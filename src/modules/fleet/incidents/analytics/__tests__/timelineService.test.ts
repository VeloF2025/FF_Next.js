import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The db mock dispatches on the SQL comment tag each timeline query carries
 * (`fleet-incident-timeline:<source>`), not on call order — the service issues
 * its five source reads concurrently, so an order-based mock would pass or fail
 * depending on scheduling rather than on behaviour.
 */
const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne }));

const scopeMock = vi.hoisted(() => ({
  resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn(),
}));
vi.mock('../../reviewScope', () => scopeMock);

const coreMock = vi.hoisted(() => ({ getIncidentCore: vi.fn() }));
vi.mock('../../reviewQueries', () => coreMock);

const namesMock = vi.hoisted(() => ({ resolveActiveUserNames: vi.fn() }));
vi.mock('../../settingsRepository', () => namesMock);

import { getIncidentTimeline, IncidentTimelineAccessDeniedError } from '../timelineService';
import { IncidentNotFoundError } from '../../incidentRepository';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const OTHER_INCIDENT = '99999999-9999-4999-8999-999999999999';
const USER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const MANAGER = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';

const viewer = { userId: USER, staffId: STAFF, role: 'project_manager' };

/** Per-tag query results for one test. Any tag left unset returns []. */
type Rows = Record<string, Record<string, unknown>[]>;

/**
 * The ordering key each source is read on, so the mock can page the way
 * Postgres does. `notifications` has no id — the minute bucket it groups on is
 * both its instant and its identity.
 */
const SOURCE_KEYS: Record<string, { time: string; id: string }> = {
  actions: { time: 'occurred_at', id: 'id' },
  observations: { time: 'observed_at', id: 'id' },
  attendance: { time: 'linked_at', id: 'id' },
  notifications: { time: 'occurred_at', id: 'occurred_at' },
  retention_holds: { time: 'occurred_at', id: 'id' },
};

/**
 * A mock that returns every row regardless of the bound it was handed cannot
 * fail a pagination test — it answers page two with the whole history, which is
 * exactly what a broken keyset would have to be caught doing. So this applies
 * the cursor predicate, the ordering, and the LIMIT the way the database would,
 * and a query whose parameters it cannot honour is an error rather than a
 * silent full read.
 */
function respondWith(rows: Rows): void {
  db.query.mockImplementation(async (text: string, params: unknown[]) => {
    const tag = /fleet-incident-timeline:([a-z_]+)/.exec(text)?.[1];
    if (!tag) throw new Error(`timeline query is missing its comment tag: ${text.slice(0, 80)}`);
    const keys = SOURCE_KEYS[tag];
    if (!keys) throw new Error(`timeline query carries an unknown source tag: ${tag}`);
    const [, after, afterId, includeAtInstant, limit] = params as
      [string, string | null, string | null, boolean, number];
    if (typeof limit !== 'number') throw new Error(`timeline query ${tag} passed no row limit`);
    if (typeof includeAtInstant !== 'boolean') throw new Error(`timeline query ${tag} passed no instant rule`);

    const at = (row: Record<string, unknown>, column: string): number => Date.parse(String(row[column]));
    const key = (row: Record<string, unknown>): string => String(row[keys.id]);
    const ordered = [...(rows[tag] ?? [])].sort((left, right) => (
      at(left, keys.time) - at(right, keys.time) || (key(left) < key(right) ? -1 : Number(key(left) > key(right)))
    ));
    const bounded = after === null ? ordered : ordered.filter((row) => {
      const instant = at(row, keys.time) - Date.parse(after);
      if (instant !== 0) return instant > 0;
      return includeAtInstant && (afterId === null || key(row) > afterId);
    });
    return bounded.slice(0, limit);
  });
}

/**
 * Reads the chronology the way the drawer does — first page, then each
 * `nextCursor` until the server stops offering one — and returns every
 * `stableId` it was shown, in order.
 */
async function walkEveryPage(limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 500; guard += 1) {
    const page = await getIncidentTimeline(INCIDENT, viewer, { limit, cursor });
    seen.push(...page.entries.map((entry) => entry.stableId));
    if (!page.nextCursor) return seen;
    cursor = page.nextCursor;
  }
  throw new Error('pagination never reached a last page');
}

