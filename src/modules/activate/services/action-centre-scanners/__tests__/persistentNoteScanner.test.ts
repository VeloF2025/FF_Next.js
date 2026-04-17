/**
 * Unit tests for scanPersistentNotes.
 *
 * Uses a stubbed pool so we can assert:
 *   - Aggregation query fires with the correct minConsecutiveWeeks
 *   - Idempotency check gates duplicate emissions
 *   - New runs emit via logAnomalyPersistentNote
 *   - Errors on one row do not stop the rest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.mock is hoisted above imports, so mock fns must be created inside the
// factory (not captured from an outer const). We re-grab them below with
// vi.mocked() after the SUT import.
vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
}));
vi.mock('@/modules/activate/services/activity-log/eventLoggers', () => ({
  logAnomalyPersistentNote: vi.fn(),
}));

import { scanPersistentNotes } from '../persistentNoteScanner';
import pool from '@/lib/db';
import { logAnomalyPersistentNote } from '@/modules/activate/services/activity-log/eventLoggers';

const mockQuery = vi.mocked(pool.query);
const mockLogAnomalyPersistentNote = vi.mocked(logAnomalyPersistentNote);

beforeEach(() => {
  mockQuery.mockReset();
  mockLogAnomalyPersistentNote.mockReset();
  mockLogAnomalyPersistentNote.mockResolvedValue('event-id');
});

describe('scanPersistentNotes', () => {
  it('returns zeroed summary when no runs detected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const summary = await scanPersistentNotes(3);

    expect(summary.runsDetected).toBe(0);
    expect(summary.eventsEmitted).toBe(0);
    expect(summary.errors).toEqual([]);
    expect(mockLogAnomalyPersistentNote).not.toHaveBeenCalled();
  });

  it('emits anomaly for each newly-detected run', async () => {
    // First call: aggregation query returns 2 runs
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          dr_number: 'DR100',
          deduction_note: 'note4',
          first_week: '2026-03-29',
          latest_week: '2026-04-12',
          run_length: 3,
        },
        {
          dr_number: 'DR200',
          deduction_note: 'note5',
          first_week: '2026-03-22',
          latest_week: '2026-04-12',
          run_length: 4,
        },
      ],
    });
    // Idempotency checks for both rows: no existing event
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const summary = await scanPersistentNotes(3);

    expect(summary.runsDetected).toBe(2);
    expect(summary.eventsEmitted).toBe(2);
    expect(summary.skippedAlreadyEmitted).toBe(0);
    expect(mockLogAnomalyPersistentNote).toHaveBeenCalledTimes(2);
    expect(mockLogAnomalyPersistentNote).toHaveBeenCalledWith('DR100', {
      noteCode: 'note4',
      consecutiveWeeks: 3,
      firstWeek: '2026-03-29',
      latestWeek: '2026-04-12',
    });
  });

  it('skips runs whose anomaly was already emitted in the idempotency window', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          dr_number: 'DR100',
          deduction_note: 'note4',
          first_week: '2026-03-29',
          latest_week: '2026-04-12',
          run_length: 3,
        },
      ],
    });
    // Existing event found — idempotency check returns a row
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-event-id' }] });

    const summary = await scanPersistentNotes(3);

    expect(summary.skippedAlreadyEmitted).toBe(1);
    expect(summary.eventsEmitted).toBe(0);
    expect(mockLogAnomalyPersistentNote).not.toHaveBeenCalled();
  });

  it('continues when one emission fails, collecting the error in the summary', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          dr_number: 'DR100',
          deduction_note: 'note4',
          first_week: '2026-03-29',
          latest_week: '2026-04-12',
          run_length: 3,
        },
        {
          dr_number: 'DR200',
          deduction_note: 'note5',
          first_week: '2026-03-22',
          latest_week: '2026-04-12',
          run_length: 4,
        },
      ],
    });
    // Idempotency checks succeed for both
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // First emit fails, second succeeds
    mockLogAnomalyPersistentNote
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('event-id-2');

    const summary = await scanPersistentNotes(3);

    expect(summary.eventsEmitted).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toBe('boom');
  });

  it('captures scanner-wide failure as a single error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    const summary = await scanPersistentNotes(3);

    expect(summary.runsDetected).toBe(0);
    expect(summary.errors).toContain('db down');
  });

  it('passes minConsecutiveWeeks into the aggregation query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await scanPersistentNotes(5);

    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual([5]);
  });
});
