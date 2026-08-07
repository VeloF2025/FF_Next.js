/**
 * Netstar VigilCloud portal client.
 *
 * VigilCloud is a human portal backed by JSON endpoints, so this speaks HTTP
 * rather than driving a browser. Two paths, and they are not interchangeable:
 *
 *   LIVE (listVehicles / fetchPositions) — the tree API, see ./tree.ts. One
 *   POST returns every vehicle on the account with its last known fix. This is
 *   what the 2-hourly poll uses.
 *
 *   HISTORY (fetchHistory) — the report builder:
 *     POST /Reports/ReportRepo/GenerateReport/  -> "<jobId>"  (async)
 *     POST /Reports/Export                      -> CSV bytes
 *   One job per vehicle per 31-day chunk, each polled until ready. Only
 *   scripts/backfill-tracking.ts uses it, and it is UNVERIFIED against the live
 *   portal — the contract was documented in the same pass that got the vehicle
 *   list wrong (it pointed at /Reports/ReportRepo/GetReportTree, which 404s).
 *
 * The login form's inputs carry readonly="readonly" with an onmousedown handler
 * that clears it — an anti-autofill measure that only affects browser
 * automation. Posting the form directly sidesteps it entirely, which is a large
 * part of why this is an HTTP client and not Playwright.
 */
import { PortalSession, type CookieJar } from '../portal/session';
import { newestFixAt, parseVehicleTree, type NetstarTreeNode } from './tree';
import { createHistoryFetcher } from './history';
// Re-exported so the historical import sites keep working; both live in
// ./history.ts now, which is the only place they are reachable from.
export { MAX_REPORT_MS, PartialFetchError, chunkWindow } from './history';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';

export interface NetstarClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
  /** Injectable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Wall-clock budget for one fetchPositions call. Worst case per vehicle is
   * ~11 minutes (one GenerateReport plus EXPORT_ATTEMPTS polls at the session's
   * 60s timeout), so at ~22 vehicles a degenerate portal outruns the 2-hourly
   * cadence and every later tick skips on the advisory lock with a 200 while
   * tracking is dead. Stopping at the budget makes that a partial fetch
   * instead: what was collected is stored and the next tick resumes.
   */
  maxRuntimeMs?: number;
  /** Injectable so the budget is testable without waiting. */
  now?: () => number;
  /** How long one tick may share a single tree download. Well under the cadence. */
  treeTtlMs?: number;
}

export interface NetstarClient {
  listVehicles(): Promise<PortalVehicle[]>;
  /**
   * Current position per vehicle, from the tree API. A SNAPSHOT: at most one
   * fix per vehicle, whatever the portal last heard. `from`/`to` filter that
   * snapshot; they do not fetch history — see fetchHistory.
   */
  fetchPositions(from: Date, to: Date, vehicles: PortalVehicle[]): Promise<ProviderPosition[]>;
  /**
   * Historical positions via the report/CSV flow — slow, one job per vehicle
   * per 31-day chunk. Used only by scripts/backfill-tracking.ts.
   *
   * UNVERIFIED against the live portal. The report endpoints were documented in
   * the same pass that got the vehicle-list endpoint wrong (it 404'd), so treat
   * a failure here as "the contract was never right" before assuming an outage.
   */
  fetchHistory(from: Date, to: Date, vehicles: PortalVehicle[]): Promise<ProviderPosition[]>;
  /**
   * Newest fix anywhere on the account, across every client on the reseller
   * tree — the dead-feed signal. See newestFixAt in ./tree.ts for why this
   * spans foreign vehicles rather than only ours.
   */
  feedFreshness(): Promise<Date | null>;
}

/**
 * Lift the anti-forgery token out of the login page.
 *
 * Deliberately tolerant of markup this codebase does not control:
 *   - attributes in any order (`value=` may precede `name=`)
 *   - single or double quotes
 *   - arbitrary whitespace and self-closing slashes
 *
 * The page carries two forms — the login form and a forgot-password form, both
 * posting to /Authentication/ — so "first token on the page" is a real choice
 * rather than an accident. It is the right one: the portal's own client-side
 * code selects the token the same way, globally rather than scoped to a form
 * (`$('input[name=__RequestVerificationToken]').val()`). Matching that keeps us
 * consistent with the server's expectation if a second token ever appears.
 *
 * Returns null rather than throwing so the caller can name the failure.
 */
export function extractVerificationToken(html: string): string | null {
  const inputs = html.match(/<input\b[^>]*>/gi) ?? [];
  for (const tag of inputs) {
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (name !== '__RequestVerificationToken') continue;
    const value = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (value) return value;
  }
  return null;
}

/** Collapses one tick's repeated tree reads; far below the 2-hour cadence. */
const DEFAULT_TREE_TTL_MS = 60_000;

/** Comfortably inside the 2-hour cadence, with room for the next tick. */
const DEFAULT_MAX_RUNTIME_MS = 25 * 60 * 1000;

