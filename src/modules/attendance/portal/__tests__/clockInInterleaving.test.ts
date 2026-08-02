import type { TxnClient } from '@/lib/db-pool';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db-pool', () => ({ transaction: vi.fn(), sql: vi.fn() }));

import { acquireAttendanceStaffGateLock } from '@/modules/attendance/corrections/lockQueries';
import { finalizeClockInTxn } from '../clockInFinalization';

const STAFF_ID = '10000000-0000-4000-8000-000000000001';
const args = {
  staffId: STAFF_ID, workDate: '2026-08-04',
  clockInAt: new Date('2026-08-04T06:00:00Z'),
  clientOccurredAt: new Date('2026-08-04T06:00:00Z'),
  lat: -26.27, lon: 27.95, accuracyM: 12, selfieInUrl: '/storage/in.jpg',
  vehicleAssignmentId: null, siteGeofenceId: null,
  deviceFingerprint: null, deviceUserAgent: 'test',
};

describe('clock-in and reconciliation interleaving', () => {
  it('waits for reconciliation, then observes its required action before inserting', async () => {
    const lock = new AdvisoryCoordinator();
    const state = { requiredAction: false, insertCount: 0 };
    const reconcileTx = txn(lock, state);
    const clockTx = txn(lock, state);

    await acquireAttendanceStaffGateLock(reconcileTx, STAFF_ID);
    const finalizing = finalizeClockInTxn(clockTx, args);
    await lock.waitUntilContended();

    state.requiredAction = true;
    lock.release();

    await expect(finalizing).resolves.toMatchObject({
      ok: false, reason: 'prior_correction_required',
      action: { exceptionId: 'exception-prior' },
    });
    expect(state.insertCount).toBe(0);
  });
});

class AdvisoryCoordinator {
  private held = false;
  private queuedResolve: (() => void) | null = null;
  private contentionResolve: (() => void) | null = null;
  private readonly contended = new Promise<void>((resolve) => { this.contentionResolve = resolve; });

  async acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return;
    }
    this.contentionResolve?.();
    await new Promise<void>((resolve) => { this.queuedResolve = resolve; });
    this.held = true;
  }

  waitUntilContended(): Promise<void> { return this.contended; }

  release(): void {
    this.held = false;
    const next = this.queuedResolve;
    this.queuedResolve = null;
    next?.();
  }
}

function txn(
  lock: AdvisoryCoordinator,
  state: { requiredAction: boolean; insertCount: number },
): TxnClient {
  return {
    query: vi.fn(async (text: string) => {
      if (/pg_advisory_xact_lock/i.test(text)) {
        await lock.acquire();
        return [{ acquired: '' }];
      }
      if (/FROM attendance_day_exceptions/i.test(text) && state.requiredAction) {
        return [{
          exception_id: 'exception-prior', entry_id: 'entry-prior', work_date: '2026-08-03',
          kind: 'missing_clock_out', proposed_regular_hours: '8', proposed_overtime_hours: '0',
          proposed_sunday_hours: '0', proposed_holiday_hours: '0',
          clock_in_at: '2026-08-03T06:00:00Z',
        }];
      }
      return [];
    }),
    queryOne: vi.fn(async (text: string) => {
      if (/INSERT INTO attendance_entries/i.test(text)) {
        state.insertCount += 1;
        return { id: 'entry-new', staff_id: STAFF_ID, work_date: args.workDate,
          clock_in_at: args.clockInAt.toISOString(), clock_out_at: null, status: 'open' };
      }
      return null;
    }),
    client: {} as TxnClient['client'],
  };
}