function capturedSql(): string {
  return db.query.mock.calls.map((call) => String(call[0])).join('\n');
}

const actionRow = {
  id: 'aaaaaaa1-0000-4000-8000-000000000001', action_type: 'acknowledged', actor_user_id: MANAGER,
  is_system_actor: false, occurred_at: '2026-08-13T08:10:00.000Z', visibility: 'internal',
};

/** Five manager actions a minute apart — enough to page through more than once. */
const many = Array.from({ length: 5 }, (_, index) => ({
  ...actionRow,
  id: `aaaaaaa1-0000-4000-8000-00000000000${index}`,
  occurred_at: `2026-08-13T08:0${index}:00.000Z`,
}));

beforeEach(() => {
  vi.clearAllMocks();
  scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
  scopeMock.isProjectOwnedByScope.mockResolvedValue(true);
  coreMock.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: PROJECT });
  namesMock.resolveActiveUserNames.mockResolvedValue([{ id: MANAGER, name: 'Thabo Nkosi' }]);
  respondWith({});
});

describe('getIncidentTimeline scope', () => {
  it('refuses an incident outside the viewer project scope the way the detail read does', async () => {
    // 403, not 404: `reviewService.ts#getIncidentDetailForViewer` answers 403
    // for exactly this condition, and two endpoints on the same incident must
    // not disagree about whether it exists.
    scopeMock.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(getIncidentTimeline(OTHER_INCIDENT, viewer))
      .rejects.toThrow(IncidentTimelineAccessDeniedError);
  });

  it('refuses an incident that does not exist', async () => {
    coreMock.getIncidentCore.mockResolvedValue(null);
    await expect(getIncidentTimeline(INCIDENT, viewer)).rejects.toThrow(IncidentNotFoundError);
  });

  it('reads no source table when the scope check fails', async () => {
    scopeMock.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(getIncidentTimeline(INCIDENT, viewer))
      .rejects.toThrow(IncidentTimelineAccessDeniedError);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('skips the project check for an unrestricted oversight scope', async () => {
    scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: USER, pmStaffId: STAFF });
    respondWith({ actions: [actionRow] });
    const page = await getIncidentTimeline(INCIDENT, viewer);
    expect(scopeMock.isProjectOwnedByScope).not.toHaveBeenCalled();
    expect(page.entries).toHaveLength(1);
  });

  it('refuses a viewer with no incident scope at all', async () => {
    scopeMock.resolveIncidentScope.mockResolvedValue(null);
    await expect(getIncidentTimeline(INCIDENT, viewer)).rejects.toThrow(/cannot view/i);
  });
});

describe('getIncidentTimeline sources', () => {
  it('labels a system-actor action as system and a manager action as manager', async () => {
    respondWith({
      actions: [
        {
          ...actionRow, id: 'aaaaaaa1-0000-4000-8000-000000000001', action_type: 'opened',
          actor_user_id: null, is_system_actor: true, occurred_at: '2026-08-13T08:00:00.000Z',
        },
        { ...actionRow, id: 'aaaaaaa1-0000-4000-8000-000000000002', occurred_at: '2026-08-13T08:10:00.000Z' },
      ],
    });
    const page = await getIncidentTimeline(INCIDENT, viewer);
    expect(page.entries.map((entry) => entry.source)).toEqual(['system', 'manager']);
  });

  it('labels a driver-submitted action as driver even though a manager row shares the table', async () => {
    respondWith({
      actions: [{
        ...actionRow, action_type: 'driver_response_received', visibility: 'driver_submitted',
        occurred_at: '2026-08-13T09:00:00.000Z',
      }],
    });
    const page = await getIncidentTimeline(INCIDENT, viewer);
    expect(page.entries[0]?.source).toBe('driver');
  });

  it('reports an observation with its own recorded time, distinct from when it occurred', async () => {
    respondWith({
      observations: [{
        id: 'bbbbbbb1-0000-4000-8000-000000000001', observed_at: '2026-08-13T07:55:00.000Z',
        recorded_at: '2026-08-13T08:05:00.000Z',
      }],
    });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.source).toBe('system');
    expect(entry?.occurredAt).toBe('2026-08-13T07:55:00.000Z');
    expect(entry?.recordedAt).toBe('2026-08-13T08:05:00.000Z');
  });

  it('never fabricates a recorded time for a source that records only one timestamp', async () => {
    respondWith({ actions: [actionRow] });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.recordedAt).toBe(entry?.occurredAt);
  });

  it('reports a linked attendance correction without restating its current state', async () => {
    respondWith({
      attendance: [{ id: 'ccccccc1-0000-4000-8000-000000000001', linked_at: '2026-08-14T06:00:00.000Z' }],
    });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.source).toBe('attendance');
    expect(entry?.summary).toBe('Attendance correction linked');
  });

  it('reports notifications as a count, never as recipients', async () => {
    respondWith({
      notifications: [{ occurred_at: '2026-08-13T08:11:00.000Z', recipient_count: 4 }],
    });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.source).toBe('notification');
    expect(entry?.summary).toBe('Notified 4 recipients');
    expect(entry?.actorLabel).toBeNull();
  });

  it('reports retention hold actions', async () => {
    respondWith({
      retention_holds: [{
        id: 'ddddddd1-0000-4000-8000-000000000001', action_type: 'created', actor_user_id: MANAGER,
        occurred_at: '2026-08-20T10:00:00.000Z',
      }],
    });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.source).toBe('retention_hold');
    expect(entry?.summary).toBe('Retention hold created');
  });
});

