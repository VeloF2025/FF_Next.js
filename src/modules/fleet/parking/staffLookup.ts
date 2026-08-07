/**
 * users.id → staff.id, for the decided_by FK.
 *
 * decided_by references staff(id), but web sessions carry a users.id. Most
 * approvers are office users with a staff row; some are not, and a decision by
 * one of those stores a null decided_by rather than failing — the decision
 * itself matters more than the attribution, and decided_at still records that
 * it happened.
 */
import { sql } from '@/lib/db-pool';

export async function resolveStaffIdForUser(userId: string): Promise<string | null> {
  const rows = await sql<{ id: string }>`
    SELECT id FROM staff WHERE user_id = ${userId} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}
