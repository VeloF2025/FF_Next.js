/**
 * Ituran tracking poll.
 *
 *   npx tsx scripts/poll-ituran-tracking.ts
 *
 * WHY THIS IS A SCRIPT AND NOT A PROVIDER IN /api/cron/poll-portal-tracking.
 *
 * The Ituran portal is behind a Reblaze bot challenge. Getting past it needs a
 * real browser exactly once per session, and the browser is Playwright — a
 * devDependency. Registering Ituran in configuredProviders() would make the
 * Next.js route bundle reach Playwright, so the browser stays out here and the
 * route keeps polling only the providers it can reach with plain fetch.
 *
 * Everything after the mint is shared: this builds the same ConfiguredProvider
 * shape the route builds and hands it to the same pollProvider(), so reconcile,
 * ingest, watermark and alerting behave identically for all providers. There is
 * no second copy of that logic.
 *
 * The session is minted fresh on every run and thrown away. At a 2-hourly
 * cadence a ~5s mint is not worth caching, and not persisting it means no
 * portal credential is ever written to the database.
 *
 * Exits non-zero when the tick failed, so cron mail and the log both show it.
 */
import { ituranClient, ituranProvider } from '@/services/tracking/ituran';
import { mintIturanSession } from '@/services/tracking/ituran/session';
import { pollProvider } from '@/services/tracking/pollProvider';
import { alertRecipientCount } from '@/services/tracking/alerts';
import { pool } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const DEFAULT_BASE_URL = 'https://www.ituran.com';

/**
 * Distinct from poll-tracking's 4417301 and poll-portal-tracking's 4417302, so
 * Ituran serialises only against itself and never blocks the other cadences.
 *
 * Running outside the API route means this does not inherit that route's
 * advisory lock, and it still needs one for the same reason the route
 * documents: two concurrent ticks race reconcileTrackers' read-then-write and
 * can land a stale watermark upsert after a fresher one. A mint takes ~5s and a
 * tick well under a minute, so overlap needs a stall — but a stalled portal is
 * exactly when a second tick fires, and it would also mean two browser logins
 * against a partner-owned account at once.
 */
const LOCK_KEY = 4417303;

async function main(): Promise<number> {
  const baseUrl = process.env.ITURAN_PORTAL_URL || DEFAULT_BASE_URL;
  const username = process.env.ITURAN_PORTAL_USER;
  const password = process.env.ITURAN_PORTAL_PASS;
  const accountRef = process.env.ITURAN_ACCOUNT_REF ?? 'avis';

  if (!username || !password) {
    // Name the missing variables. A provider that is merely absent produces a
    // clean exit indistinguishable from a healthy tick, so a typo in an env
    // file would stay invisible until somebody asked why no positions arrived.
    const missing = [
      ['ITURAN_PORTAL_USER', username],
      ['ITURAN_PORTAL_PASS', password],
    ].filter(([, v]) => !v).map(([n]) => n);
    log.error('[poll-ituran] not configured — refusing to run', {
      missing,
      hint: 'set these in the service env file',
    });
    return 1;
  }

  const client = ituranClient({
    baseUrl,
    username,
    mintSession: () => mintIturanSession({ baseUrl, username, password }),
  });

  const recipients = alertRecipientCount();
  if (recipients === 0) {
    log.warn('[poll-ituran] no alert recipients configured — alerts will be dropped', {
      hint: 'set FLEET_ALERT_USER_IDS in the service env file',
    });
  }

  // Same pinned-connection discipline as the API-route pollers:
  // pg_try_advisory_lock and pg_advisory_unlock are SESSION-scoped, so acquire
  // and release must run on the identical physical connection or the unlock
  // silently no-ops on a session that never held the lock — stranding it on
  // whichever session did. sql()/pool.query() each check out an arbitrary
  // connection, so a pinned client is required.
  const client_ = await pool.connect();
  let lockHeld = false;
  try {
    const { rows } = await client_.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    lockHeld = rows[0]?.locked ?? false;
    if (!lockHeld) {
      // Not an error: the previous tick is still going. Exit 0 so cron does not
      // mail about it, but say so on stdout where the log file will show it.
      log.info('[poll-ituran] previous run still in progress — skipping tick');
      process.stdout.write(`${JSON.stringify({ accountRef, skipped: 'already-running' })}\n`);
      return 0;
    }

    const result = await pollProvider({
      provider: ituranProvider({ accountRef, client }),
      listVehicles: () => client.listVehicles(),
      // A snapshot feed keeps serving the same fix after the account goes dark,
      // so staleness — not emptiness — is the dead-feed signal.
      feedFreshness: () => client.feedFreshness(),
    });

    // Printed, not just logged: the cron appends stdout to the log file, and
    // log.info goes to journald, which is not where anyone looks when a day of
    // telemetry is missing.
    process.stdout.write(`${JSON.stringify({ accountRef, alertRecipients: recipients, result })}\n`);

    return 'error' in (result as Record<string, unknown>) ? 1 : 0;
  } finally {
    let unlockFailed = false;
    if (lockHeld) {
      try {
        await client_.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      } catch (err) {
        unlockFailed = true;
        log.error('[poll-ituran] advisory unlock failed', {
          error: err instanceof Error ? err.message : String(err) });
      }
    }
    // A connection whose unlock failed still holds the session-scoped lock.
    // Destroying it ends the session, which is what makes Postgres drop it —
    // otherwise every later tick skips with a clean exit and tracking stops
    // dead while looking healthy.
    client_.release(unlockFailed);
  }
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    log.error('[poll-ituran] tick failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