describe('getIncidentTimeline ordering', () => {
  /**
   * Ties on one instant break by source table, then by the source's own id.
   * `recordedAt` is reported on the entry but is deliberately not part of the
   * order: no source can bound a read on another source's `recordedAt`, so a
   * sort key that used it could not be reproduced as a per-source keyset — and
   * an order the sources cannot reproduce is an order that cannot be paged.
   */
  it('orders by occurred time, then source table, then the source id', async () => {
    respondWith({
      actions: [
        {
          ...actionRow, id: 'aaaaaaa1-0000-4000-8000-00000000000b', action_type: 'commented',
          occurred_at: '2026-08-13T08:00:00.000Z',
        },
        {
          ...actionRow, id: 'aaaaaaa1-0000-4000-8000-00000000000a', action_type: 'commented',
          occurred_at: '2026-08-13T08:00:00.000Z',
        },
      ],
      observations: [{
        id: 'bbbbbbb1-0000-4000-8000-000000000001', observed_at: '2026-08-13T08:00:00.000Z',
        recorded_at: '2026-08-13T07:00:00.000Z',
      }],
    });
    const page = await getIncidentTimeline(INCIDENT, viewer);
    expect(page.entries.map((entry) => entry.stableId)).toEqual([
      'manager:aaaaaaa1-0000-4000-8000-00000000000a',
      'manager:aaaaaaa1-0000-4000-8000-00000000000b',
      'system:bbbbbbb1-0000-4000-8000-000000000001',
    ]);
    // Still reported, just not sorted on.
    expect(page.entries[2]?.recordedAt).toBe('2026-08-13T07:00:00.000Z');
  });

  it('gives every entry a stable id unique across sources', async () => {
    const shared = '00000000-0000-4000-8000-000000000001';
    respondWith({
      actions: [{ ...actionRow, id: shared }],
      observations: [{ id: shared, observed_at: '2026-08-13T08:00:00.000Z', recorded_at: '2026-08-13T08:00:00.000Z' }],
    });
    const page = await getIncidentTimeline(INCIDENT, viewer);
    expect(new Set(page.entries.map((entry) => entry.stableId)).size).toBe(2);
  });
});

