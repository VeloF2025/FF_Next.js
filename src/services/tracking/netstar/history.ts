/**
 * Netstar historical positions — the report builder, and the slow path.
 *
 *   POST /Reports/ReportRepo/GenerateReport/  -> "<jobId>"  (async)
 *   POST /Reports/Export                      -> CSV bytes
 *
 * One job per vehicle per 31-day chunk, each export polled until it is ready.
 * Only scripts/backfill-tracking.ts reaches this; the 2-hourly poll uses the
 * tree API (./tree.ts), which needs one request for the whole account.
 *
 * UNVERIFIED against the live portal. These endpoint paths were documented in
 * the same pass that had the vehicle list pointing at
 * /Reports/ReportRepo/GetReportTree — an endpoint that does not exist and always
 * 404'd. Treat a failure here as "the contract was never right" before
 * concluding the portal is down.
 *
 * Split out of client.ts so the live path is not read through 150 lines of a
 * flow that never runs during a poll — and so client.ts fits the 300-line rule.
 */
import type { PortalSession } from '../portal/session';
import { parseAllActivityCsv } from './parse';
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
 * Breathing room between one vehicle's report and the next. These are
 * partner-owned accounts, one report job is generated PER VEHICLE, and a burst
 * of them back-to-back is what a scraper looks like.
 */
const REQUEST_PACE_MS = 2_000;

/**
 * Some vehicles were fetched, some were not.
 *
 * Thrown rather than returned so a caller that ignores it cannot mistake a
 * partial result for a complete one, but it carries the positions that DID
 * arrive so the caller can still store them. A caller must not advance a
 * watermark past a window it only partly fetched.
 *
 * Total failure is a plain Error: nothing was fetched, so there is nothing to
 * store and the whole run failed.
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

export interface HistoryDeps {
  session: PortalSession;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /**
   * Wall-clock budget for one fetchHistory call. Worst case per vehicle is ~11
   * minutes (one GenerateReport plus EXPORT_ATTEMPTS polls at the session's 60s
   * timeout), so a large fleet against a degenerate portal runs for hours.
   * Stopping at the budget turns that into a partial fetch the caller can
   * resume from.
   */
  maxRuntimeMs: number;
}

export function createHistoryFetcher(deps: HistoryDeps) {
  const { session, sleep, now, maxRuntimeMs } = deps;

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

  async function fetchHistory(
  from: Date,
  to: Date,
  vehicles: PortalVehicle[]
  ): Promise<ProviderPosition[]> {
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
  }

  return fetchHistory;
}
