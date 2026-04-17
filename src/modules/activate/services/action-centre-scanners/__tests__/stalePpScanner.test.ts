/**
 * Unit tests for scanStalePp.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));
vi.mock('@/modules/activate/services/activity-log/eventLoggers', () => ({
  logAnomalyStalePp: vi.fn(),
}));

import { scanStalePp } from '../stalePpScanner';
import pool from '@/lib/db';
import { logAnomalyStalePp } from '@/modules/activate/services/activity-log/eventLoggers';

const mockQuery = vi.mocked(pool.query);
const mockLog = vi.mocked(logAnomalyStalePp);

beforeEach(() => {
  mockQuery.mockReset();
  mockLog.mockReset();
  mockLog.mockResolvedValue('event-id');
});

describe('scanStalePp', () => {
  it('emits anomaly for PP rows that resolve to a DR', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          dr_number: 'DR100',
          serial_number: 'ALCLB48E0001',
          project: 'Mohadin',
          resolution_status: 'located_oes',
          age_days: 45,
        },
      ],
    });
    // Idempotency check: no existing event
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const summary = await scanStalePp(30);

    expect(summary.staleRowsDetected).toBe(1);
    expect(summary.eventsEmitted).toBe(1);
    expect(summary.skippedNoDrNumber).toBe(0);
    expect(mockLog).toHaveBeenCalledWith('DR100', {
      serial: 'ALCLB48E0001',
      ageDays: 45,
      resolutionStatus: 'located_oes',
      project: 'Mohadin',
    });
  });

  it('skips PP rows without a resolved drop number — counted separately', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          dr_number: null,
          serial_number: 'ALCLB48E9999',
          project: null,
          resolution_status: null,
          age_days: 60,
        },
      ],
    });

    const summary = await scanStalePp(30);

    expect(summary.staleRowsDetected).toBe(1);
    expect(summary.skippedNoDrNumber).toBe(1);
    expect(summary.eventsEmitted).toBe(0);
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('honors the 30-day idempotency window', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          dr_number: 'DR100',
          serial_number: 'ALCLB48E0001',
          project: 'Mohadin',
          resolution_status: 'located_oes',
          age_days: 45,
        },
      ],
    });
    // Existing anomaly found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing' }] });

    const summary = await scanStalePp(30);

    expect(summary.skippedAlreadyEmitted).toBe(1);
    expect(summary.eventsEmitted).toBe(0);
  });

  it('passes the custom stale threshold into the SELECT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await scanStalePp(60);

    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual([60]);
  });
});
