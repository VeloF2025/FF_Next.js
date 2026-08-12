import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const state = vi.hoisted(() => ({ run: vi.fn(), start: vi.fn(), finalize: vi.fn(), notify: vi.fn() }));
vi.mock('@/modules/fleet/parking/runParkingCheck', () => ({ runParkingCheck: state.run }));
vi.mock('@/modules/fleet/parking/runQueries', () => ({ startParkingRun: state.start, finalizeParkingRun: state.finalize }));
vi.mock('@/modules/fleet/parking/violationNotifications', () => ({ notifyNewParkingViolations: state.notify }));
import handler from '../fleet-parking-check';

const report = { checkDate: '2026-08-11', evaluated: 2, counts: { compliant: 1, violation: 1, unknown: 0, not_verifiable: 0, no_address: 0 }, errors: 0, results: [] };
const response = () => { const res = { statusCode: 0, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; }, setHeader() { return this; }, end() { return this; } }; return res as unknown as NextApiResponse & typeof res; };
const call = async (date?: string) => { const res = response(); await handler({ method: 'GET', headers: { 'x-cron-secret': 'secret' }, query: date === undefined ? {} : { date } } as unknown as NextApiRequest, res); return res; };

describe('parking check run lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = 'secret'; state.start.mockResolvedValue('run-1'); state.run.mockResolvedValue(report); state.notify.mockResolvedValue({ warnings: 0, notifiedViolations: 1 }); state.finalize.mockResolvedValue(undefined); });
  it('does not start a run for an invalid date', async () => { expect((await call('bad')).statusCode).toBe(400); expect(state.start).not.toHaveBeenCalled(); });
  it('records a successful lifecycle', async () => { expect((await call('2026-08-11')).statusCode).toBe(200); expect(state.start.mock.invocationCallOrder[0]).toBeLessThan(state.run.mock.invocationCallOrder[0]!); expect(state.finalize).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'succeeded', evaluatedCount: 2, violationCount: 1 })); });
  it('records partial failure for record or notification warnings', async () => { state.run.mockResolvedValue({ ...report, errors: 1 }); state.notify.mockResolvedValue({ warnings: 2, notifiedViolations: 0 }); await call('2026-08-11'); expect(state.finalize).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'partial_failure', recordErrorCount: 1, notificationWarningCount: 2 })); });
  it('records fatal failure and preserves the 500', async () => { state.run.mockRejectedValue(new Error('boom')); expect((await call('2026-08-11')).statusCode).toBe(500); expect(state.finalize).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed', errorSummary: 'boom' })); });
});
