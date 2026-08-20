import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query }));

const settings = vi.hoisted(() => ({ listOversightMembers: vi.fn() }));
vi.mock('../settingsRepository', () => settings);

import { resolveIncidentRecipients } from '../recipientService';

const PM = '11111111-1111-4111-8111-111111111111';
const OVERSIGHT_A = '22222222-2222-4222-8222-222222222222';
const OVERSIGHT_B = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const PM_STAFF_USER = '55555555-5555-4555-8555-555555555555';

function member(userId: string) {
  return { id: `m-${userId}`, userId, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, reason: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.listOversightMembers.mockResolvedValue([member(OVERSIGHT_A), member(OVERSIGHT_B)]);
  db.query.mockImplementation((sql: string, params: unknown[]) => {
    if (sql.includes('project-manager')) return Promise.resolve([{ resolved_user_id: PM }]);
    if (sql.includes('active-filter')) {
      const requested = params[0] as string[];
      return Promise.resolve(requested.map((id) => ({ id })));
    }
    return Promise.resolve([]);
  });
});

describe('resolveIncidentRecipients', () => {
  it('combines the active project manager with active oversight members, deduplicated', async () => {
    const result = await resolveIncidentRecipients(PROJECT);

    expect(result.failed).toBe(false);
    expect(new Set(result.userIds)).toEqual(new Set([PM, OVERSIGHT_A, OVERSIGHT_B]));
    expect(result.userIds).toHaveLength(3);
  });

  // `projects.project_manager` is not reliably a users.id — reviewScope and
  // both projectScope helpers check it against a staff.id too. If it holds a
  // staff id, resolution must follow staff.user_id rather than silently
  // dropping that PM from every incident notification.
  it('resolves a project manager stored as a staff id via staff.user_id', async () => {
    db.query.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('project-manager')) return Promise.resolve([{ resolved_user_id: PM_STAFF_USER }]);
      if (sql.includes('active-filter')) {
        const requested = params[0] as string[];
        return Promise.resolve(requested.map((id) => ({ id })));
      }
      return Promise.resolve([]);
    });

    const result = await resolveIncidentRecipients(PROJECT);

    expect(result.failed).toBe(false);
    expect(result.userIds).toContain(PM_STAFF_USER);
  });

  it('deduplicates when the project manager is also an oversight member', async () => {
    settings.listOversightMembers.mockResolvedValue([member(OVERSIGHT_A), member(PM)]);

    const result = await resolveIncidentRecipients(PROJECT);

    expect(result.userIds.filter((id) => id === PM)).toHaveLength(1);
  });

  it('sends a projectless incident to oversight only, never querying project_manager', async () => {
    const result = await resolveIncidentRecipients(null);

    expect(result.failed).toBe(false);
    expect(new Set(result.userIds)).toEqual(new Set([OVERSIGHT_A, OVERSIGHT_B]));
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('project_manager'), expect.anything());
  });

  it('filters out an oversight member whose FibreFlow account is no longer active', async () => {
    db.query.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('project-manager')) return Promise.resolve([{ resolved_user_id: PM }]);
      if (sql.includes('active-filter')) {
        const requested = params[0] as string[];
        return Promise.resolve(requested.filter((id) => id !== OVERSIGHT_B).map((id) => ({ id })));
      }
      return Promise.resolve([]);
    });

    const result = await resolveIncidentRecipients(PROJECT);

    expect(result.userIds).not.toContain(OVERSIGHT_B);
    expect(result.failed).toBe(false);
  });

  it('does not add a project with no manager assigned', async () => {
    db.query.mockImplementation((sql: string, params: unknown[]) => {
      if (sql.includes('project-manager')) return Promise.resolve([{ resolved_user_id: null }]);
      if (sql.includes('active-filter')) {
        const requested = params[0] as string[];
        return Promise.resolve(requested.map((id) => ({ id })));
      }
      return Promise.resolve([]);
    });

    const result = await resolveIncidentRecipients(PROJECT);

    expect(new Set(result.userIds)).toEqual(new Set([OVERSIGHT_A, OVERSIGHT_B]));
  });

  it('reports an empty recipient set as a recorded failure, not a silent success', async () => {
    settings.listOversightMembers.mockResolvedValue([]);
    db.query.mockImplementation((sql: string) => {
      if (sql.includes('project-manager')) return Promise.resolve([{ resolved_user_id: null }]);
      return Promise.resolve([]);
    });

    const result = await resolveIncidentRecipients(null);

    expect(result.userIds).toEqual([]);
    expect(result.failed).toBe(true);
  });
});
