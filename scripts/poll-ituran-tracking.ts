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
