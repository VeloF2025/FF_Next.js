/**
 * Cartrack fleetweb portal client — JSON-RPC 2.0 over plain fetch.
 *
 * The urent account authenticates with THREE fields (account + sub-user +
 * password). HTTP Basic has two slots, which is why that account can never
 * authenticate against the REST API in ./client.ts however the username is
 * shaped — the sub-user has nowhere to go. This portal API takes all three.
 *
 * Verified live 2026-08-07, entirely server-side: `ct_login` returns
 * `status: SUCCEEDED` plus `fs`/`refresh_token`/`SERVERID` cookies, and sending
 * those cookies back is the whole of authentication. No browser, no bot
 * challenge — unlike Ituran.
 *
 * ⚠️ `ct_login` enforces a lockout counter (a bad call answers
 * `{"status":"WRONG_CREDENTIALS","attempts_remaining":20}`). Re-login is
 * therefore capped at one retry per tick, and a rejected credential is never
 * retried.
 */
import { log } from '@/lib/logger';
import {
  newestFixAt,
  toPositions,
  toVehicles,
  type FleetwebVehicle,
  type FleetwebVehicleListResult,
} from './portalParse';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';

const DEFAULT_TIMEOUT_MS = 60_000;
const RPC_PATH = '/jsonrpc/index.php';
/** Sent verbatim as the SPA does; the portal rejects an unknown shape. */
const CLIENT_VERSION = '3.11.3';
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36';

export interface CartrackPortalOptions {
  /** Portal origin, e.g. https://fleetweb-za.cartrack.com */
  baseUrl: string;
  /** The client code — `UREN00016`. Goes in `account`, NOT `username`. */
  account: string;
  /** The SUB-USER — `BLITZ`. This is what the API calls `username`. */
  subUser: string;
  password: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CartrackPortalClient {
  fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]>;
  listVehicles(): Promise<PortalVehicle[]>;
  feedFreshness(): Promise<Date | null>;
}

export class CartrackPortalError extends Error {
  constructor(
    public readonly kind: 'network' | 'http' | 'auth' | 'shape',
    message: string
  ) {
    super(`[cartrack-portal/${kind}] ${message}`);
    this.name = 'CartrackPortalError';
  }
}

interface RpcEnvelope<T> {
  id?: number | null;
  result?: T | null;
  error?: string | { message?: string } | null;
}

function errorText(err: RpcEnvelope<unknown>['error']): string {
  if (!err) return '';
  return typeof err === 'string' ? err : (err.message ?? JSON.stringify(err));
}

