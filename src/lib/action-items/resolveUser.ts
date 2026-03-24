/**
 * Resolve an assignee name to a FibreFlow user ID.
 * Used by meeting action items, procurement, and other modules
 * to auto-link text assignee names to actual user accounts.
 */

import { sql } from '@/lib/db-pool';

/**
 * Fuzzy-match an assignee name to a user ID from the users table.
 * Tries exact match, then partial name match.
 * Returns null if no match found or name is empty/Unassigned.
 */
export async function resolveUserByName(name: string): Promise<string | null> {
  if (!name || name === 'Unassigned' || name.length < 2) return null;

  const trimmed = name.trim().toLowerCase();

  // Try exact match on first_name + last_name
  const exact = await sql`
    SELECT id FROM users
    WHERE LOWER(first_name || ' ' || last_name) = ${trimmed}
    LIMIT 1
  `;
  if (exact.length > 0) return exact[0].id as string;

  // Try partial match: name contains both first and last name
  const partial = await sql`
    SELECT id FROM users
    WHERE LENGTH(last_name) > 3
      AND LOWER(last_name) != ''
      AND ${trimmed} LIKE '%' || LOWER(last_name) || '%'
      AND ${trimmed} LIKE '%' || LOWER(first_name) || '%'
    LIMIT 1
  `;
  if (partial.length > 0) return partial[0].id as string;

  return null;
}
