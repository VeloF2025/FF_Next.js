import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { resolveWhatsAppGroupJid } from '../../../pages/api/activate/send-feedback';

describe('resolveWhatsAppGroupJid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replies into the group the DR was submitted in, without querying the registry', async () => {
    const jid = await resolveWhatsAppGroupJid('120363428902130816@g.us', 'Mamelodi');

    expect(jid).toBe('120363428902130816@g.us');
    expect(query).not.toHaveBeenCalled();
  });

  it('falls back to the registry when the review has no group JID', async () => {
    query.mockResolvedValueOnce({ rows: [{ group_jid: '120363428902130816@g.us' }] });

    const jid = await resolveWhatsAppGroupJid(null, "Themb'elihle");

    expect(jid).toBe('120363428902130816@g.us');
    const [sql, params] = query.mock.calls[0] as [string, string[]];
    expect(sql).toContain('wa_monitored_groups');
    expect(sql).toContain('is_active = true');
    expect(params).toEqual(["Themb'elihle"]);
  });

  it('matches on group_name too, for reviews whose project holds a group name', async () => {
    query.mockResolvedValueOnce({ rows: [{ group_jid: '120363421664266245@g.us' }] });

    const jid = await resolveWhatsAppGroupJid(null, 'Velo Test');

    expect(jid).toBe('120363421664266245@g.us');
    const [sql] = query.mock.calls[0] as [string];
    expect(sql).toContain('project_name = $1 OR group_name = $1');
  });

  it('prefers the project match, then dr_submission, then the oldest group', async () => {
    query.mockResolvedValueOnce({ rows: [{ group_jid: '120363408849234743@g.us' }] });

    await resolveWhatsAppGroupJid(null, 'Mamelodi');

    const [sql] = query.mock.calls[0] as [string];
    // Mamelodi has three active dr_submission groups — the ordering must be
    // deterministic or feedback lands in a different group run to run.
    expect(sql).toMatch(/ORDER BY[\s\S]*\(project_name = \$1\) DESC/);
    expect(sql).toMatch(/ORDER BY[\s\S]*\(group_type = 'dr_submission'\) DESC/);
    expect(sql).toMatch(/ORDER BY[\s\S]*created_at ASC/);
    expect(sql).toContain('LIMIT 1');
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