export function netstarClient(opts: NetstarClientOptions): NetstarClient {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const maxRuntimeMs = opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  const treeTtlMs = opts.treeTtlMs ?? DEFAULT_TREE_TTL_MS;

  const session = new PortalSession({
    baseUrl: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
    isLoggedOut: (res) =>
      res.status === 302 && /Account\/Login/i.test(res.headers.get('location') ?? ''),
    /**
     * Two requests, because the form is anti-forgery protected.
     *
     * GET the login page to pick up the session cookie and the
     * `__RequestVerificationToken` hidden field, then POST both back. ASP.NET
     * MVC validates the token against the cookie, so the pair has to travel
     * together — posting credentials alone is rejected and the session is never
     * established, which surfaces later as "still logged out after re-auth"
     * against whatever endpoint ran next.
     *
     * The form posts to `/Authentication/`, NOT to
     * `/Authentication/Account/Login` — that second path is where the form is
     * SERVED, and posting to it does not log you in. Verified against the live
     * portal 2026-08-07: GET the page, POST to /Authentication/, receive a 302
     * and a session cookie, after which /Main answers 200 instead of redirecting.
     */
    login: async (fetchImpl, jar: CookieJar) => {
      const base = opts.baseUrl.replace(/\/+$/, '');

      const page = await fetchImpl(`${base}/Authentication/Account/Login`, {
        // manual, like every other request this session makes: an already-authed
        // GET here 302s to the dashboard, and following it would run the token
        // scrape against the wrong page and report "no token" instead of "already
        // logged in".
        redirect: 'manual',
        headers: { Cookie: jar.header() },
      });
      jar.absorb(page);
      if (!page.ok) {
        throw new Error(`[netstar] login page: HTTP ${page.status}`);
      }
      const html = await page.text();
      const token = extractVerificationToken(html);
      if (!token) {
        // Shape change, or a login page that is really an error page. Failing
        // here names the cause; posting without the token would surface three
        // calls later as a mysterious logged-out error.
        throw new Error('[netstar] login page carried no __RequestVerificationToken');
      }

      const body = new URLSearchParams({
        UserName: opts.username,
        Password: opts.password,
        __RequestVerificationToken: token,
        // The form submits both; the portal uses them to render times in the
        // operator's zone. SAST is UTC+2 year-round.
        timeZone: '120',
        timeZoneName: 'South Africa Standard Time',
      });
      const res = await fetchImpl(`${base}/Authentication/`, {
        method: 'POST',
        body,
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: jar.header(),
        },
      });
      jar.absorb(res);
      if (res.status >= 400) {
        throw new Error(`[netstar] login failed: HTTP ${res.status}`);
      }
    },
  });

  /**
   * The whole account in one POST, vehicles and their last fix together.
   *
   * `pageSize` is deliberately unbounded: this is a multi-client reseller tree
   * (~11.5k vehicles at the time of writing) and paging it would mean holding a
   * cursor across requests for a list we consume whole. Roughly a few MB every
   * two hours, which is cheaper than the per-vehicle report jobs it replaces.
   *
   * `__ts` is a cache-buster the portal's own UI sends; without it a proxy can
   * hand back a stale tree, which would look exactly like "nothing moved".
   */
  let memo: { at: number; nodes: NetstarTreeNode[] } | null = null;

  async function fetchTree(): Promise<NetstarTreeNode[]> {
    // One tick asks for the tree up to three times within milliseconds —
    // listVehicles for discovery, fetchPositions for ingest, feedFreshness for
    // the dead-feed check. Without this memo that is three multi-MB downloads
    // and three parses every two hours, and the three copies can disagree with
    // each other mid-tick. The TTL is far below the 2-hour cadence, so a later
    // tick always refetches — this collapses one tick, it does not cache across
    // ticks.
    if (memo && now() - memo.at < treeTtlMs) return memo.nodes;
    const qs = `page=1&pageSize=2147483647&__ts=${Date.now()}&treeFilter=&sortBy=&sortDir=`;
    const res = await session.request(`/Main/VehicleRepo/GetVehicleTreeDataPaging?${qs}`, {
      method: 'POST',
      // Explicit empty body: the portal answers 411 Length Required to a POST
      // that carries no Content-Length.
      body: '',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // The portal routes on this; without it the same path answers 404.
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) throw new Error(`[netstar] vehicle tree: HTTP ${res.status}`);
    const nodes = parseVehicleTree(await res.json());
    memo = { at: now(), nodes };
    return nodes;
  }

  async function listVehicles(): Promise<PortalVehicle[]> {
    return (await fetchTree()).map((n) => ({
      externalId: n.externalId,
      registration: n.registration,
      // Carried, not dropped: the account is a reseller tree of other
      // companies' fleets, so which group a match came from is the first thing
      // anyone reviewing a surprising match needs to see.
      groupName: n.groupName,
    }));
  }

  const fetchHistory = createHistoryFetcher({ session, sleep, now, maxRuntimeMs });

  return {
    listVehicles,
    fetchHistory,
    async feedFreshness() {
      return newestFixAt(await fetchTree());
    },
    /**
     * The snapshot path — one request, no report jobs.
     *
     * Returns each requested vehicle's last fix when it falls inside the
     * window. A fix older than `from` is one we have already stored on an
     * earlier tick, and re-returning it would only churn the dedup key.
     */
    async fetchPositions(from, to, vehicles) {
      const wanted = new Set(vehicles.map((v) => v.externalId));
      const nodes = await fetchTree();
      const out: ProviderPosition[] = [];
      for (const n of nodes) {
        if (!wanted.has(n.externalId) || !n.position) continue;
        const t = n.position.recordedAt.getTime();
        if (t >= from.getTime() && t <= to.getTime()) out.push(n.position);
      }
      return out;
    },
  };
}
