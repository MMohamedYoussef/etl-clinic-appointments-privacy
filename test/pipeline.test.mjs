import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from '../pipeline.mjs';

test('exports stable pseudonyms and no-show rates without names or raw patient IDs', () => {
  const rows = [
    { appointment_id: 'A', patient_id: 'P1', patient_name: 'Synthetic One', clinic: 'North', start_time: '2026-09-01T09:00:00Z', status: 'COMPLETED' },
    { appointment_id: 'B', patient_id: 'P2', patient_name: 'Synthetic Two', clinic: 'North', start_time: '2026-09-01T10:00:00Z', status: 'NO_SHOW' },
  ];
  const result = transform(rows, 'test-key');
  assert.equal(result.metrics[0].no_show_rate, 0.5);
  assert.match(result.appointments[0].patient_key, /^[a-f0-9]{16}$/);
  assert.ok(!JSON.stringify(result).includes('Synthetic One'));
  assert.ok(!JSON.stringify(result).includes('P1'));
  assert.deepEqual(transform(rows, 'test-key').appointments, result.appointments);
});

test('quarantines impossible dates without leaking the source row', () => {
  const result = transform([{ appointment_id: 'A', patient_id: 'P1', patient_name: 'Synthetic One', clinic: 'North', start_time: 'not-a-date', status: 'NO_SHOW' }], 'test-key');
  assert.equal(result.quarantine[0].reason, 'invalid_appointment');
  assert.ok(!JSON.stringify(result).includes('Synthetic One'));
  assert.deepEqual(transform([], 'test-key').metrics, []);
});

test('quarantines null, impossible, and timezone-less appointment times', () => {
  const rows = [null, '2026-02-30T09:00:00Z', '2026-09-01T09:00:00'].map((start_time, index) => ({
    appointment_id: `A${index}`, patient_id: 'P1', clinic: 'North', start_time, status: 'NO_SHOW',
  }));
  const result = transform(rows, 'test-key');
  assert.deepEqual(result.appointments, []);
  assert.deepEqual(result.quarantine.map(row => row.reason), ['invalid_appointment', 'invalid_appointment', 'invalid_appointment']);
  assert.equal(transform([{ ...rows[0], start_time: '2026-09-01T11:00:00+02:00' }], 'test-key').appointments[0].day, '2026-09-01');
});
