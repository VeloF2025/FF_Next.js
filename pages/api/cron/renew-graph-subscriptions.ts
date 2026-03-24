// 🟢 WORKING: Daily cron — renews expiring Graph webhook subscriptions
// Graph callRecord subscriptions have a 3-day maximum lifetime
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import {
  getExpiringSubscriptions,
  getActiveSubscriptionCount,
  renewSubscription,
  createWebhookSubscription,
} from '@/lib/graph/subscriptions';
import { apiResponse } from '@/lib/apiResponse';

const LOGGER = 'GraphSubRenewal';

/** Public HTTPS URL Graph will POST change notifications to */
const WEBHOOK_URL = 'https://app.fibreflow.app/api/meetings/webhook';

/**
 * POST /api/cron/renew-graph-subscriptions
 *
 * Finds all active Graph subscriptions expiring within the next 12 hours and:
 *   1. Attempts to renew each via PATCH /subscriptions/{id}
 *   2. Falls back to creating a new subscription if renewal fails
 *
 * Auth: CRON_SECRET bearer token.
 * Recommended schedule: once daily (e.g. 06:00 SAST).
 *
 * curl example:
 *   curl -X POST https://app.fibreflow.app/api/cron/renew-graph-subscriptions \
 *        -H "Authorization: Bearer $CRON_SECRET"
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method!, ['GET']);
    return;
  }

  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('CRON_SECRET is not configured', {}, LOGGER);
    apiResponse.internalError(res, new Error('Server misconfiguration'));
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    log.warn(
      'Unauthorized cron attempt on subscription renewal',
      { ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress },
      LOGGER
    );
    apiResponse.unauthorized(res);
    return;
  }

  try {
    let renewed = 0;
    let recreated = 0;
    let failed = 0;
    let bootstrapped = false;

    // Bootstrap: create a subscription if none exist (first run or all expired)
    const activeCount = await getActiveSubscriptionCount();
    if (activeCount === 0) {
      log.info('No active subscriptions found — bootstrapping new subscription', {}, LOGGER);
      try {
        await createWebhookSubscription(WEBHOOK_URL);
        bootstrapped = true;
        recreated++;
        log.info('Webhook subscription bootstrapped', { webhookUrl: WEBHOOK_URL }, LOGGER);
      } catch (bootstrapError: unknown) {
        failed++;
        const msg = bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError);
        log.error('Subscription bootstrap failed', { error: msg }, LOGGER);
      }
    }

    const expiring = await getExpiringSubscriptions();

    log.info(
      'Subscription renewal check',
      { expiringSoon: expiring.length, activeCount, bootstrapped },
      LOGGER
    );

    for (const sub of expiring) {
      try {
        await renewSubscription(sub.subscriptionId);
        renewed++;
        log.info(
          'Subscription renewed',
          { subscriptionId: sub.subscriptionId, expiresAt: sub.expiresAt },
          LOGGER
        );
      } catch (renewError: unknown) {
        const renewMsg = renewError instanceof Error ? renewError.message : String(renewError);

        log.warn(
          'Subscription renewal failed — attempting recreation',
          { subscriptionId: sub.subscriptionId, error: renewMsg },
          LOGGER
        );

        try {
          await createWebhookSubscription(WEBHOOK_URL);
          recreated++;
        } catch (createError: unknown) {
          failed++;
          const createMsg = createError instanceof Error ? createError.message : String(createError);
          log.error(
            'Subscription recreation failed',
            { subscriptionId: sub.subscriptionId, error: createMsg },
            LOGGER
          );
        }
      }
    }

    log.info(
      'Subscription renewal cron complete',
      { expiring: expiring.length, renewed, recreated, failed },
      LOGGER
    );

    res.status(200).json({
      success: true,
      activeCount,
      bootstrapped,
      expiring: expiring.length,
      renewed,
      recreated,
      failed,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('Subscription renewal cron failed', { error: errorMsg }, LOGGER);
    res.status(500).json({ success: false, error: errorMsg });
  }
}
