/**
 * Unit tests for the cortex/meeting-review proxy logic.
 *
 * Tests focus on the pure mapping/routing logic with injectable sql and fetchFn,
 * mirroring the pattern in src/lib/cortex/__tests__/pullMeetingActions.test.ts.
 *
 * The pure functions live in src/lib/cortex/meetingReviewLogic.ts (extracted for
 * testability). The route handler in [meetingId].ts is a thin auth + dispatch
 * wrapper that calls these functions.
 *
 * NOTE: Full HTTP integration (cookie auth, withPermission) requires a running
 * Next.js server and is out of scope here.
 */

import { describe, it, expect } from 'vitest';
import type { NeonQueryFunction } from '@/lib/db-neon';
import {
  resolveCallRecordId,
  readSealedRow,
  resolveUnsealedMeetingId,
  fetchLiveState,
  deleteLocalSealedRow,
} from '@/lib/cortex/meetingReviewLogic';

// ── fake sql ──────────────────────────────────────────────────────────────────

interface FakeSqlState {
  callRecord?: string | null;
  sealedRow?: Record<string, unknown> | null;
  deleted?: boolean;
}

function makeFakeSql(state: FakeSqlState): NeonQueryFunction<false, false> {
  return ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = (strings as string[]).join(' ? ').toLowerCase();
    if (q.includes('teams_call_record_id')) {
      return Promise.resolve(
        state.callRecord !== undefined ? [{ teams_call_record_id: state.callRecord }] : []
      );
    }
    if (q.includes('cortex_meeting_actions') && q.includes('select')) {
      return Promise.resolve(state.sealedRow ? [state.sealedRow] : []);
    }
    if (q.includes('delete from cortex_meeting_actions')) {
      state.deleted = true;
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as unknown as NeonQueryFunction<false, false>;
}

// ── fake fetch ────────────────────────────────────────────────────────────────

function makeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok, status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const BRIDGE = 'http://bridge:7403';
const KEY = 'test-key';
const EMAIL = 'reviewer@test.com';

// ── resolveCallRecordId ───────────────────────────────────────────────────────

describe('resolveCallRecordId', () => {
  it('returns teams_call_record_id from the meetings row', async () => {
    const sql = makeFakeSql({ callRecord: 'cr-abc123' });
    expect(await resolveCallRecordId(sql, '92488')).toBe('cr-abc123');
  });

  it('returns null when meeting has no call record id', async () => {
    const sql = makeFakeSql({ callRecord: null });
    expect(await resolveCallRecordId(sql, '99999')).toBeNull();
  });

  it('returns null when meeting row does not exist', async () => {
    const sql = makeFakeSql({} as FakeSqlState);
    expect(await resolveCallRecordId(sql, '00000')).toBeNull();
  });
});

// ── readSealedRow ─────────────────────────────────────────────────────────────

describe('readSealedRow', () => {
  it('returns SealedMeetingPanel when a sealed row exists', async () => {
    const sql = makeFakeSql({
      sealedRow: {
        cortex_meeting_id: 'mtg_a',
        seal_source: 'human',
        human_reviewed: true,
        sealed_at: '2026-05-31T10:00:00Z',
        summary: 'We shipped.',
        items: [{ action_id: 'a0', text: 'Do thing', owner: null, due: null, confidence: 0.9, kind: 'action', meeting_id: 'mtg_a', content_key: 'k0', source_quotes: [] }],
      },
    });
    const result = await readSealedRow(sql, '92488');
    expect(result).not.toBeNull();
    expect(result?.panelState).toBe('sealed');
    expect(result?.cortexMeetingId).toBe('mtg_a');
    expect(result?.sealSource).toBe('human');
    expect(result?.humanReviewed).toBe(true);
    expect(result?.items).toHaveLength(1);
  });

  it('returns null when no sealed row exists', async () => {
    const sql = makeFakeSql({ sealedRow: null });
    expect(await readSealedRow(sql, '99999')).toBeNull();
  });

  it('handles items being a non-array gracefully', async () => {
    const sql = makeFakeSql({
      sealedRow: {
        cortex_meeting_id: 'mtg_b',
        seal_source: 'auto',
        human_reviewed: false,
        sealed_at: null,
        summary: null,
        items: null,  // DB returned null instead of []
      },
    });
    const result = await readSealedRow(sql, '92488');
    expect(result?.items).toEqual([]);
  });
});

// ── resolveUnsealedMeetingId ──────────────────────────────────────────────────

describe('resolveUnsealedMeetingId', () => {
  const queue = {
    meetings: [
      { meeting_id: 'mtg_b', source_id: 'cr-abc123', title: 'Sprint', action_count: 2, processing_status: 'completed', updated_at: '' },
      { meeting_id: 'mtg_c', source_id: 'cr-other', title: 'Other', action_count: 0, processing_status: 'completed', updated_at: '' },
    ],
  };

  it('returns the Cortex meeting_id when source_id matches', async () => {
    const result = await resolveUnsealedMeetingId('cr-abc123', EMAIL, BRIDGE, KEY, makeFetch(queue));
    expect(result).toBe('mtg_b');
  });

  it('returns null when source_id is not in the queue', async () => {
    const result = await resolveUnsealedMeetingId('cr-zzz', EMAIL, BRIDGE, KEY, makeFetch(queue));
    expect(result).toBeNull();
  });

  it('returns null on a non-OK response', async () => {
    const result = await resolveUnsealedMeetingId('cr-abc123', EMAIL, BRIDGE, KEY, makeFetch({}, false, 503));
    expect(result).toBeNull();
  });

  it('defensively tolerates a bare-array response shape (not the documented contract)', async () => {
    // Cortex's documented /review-queue response is { meetings: [...] }. This test only
    // pins the defensive fallback in resolveUnsealedMeetingId for an array-at-root body;
    // it is NOT asserting that Cortex emits this shape.
    const result = await resolveUnsealedMeetingId('cr-abc123', EMAIL, BRIDGE, KEY, makeFetch(queue.meetings));
    expect(result).toBe('mtg_b');
  });
});

// ── fetchLiveState ────────────────────────────────────────────────────────────

describe('fetchLiveState', () => {
  it('returns the proposed_actions from live-state', async () => {
    // Cortex /live-state returns `minutes` as an ARRAY of running-minute entries,
    // not a string (rendering the raw array previously crashed the panel, React #31).
    const liveState = {
      proposed_actions: [
        { action_id: 'a1', text: 'Do this', owner: 'Hein', due: null, confidence: 0.9, state: 'proposed', source_quotes: [], history: [] },
      ],
      minutes: [
        { entry_id: 'min_1', kind: 'decision', text: 'Ship the reviewer', content_key: 'k1', segment_index: 0, superseded_by: null, created_at: '2026-05-31T00:00:00Z' },
      ],
    };
    const result = await fetchLiveState('mtg_a', EMAIL, BRIDGE, KEY, makeFetch(liveState));
    expect(result).not.toBeNull();
    expect(result?.proposed_actions).toHaveLength(1);
    expect(Array.isArray(result?.minutes)).toBe(true);
    expect(result?.minutes?.[0].text).toBe('Ship the reviewer');
  });

  it('returns null on a non-OK response', async () => {
    const result = await fetchLiveState('mtg_x', EMAIL, BRIDGE, KEY, makeFetch({}, false, 404));
    expect(result).toBeNull();
  });
});

// ── deleteLocalSealedRow ──────────────────────────────────────────────────────

describe('deleteLocalSealedRow', () => {
  it('issues a DELETE for the given ff_meeting_id', async () => {
    const state: FakeSqlState = { deleted: false };
    const sql = makeFakeSql(state);
    await deleteLocalSealedRow(sql, '92488');
    expect(state.deleted).toBe(true);
  });
});
