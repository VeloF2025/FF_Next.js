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
import { parseAllActivityCsv } from './parse';
import { parseVehicleTree, type NetstarTreeNode } from './tree';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';
import { log } from '@/lib/logger';

/** Portal-enforced: "This report is limited to 31 days". Verified 2026-08-05. */
export const MAX_REPORT_MS = 31 * 24 * 60 * 60 * 1000;

const REPORT_ID = 'Mobiles.IndividualReports.AllActivity';
const TIMEZONE = 'South Africa Standard Time';
/** Generation is async; poll the export until it stops reporting "not ready". */
const EXPORT_ATTEMPTS = 10;
const EXPORT_DELAY_MS = 3_000;
/**
 * Breathing room between one vehicle's report and the next.
 *
 * Same reasoning as the backfill script's pause: this is a partner-owned
 * account, one report job is generated PER VEHICLE, and a burst of them
 * back-to-back is what a scraper looks like. The cost is bounded — a handful
 * of vehicles, a couple of seconds each — and it is paid once every two hours.
 */
const REQUEST_PACE_MS = 2_000;

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
}

/**
 * Some vehicles were fetched, some were not.
 *
 * Thrown rather than returned so a caller that ignores it cannot mistake a
 * partial result for a complete one, but it carries the positions that DID
 * arrive so the caller can still store them. The caller must not advance its
 * watermark past a window it only partly fetched — see pollProvider.ts.
 *
 * Total failure is a plain Error: nothing was fetched, so there is nothing to
 * store and the whole tick failed.
 */
export class PartialFetchError extends Error {
  constructor(
    message: string,
    readonly positions: ProviderPosition[],
    readonly failures: Array<{ externalId: string; error: string }>
  ) {
    super(message);
    this.name = 'PartialFetchError';
  }
}

/** Split a window into contiguous chunks no wider than `maxMs`. */
export function chunkWindow(
  from: Date,
  to: Date,
  maxMs: number
): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  let cursor = from.getTime();
  const end = to.getTime();
  if (!(cursor < end)) return out;
  while (cursor < end) {
    const next = Math.min(cursor + maxMs, end);
    out.push({ from: new Date(cursor), to: new Date(next) });
    cursor = next;
  }
  return out;
}

/** Comfortably inside the 2-hour cadence, with room for the next tick. */
const DEFAULT_MAX_RUNTIME_MS = 25 * 60 * 1000;

