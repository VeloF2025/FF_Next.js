/**
 * One-off historical backfill for a portal tracking provider.
 *
 *   npx tsx scripts/backfill-tracking.ts --provider=netstar --floor=2024-08-01
 *
 * Walks BACKWARDS from now in provider-max chunks. Portals cap how much history
 * a single report may cover (Netstar: 31 days) and none of them documents how
 * far back the data actually goes — so retention is discovered by walking until
 * two consecutive chunks come back empty, rather than assumed.
 *
 * RESUMING. Re-running is safe for the database — every write goes through
 * ingestPositions, which is idempotent on (provider, account_ref,
 * provider_event_id) — but it is NOT free against the portal: a plain re-run
 * restarts from now() and re-issues every report job it already did, one per
 * vehicle per 31-day chunk, against a partner-owned account. So the cursor is
 * printed on every chunk and on exit, and `--to=` picks up from it:
 *
 *   npx tsx scripts/backfill-tracking.ts --provider=netstar --floor=2024-08-01 \
 *     --to=2025-11-14T00:00:00.000Z
 *
 * It may also run while the 2-hourly poll is active: it only ever appends
 * positions and never touches fleet_vehicle_trackers, so it cannot race the
 * poll's reconcile.
 *
 * Sequential and paced on purpose. These are partner-owned accounts and a
 * backfill that looks like an attack gets an account suspended.
 */
import { netstarClient, netstarProvider, MAX_REPORT_MS } from '@/services/tracking/netstar';
import { ingestPositions } from '@/services/tracking/ingest';
import {
  countDry, nextChunk, parseDateArg, resumeCommand, shouldContinue,
} from '@/services/tracking/backfillPlan';
import { sql, pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const PAUSE_MS = 5_000;
const DRY_CHUNKS_BEFORE_STOP = 2;

function arg(name: string, fallback?: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  // slice, not split('=')[1]: an ISO timestamp resume cursor contains no '='
  // today, but truncating a value at its first one is a trap waiting for the
  // first argument that does.
  const value = hit ? hit.slice(prefix.length) : fallback;
  if (!value) throw new Error(`--${name}= is required`);
  return value;
}

async function main(): Promise<void> {
  const providerKey = arg('provider');
  if (providerKey !== 'netstar') {
    throw new Error(`unsupported provider "${providerKey}" — phase 1 covers netstar only`);
  }
  const floor = parseDateArg('floor', arg('floor', '2024-08-01'));
  const start = parseDateArg('to', arg('to', new Date().toISOString()));
  if (start <= floor) {
    throw new Error(`--to=${start.toISOString()} is not after --floor=${floor.toISOString()}`);
  }
  const { NETSTAR_PORTAL_URL, NETSTAR_PORTAL_USER, NETSTAR_PORTAL_PASS } = process.env;
  if (!NETSTAR_PORTAL_URL || !NETSTAR_PORTAL_USER || !NETSTAR_PORTAL_PASS) {
    throw new Error('NETSTAR_PORTAL_URL, NETSTAR_PORTAL_USER and NETSTAR_PORTAL_PASS must be set');
  }
  const accountRef = process.env.NETSTAR_ACCOUNT_REF ?? 'europcar';
  const opts = {
    baseUrl: NETSTAR_PORTAL_URL,
    username: NETSTAR_PORTAL_USER,
    password: NETSTAR_PORTAL_PASS,
    accountRef,
  };
  const provider = netstarProvider({ ...opts, client: netstarClient(opts) });

  // Discovery has to have run at least once, and this script does not run it.
  // netstarProvider.fetchPositions() returns [] when no vehicle is mapped, so
  // without this check the walk would collect two empty chunks, stop, and log
  // "stopped at retention edge, totalInserted: 0" — a success message for a
  // complete no-op. That is the most likely first-live-run sequence: creds set,
  // backfill started, poll cron not yet run.
  const mapped = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM fleet_vehicle_trackers
    WHERE provider = ${providerKey} AND account_ref = ${accountRef} AND is_active
  `;
  const activeTrackers = mapped[0]?.n ?? 0;
  if (activeTrackers === 0) {
    log.error('[backfill-tracking] no active trackers mapped — nothing to backfill', {
      provider: providerKey, accountRef,
      hint: 'run GET /api/cron/poll-portal-tracking once so discovery populates '
        + 'fleet_vehicle_trackers, then re-run this script',
    });
    process.exitCode = 1;
    return;
  }
  log.info('[backfill-tracking] starting', {
    provider: providerKey, accountRef, activeTrackers,
    floor: floor.toISOString(), from: start.toISOString() });

  let to = start;
  let dryChunks = 0;
  let totalInserted = 0;

  // Ctrl-C mid-walk is the expected way a multi-hour backfill ends. Print where
  // it got to, so resuming does not mean re-walking everything.
  const onInterrupt = () => {
    log.warn('[backfill-tracking] interrupted', {
      reachedBack: to.toISOString(), totalInserted,
      resume: resumeCommand(providerKey, floor, to),
    });
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onInterrupt);

  try {
    while (shouldContinue(to, floor, dryChunks, DRY_CHUNKS_BEFORE_STOP)) {
      const { from } = nextChunk(to, floor, MAX_REPORT_MS);
      const positions = await provider.fetchPositions(from, to);
      const { inserted, skippedUnmapped } = await ingestPositions(
        'netstar', accountRef, positions);
      totalInserted += inserted;

      log.info('[backfill-tracking] chunk complete', {
        provider: providerKey, accountRef,
        from: from.toISOString(), to: to.toISOString(),
        fetched: positions.length, inserted, skippedUnmapped, totalInserted,
        resume: resumeCommand(providerKey, floor, from),
      });

      dryChunks = countDry(dryChunks, positions.length);
      to = from;
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  } catch (err) {
    // Re-thrown after logging the cursor: without it, a failure two thirds of
    // the way through a 24-month walk costs the whole walk.
    log.error('[backfill-tracking] chunk failed — resume from the cursor below', {
      reachedBack: to.toISOString(), totalInserted,
      resume: resumeCommand(providerKey, floor, to),
    });
    throw err;
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onInterrupt);
  }

  if (dryChunks >= DRY_CHUNKS_BEFORE_STOP) {
    log.info('[backfill-tracking] stopped at retention edge', {
      provider: providerKey, accountRef,
      reachedBack: to.toISOString(), totalInserted });
  } else {
    log.info('[backfill-tracking] reached configured floor', {
      provider: providerKey, floor: floor.toISOString(), totalInserted });
  }
}

main()
  .catch((err) => {
    log.error('[backfill-tracking] failed', {
      error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  })
  // src/lib/db.ts holds a min:1 connection floor with keepAlive, so the event
  // loop never drains on its own — without this the script finishes its work
  // and then sits there until somebody kills it.
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
