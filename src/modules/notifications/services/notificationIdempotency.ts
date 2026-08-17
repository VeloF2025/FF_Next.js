import { sql } from '@/lib/db-pool';

export async function claimNotification(
  userId: string,
  eventType: string,
  idempotencyKey: string
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    INSERT INTO notification_idempotency_claims (user_id, event_type, idempotency_key)
    VALUES (${userId}::uuid, ${eventType}, ${idempotencyKey})
    ON CONFLICT (user_id, event_type, idempotency_key) DO NOTHING
    RETURNING id
  `;
  return rows.length === 1;
}

export async function releaseNotificationClaim(
  userId: string,
  eventType: string,
  idempotencyKey: string
): Promise<void> {
  await sql`
    DELETE FROM notification_idempotency_claims
    WHERE user_id = ${userId}::uuid
      AND event_type = ${eventType}
      AND idempotency_key = ${idempotencyKey}
  `;
}
