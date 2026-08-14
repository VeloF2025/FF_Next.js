/**
 * Group resolution for QA feedback.
 *
 * Two layers, because they fail differently:
 *  - the JS branching (submission group vs project fallback) is tested with a mocked pool;
 *  - the SQL itself is run against pg-mem with realistic candidate rows, so the WHERE and
 *    ORDER BY are proven by behaviour rather than by matching the query text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: unknown) => handler,
}));

vi.mock('@/lib/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { log, createLogger: () => log };
});

const query = vi.fn();
vi.mock('@/lib/db', () => ({
  default: { query: (...args: unknown[]) => query(...args) },
}));

import {
  resolveWhatsAppGroupJid,
  ACTIVE_GROUP_BY_JID_SQL,
  GROUP_FOR_PROJECT_SQL,
} from '../../../pages/api/activate/send-feedback';

describe('resolveWhatsAppGroupJid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replies into the group the DR was submitted in when that group is still active', async () => {
    query.mockResolvedValueOnce({ rows: [{ group_jid: '120363428902130816@g.us' }] });

    const jid = await resolveWhatsAppGroupJid('120363428902130816@g.us', 'Mamelodi');

    expect(jid).toBe('120363428902130816@g.us');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(['120363428902130816@g.us']);
  });

  it('falls back to the project when the submission group is no longer active', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // submission group deactivated
      .mockResolvedValueOnce({ rows: [{ group_jid: '120363408849234743@g.us' }] });

    const jid = await resolveWhatsAppGroupJid('120363999999999999@g.us', 'Mamelodi');

    expect(jid).toBe('120363408849234743@g.us');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[1]).toEqual(['Mamelodi']);
  });

  it('returns null when the submission group is dead and the project has no group', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    expect(await resolveWhatsAppGroupJid('120363999999999999@g.us', 'Tonga')).toBeNull();
  });

  it('queries the project registry directly when the review has no group JID', async () => {
    query.mockResolvedValueOnce({ rows: [{ group_jid: '120363428902130816@g.us' }] });

    const jid = await resolveWhatsAppGroupJid(null, "Themb'elihle");

    expect(jid).toBe('120363428902130816@g.us');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual(["Themb'elihle"]);
  });

  it('returns null when the project matches no registered group', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    expect(await resolveWhatsAppGroupJid(null, 'Unknown Project')).toBeNull();
  });

  it('returns null without querying when there is no group JID and no project', async () => {
    expect(await resolveWhatsAppGroupJid(null, '')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('group resolution SQL (pg-mem)', () => {
  let db: IMemoryDb;

  const seed = (rows: Array<[string, string, string | null, string, boolean, string]>) => {
    db = newDb();
    db.public.none(`
      CREATE TABLE wa_monitored_groups (
        group_jid    TEXT PRIMARY KEY,
        group_name   TEXT NOT NULL,
        project_name TEXT,
        group_type   TEXT NOT NULL,
        is_active    BOOLEAN NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL
      )`);
    const lit = (v: string | boolean | null) =>
      v === null ? 'NULL' : typeof v === 'boolean' ? String(v) : `'${v.replace(/'/g, "''")}'`;

    for (const [jid, name, project, type, active, created] of rows) {
      db.public.none(
        `INSERT INTO wa_monitored_groups VALUES (${[jid, name, project, type, active, created].map(lit).join(', ')})`
      );
    }
  };

  const forProject = (project: string): string | null => {
    const rows = db.public.many(GROUP_FOR_PROJECT_SQL.replace(/\$1/g, `'${project.replace(/'/g, "''")}'`)) as Array<{
      group_jid: string;
    }>;
    return rows[0]?.group_jid ?? null;
  };

  const byJid = (jid: string): string | null => {
    const rows = db.public.many(ACTIVE_GROUP_BY_JID_SQL.replace('$1', `'${jid}'`)) as Array<{ group_jid: string }>;
    return rows[0]?.group_jid ?? null;
  };

  it('never returns a civil or admin group for a project match', () => {
    // Tonga owns only civil and admin groups — QA feedback must not land in either.
    seed([
      ['civil@g.us', 'Tonga A - As Build & QA', 'Tonga', 'civil', true, '2026-03-01'],
      ['admin@g.us', 'Tonga Project - Mafemani', 'Tonga', 'admin', true, '2026-03-02'],
    ]);

    expect(forProject('Tonga')).toBeNull();
  });

  it('picks the dr_submission group when a project owns several types', () => {
    seed([
      ['civil@g.us', 'MAM Zone 6', 'Mamelodi', 'civil', true, '2026-01-01'],
      ['dr@g.us', 'Mamelodi', 'Mamelodi', 'dr_submission', true, '2026-02-01'],
      ['maint@g.us', 'Velocity MNT - Mamelodi', 'Mamelodi', 'maintenance', true, '2026-01-05'],
    ]);

    expect(forProject('Mamelodi')).toBe('dr@g.us');
  });

  it('picks the oldest dr_submission group when a project owns three of them', () => {
    seed([
      ['second@g.us', 'Mamelodi Internal', 'Mamelodi', 'dr_submission', true, '2026-02-04'],
      ['first@g.us', 'Mamelodi', 'Mamelodi', 'dr_submission', true, '2026-01-26'],
      ['third@g.us', 'Mamelodi Activations', 'Mamelodi', 'dr_submission', true, '2026-06-01'],
    ]);

    expect(forProject('Mamelodi')).toBe('first@g.us');
  });

  it('breaks a created_at tie on group_jid instead of leaving it to the planner', () => {
    seed([
      ['bbb@g.us', 'Seeded B', 'Etwatwa', 'dr_submission', true, '2026-05-25 11:12:08'],
      ['aaa@g.us', 'Seeded A', 'Etwatwa', 'dr_submission', true, '2026-05-25 11:12:08'],
    ]);

    expect(forProject('Etwatwa')).toBe('aaa@g.us');
  });

  it('honours an exact group_name match for rows that carry no project_name', () => {
    seed([['test@g.us', 'Velo Test', null, 'admin', true, '2026-01-01']]);

    expect(forProject('Velo Test')).toBe('test@g.us');
  });

  it('ranks a real project match above a group_name match on a NULL-project row', () => {
    // `project_name = $1` is NULL for the first row; a bare DESC would sort it first.
    seed([
      ['nullproj@g.us', 'Lawley', null, 'admin', true, '2026-01-01'],
      ['real@g.us', 'Lawley Activation', 'Lawley', 'dr_submission', true, '2026-02-01'],
    ]);

    expect(forProject('Lawley')).toBe('real@g.us');
  });

  it('excludes inactive groups from both queries', () => {
    seed([['dead@g.us', 'Retired Group', 'Lawley', 'dr_submission', false, '2026-01-01']]);

    expect(forProject('Lawley')).toBeNull();
    expect(byJid('dead@g.us')).toBeNull();
  });

  it('confirms an active group by JID', () => {
    seed([['live@g.us', 'Lawley', 'Lawley', 'dr_submission', true, '2026-01-01']]);

    expect(byJid('live@g.us')).toBe('live@g.us');
    expect(byJid('never-seen@g.us')).toBeNull();
  });
});
