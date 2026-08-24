/**
 * The narrowing is exercised through the REAL loaders, against a mocked driver.
 *
 * Testing `narrowingFor` in isolation would prove that a string builder builds
 * strings. What has to hold is that the SQL a loader actually emits carries the
 * predicate, that the value lands in the bind array at the position the
 * placeholder names, and that a loader which cannot answer a filter never
 * pretends to — so every assertion here reads the two arguments the loader
 * hands to `query`.
 *
 * The alignment check is the one that matters most: a predicate saying `$4`
 * while its value is bound fifth does not fail at build time, and does not fail
 * in review. It fails at 01:00, for one caller, on one branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => db);

import { RECURRENCE_WINDOW_DAYS, loadIncidentFacts, loadNotificationFacts } from '../incidentFactQueries';
import { ROSTER_MONITOR_RUN_KIND, loadMonitorRunFacts } from '../monitorFactQueries';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';
const DRIVER = '44444444-4444-4444-8444-444444444444';
const VEHICLE = '55555555-5555-4555-8555-555555555555';

const MONTH = '2026-08-01';
const NEXT_MONTH = '2026-09-01';

/** The SQL text and the bind array of the loader's single call. */
function lastCall(): { sql: string; params: unknown[] } {
  const call = db.query.mock.calls[0];
  return { sql: String(call?.[0]), params: (call?.[1] ?? []) as unknown[] };
}

/** The highest `$n` the statement references. */
function highestPlaceholder(sql: string): number {
  const found = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  return found.length === 0 ? 0 : Math.max(...found);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.query.mockResolvedValue([]);
});

describe('an unscoped load', () => {
  it('is exactly what the nightly job has always sent', async () => {
    await loadIncidentFacts(MONTH, NEXT_MONTH);
    const { sql, params } = lastCall();
    expect(params).toEqual([MONTH, NEXT_MONTH, RECURRENCE_WINDOW_DAYS]);
    expect(sql).not.toContain('$4');
  });

  it('adds nothing for a scope that sets no field', async () => {
    await loadIncidentFacts(MONTH, NEXT_MONTH, {});
    expect(lastCall().params).toEqual([MONTH, NEXT_MONTH, RECURRENCE_WINDOW_DAYS]);
  });
});

describe('the incident loader', () => {
  it('pushes the project list into SQL rather than filtering afterwards', async () => {
    await loadIncidentFacts(MONTH, NEXT_MONTH, { projectIds: [PROJECT, OTHER_PROJECT] });
    const { sql, params } = lastCall();
    expect(sql).toContain('i.project_id = ANY($4::uuid[])');
    expect(params).toEqual([MONTH, NEXT_MONTH, RECURRENCE_WINDOW_DAYS, [PROJECT, OTHER_PROJECT]]);
  });

  it('binds a type filter after the project list, in the order it emits them', async () => {
    await loadIncidentFacts(MONTH, NEXT_MONTH, { projectIds: [PROJECT], incidentType: 'late' });
    const { sql, params } = lastCall();
    expect(sql).toContain('i.project_id = ANY($4::uuid[])');
    expect(sql).toContain('i.incident_type = $5');
    expect(params).toEqual([MONTH, NEXT_MONTH, RECURRENCE_WINDOW_DAYS, [PROJECT], 'late']);
  });

  it('emits a predicate for every field it accepts', async () => {
    await loadIncidentFacts(MONTH, NEXT_MONTH, {
      projectIds: [PROJECT], operationalSiteId: SITE, incidentType: 'late',
      severity: 'high', outcome: 'confirmed', staffId: DRIVER, vehicleId: VEHICLE,
    });
    const { sql, params } = lastCall();
    for (const predicate of [
      'i.project_id = ANY($4::uuid[])', 'i.operational_site_id = $5::uuid', 'i.incident_type = $6',
      'i.severity = $7', 'i.outcome = $8', 'i.staff_id = $9::uuid', 'i.vehicle_id = $10::uuid',
    ]) {
      expect(sql).toContain(predicate);
    }
    expect(params).toEqual([
      MONTH, NEXT_MONTH, RECURRENCE_WINDOW_DAYS,
      [PROJECT], SITE, 'late', 'high', 'confirmed', DRIVER, VEHICLE,
    ]);
  });

  it('renumbers around an absent field instead of leaving a gap', async () => {
    // The one that bites: skipping `operationalSiteId` must move the type
    // filter to $5, not leave it at $6 with nothing bound there.
    await loadIncidentFacts(MONTH, NEXT_MONTH, { projectIds: [PROJECT], severity: 'high' });
    const { sql, params } = lastCall();
    expect(sql).toContain('i.severity = $5');
    expect(sql).not.toContain('operational_site_id = $');
    expect(params[4]).toBe('high');
  });

  it('keeps the month filter and the ORDER BY around the narrowing', async () => {
    // lastIndexOf: the LATERAL subqueries carry ORDER BYs of their own, and the
    // statement's own is the final one.
    await loadIncidentFacts(MONTH, NEXT_MONTH, { severity: 'high' });
    const { sql } = lastCall();
    expect(sql.indexOf('i.work_date >= $1::date')).toBeLessThan(sql.indexOf('i.severity = $4'));
    expect(sql.indexOf('i.severity = $4')).toBeLessThan(sql.lastIndexOf('ORDER BY'));
  });
});

