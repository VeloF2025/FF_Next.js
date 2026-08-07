/**
 * Env-driven registration for the Cartrack fleetweb portal provider.
 *
 * Lives here rather than inline in pollProvider.ts, which is already over the
 * 300-line limit before this provider existed — adding a fourth env block to it
 * would push it further out.
 */
import { log } from '@/lib/logger';
import { cartrackPortalClient } from './portalClient';
import { cartrackPortalProvider } from './portalProvider';
import type { ConfiguredProvider } from '../pollProvider';

const DEFAULT_BASE_URL = 'https://fleetweb-za.cartrack.com';

/**
 * The portal provider, or null when it is not configured.
 *
 * Optional by design — unlike Netstar, an entirely absent config is a valid
 * deployment, so silence is correct there. A PARTIAL config is not: it would
 * otherwise be skipped and look identical to a healthy tick, so every subset
 * that isn't "all" or "none" is named loudly.
 */
export function cartrackPortalFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ConfiguredProvider | null {
  const url = env.CARTRACK_PORTAL_URL;
  const account = env.CARTRACK_PORTAL_ACCOUNT;
  const subUser = env.CARTRACK_PORTAL_SUBUSER;
  const password = env.CARTRACK_PORTAL_PASS;

  if (account && subUser && password) {
    const client = cartrackPortalClient({
      baseUrl: url || DEFAULT_BASE_URL,
      account,
      subUser,
      password,
    });
    return {
      provider: cartrackPortalProvider({
        accountRef: env.CARTRACK_PORTAL_ACCOUNT_REF ?? 'urent',
        client,
      }),
      listVehicles: () => client.listVehicles(),
      // A snapshot feed keeps serving the same fix after an account goes dark,
      // so staleness — not emptiness — is the dead-feed signal. This account
      // legitimately holds vehicles idle for days.
      feedFreshness: () => client.feedFreshness(),
    };
  }

  // Every variable is checked here, including PASS. Testing only a subset means
  // a config consisting of PASS alone falls through both branches and is
  // dropped in total silence — the exact failure this warning exists to catch.
  if (url || account || subUser || password) {
    const missing = (
      [
        ['CARTRACK_PORTAL_ACCOUNT', account],
        ['CARTRACK_PORTAL_SUBUSER', subUser],
        ['CARTRACK_PORTAL_PASS', password],
      ] as const
    ).filter(([, value]) => !value).map(([name]) => name);
    log.warn('[poll-portal-tracking] cartrack portal partially configured — skipping it', {
      missing,
      hint: 'set all three of ACCOUNT/SUBUSER/PASS, or none, in the service env file',
    });
  }
  return null;
}
