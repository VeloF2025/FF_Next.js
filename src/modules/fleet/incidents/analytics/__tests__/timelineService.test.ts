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

import { getIncidentTimeline } from '../timelineService';
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

function respondWith(rows: Rows): void {
  db.query.mockImplementation(async (text: string) => {
    const tag = /fleet-incident-timeline:([a-z_]+)/.exec(text)?.[1];
    if (!tag) throw new Error(`timeline query is missing its comment tag: ${text.slice(0, 80)}`);
    return rows[tag] ?? [];
  });
}

function capturedSql(): string {
  return db.query.mock.calls.map((call) => String(call[0])).join('\n');
}

const actionRow = {
  id: 'aaaaaaa1-0000-4000-8000-000000000001', action_type: 'acknowledged', actor_user_id: MANAGER,
  is_system_actor: false, occurred_at: '2026-08-13T08:10:00.000Z', visibility: 'internal',
};

beforeEach(() => {
  vi.clearAllMocks();
  scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
  scopeMock.isProjectOwnedByScope.mockResolvedValue(true);
  coreMock.getIncidentCore.mockResolvedValue({ id: INCIDENT, projectId: PROJECT });
  namesMock.resolveActiveUserNames.mockResolvedValue([{ id: MANAGER, name: 'Thabo Nkosi' }]);
  respondWith({});
});

describe('getIncidentTimeline scope', () => {
  it('refuses an incident outside the viewer project scope as not-found, not forbidden', async () => {
    scopeMock.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(getIncidentTimeline(OTHER_INCIDENT, viewer)).rejects.toThrow(IncidentNotFoundError);
  });

  it('refuses an incident that does not exist', async () => {
    coreMock.getIncidentCore.mockResolvedValue(null);
    await expect(getIncidentTimeline(INCIDENT, viewer)).rejects.toThrow(IncidentNotFoundError);
  });

  it('reads no source table when the scope check fails', async () => {
    scopeMock.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(getIncidentTimeline(INCIDENT, viewer)).rejects.toThrow(IncidentNotFoundError);
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
  it('orders by occurred time, then recorded time, then stable id', async () => {
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
      'system:bbbbbbb1-0000-4000-8000-000000000001',
      'manager:aaaaaaa1-0000-4000-8000-00000000000a',
      'manager:aaaaaaa1-0000-4000-8000-00000000000b',
    ]);
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
  const many = Array.from({ length: 5 }, (_, index) => ({
    ...actionRow,
    id: `aaaaaaa1-0000-4000-8000-00000000000${index}`,
    occurred_at: `2026-08-13T08:0${index}:00.000Z`,
  }));

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
    // entry per person, so the size of the audience could be counted off the
    // chronology even though no recipient is ever named.
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
