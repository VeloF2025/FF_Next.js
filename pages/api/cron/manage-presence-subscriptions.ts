// Cron: Manage presence subscriptions — renew every 45 minutes (60-min max lifetime)
import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { neon } from '@/lib/db-neon';
import { graphFetch } from '@/lib/graph/auth';
import { createPresenceSubscription } from '@/lib/graph/presence';

const sql = neon(process.env.DATABASE_URL!);
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LOGGER = 'PresenceSubCron';

const PRESENCE_WEBHOOK_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/meetings/presence-webhook`
  : 'https://app.fibreflow.app/api/meetings/presence-webhook';

/**
 * POST /api/cron/manage-presence-subscriptions
 *
 * Manages presence webhook subscriptions:
 *   1. Creates a new subscription if none exists
 *   2. Renews existing subscriptions expiring in the next 15 minutes
 *   3. Cleans up expired subscriptions
 *
 * Schedule: Every 45 minutes (presence subs max lifetime = 60 min)
 *
 * Auth: CRON_SECRET bearer token
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  if (!cronSecret || !authHeader || authHeader !== `Bearer ${cronSecret}`) {
    apiResponse.unauthorized(res);
    return;
  }

  try {
    let renewed = 0;
    let created = 0;
    let failed = 0;
    let cleaned = 0;

    // Clean up expired presence subscriptions
    const expiredRows = await sql`
      UPDATE graph_subscriptions
      SET status = 'expired'
      WHERE resource = 'presence'
        AND status = 'active'
        AND expires_at < NOW()
      RETURNING subscription_id
    `;
    cleaned = expiredRows.length;

    // Check for active presence subscriptions
    const activeRows = await sql`
      SELECT subscription_id, expires_at
      FROM graph_subscriptions
      WHERE resource = 'presence'
        AND status = 'active'
        AND expires_at > NOW()
    `;

    if (activeRows.length === 0) {
      // No active presence subscription — create one
      log.info('No active presence subscription — creating new one', {}, LOGGER);
      try {
        await createPresenceSubscription(PRESENCE_WEBHOOK_URL);
        created++;
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        log.error('Failed to create presence subscription', { error: msg }, LOGGER);
      }
    } else {
      // Renew subscriptions expiring in the next 15 minutes
      for (const row of activeRows) {
        const expiresAt = new Date(row.expires_at as string);
        const fifteenMinFromNow = new Date(Date.now() + 15 * 60 * 1000);

        if (expiresAt < fifteenMinFromNow) {
          try {
            const newExpiry = new Date(Date.now() + 60 * 60 * 1000);
            const response = await graphFetch(
              `${GRAPH_BASE}/subscriptions/${row.subscription_id}`,
              {
                method: 'PATCH',
                body: JSON.stringify({ expirationDateTime: newExpiry.toISOString() }),
              }
            );

            if (response.ok) {
              await sql`
                UPDATE graph_subscriptions
                SET expires_at = ${newExpiry.toISOString()}, renewed_at = NOW()
                WHERE subscription_id = ${row.subscription_id as string}
              `;
              renewed++;
            } else {
              // Renewal failed — delete old and create new
              await sql`
                UPDATE graph_subscriptions
                SET status = 'expired'
                WHERE subscription_id = ${row.subscription_id as string}
              `;
              await createPresenceSubscription(PRESENCE_WEBHOOK_URL);
              created++;
            }
          } catch (err: unknown) {
            failed++;
            const msg = err instanceof Error ? err.message : String(err);
            log.warn('Presence subscription renewal failed', { error: msg }, LOGGER);
          }
        }
      }
    }

    const result = { active: activeRows.length, renewed, created, failed, cleaned };
    log.info('Presence subscription management complete', result, LOGGER);

    apiResponse.success(res, result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error('Presence subscription cron failed', { error: msg }, LOGGER);
    apiResponse.error(res, ErrorCode.INTERNAL_ERROR, msg);
  }
}
