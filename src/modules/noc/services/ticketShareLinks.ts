/**
 * Ticket Share Links — batched share-URL resolution for exports.
 *
 * Produces the same public, no-auth shareable ticket URL as the NOC "Share"
 * button (`/snag/resolve/<token>`), backed by the `snag_share_tokens` table.
 *
 * Two entry points:
 * - getOrCreateShareUrls: mints a token for any ticket missing one. Use from
 *   server-side EXPORT endpoints, where a write side-effect is acceptable and
 *   every ticketed row should get a working link.
 * - getShareUrls: read-only; returns links only for tickets that already have an
 *   active token. Use from hot LIST endpoints where minting on every page load
 *   would be wasteful.
 *
 * Both batch their DB access (one SELECT, plus one INSERT for the create variant)
 * to avoid N+1 round-trips when an export contains hundreds of tickets.
 */

import crypto from 'crypto';
import pool from '@/lib/db';
import { log } from '@/lib/logger';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';

/** A v4-ish UUID guard so non-uuid ids never reach a `::uuid[]` cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildUrl(token: string): string {
  return `${APP_URL}/snag/resolve/${token}`;
}

/** Normalize input: drop null/blank/non-uuid values and de-duplicate. */
function sanitizeIds(ticketIds: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const id of ticketIds) {
    if (id && UUID_RE.test(id)) seen.add(id);
  }
  return [...seen];
}

/**
 * Fetch the latest active token per ticket (read-only).
 * Returns Map<ticketId, shareUrl> covering only tickets that already have one.
 */
export async function getShareUrls(
  ticketIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = sanitizeIds(ticketIds);
  const urls = new Map<string, string>();
  if (ids.length === 0) return urls;

  const result = await pool.query<{ ticket_id: string; token: string }>(
    `SELECT DISTINCT ON (ticket_id) ticket_id, token
       FROM snag_share_tokens
      WHERE ticket_id = ANY($1::uuid[]) AND is_active = true
      ORDER BY ticket_id, created_at DESC`,
    [ids],
  );
  for (const row of result.rows) {
    urls.set(row.ticket_id, buildUrl(row.token));
  }
  return urls;
}

/**
 * Fetch-or-create an active token per ticket, returning Map<ticketId, shareUrl>.
 * Mints (and persists) a token for any ticket that lacks an active one, so every
 * supplied ticket id resolves to a usable link.
 */
export async function getOrCreateShareUrls(
  ticketIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = sanitizeIds(ticketIds);
  const urls = await getShareUrls(ids);
  if (ids.length === 0) return urls;

  const missing = ids.filter((id) => !urls.has(id));
  if (missing.length === 0) return urls;

  const tokens = missing.map(() => crypto.randomBytes(24).toString('hex'));

  try {
    // Batched insert via unnest; created_by NULL mirrors the NOC notification path.
    await pool.query(
      `INSERT INTO snag_share_tokens (token, ticket_id, created_by)
       SELECT t.token, t.ticket_id, NULL
         FROM unnest($1::text[], $2::uuid[]) AS t(token, ticket_id)`,
      [tokens, missing],
    );
    missing.forEach((id, i) => urls.set(id, buildUrl(tokens[i] as string)));
  } catch (err) {
    // A link is a convenience column; never fail the whole export over it.
    log.warn('Failed to create share tokens for export', {
      count: missing.length,
      error: err instanceof Error ? err.message : String(err),
    }, 'TicketShareLinks');
  }

  return urls;
}
