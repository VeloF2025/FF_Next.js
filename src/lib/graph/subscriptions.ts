// 🟢 WORKING: Microsoft Graph webhook subscriptions — create, renew, and query expiring subs
import { graphFetch } from './auth';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const sql = neon(process.env.DATABASE_URL!);

/** Graph API subscription object returned on create/read */
export interface GraphSubscription {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState?: string;
}

/** Row shape returned by getExpiringSubscriptions */
export interface ExpiringSubscription {
  subscriptionId: string;
  expiresAt: string;
}

/**
 * Creates a new Microsoft Graph webhook subscription for call records.
 * Persists the subscription metadata to the `graph_subscriptions` table.
 *
 * Call record subscriptions have a maximum lifetime of 3 days — callers should
 * schedule renewal via `renewSubscription` before expiry.
 *
 * @param notificationUrl - Public HTTPS URL that Graph will POST change notifications to
 * @returns The created GraphSubscription object
 */
export async function createWebhookSubscription(
  notificationUrl: string
): Promise<GraphSubscription> {
  const clientState = process.env.GRAPH_WEBHOOK_SECRET;
  if (!clientState) {
    throw new Error('GRAPH_WEBHOOK_SECRET required for webhook subscriptions');
  }

  // Graph enforces a maximum of 3 days for callRecords subscriptions
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const body = {
    changeType: 'created',
    notificationUrl,
    resource: '/communications/callRecords',
    expirationDateTime: expiresAt.toISOString(),
    clientState,
  };

  const response = await graphFetch(`${GRAPH_BASE}/subscriptions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create Graph subscription: ${response.status} ${errorText}`
    );
  }

  const sub = (await response.json()) as GraphSubscription;

  await sql`
    INSERT INTO graph_subscriptions
      (subscription_id, resource, change_type, notification_url, expires_at, client_state)
    VALUES
      (${sub.id}, ${sub.resource}, ${sub.changeType}, ${sub.notificationUrl},
       ${expiresAt.toISOString()}, ${clientState})
  `;

  log.info(
    'Graph webhook subscription created',
    { subscriptionId: sub.id, expiresAt: expiresAt.toISOString() },
    'GraphSubscriptions'
  );

  return sub;
}

/**
 * Extends an existing subscription by 3 more days.
 * Updates the `graph_subscriptions` table with the new expiry timestamp.
 *
 * @param subscriptionId - The Graph subscription ID to renew
 */
export async function renewSubscription(subscriptionId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const response = await graphFetch(
    `${GRAPH_BASE}/subscriptions/${subscriptionId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to renew subscription ${subscriptionId}: ${response.status} ${errorText}`
    );
  }

  await sql`
    UPDATE graph_subscriptions
    SET expires_at  = ${expiresAt.toISOString()},
        renewed_at  = NOW()
    WHERE subscription_id = ${subscriptionId}
  `;

  log.info(
    'Subscription renewed',
    { subscriptionId, expiresAt: expiresAt.toISOString() },
    'GraphSubscriptions'
  );
}

/**
 * Returns all active subscriptions that expire within the next 12 hours.
 * Use this in a scheduled job to renew subscriptions before they lapse.
 */
export async function getExpiringSubscriptions(): Promise<ExpiringSubscription[]> {
  const rows = await sql`
    SELECT subscription_id, expires_at
    FROM graph_subscriptions
    WHERE status = 'active'
      AND expires_at < NOW() + INTERVAL '12 hours'
  `;

  return rows.map(r => ({
    subscriptionId: r.subscription_id as string,
    expiresAt: r.expires_at as string,
  }));
}
