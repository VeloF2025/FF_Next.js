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
 * Safe to interrupt and re-run: every write goes through ingestPositions, which
 * is idempotent on (provider, account_ref, provider_event_id). It may also run
 * while the 2-hourly poll is active, for the same reason.
 *
 * Sequential and paced on purpose. These are partner-owned accounts and a
 * backfill that looks like an attack gets an account suspended.
 */
import { netstarClient, netstarProvider, MAX_REPORT_MS } from '@/services/tracking/netstar';
import { ingestPositions } from '@/services/tracking/ingest';
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const PAUSE_MS = 5_000;
const DRY_CHUNKS_BEFORE_STOP = 2;

function arg(name: string, fallback?: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = hit?.split('=')[1] ?? fallback;
  if (!value) throw new Error(`--${name}= is required`);
  return value;
}

async function main(): Promise<void> {
  const providerKey = arg('provider');
  if (providerKey !== 'netstar') {
    throw new Error(`unsupported provider "${providerKey}" — phase 1 covers netstar only`);
  }
  const floor = new Date(arg('floor', '2024-08-01'));
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
    provider: providerKey, accountRef, activeTrackers, floor: floor.toISOString() });

  let to = new Date();
  let dryChunks = 0;
  let totalInserted = 0;

  while (to > floor && dryChunks < DRY_CHUNKS_BEFORE_STOP) {
    const from = new Date(Math.max(to.getTime() - MAX_REPORT_MS, floor.getTime()));
    const positions = await provider.fetchPositions(from, to);
    const { inserted, skippedUnmapped } = await ingestPositions(
      'netstar', accountRef, positions);
    totalInserted += inserted;

    log.info('[backfill-tracking] chunk complete', {
      provider: providerKey, accountRef,
      from: from.toISOString(), to: to.toISOString(),
      fetched: positions.length, inserted, skippedUnmapped, totalInserted });

    dryChunks = positions.length === 0 ? dryChunks + 1 : 0;
    to = from;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
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

main().catch((err) => {
  log.error('[backfill-tracking] failed', {
    error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