describe('the notification loader', () => {
  it('narrows on the incident the notification is about', async () => {
    await loadNotificationFacts(MONTH, NEXT_MONTH, { projectIds: [PROJECT], operationalSiteId: SITE });
    const { sql, params } = lastCall();
    expect(sql).toContain('i.project_id = ANY($3::uuid[])');
    expect(sql).toContain('i.operational_site_id = $4::uuid');
    expect(params).toEqual([MONTH, NEXT_MONTH, [PROJECT], SITE]);
  });

  it('starts its own parameters at $3, having no recurrence window to bind', async () => {
    await loadNotificationFacts(MONTH, NEXT_MONTH, { projectIds: [PROJECT] });
    expect(lastCall().params).toEqual([MONTH, NEXT_MONTH, [PROJECT]]);
  });
});

describe('the monitor-run loader', () => {
  it('narrows on the assignment dimensions, after the run kind', async () => {
    await loadMonitorRunFacts(MONTH, NEXT_MONTH, { projectIds: [PROJECT], operationalSiteId: SITE });
    const { sql, params } = lastCall();
    expect(sql).toContain('a.project_id = ANY($4::uuid[])');
    expect(sql).toContain('a.operational_site_id = $5::uuid');
    expect(params).toEqual([MONTH, NEXT_MONTH, ROSTER_MONITOR_RUN_KIND, [PROJECT], SITE]);
  });

  it('ignores the incident-shaped fields, which a run does not have', async () => {
    // A run sweeps the whole roster and carries no type, severity or driver.
    // Emitting `a.severity` here would not narrow anything — it would fail.
    await loadMonitorRunFacts(MONTH, NEXT_MONTH, {
      projectIds: [PROJECT], severity: 'high', staffId: DRIVER, incidentType: 'late',
    });
    const { sql, params } = lastCall();
    expect(sql).not.toContain('severity');
    expect(sql).not.toContain('staff_id = $');
    expect(sql).not.toContain('incident_type');
    expect(params).toEqual([MONTH, NEXT_MONTH, ROSTER_MONITOR_RUN_KIND, [PROJECT]]);
  });

  it('keeps the narrowing inside the WHERE, ahead of the GROUP BY', async () => {
    await loadMonitorRunFacts(MONTH, NEXT_MONTH, { projectIds: [PROJECT] });
    const { sql } = lastCall();
    expect(sql.indexOf('a.project_id = ANY($4::uuid[])')).toBeLessThan(sql.indexOf('GROUP BY'));
  });
});

describe('placeholders and binds, for every loader and every combination', () => {
  const scopes = [
    {},
    { projectIds: [PROJECT] },
    { projectIds: [] },
    { operationalSiteId: SITE },
    { severity: 'high' as const },
    { projectIds: [PROJECT], operationalSiteId: SITE },
    { projectIds: [PROJECT], incidentType: 'late', vehicleId: VEHICLE },
    {
      projectIds: [PROJECT], operationalSiteId: SITE, incidentType: 'late',
      severity: 'high' as const, outcome: 'confirmed', staffId: DRIVER, vehicleId: VEHICLE,
    },
  ];

  const loaders = [
    ['incidents', loadIncidentFacts],
    ['notifications', loadNotificationFacts],
    ['monitor runs', loadMonitorRunFacts],
  ] as const;

  for (const [name, load] of loaders) {
    it(`binds exactly as many parameters as ${name} references`, async () => {
      for (const scope of scopes) {
        vi.clearAllMocks();
        db.query.mockResolvedValue([]);
        await load(MONTH, NEXT_MONTH, scope);
        const { sql, params } = lastCall();
        expect(highestPlaceholder(sql)).toBe(params.length);
      }
    });
  }

  it('treats an empty project list as a real restriction, not as absent', async () => {
    await loadIncidentFacts(MONTH, NEXT_MONTH, { projectIds: [] });
    const { sql, params } = lastCall();
    expect(sql).toContain('i.project_id = ANY($4::uuid[])');
    expect(params[3]).toEqual([]);
  });
});