describe('getIncidentTimeline pagination', () => {
  it('returns a cursor when more entries remain, and resumes after it', async () => {
    respondWith({ actions: many });
    const first = await getIncidentTimeline(INCIDENT, viewer, { limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await getIncidentTimeline(INCIDENT, viewer, { limit: 2, cursor: first.nextCursor });
    expect(second.entries.map((entry) => entry.stableId)).toEqual([
      'manager:aaaaaaa1-0000-4000-8000-000000000002',
      'manager:aaaaaaa1-0000-4000-8000-000000000003',
    ]);
  });

  it('returns a null cursor on the last page', async () => {
    respondWith({ actions: many });
    const page = await getIncidentTimeline(INCIDENT, viewer, { limit: 10 });
    expect(page.entries).toHaveLength(5);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a cursor that does not decode', async () => {
    respondWith({ actions: many });
    await expect(getIncidentTimeline(INCIDENT, viewer, { cursor: 'not-a-cursor' })).rejects.toThrow(/cursor/i);
  });
});

describe('getIncidentTimeline actor labels', () => {
  it('names the actor from the active-user directory', async () => {
    respondWith({ actions: [actionRow] });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.actorLabel).toBe('Thabo Nkosi');
  });

  it('never falls back to the raw user id when the actor cannot be named', async () => {
    namesMock.resolveActiveUserNames.mockResolvedValue([]);
    respondWith({ actions: [actionRow] });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.actorLabel).toBeNull();
    expect(JSON.stringify(entry)).not.toContain(MANAGER);
  });

  it('leaves a system actor unnamed', async () => {
    respondWith({ actions: [{ ...actionRow, actor_user_id: null, is_system_actor: true, action_type: 'escalated' }] });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(entry?.actorLabel).toBeNull();
  });
});

