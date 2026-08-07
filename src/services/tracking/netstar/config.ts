/**
 * Env-driven registration for the Netstar portal provider.
 *
 * Mirrors cartrack/portalConfig.ts. Both live outside pollProvider.ts so that
 * file stays within the 300-line limit — it had drifted past it before either
 * existed.
 */
import { log } from '@/lib/logger';
import { netstarClient } from './client';
import { netstarProvider } from './provider';
import type { ConfiguredProvider } from '../pollProvider';

/**
 * The Netstar provider, or null when it is not configured.
 *
 * Unlike the Cartrack portal, Netstar is NOT optional: it is the reason this
 * cron exists, so an absent config is a fault and is named loudly. A provider
 * merely missing from the loop produces a 200 with an empty result set —
 * indistinguishable from a healthy tick — so a typo in a variable name, or an
 * env file that never reached the service, would otherwise stay invisible for
 * as long as nobody thought to ask why no positions were arriving.
 */
export function netstarFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ConfiguredProvider | null {
  const { NETSTAR_PORTAL_URL, NETSTAR_PORTAL_USER, NETSTAR_PORTAL_PASS } = env;
  if (NETSTAR_PORTAL_URL && NETSTAR_PORTAL_USER && NETSTAR_PORTAL_PASS) {
    const opts = {
      baseUrl: NETSTAR_PORTAL_URL,
      username: NETSTAR_PORTAL_USER,
      password: NETSTAR_PORTAL_PASS,
      accountRef: env.NETSTAR_ACCOUNT_REF ?? 'europcar',
    };
    const client = netstarClient(opts);
    return {
      provider: netstarProvider({ ...opts, client }),
      listVehicles: () => client.listVehicles(),
      feedFreshness: () => client.feedFreshness(),
    };
  }

  const missing = (
    [
      ['NETSTAR_PORTAL_URL', NETSTAR_PORTAL_URL],
      ['NETSTAR_PORTAL_USER', NETSTAR_PORTAL_USER],
      ['NETSTAR_PORTAL_PASS', NETSTAR_PORTAL_PASS],
    ] as const
  ).filter(([, value]) => !value).map(([name]) => name);
  log.warn('[poll-portal-tracking] netstar not configured — skipping provider entirely', {
    missing,
    hint: 'set these in the service env file; until then this cron does nothing',
  });
  return null;
}
