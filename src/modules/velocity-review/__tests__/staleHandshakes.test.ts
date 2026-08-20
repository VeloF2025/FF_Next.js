import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), warn: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mocks.warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/lib/db-pool', () => ({
  query: mocks.query,
  queryOne: vi.fn(),
  transaction: vi.fn(),
}));

import {
  expireStalledHandshakes, markHandshakeTagsLeft, sweepStalledHandshakes,
  type StaleHandshakeRow,
} from '../staleHandshakes';
import { HighLevelRequestError } from '../ghlClient';
import { ENROLLED_TAG, READY_TAG } from '../types';

function sweepDeps(expired: StaleHandshakeRow[], removeTags = vi.fn(async () => undefined)) {
  return {
    ghl: { removeTags },
    exports: {
      expireStalledHandshakes: vi.fn(async () => expired),
      markHandshakeTagsLeft: vi.fn(async () => undefined),
    },
  };
}

describe('expireStalledHandshakes', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('resolves only ambiguous and ack_cleanup_pending rows older than the cutoff', async () => {
    mocks.query.mockResolvedValue([
      { id: 'a', ghl_contact_id: 'contact-a' },
      { id: 'b', ghl_contact_id: null },
    ]);
    const cutoff = new Date('2026-08-19T09:00:00.000Z');
    const now = new Date('2026-08-20T09:00:00.000Z');

    const expired = await expireStalledHandshakes(cutoff, now);

    expect(expired).toEqual([
      { id: 'a', ghlContactId: 'contact-a' },
      { id: 'b', ghlContactId: null },
    ]);
    const [sql, params] = mocks.query.mock.calls[0];
    // One injectable clock: the retry-due bound is a parameter, not SQL NOW().
    expect(params).toEqual([cutoff, now]);
    expect(sql).toContain("state IN ('ambiguous', 'ack_cleanup_pending')");
    expect(sql).toContain('updated_at < $1');
    expect(sql).toContain("state = 'permanent_failure'");
    // The contact id is what makes tag cleanup possible; without it the sweep is blind.
    expect(sql).toContain('RETURNING id, ghl_contact_id');
  });

  it('leaves a row alone while its own retry is still scheduled', async () => {
    mocks.query.mockResolvedValue([]);

    await expireStalledHandshakes(new Date('2026-08-19T09:00:00.000Z'), new Date());

    // nextRetryAt honours an uncapped GHL Retry-After, so a pending next_attempt_at
    // can outlive the stale window; expiring it would drop a live retry.
    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain('next_attempt_at IS NULL OR next_attempt_at <= $2');
  });

  it('does not prefix a bare handshake code with a colon', async () => {
    mocks.query.mockResolvedValue([]);

    await expireStalledHandshakes(new Date(), new Date());

    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain("COALESCE(error_code || ':', '') || 'handshake_expired'");
  });

  it('reports nothing when no row is stale', async () => {
    mocks.query.mockResolvedValue([]);
    await expect(expireStalledHandshakes(new Date(), new Date())).resolves.toEqual([]);
  });
});

describe('markHandshakeTagsLeft', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue([]);
  });

  it('appends the marker to the row it is given without dropping the existing code', async () => {
    await markHandshakeTagsLeft('export-9');

    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual(['export-9']);
    expect(sql).toContain("COALESCE(error_code || ':', '') || 'tags_left'");
    expect(sql).toContain('WHERE id = $1');
  });
});

describe('sweepStalledHandshakes', () => {
  it('clears both transient tags off every expired row that reached a contact', async () => {
    const deps = sweepDeps([
      { id: 'a', ghlContactId: 'contact-a' },
      { id: 'b', ghlContactId: 'contact-b' },
    ]);
    const cutoff = new Date('2026-08-19T09:00:00.000Z');
    const now = new Date('2026-08-20T09:00:00.000Z');

    await expect(sweepStalledHandshakes(cutoff, now, deps)).resolves.toBe(2);

    expect(deps.exports.expireStalledHandshakes).toHaveBeenCalledWith(cutoff, now);
    // Leaving either tag behind parks the next install at that number on
    // `stale_transient_tag`, regenerating the stall this sweep exists to end.
    expect(deps.ghl.removeTags.mock.calls).toEqual([
      ['contact-a', [READY_TAG, ENROLLED_TAG]],
      ['contact-b', [READY_TAG, ENROLLED_TAG]],
    ]);
    expect(deps.exports.markHandshakeTagsLeft).not.toHaveBeenCalled();
  });

  it('skips a row that never reached a contact', async () => {
    const deps = sweepDeps([{ id: 'a', ghlContactId: null }]);

    await expect(sweepStalledHandshakes(new Date(), new Date(), deps)).resolves.toBe(1);

    expect(deps.ghl.removeTags).not.toHaveBeenCalled();
    expect(deps.exports.markHandshakeTagsLeft).not.toHaveBeenCalled();
  });

  it('removes once per contact when two DR numbers share it', async () => {
    const deps = sweepDeps([
      { id: 'a', ghlContactId: 'contact-a' },
      { id: 'b', ghlContactId: 'contact-a' },
    ]);

    await sweepStalledHandshakes(new Date(), new Date(), deps);

    expect(deps.ghl.removeTags).toHaveBeenCalledTimes(1);
  });

  it('still expires the row when GHL is down, and records the tag it could not clear', async () => {
    const removeTags = vi.fn(async () => { throw new Error('GHL 503'); });
    const deps = sweepDeps([
      { id: 'a', ghlContactId: 'contact-a' },
      { id: 'b', ghlContactId: 'contact-a' },
    ], removeTags);

    // Expiry is the deadlock fix and must not depend on GHL being reachable.
    await expect(sweepStalledHandshakes(new Date(), new Date(), deps)).resolves.toBe(2);

    expect(removeTags).toHaveBeenCalledTimes(1);
    expect(deps.exports.markHandshakeTagsLeft.mock.calls).toEqual([['a'], ['b']]);
  });

  it('logs the GHL status behind a removal it could not complete', async () => {
    const removeTags = vi.fn(async () => {
      throw new HighLevelRequestError('rate limited', 429, true, false);
    });
    const deps = sweepDeps([{ id: 'a', ghlContactId: 'contact-a' }], removeTags);
    mocks.warn.mockClear();

    await sweepStalledHandshakes(new Date(), new Date(), deps);

    // A bare error code with no status left 225 rows untriageable on 2026-08-03, and
    // the status is recorded nowhere else once the promise is swallowed.
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0][1]).toMatchObject({
      exportId: 'a', contactId: 'contact-a', status: 429,
    });
  });

  it('does not mark rows on a contact whose removal succeeded', async () => {
    const removeTags = vi.fn(async (contactId: string) => {
      if (contactId === 'contact-b') throw new Error('GHL 503');
    });
    const deps = sweepDeps([
      { id: 'a', ghlContactId: 'contact-a' },
      { id: 'b', ghlContactId: 'contact-b' },
    ], removeTags);

    await sweepStalledHandshakes(new Date(), new Date(), deps);

    expect(deps.exports.markHandshakeTagsLeft.mock.calls).toEqual([['b']]);
  });
});