class HttpCartrackPortalClient implements CartrackPortalClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private cookie: string | null = null;
  /** One vehicle-list response reused by all three consumers within a tick. */
  private cached: Promise<FleetwebVehicle[]> | null = null;

  constructor(private readonly opts: CartrackPortalOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private get origin(): string {
    return this.opts.baseUrl.replace(/\/+$/, '');
  }

  private async post(body: unknown, cookie: string | null): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.origin}${RPC_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': BROWSER_UA,
          Referer: `${this.origin}/map/fleet`,
          Origin: this.origin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new CartrackPortalError(
        'network',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Authenticates and captures the session cookies. */
  private async login(): Promise<void> {
    const res = await this.post(
      {
        version: '2.0',
        method: 'ct_login',
        id: 10,
        params: {
          x: 'x',
          account: this.opts.account,
          username: this.opts.subUser,
          password: this.opts.password,
          locale: 'en-ZA',
          otp: '',
          browserName: '',
          version: CLIENT_VERSION,
          environment: 'live',
          thirdParty: false,
        },
      },
      null
    );
    if (!res.ok) throw new CartrackPortalError('http', `ct_login: HTTP ${res.status}`);

    let body: RpcEnvelope<{ status?: string; attempts_remaining?: number }>;
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new CartrackPortalError('http', 'ct_login: malformed JSON body');
    }

    const status = body.result?.status ?? '';
    if (status !== 'SUCCEEDED') {
      // Deliberately terminal, never retried: this endpoint counts failures and
      // locks the account out. The remaining-attempts figure is surfaced because
      // it is the only warning anyone gets before losing portal access entirely.
      const remaining = body.result?.attempts_remaining;
      throw new CartrackPortalError(
        'auth',
        `login failed: status=${status || '(none)'}${
          remaining === undefined ? '' : `, attempts_remaining=${remaining}`
        }${body.error ? `, error=${errorText(body.error)}` : ''}`
      );
    }

    // getSetCookie() is required, not preferred. The login issues THREE
    // Set-Cookie headers, and the folded `get('set-cookie')` form joins them
    // into one comma-separated string that cannot be split back apart
    // reliably — a naive split keeps only `fs` and silently drops
    // `refresh_token` and `SERVERID`, producing a session that half-works.
    // Node 18+ implements it; failing loudly beats a subtly broken jar.
    const headers = res.headers as unknown as { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie !== 'function') {
      throw new CartrackPortalError(
        'shape',
        'fetch implementation lacks Headers.getSetCookie(); cannot read the session cookies safely'
      );
    }
    const jar = headers.getSetCookie()
      .filter(Boolean)
      .map((line) => line.split(';')[0])
      .filter((pair): pair is string => Boolean(pair && pair.includes('=')));
    // `fs` is the cookie that actually carries the session. Accepting any
    // cookie would let a response that set only an incidental one (load-balancer
    // affinity, analytics) read as "logged in", which then fails on the next RPC
    // and spends the single allowed same-tick re-login before surfacing.
    if (!jar.some((pair) => pair.startsWith('fs='))) {
      throw new CartrackPortalError(
        'auth',
        `login succeeded but issued no session cookies (got ${
          jar.map((p) => p.split('=')[0]).join(', ') || 'none'
        }, expected fs)`
      );
    }
    this.cookie = jar.join('; ');
    log.info('[cartrack-portal] session established', {
      account: this.opts.account,
      cookies: jar.length,
    });
  }

  private vehicles(): Promise<FleetwebVehicle[]> {
    this.cached ??= this.fetchVehicles();
    return this.cached;
  }

  private async fetchVehicles(): Promise<FleetwebVehicle[]> {
    if (!this.cookie) await this.login();

    let rows = await this.attempt();
    if (rows) return rows;

    // Exactly one re-login. A session can expire between ticks, but a portal
    // that rejects a freshly minted session is a credentials problem, and
    // looping against a lockout counter is how the account is lost.
    log.warn('[cartrack-portal] session rejected — re-authenticating once', {
      account: this.opts.account,
    });
    this.cookie = null;
    await this.login();
    rows = await this.attempt();
    if (rows) return rows;
    throw new CartrackPortalError('auth', 'still unauthenticated after re-login');
  }

  /** Returns null when the response says the session is gone. */
  private async attempt(): Promise<FleetwebVehicle[] | null> {
    const res = await this.post(
      {
        version: '2.0',
        method: 'ct_fleet_get_vehiclelist_v3',
        id: 10,
        params: { requireSensorData: true },
      },
      this.cookie
    );
    if (!res.ok) {
      throw new CartrackPortalError('http', `vehiclelist: HTTP ${res.status}`);
    }

    let body: RpcEnvelope<FleetwebVehicleListResult>;
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new CartrackPortalError('http', 'vehiclelist: malformed JSON body');
    }

    // The portal answers HTTP 200 with an error string when the session is
    // gone — "Your session has been invalidated. Please log in again."
    if (body.error) {
      const text = errorText(body.error);
      if (/session|log in again|invalidated/i.test(text)) return null;
      throw new CartrackPortalError('http', `vehiclelist: ${text}`);
    }

    const list = body.result?.ct_fleet_get_vehiclelist;
    if (!Array.isArray(list)) {
      // Distinct from an empty account, which yields []. A missing key is a
      // contract change, and returning [] here would read as "no vehicles" —
      // which reconcileTrackers treats as a fetch failure but which would also
      // hide a real breakage behind a warning.
      throw new CartrackPortalError(
        'shape',
        `vehiclelist: expected result.ct_fleet_get_vehiclelist array, got ${
          list === undefined ? 'undefined' : list === null ? 'null' : typeof list
        }`
      );
    }
    return list;
  }

  async fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
    return toPositions(await this.vehicles(), from, to);
  }

  async listVehicles(): Promise<PortalVehicle[]> {
    return toVehicles(await this.vehicles());
  }

  async feedFreshness(): Promise<Date | null> {
    return newestFixAt(await this.vehicles());
  }
}

export function cartrackPortalClient(opts: CartrackPortalOptions): CartrackPortalClient {
  return new HttpCartrackPortalClient(opts);
}