describe('getIncidentTimeline disclosure', () => {
  it('serializes only the contract fields', async () => {
    respondWith({ actions: [{ ...actionRow, note: 'internal manager note', metadata: { evidenceId: 'x' } }] });
    const [entry] = (await getIncidentTimeline(INCIDENT, viewer)).entries;
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'actorLabel', 'entryType', 'occurredAt', 'recordedAt', 'source', 'stableId', 'summary',
    ]);
  });

  it('never carries user-authored free text into a summary', async () => {
    respondWith({
      actions: [{ ...actionRow, action_type: 'commented', note: 'PROSE-THAT-MUST-NOT-LEAK' }],
    });
    const page = await getIncidentTimeline(INCIDENT, viewer);
    expect(JSON.stringify(page)).not.toContain('PROSE-THAT-MUST-NOT-LEAK');
  });

  it('selects no free-text, storage, or recipient column in any source query', async () => {
    // `recipient` is matched on a word boundary, so it does NOT catch the
    // notification query's `recipient_count` — `_` is a word character, so
    // `\brecipient\b` cannot match inside `recipient_count`. That is deliberate:
    // an aggregate count is a fact about the fan-out, while a `recipient`,
    // `recipient_id`, or `recipient_email` column would name a person. Any
    // column that identifies who was messaged must be added to this list
    // explicitly; the word boundary will not do it for you.
    await getIncidentTimeline(INCIDENT, viewer);
    const sql = capturedSql();
    for (const column of [
      'note', 'description', 'explanation', 'guidance', 'resolution_note',
      'storage_url', 'storage_key', 'original_filename', 'evidence_snapshot',
      'metadata', 'client_metadata', 'recipient', 'email', 'latitude', 'longitude',
    ]) {
      expect(sql).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('collapses a notification fan-out by truncating to the minute', async () => {
    // notificationBus writes one row per recipient in a loop, microseconds
    // apart. Grouping on the raw timestamp would turn one notification into one
    // entry per person; the minute bucket collapses it into one entry, or two
    // when the loop happens to straddle a minute boundary — either way far
    // fewer entries than recipients, and no recipient is ever named.
    await getIncidentTimeline(INCIDENT, viewer);
    const notifications = db.query.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes('fleet-incident-timeline:notifications'));
    expect(notifications).toMatch(/GROUP BY date_trunc\('minute'/);
  });

  it('never reads the evidence or submission tables, which the actions table already reports', async () => {
    // An evidence upload writes an `evidence_added` action and a driver reply
    // writes a `driver_response_received` action, so reading those tables too
    // would report each event twice — and would put storage locators and driver
    // prose within reach of a query that has no use for them.
    await getIncidentTimeline(INCIDENT, viewer);
    const sql = capturedSql();
    expect(sql).not.toContain('fleet_operational_incident_evidence');
    expect(sql).not.toContain('fleet_incident_driver_submissions');
  });

  it('reads every source scoped to the one incident', async () => {
    await getIncidentTimeline(INCIDENT, viewer);
    expect(db.query).toHaveBeenCalledTimes(5);
    for (const call of db.query.mock.calls) {
      expect(call[1]).toContain(INCIDENT);
    }
  });
});

/**
 * The merge happens in memory, so a source that returned its whole history
 * would cost the same however small the page was. These hold the reads bounded:
 * every source orders ascending and stops at `limit + 1` rows, which is exactly
 * the number that can decide a page of `limit`.
 */
/**
 * A page boundary is where a chronology quietly loses history: the entries that
 * vanish are the ones nobody is looking at. These walk every page the drawer
 * would and account for every row.
 */
describe('getIncidentTimeline pages the whole history', () => {
  /** Distinct instants, ten seconds apart — the ordinary case. */
  const longHistory = Array.from({ length: 500 }, (_, index) => ({
    ...actionRow,
    id: `eeeeeee1-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurred_at: new Date(Date.parse('2026-08-13T08:00:00.000Z') + index * 10_000).toISOString(),
  }));

  /** One instant shared by every row — the case an instant-only bound cannot page. */
  const oneInstant = Array.from({ length: 30 }, (_, index) => ({
    ...actionRow,
    id: `fffffff1-0000-4000-8000-${String(index).padStart(12, '0')}`,
    occurred_at: '2026-08-13T08:00:00.000Z',
  }));

  it('walks 500 entries in pages of 10 without dropping or repeating one', async () => {
    respondWith({ actions: longHistory });
    const seen = await walkEveryPage(10);
    expect(seen).toHaveLength(500);
    expect(new Set(seen).size).toBe(500);
    expect([...seen].sort()).toEqual(longHistory.map((row) => `manager:${row.id}`).sort());
  });

  it('pages sources that share one instant without repeating an entry', async () => {
    // Three tables, one instant, a page that holds one entry. Nothing filters
    // the sources again in memory, so a source whose rows sort *before* the
    // cursor must be told not to return them — otherwise every page re-reads
    // the earlier tables and the same entry is shown again and again.
    const at = '2026-08-13T08:00:00.000Z';
    respondWith({
      actions: [{ ...actionRow, occurred_at: at }],
      observations: [{ id: 'bbbbbbb1-0000-4000-8000-000000000001', observed_at: at, recorded_at: at }],
      attendance: [{ id: 'ccccccc1-0000-4000-8000-000000000001', linked_at: at }],
    });
    const seen = await walkEveryPage(1);
    expect(seen).toEqual([
      `manager:${actionRow.id}`,
      'system:bbbbbbb1-0000-4000-8000-000000000001',
      'attendance:ccccccc1-0000-4000-8000-000000000001',
    ]);
  });

  it('pages 30 entries that share one instant without dropping or repeating one', async () => {
    respondWith({ actions: oneInstant });
    const seen = await walkEveryPage(10);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    expect([...seen].sort()).toEqual(oneInstant.map((row) => `manager:${row.id}`).sort());
  });
});

describe('getIncidentTimeline source bounding', () => {
  it('orders and limits every source query rather than reading a whole history', async () => {
    // Ordered on the whole key the keyset compares, never on the instant alone:
    // an instant-only ORDER BY lets the database return a different arbitrary
    // subset of a tied group per page, and a row in no subset is never shown.
    // The notification bucket is its own id, so it is the whole key there.
    // The mock below reproduces the keyset from the *parameters*, so on its own
    // it cannot tell that a query stopped applying one — it would page a
    // reverted `>=` predicate perfectly. These pin the predicate text itself, so
    // the SQL and the mock's model of it have to stay the same shape.
    const KEYSET: Record<string, string> = {
      actions: "AND (occurred_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)\n"
        + '             OR (occurred_at = $2::timestamptz AND $4::boolean\n'
        + '                 AND ($3::uuid IS NULL OR id > $3::uuid)))',
      observations: "AND (observed_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)\n"
        + '             OR (observed_at = $2::timestamptz AND $4::boolean\n'
        + '                 AND ($3::uuid IS NULL OR id > $3::uuid)))',
      attendance: "AND (linked_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)\n"
        + '             OR (linked_at = $2::timestamptz AND $4::boolean\n'
        + '                 AND ($3::uuid IS NULL OR id > $3::uuid)))',
      // A bucket is atomic, so the cursor's own bucket is behind the cursor in
      // full and the keyset is a plain `>` on the bucket.
      notifications: "HAVING date_trunc('minute', created_at) > COALESCE($2::timestamptz, '-infinity'::timestamptz)\n"
        + "             OR (date_trunc('minute', created_at) = $2::timestamptz AND $4::boolean\n"
        + "                 AND ($3::timestamptz IS NULL OR date_trunc('minute', created_at) > $3::timestamptz))",
      retention_holds: "AND (a.occurred_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)\n"
        + '             OR (a.occurred_at = $2::timestamptz AND $4::boolean\n'
        + '                 AND ($3::uuid IS NULL OR a.id > $3::uuid)))',
    };
    const ORDER_BY: Record<string, string> = {
      actions: 'ORDER BY occurred_at, id',
      observations: 'ORDER BY observed_at, id',
      attendance: 'ORDER BY linked_at, id',
      notifications: "ORDER BY date_trunc('minute', created_at)",
      retention_holds: 'ORDER BY a.occurred_at, a.id',
    };
    await getIncidentTimeline(INCIDENT, viewer, { limit: 25 });
    expect(db.query).toHaveBeenCalledTimes(5);
    for (const call of db.query.mock.calls) {
      const sql = String(call[0]);
      const tag = /fleet-incident-timeline:([a-z_]+)/.exec(sql)?.[1] ?? '';
      expect(sql).toContain(KEYSET[tag]);
      expect(sql).toContain(ORDER_BY[tag]);
      expect(sql).toMatch(/LIMIT \$5/);
      // limit + 1: the extra row is what answers "is there another page".
      expect(call[1]).toEqual([INCIDENT, null, null, false, 26]);
    }
  });

  it('bounds every source on the default limit when the caller asks for none', async () => {
    await getIncidentTimeline(INCIDENT, viewer);
    for (const call of db.query.mock.calls) {
      expect((call[1] as unknown[])[4]).toBe(101);
    }
  });

  it('passes the cursor instant to every source so no source rereads the earlier page', async () => {
    respondWith({ actions: many });
    const first = await getIncidentTimeline(INCIDENT, viewer, { limit: 2 });
    db.query.mockClear();
    respondWith({ actions: many });
    await getIncidentTimeline(INCIDENT, viewer, { limit: 2, cursor: first.nextCursor });
    expect(db.query).toHaveBeenCalledTimes(5);
    for (const call of db.query.mock.calls) {
      expect((call[1] as unknown[])[1]).toBe('2026-08-13T08:01:00.000Z');
    }
    // Only the source the cursor row came from is given an id to be past; an id
    // from another table would be compared against rows it says nothing about.
    const byTag = (tag: string): unknown[] => db.query.mock.calls
      .find((call) => String(call[0]).includes(`fleet-incident-timeline:${tag}`))?.[1] as unknown[];
    expect(byTag('actions')[2]).toBe('aaaaaaa1-0000-4000-8000-000000000001');
    expect(byTag('observations')[2]).toBeNull();
  });

  it('bounds inclusively, so an entry sharing the cursor instant is not skipped', async () => {
    // The cursor's tie-break is (occurredAt, recordedAt, stableId) and only the
    // first of those reaches SQL, so an exclusive bound would drop a row
    // recorded in the same second that sorts after the cursor.
    const at = '2026-08-13T08:00:00.000Z';
    const tied = [0, 1, 2].map((index) => ({
      ...actionRow, id: `bbbbbbb1-0000-4000-8000-00000000000${index}`, occurred_at: at,
    }));
    respondWith({ actions: tied });
    const first = await getIncidentTimeline(INCIDENT, viewer, { limit: 1 });
    expect(first.entries).toHaveLength(1);
    respondWith({ actions: tied });
    const second = await getIncidentTimeline(INCIDENT, viewer, { limit: 5, cursor: first.nextCursor });
    expect(second.entries.map((entry) => entry.stableId)).toEqual([
      'manager:bbbbbbb1-0000-4000-8000-000000000001',
      'manager:bbbbbbb1-0000-4000-8000-000000000002',
    ]);
  });

  it('falls back to the default rather than clamping a limit the route would have refused', async () => {
    // The route answers 400 for a limit above the maximum. Clamping here would
    // let a direct caller be answered a page size the endpoint rejects.
    await getIncidentTimeline(INCIDENT, viewer, { limit: 5000 });
    for (const call of db.query.mock.calls) {
      expect((call[1] as unknown[])[4]).toBe(101);
    }
  });
});
