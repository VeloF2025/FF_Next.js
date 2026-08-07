/**
 * Ituran PeleGrid client — a plain fetch, no browser.
 *
 * The portal sits behind a Reblaze bot challenge that answers any unrecognised
 * client with HTTP 247 and a JavaScript puzzle. Solving it needs a real browser,
 * but only ONCE: the challenge yields a `waap_id` cookie, and every later
 * request is accepted on that cookie alone. Authentication is separate and
 * travels in the POST body as `PassEnc` + `Username` — the ASP.NET session
 * cookie is not required and is deliberately not sent.
 *
 * All of that was established against the live portal on 2026-08-07:
 *
 *   waap_id alone            -> 200, full data
 *   IWEB_LB alone            -> 247 (challenge)
 *   no cookies               -> 247 (challenge)
 *   waap_id + bogus PassEnc  -> 200-family, ErrorStr 'LoginError!'
 *
 * So the two credentials fail independently and distinguishably, and each maps
 * to a different repair: a 247 means the WAF cookie died, a 'LoginError!' means
 * the login token died. Both are repaired by re-minting, which is why minting
 * is injected rather than done here — it needs Playwright, which must never be
 * reachable from the Next.js runtime (it is a devDependency).
 */
import { log } from '@/lib/logger';
import {
  isLoginError,
  newestFixAt,
  toPositions,
  toVehicles,
  type IturanGridResponse,
} from './parse';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';

const DEFAULT_TIMEOUT_MS = 60_000;
const GRID_PATH = '/iweb2/PeleGrid/PeleGrid.ashx';
/** The challenge status. Non-standard, and specific to this WAF. */
export const CHALLENGE_STATUS = 247;

/**
 * Sent by BOTH the mint and every later request, deliberately from one
 * constant. The WAF issues `waap_id` against the minting client's identity, so
 * a browser and a poller that disagree on their user-agent risk having the
 * cookie refused. It also must not say "HeadlessChrome" — see session.ts.
 */
export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36';

export interface IturanSession {
  waapId: string;
  passEnc: string;
}

export interface IturanClientOptions {
  /** Portal origin, e.g. https://www.ituran.com */
  baseUrl: string;
  username: string;
  /** Drives a real browser to solve the challenge and log in. */
  mintSession: () => Promise<IturanSession>;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface IturanClient {
  fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]>;
  listVehicles(): Promise<PortalVehicle[]>;
  feedFreshness(): Promise<Date | null>;
}

export class IturanError extends Error {
  constructor(
    public readonly kind: 'network' | 'http' | 'auth' | 'shape',
    message: string
  ) {
    super(`[ituran/${kind}] ${message}`);
    this.name = 'IturanError';
  }
}

class HttpIturanClient implements IturanClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private session: IturanSession | null = null;
  /**
   * One grid response is reused across fetchPositions/listVehicles/
   * feedFreshness within a tick. All three read the same payload, and the
   * account is a partner's — three identical POSTs per tick is both wasteful
   * and a way to look like a scraper.
   */
  private cached: Promise<IturanGridResponse> | null = null;

  constructor(private readonly opts: IturanClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private grid(): Promise<IturanGridResponse> {
    this.cached ??= this.fetchGridOnce();
    return this.cached;
  }

  private async fetchGridOnce(): Promise<IturanGridResponse> {
    let res = await this.attempt();
    if (res.ok) return res.body;

    // Exactly one re-mint, mirroring PortalSession: a portal that rejects a
    // freshly minted session twice has a credentials or entitlement problem,
    // and retrying in a loop is how an account gets locked out.
    log.warn('[ituran] session rejected — re-minting once', { reason: res.reason });
    this.session = null;
    res = await this.attempt();
    if (res.ok) return res.body;

    throw new IturanError('auth', `still rejected after re-mint: ${res.reason}`);
  }

  private async attempt(): Promise<
    { ok: true; body: IturanGridResponse } | { ok: false; reason: string }
  > {
    this.session ??= await this.opts.mintSession();
    const { waapId, passEnc } = this.session;

    // LastDataTimeStamp='not initialized' asks for a FULL snapshot. The app's
    // own later polls send a timestamp plus OnlyDifferences and map bounds,
    // which returns only what changed inside the visible map rectangle — a
    // poller that copied that shape would silently miss every vehicle outside
    // whatever bounds it happened to send.
    const body = new URLSearchParams({
      Function: 'GetGridData',
      PassEnc: passEnc,
      Username: this.opts.username,
      Iweb2Culture: 'en-US',
      LimitedToMap: 'false',
      IsLimitToPreselectedGroups: 'false',
      cid: 'soltrack',
      LastDataTimeStamp: 'not initialized',
    }).toString();

    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}${GRID_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Cookie: `waap_id=${waapId}`,
          'User-Agent': BROWSER_UA,
          Referer: `${this.opts.baseUrl.replace(/\/+$/, '')}/iweb2/iweb2p.aspx`,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      throw new IturanError('network', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    if (res.status === CHALLENGE_STATUS) {
      return { ok: false, reason: `WAF challenge (HTTP ${CHALLENGE_STATUS}) — waap_id rejected` };
    }
    // 203 is inside res.ok, and it is what the portal actually returns
    // alongside ErrorStr 'LoginError!' — so a dead token is detected from the
    // body below, not from the status.
    if (!res.ok) {
      throw new IturanError('http', `grid: HTTP ${res.status}`);
    }

    const text = await res.text();
    let parsed: IturanGridResponse;
    try {
      parsed = JSON.parse(text) as IturanGridResponse;
    } catch {
      // A challenge served under some other status, or an error page. Either
      // way it is not data, and it must not be mistaken for an empty account.
      return { ok: false, reason: `non-JSON body (HTTP ${res.status}, ${text.length} bytes)` };
    }

    if (isLoginError(parsed)) {
      return { ok: false, reason: `PassEnc rejected (ErrorStr=${parsed.ErrorStr})` };
    }
    if (!parsed.rows_data || typeof parsed.rows_data !== 'object') {
      // Distinct from an account with no vehicles, which yields {}. A missing
      // key is a contract change and must not read as "the fleet is empty" —
      // reconcileTrackers would deactivate every tracker on the account.
      throw new IturanError(
        'shape',
        `grid: expected rows_data object, got ${parsed.rows_data === null ? 'null' : typeof parsed.rows_data}`
      );
    }
    return { ok: true, body: parsed };
  }

  async fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
    return toPositions(await this.grid(), from, to);
  }

  async listVehicles(): Promise<PortalVehicle[]> {
    return toVehicles(await this.grid());
  }

  async feedFreshness(): Promise<Date | null> {
    return newestFixAt(await this.grid());
  }
}

export function ituranClient(opts: IturanClientOptions): IturanClient {
  return new HttpIturanClient(opts);
}
