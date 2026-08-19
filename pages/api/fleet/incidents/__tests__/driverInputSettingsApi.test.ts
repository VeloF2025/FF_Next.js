import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffective: vi.fn(), version: vi.fn(), gates: [] as Array<[string, string]>,
}));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => { mocks.gates.push([key, action]); return handler; },
}));
vi.mock('@/modules/fleet/incidents/driver/settingsRepository', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/driver/settingsRepository')>(
    '@/modules/fleet/incidents/driver/settingsRepository',
  );
  return { ...actual, getEffectiveDriverInputSettings: mocks.getEffective, versionDriverInputSettings: mocks.version };
});

import driverInputSettingsHandler from '../settings/driver-input';
import { DriverInputSettingsValidationError } from '@/modules/fleet/incidents/driver/settingsRepository';

const USER = '11111111-1111-4111-8111-111111111111';

async function call(
  method: string,
  options: { body?: unknown; user?: { id: string; role: string } | null } = {},
) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  const req = {
    method, query: {}, body: options.body,
    user: options.user === undefined ? { id: USER, role: 'admin' } : options.user,
  } as unknown as NextApiRequest;
  await driverInputSettingsHandler(req, res);
  return state;
}

const currentSettings = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: null,
  responseWindowWorkdays: 2, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
  recentWindowDays: 90, historyWindowDays: 365,
  enabledConcernCategories: ['assignment_error', 'site_error', 'vehicle_error', 'geofence_error', 'other'],
  evidenceAllowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'], evidenceMaxBytes: 15728640,
  driverInputRequestedChannels: { inApp: true, email: true, whatsapp: false },
  driverResponseReceivedChannels: { inApp: true, email: true, whatsapp: false },
};

const validPostBody = {
  responseWindowWorkdays: 3, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
  recentWindowDays: 90, historyWindowDays: 365,
  enabledConcernCategories: ['assignment_error', 'other'],
  evidenceAllowedMimeTypes: ['image/jpeg'], evidenceMaxBytes: 5000000,
  driverInputRequestedChannels: { inApp: true, email: false, whatsapp: false },
  driverResponseReceivedChannels: { inApp: true, email: false, whatsapp: false },
  effectiveFrom: '2099-01-01T00:00:00.000Z', changeReason: 'Tighten the response window',
};

beforeEach(() => { vi.clearAllMocks(); mocks.gates.length = 0; });

describe('GET/POST /api/fleet/incidents/settings/driver-input', () => {
  it('allows GET and POST only', async () => {
    const result = await call('DELETE');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET, POST');
  });

  it('rejects an unauthenticated request', async () => {
    const result = await call('GET', { user: null });
    expect(result.status).toBe(401);
    expect(mocks.getEffective).not.toHaveBeenCalled();
  });

  it('gates GET on the view action and POST on the edit action of fleet.incidents-settings', async () => {
    mocks.getEffective.mockResolvedValue(currentSettings);
    await call('GET');
    expect(mocks.gates).toContainEqual(['fleet.incidents-settings', 'view']);

    mocks.gates.length = 0;
    mocks.version.mockResolvedValue({ ...currentSettings, version: 2 });
    await call('POST', { body: validPostBody });
    expect(mocks.gates).toContainEqual(['fleet.incidents-settings', 'edit']);
  });

  it('returns the effective settings on GET', async () => {
    mocks.getEffective.mockResolvedValue(currentSettings);
    const result = await call('GET');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: currentSettings });
  });

  it('rejects a malformed POST body before calling the repository', async () => {
    const missingField = await call('POST', { body: { ...validPostBody, responseWindowWorkdays: undefined } });
    expect(missingField.status).toBe(400);
    const badChannels = await call('POST', { body: { ...validPostBody, driverInputRequestedChannels: { inApp: 'yes' } } });
    expect(badChannels.status).toBe(400);
    const badCategories = await call('POST', { body: { ...validPostBody, enabledConcernCategories: 'other' } });
    expect(badCategories.status).toBe(400);
    expect(mocks.version).not.toHaveBeenCalled();
  });

  it('uses the session actor rather than any actorUserId in the body, and versions on success', async () => {
    mocks.version.mockResolvedValue({ ...currentSettings, version: 2, responseWindowWorkdays: 3 });
    const result = await call('POST', { body: { ...validPostBody, actorUserId: 'attacker' } });
    expect(result.status).toBe(201);
    expect(mocks.version).toHaveBeenCalledWith(
      expect.objectContaining({ responseWindowWorkdays: 3, changeReason: 'Tighten the response window' }),
      USER,
    );
  });

  it('maps a settings validation error to 400 without leaking a fake success', async () => {
    mocks.version.mockRejectedValue(new DriverInputSettingsValidationError('effectiveFrom must be after the current version'));
    const result = await call('POST', { body: validPostBody });
    expect(result.status).toBe(400);
    expect(result.body).not.toMatchObject({ success: true });
  });

  it('maps an unexpected error to 500', async () => {
    mocks.version.mockRejectedValue(new Error('db exploded'));
    const result = await call('POST', { body: validPostBody });
    expect(result.status).toBe(500);
  });
});
