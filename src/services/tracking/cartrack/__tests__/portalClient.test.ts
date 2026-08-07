/**
 * Covers the login/session logic. `fetchImpl` is injected, so nothing here
 * touches the network — which matters more than usual: the real `ct_login`
 * counts failures toward an account lockout.
 */
import { describe, expect, it, vi } from 'vitest';
import { CartrackPortalError, cartrackPortalClient } from '../portalClient';

const WIDE_FROM = new Date('2026-08-01T00:00:00Z');
const WIDE_TO = new Date('2026-08-31T00:00:00Z');

const VEHICLE = {
  vehicle_id: '164811864', vehicle_name: 'HG16TDGP', registration: 'HG16TDGP',
  latitude: '-26.385329', longitude: '27.812445', event_ts: '2026-08-07 15:55:27+02',
  speed: '12', road_speed: '60', odometer: '149989788', ignition: '2',
  bearing: '170', gps_fix_type: '3',
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' }, ...init,
  });
}

function loginOk(): Response {
  const r = json({ id: 10, result: { status: 'SUCCEEDED', account: 'UREN00016' } });
  r.headers.append('set-cookie', 'fs=sess-abc; path=/; HttpOnly');
  r.headers.append('set-cookie', 'refresh_token=rt-xyz; path=/');
  r.headers.append('set-cookie', 'SERVERID=6; path=/');
  return r;
}

const listOk = () => json({ id: 10, result: { ct_fleet_get_vehiclelist: [VEHICLE] } });
const sessionGone = () =>
  json({ id: null, result: null, error: 'Your session has been invalidated. Please log in again.' });

function make(responses: Response[]) {
  const queue = [...responses];
  const calls: Array<{ method: string; cookie: string | undefined; body: string }> = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    calls.push({
      method: JSON.parse(body).method,
      cookie: (init.headers as Record<string, string>).Cookie,
      body,
    });
    const next = queue.shift();
    if (!next) throw new Error('fetchImpl called more times than queued');
    return next;
  });
  const client = cartrackPortalClient({
    baseUrl: 'https://portal.example',
    account: 'UREN00016',
    subUser: 'BLITZ',
    password: 'secret123',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl, calls };
}

describe('login', () => {
  it('sends the sub-user as `username` and the code as `account`', async () => {
    // The single most confusable part of this contract: docs list them the
    // other way round, and HTTP Basic has no slot for a third field at all.
    const { client, calls } = make([loginOk(), listOk()]);
    await client.listVehicles();
    const params = JSON.parse(calls[0]!.body).params;
    expect(calls[0]!.method).toBe('ct_login');
    expect(params).toMatchObject({
      account: 'UREN00016', username: 'BLITZ', password: 'secret123',
      environment: 'live', locale: 'en-ZA',
    });
  });

  it('replays the issued cookies on the data call', async () => {
    const { client, calls } = make([loginOk(), listOk()]);
    await client.listVehicles();
    expect(calls[0]!.cookie).toBeUndefined();
    expect(calls[1]!.cookie).toBe('fs=sess-abc; refresh_token=rt-xyz; SERVERID=6');
  });

  it('logs in ONCE and reuses the session across all three consumers', async () => {
    const { client, fetchImpl } = make([loginOk(), listOk()]);
    await client.listVehicles();
    await client.fetchPositions(WIDE_FROM, WIDE_TO);
    await client.feedFreshness();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one login + one list, not four
  });

  it('refuses to retry a rejected credential, and surfaces attempts_remaining', async () => {
    // ct_login counts failures toward a lockout. Retrying is how the account is
    // lost, so this must throw on the first rejection, not loop.
    const { client, fetchImpl } = make([
      json({ id: 10, result: { status: 'WRONG_CREDENTIALS', attempts_remaining: 19 } }),
    ]);
    await expect(client.listVehicles()).rejects.toThrow(/attempts_remaining=19/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('produces an auth message the alert classifier recognises', async () => {
    // pollProvider.isAuthFailure() matches on message text to choose between an
    // immediate WhatsApp and a silent-until-threshold transient.
    const { client } = make([
      json({ id: 10, result: { status: 'WRONG_CREDENTIALS', attempts_remaining: 19 } }),
    ]);
    await expect(client.listVehicles()).rejects.toThrow(/login failed/);
  });

  it('treats a successful login that issued no cookies as an auth failure', async () => {
    const { client } = make([json({ id: 10, result: { status: 'SUCCEEDED' } })]);
    await expect(client.listVehicles()).rejects.toThrow(/issued no session cookies/);
  });
});

describe('session expiry', () => {
  it('re-logs in exactly once when the session is invalidated', async () => {
    const { client, calls, fetchImpl } = make([loginOk(), sessionGone(), loginOk(), listOk()]);
    const out = await client.listVehicles();
    expect(out).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(calls.map((c) => c.method)).toEqual([
      'ct_login', 'ct_fleet_get_vehiclelist_v3', 'ct_login', 'ct_fleet_get_vehiclelist_v3',
    ]);
  });

  it('gives up after ONE re-login rather than hammering a lockout counter', async () => {
    const { client, fetchImpl } = make([loginOk(), sessionGone(), loginOk(), sessionGone()]);
    await expect(client.listVehicles()).rejects.toThrow(/still unauthenticated after re-login/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('failure classification', () => {
  it('throws on a genuine HTTP error', async () => {
    const { client } = make([loginOk(), json({}, { status: 500 })]);
    await expect(client.listVehicles()).rejects.toThrow(/HTTP 500/);
  });

  it('throws — never returns empty — when the result array is missing', async () => {
    // Returning [] would read as "no vehicles", which reconcileTrackers treats
    // as a fetch failure, hiding a contract change behind a warning.
    const { client } = make([loginOk(), json({ id: 10, result: {} })]);
    await expect(client.listVehicles()).rejects.toThrow(/expected result\.ct_fleet_get_vehiclelist/);
  });

  it('does not mistake a non-session RPC error for expiry', async () => {
    const { client, fetchImpl } = make([
      loginOk(), json({ id: null, result: null, error: 'rate limit exceeded' }),
    ]);
    await expect(client.listVehicles()).rejects.toThrow(/rate limit exceeded/);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no pointless re-login
  });

  it('wraps a network failure rather than leaking it raw', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    const client = cartrackPortalClient({
      baseUrl: 'https://portal.example', account: 'A', subUser: 'B', password: 'C',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.listVehicles()).rejects.toThrow(CartrackPortalError);
    await expect(client.listVehicles()).rejects.toThrow(/cartrack-portal\/network/);
  });
});
