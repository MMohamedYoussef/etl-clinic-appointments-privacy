import { createHmac } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 ||
      Number(minute) > 59 || Number(second) > 59) return null;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function transform(source, secret) {
  if (typeof secret !== 'string' || !secret) throw new Error('PSEUDONYM_KEY is required');
  const seen = new Map();
  const appointments = [];
  const quarantine = [];
  const clinicCounts = new Map();
  source.forEach((row, source_index) => {
    const date = parseTimestamp(row?.start_time);
    if (typeof row?.appointment_id !== 'string' || !row.appointment_id ||
        typeof row?.patient_id !== 'string' || !row.patient_id ||
        typeof row?.clinic !== 'string' || !row.clinic || !date ||
        !['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(row?.status)) {
      quarantine.push({ source_index, reason: 'invalid_appointment' });
      return;
    }
    const prior = seen.get(row.appointment_id);
    if (prior !== undefined) {
      if (prior !== JSON.stringify(row)) quarantine.push({ source_index, reason: 'conflicting_duplicate' });
      return;
    }
    seen.set(row.appointment_id, JSON.stringify(row));
    const patient_key = createHmac('sha256', secret).update(row.patient_id).digest('hex').slice(0, 16);
    appointments.push({ patient_key, clinic: row.clinic, day: date.toISOString().slice(0, 10), status: row.status });
    const count = clinicCounts.get(row.clinic) ?? { clinic: row.clinic, completed: 0, no_show: 0, cancelled: 0 };
    if (row.status === 'COMPLETED') count.completed++;
    else if (row.status === 'NO_SHOW') count.no_show++;
    else count.cancelled++;
    clinicCounts.set(row.clinic, count);
  });
  appointments.sort((a, b) => a.clinic.localeCompare(b.clinic) || a.day.localeCompare(b.day) || a.patient_key.localeCompare(b.patient_key));
  const metrics = [...clinicCounts.values()].sort((a, b) => a.clinic.localeCompare(b.clinic)).map(count => ({
    ...count, no_show_rate: count.completed + count.no_show === 0 ? 0 : Math.round(count.no_show / (count.completed + count.no_show) * 10000) / 10000,
  }));
  return { appointments, metrics, quarantine };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const source = JSON.parse(await readFile(path.join(root, 'fixtures/appointments.json'), 'utf8'));
  const result = transform(source, process.env.PSEUDONYM_KEY);
  await mkdir(path.join(root, 'examples'), { recursive: true });
  await writeFile(path.join(root, 'examples/result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Loaded ${result.appointments.length} safe appointments; quarantined ${result.quarantine.length}`);
}
