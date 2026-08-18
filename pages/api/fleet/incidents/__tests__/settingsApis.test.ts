import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRules: vi.fn(), versionRule: vi.fn(), listMembers: vi.fn(), addMember: vi.fn(), endMembership: vi.fn(),
  isActiveUser: vi.fn(), gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/incidents/settingsRepository', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/settingsRepository')>('@/modules/fleet/incidents/settingsRepository');
  return {
    ...actual, listIncidentRuleVersions: mocks.listRules, versionIncidentRule: mocks.versionRule,
    listOversightMembers: mocks.listMembers, addOversightMember: mocks.addMember, endOversightMembership: mocks.endMembership,
  };
});
vi.mock('@/modules/fleet/incidents/reviewScope', () => ({ isActiveFibreFlowUser: mocks.isActiveUser }));

import rulesHandler from '../settings/rules';
import oversightHandler from '../settings/oversight-members';
import { OversightMembershipConflictError, OversightMembershipNotFoundError } from '@/modules/fleet/incidents/settingsRepository';

const USER = '11111111-1111-4111-8111-111111111111';
const TARGET_USER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

async function call(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  method: string,
  options: { query?: Record<string, string>; body?: unknown; user?: { id: string; role: string } | null } = {},
) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method, query: options.query ?? {}, body: options.body,
    user: options.user === undefined ? { id: USER, role: 'admin' } : options.user,
  } as unknown as NextApiRequest;
  await handler(req, res);
  return state;
}

beforeEach(() => { vi.clearAllMocks(); mocks.gates.length = 0; });

const validRuleBody = {
  incidentType: 'late', enabled: true, createsIncident: true, severity: 'high',
  immediateNotification: true, channels: { inApp: true, email: true, whatsapp: false },
  includeInMorningSummary: false, acknowledgementTargetMinutes: 15, reminderIntervalMinutes: 10,
  maximumEscalationLevel: 3, evidenceRequiredOutcomes: ['confirmed'],
  effectiveFrom: '2099-01-01T00:00:00.000Z', changeReason: 'Tune targets',
};

describe('GET/POST /api/fleet/incidents/settings/rules', () => {
  it('allows GET and POST only', async () => {
    const result = await call(rulesHandler, 'DELETE');
    expect(result.status).toBe(405); expect(result.headers.Allow).toBe('GET, POST');
  });

  it('requires a valid incidentType on GET', async () => {
    const result = await call(rulesHandler, 'GET', { query: { incidentType: 'bogus' } });
    expect(result.status).toBe(400); expect(mocks.listRules).not.toHaveBeenCalled();
  });

  it('lists rule versions for a valid incidentType', async () => {
    mocks.listRules.mockResolvedValue([{ version: 1 }]);
    const result = await call(rulesHandler, 'GET', { query: { incidentType: 'late' } });
    expect(result.status).toBe(200); expect(mocks.listRules).toHaveBeenCalledWith('late');
    expect(mocks.gates).toContainEqual(['fleet.incidents-settings', 'view']);
  });

  it('rejects an invalid POST body before calling the repository', async () => {
    const result = await call(rulesHandler, 'POST', { body: { ...validRuleBody, severity: 'urgent' } });
    expect(result.status).toBe(400); expect(mocks.versionRule).not.toHaveBeenCalled();
  });

  it('uses the session actor rather than any actorUserId in the body', async () => {
    mocks.versionRule.mockResolvedValue({ version: 2 });
    const result = await call(rulesHandler, 'POST', { body: { ...validRuleBody, actorUserId: 'attacker' } });
    expect(result.status).toBe(201);
    expect(mocks.versionRule).toHaveBeenCalledWith(expect.objectContaining({ changeReason: 'Tune targets', actorUserId: USER }));
    expect(mocks.gates).toContainEqual(['fleet.incidents-settings', 'edit']);
  });

  it('does not convert a version-insert failure into success', async () => {
    mocks.versionRule.mockRejectedValue(new Error('insert failed'));
    const result = await call(rulesHandler, 'POST', { body: validRuleBody });
    expect(result.status).toBe(500); expect(result.body).not.toMatchObject({ success: true });
  });
});

describe('GET/POST/DELETE /api/fleet/incidents/settings/oversight-members', () => {
  it('allows GET, POST, and DELETE only', async () => {
    const result = await call(oversightHandler, 'PATCH');
    expect(result.status).toBe(405); expect(result.headers.Allow).toBe('GET, POST, DELETE');
  });

  it('lists active members by default', async () => {
    mocks.listMembers.mockResolvedValue([]);
    const result = await call(oversightHandler, 'GET', {});
    expect(result.status).toBe(200); expect(mocks.listMembers).toHaveBeenCalledWith({ activeOnly: true });
  });

  it('lists full history when activeOnly=false', async () => {
    mocks.listMembers.mockResolvedValue([]);
    await call(oversightHandler, 'GET', { query: { activeOnly: 'false' } });
    expect(mocks.listMembers).toHaveBeenCalledWith({ activeOnly: false });
  });

  it('rejects an invalid POST body before checking the user', async () => {
    const result = await call(oversightHandler, 'POST', { body: { userId: 'not-a-uuid' } });
    expect(result.status).toBe(400); expect(mocks.isActiveUser).not.toHaveBeenCalled();
  });

  it('resolves an active FibreFlow user before insert', async () => {
    mocks.isActiveUser.mockResolvedValue(false);
    const result = await call(oversightHandler, 'POST', { body: { userId: TARGET_USER } });
    expect(result.status).toBe(400); expect(mocks.addMember).not.toHaveBeenCalled();

    mocks.isActiveUser.mockResolvedValue(true);
    mocks.addMember.mockResolvedValue({ id: MEMBER, userId: TARGET_USER });
    const created = await call(oversightHandler, 'POST', { body: { userId: TARGET_USER, reason: 'New oversight' } });
    expect(created.status).toBe(201);
    expect(mocks.addMember).toHaveBeenCalledWith(expect.objectContaining({ userId: TARGET_USER, actorUserId: USER }));
  });

  it('surfaces a conflict when the user already has an active membership', async () => {
    mocks.isActiveUser.mockResolvedValue(true);
    mocks.addMember.mockRejectedValue(new OversightMembershipConflictError('already a member'));
    const result = await call(oversightHandler, 'POST', { body: { userId: TARGET_USER } });
    expect(result.status).toBe(409);
  });

  it('requires a reason to end a membership and never deletes history', async () => {
    const missingReason = await call(oversightHandler, 'DELETE', { body: { membershipId: MEMBER } });
    expect(missingReason.status).toBe(400); expect(mocks.endMembership).not.toHaveBeenCalled();

    mocks.endMembership.mockResolvedValue({ id: MEMBER, effectiveTo: '2026-08-18T00:00:00.000Z' });
    const result = await call(oversightHandler, 'DELETE', { body: { membershipId: MEMBER, reason: 'Left the team' } });
    expect(result.status).toBe(200);
    expect(mocks.endMembership).toHaveBeenCalledWith(MEMBER, USER, 'Left the team', undefined);
  });

  it('maps a missing active membership to 404', async () => {
    mocks.endMembership.mockRejectedValue(new OversightMembershipNotFoundError('missing'));
    const result = await call(oversightHandler, 'DELETE', { body: { membershipId: MEMBER, reason: 'Left the team' } });
    expect(result.status).toBe(404);
  });
});
