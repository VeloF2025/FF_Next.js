/**
 * The history screen and the target lookup must agree on which exceptions
 * are still correctable — they share one predicate, and these tests pin the
 * clauses that make the answer fail-closed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query }));

import {
  findCorrectionTarget,
  mapOpenCorrectionsByEntry,
} from '../correctionEligibility';

const STAFF = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
});

describe('mapOpenCorrectionsByEntry', () => {
  it('never queries for an empty entry list', async () => {
    const result = await mapOpenCorrectionsByEntry(STAFF, []);
    expect(result.size).toBe(0);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('scopes to the asking staff member and the requested entries', async () => {
    await mapOpenCorrectionsByEntry(STAFF, ['entry-1', 'entry-2']);
    const [statement, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([STAFF, ['entry-1', 'entry-2']]);
    expect(statement).toMatch(/de\.staff_id = \$1::uuid/i);
    expect(statement).toMatch(/de\.entry_id = ANY\(\$2::uuid\[\]\)/i);
    expect(statement).toMatch(/e\.staff_id = de\.staff_id/i);
    // Fail-closed clauses: an entry already corrected, resolved, or recomputed
    // must not surface a correction link.
    expect(statement).toMatch(/de\.kind = 'missing_clock_out'/i);
    expect(statement).toMatch(/de\.status = 'awaiting_worker'/i);
    expect(statement).toMatch(/de\.adjustment_id IS NULL/i);
    expect(statement).toMatch(/de\.resolved_at IS NULL/i);
    expect(statement).toMatch(/e\.clock_out_at IS NULL/i);
    expect(statement).toMatch(/ds\.result_version = de\.result_version/i);
  });

  it('maps entry id to exception id', async () => {
    mocks.query.mockResolvedValue([
      { entry_id: 'entry-1', exception_id: 'exception-1' },
      { entry_id: 'entry-9', exception_id: 'exception-9' },
    ]);
    const result = await mapOpenCorrectionsByEntry(STAFF, ['entry-1', 'entry-9']);
    expect(result.get('entry-1')).toBe('exception-1');
    expect(result.get('entry-9')).toBe('exception-9');
  });

  it('keeps the oldest exception when an entry carries two', async () => {
    // Rows arrive created_at ASC, so the first one wins.
    mocks.query.mockResolvedValue([
      { entry_id: 'entry-1', exception_id: 'older' },
      { entry_id: 'entry-1', exception_id: 'newer' },
    ]);
    const result = await mapOpenCorrectionsByEntry(STAFF, ['entry-1']);
    expect(result.get('entry-1')).toBe('older');
    expect(result.size).toBe(1);
  });
});

describe('findCorrectionTarget', () => {
  it('returns null when the predicate excludes the exception', async () => {
    expect(await findCorrectionTarget(STAFF, 'exception-1')).toBeNull();
  });

  it('returns the single matching row', async () => {
    mocks.query.mockResolvedValue([{ exception_id: 'exception-1', entry_id: 'entry-1' }]);
    const target = await findCorrectionTarget(STAFF, 'exception-1');
    expect(target).toEqual({ exception_id: 'exception-1', entry_id: 'entry-1' });
    const [statement, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([STAFF, 'exception-1']);
    expect(statement).toMatch(/de\.id = \$2::uuid/i);
    expect(statement).toMatch(/LIMIT 1/i);
  });
});