export function netstarClient(opts: NetstarClientOptions): NetstarClient {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const maxRuntimeMs = opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;

  const session = new PortalSession({
    baseUrl: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
    isLoggedOut: (res) =>
      res.status === 302 && /Account\/Login/i.test(res.headers.get('location') ?? ''),
    login: async (fetchImpl, jar: CookieJar) => {
      const url = `${opts.baseUrl.replace(/\/+$/, '')}/Authentication/Account/Login`;
      const body = new URLSearchParams({
        UserName: opts.username,
        Password: opts.password,
      });
      const res = await fetchImpl(url, {
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
  async function fetchTree(): Promise<NetstarTreeNode[]> {
    const qs = `page=1&pageSize=2147483647&__ts=${Date.now()}&treeFilter=&sortBy=&sortDir=`;
    const res = await session.request(`/Main/VehicleRepo/GetVehicleTreeDataPaging?${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // The portal routes on this; without it the same path answers 404.
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) throw new Error(`[netstar] vehicle tree: HTTP ${res.status}`);
    return parseVehicleTree(await res.json());
  }

  async function listVehicles(): Promise<PortalVehicle[]> {
    return (await fetchTree()).map((n) => ({
      externalId: n.externalId,
      registration: n.registration,
    }));
  }

  async function fetchChunk(
    from: Date,
    to: Date,
    vehicles: PortalVehicle[]
  ): Promise<ProviderPosition[]> {
    // JSON.stringify serialises NaN as null, so a non-numeric external id would
    // reach the portal as `selectedIds: [null]` — a report for no vehicle, which
    // returns an empty export and reads downstream as a data gap rather than as
    // the bad id it is. Fail loudly instead.
    const selectedIds = vehicles.map((v) => {
      const n = Number(v.externalId);
      if (!Number.isFinite(n)) {
        throw new Error(`[netstar] non-numeric external id "${v.externalId}"`);
      }
      return n;
    });

    const payload = {
      reportId: REPORT_ID,
      reportName: 'All Activity',
      startTime: from.toISOString(),
      stopTime: to.toISOString(),
      scheduleForAllNew: false,
      sortAscending: true,
      embededMap: false,
      useVehicleTimeZone: false,
      selectedTimeZone: TIMEZONE,
      selectedIds,
      selectedNames: vehicles.map((v) => v.registration ?? ''),
      reportBy: 'Vehicle',
      reportTree: 'Vehicles',
      reportGroup: 'Detailed',
      customPanelName: '',
      category: 'Individual',
    };

    const gen = await session.request('/Reports/ReportRepo/GenerateReport/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!gen.ok) throw new Error(`[netstar] GenerateReport: HTTP ${gen.status}`);
    const jobId = (await gen.text()).replace(/^"|"$/g, '');
    if (!jobId) throw new Error('[netstar] GenerateReport returned no job id');

    // Generation is asynchronous. A 503 here was observed once during recon and
    // is treated as "not ready yet" rather than fatal — but only for a bounded
    // number of attempts, so a genuinely broken export still fails the run.
    for (let attempt = 1; attempt <= EXPORT_ATTEMPTS; attempt++) {
      const exp = await session.request('/Reports/Export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/csv' },
        body: JSON.stringify({ reportId: jobId, outputFormat: 'CSV' }),
      });
      if (exp.ok) {
        const positions = parseAllActivityCsv(await exp.text());
        // The export carries no vehicle identifier at all (no registration or
        // id column — see __tests__/fixtures/README.md), so a report covering
        // several vehicles would produce rows nobody could attribute. That is
        // why fetchPositions requests exactly one vehicle per report and this
        // stamps its externalId onto every row it returns.
        return positions.map((p) => ({
          ...p,
          externalId: p.externalId || (vehicles[0]?.externalId ?? ''),
        }));
      }
      if (exp.status !== 503 && exp.status !== 404) {
        throw new Error(`[netstar] Export: HTTP ${exp.status}`);
      }
      log.info('[netstar] export not ready, retrying', { jobId, attempt });
      await sleep(EXPORT_DELAY_MS);
    }
    throw new Error(`[netstar] export never became ready for job ${jobId}`);
  }

  return {
    listVehicles,
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
    async fetchHistory(from, to, vehicles) {
      const all: ProviderPosition[] = [];
      const failures: Array<{ externalId: string; error: string }> = [];
      // Paced, not parallel: one report at a time, with a gap between them.
      let first = true;
      let attempted = 0;
      const deadline = now() + maxRuntimeMs;
      for (const chunk of chunkWindow(from, to, MAX_REPORT_MS)) {
        for (const v of vehicles) {
          if (now() >= deadline) {
            failures.push({ externalId: v.externalId, error: 'runtime budget exhausted' });
            attempted += 1;
            continue;
          }
          if (!first) await sleep(REQUEST_PACE_MS);
          first = false;
          attempted += 1;
          // Isolated per vehicle. Without this, one vehicle whose export job
          // never becomes ready throws out of the loop and discards every
          // position already collected for the others — and because the caller
          // leaves the watermark untouched on a throw, the next tick re-requests
          // the identical window and hits the same stuck vehicle again. One bad
          // report becomes a permanent fleet-wide blackout.
          try {
            all.push(...(await fetchChunk(chunk.from, chunk.to, [v])));
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            failures.push({ externalId: v.externalId, error });
            log.error('[netstar] vehicle report failed — continuing with the rest', {
              externalId: v.externalId, registration: v.registration,
              from: chunk.from.toISOString(), to: chunk.to.toISOString(), error,
            });
          }
        }
      }

      if (failures.length === 0) return all;
      // Everything failed: not a partial result, a dead portal. Fail the tick
      // outright so the watermark stays put and the caller's existing handler
      // classifies it (auth vs transient).
      if (failures.length === attempted) {
        throw new Error(
          `[netstar] every vehicle report failed (${attempted}): ${failures[0]!.error}`
        );
      }
      throw new PartialFetchError(
        `[netstar] ${failures.length} of ${attempted} vehicle reports failed`,
        all,
        failures
      );
    },
  };
}
