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
