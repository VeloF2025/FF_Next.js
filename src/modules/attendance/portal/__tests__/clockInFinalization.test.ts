import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TxnClient } from '@/lib/db-pool';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ transaction: mocks.transaction }));

import { finalizeClockIn } from '../clockInFinalization';

const args = {
  staffId: '10000000-0000-4000-8000-000000000001',
  clockInAt: new Date('2026-08-04T06:00:00Z'),
  clientOccurredAt: new Date('2026-08-04T06:00:00Z'),
  workDate: '2026-08-04',
  lat: -26.27,
  lon: 27.95,
  accuracyM: 12,
  selfieInUrl: '/storage/in.jpg',
  vehicleAssignmentId: null,
  siteGeofenceId: null,
  deviceFingerprint: null,
  deviceUserAgent: 'test',
};

beforeEach(() => vi.clearAllMocks());

describe('clock-in final predicate', () => {
  it('blocks when reconciliation creates a required action before the shared staff lock is acquired', async () => {
    const tx = txn({ requiredAction: true });
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(finalizeClockIn(args)).resolves.toMatchObject({
      ok: false,
      reason: 'prior_correction_required',
      action: { exceptionId: 'exception-prior' },
    });

    const statements = tx.calls.map((call) => call.text);
    const staffLockIndex = statements.findIndex((text) => /attendance-staff-gate/.test(JSON.stringify(tx.calls)) && /pg_advisory_xact_lock/i.test(text));
    const predicateIndex = statements.findIndex((text) => /attendance_day_exceptions/i.test(text));
    expect(staffLockIndex).toBeGreaterThanOrEqual(0);
    expect(staffLockIndex).toBeLessThan(predicateIndex);
    expect(statements).not.toEqual(expect.arrayContaining([expect.stringMatching(/INSERT INTO attendance_entries/i)]));
  });

  it('rechecks the open-entry predicate under the staff lock', async () => {
    const tx = txn({ openEntry: true });
    mocks.transaction.mockImplementation(async (work) => work(tx));
    await expect(finalizeClockIn(args)).resolves.toMatchObject({
      ok: false, reason: 'open_entry', entry: { id: 'entry-open' },
    });
    expect(tx.calls.some((call) => /attendance_day_exceptions/i.test(call.text))).toBe(false);
  });

  it('inserts only after both final predicates pass under the same transaction', async () => {
    const tx = txn({});
    mocks.transaction.mockImplementation(async (work) => work(tx));
    await expect(finalizeClockIn(args)).resolves.toMatchObject({
      ok: true, entry: { id: 'entry-new', status: 'open' },
    });
    const statements = tx.calls.map((call) => call.text);
    expect(statements.findIndex((text) => /attendance_day_exceptions/i.test(text))).toBeLessThan(
      statements.findIndex((text) => /INSERT INTO attendance_entries/i.test(text)),
    );
  });
});

interface Call { text: string; params: unknown[] }
function txn(state: { openEntry?: boolean; requiredAction?: boolean }) {
  const calls: Call[] = [];
  return {
    calls,
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
      if (/attendance_day_exceptions/i.test(text) && state.requiredAction) {
        return [{
          exception_id: 'exception-prior', entry_id: 'entry-prior', work_date: '2026-08-03',
          kind: 'missing_clock_out', proposed_regular_hours: '8', proposed_overtime_hours: '0',
          proposed_sunday_hours: '0', proposed_holiday_hours: '0',
          clock_in_at: '2026-08-03T06:00:00Z',
        }];
      }
      return [];
    }),
    queryOne: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (/status = 'open'/i.test(text) && state.openEntry) {
        return { id: 'entry-open', staff_id: args.staffId, work_date: '2026-08-03',
          clock_in_at: '2026-08-03T06:00:00Z', clock_out_at: null, status: 'open' };
      }
      if (/INSERT INTO attendance_entries/i.test(text)) {
        return { id: 'entry-new', staff_id: args.staffId, work_date: args.workDate,
          clock_in_at: args.clockInAt.toISOString(), clock_out_at: null, status: 'open' };
      }
      return null;
    }),
    client: {},
  } as unknown as TxnClient & { calls: Call[] };
}
