/**
 * OneMap Backfill — candidate selection
 *
 * Which DRs the backfill cron should look at, and what has fallen out of its
 * reach. Split from onemapBackfillService so neither file outgrows the
 * 300-line cap.
 */

import pool from '@/lib/db';

// Rows are re-examined at most this often, whether the last attempt found a
// shortfall or failed outright. Short enough to recover during a multi-hour
// 1Map degradation, long enough that a permanently-short DR cannot occupy a
// LIMIT slot on every 15-minute tick.
export const RETRY_COOLDOWN = '1 hour';
export const LOOKBACK_WINDOW = '7 days';

/**
 * Candidate query per mode. `mode` never reaches SQL as text — it only picks
 * among these fixed strings, and the limit is always bound as $1.
 */
export function buildCandidateQuery(mode: string): string {
  switch (mode) {
    case 'missing_photos':
      return `
        SELECT drop_number
        FROM dr_photo_unified_reviews
        WHERE (photo_count IS NULL OR photo_count = 0)
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT $1
      `;

    case 'missing_serials':
      return `
        SELECT drop_number
        FROM dr_photo_unified_reviews
        WHERE (ont_serial_scanned IS NULL OR ont_serial_scanned = '')
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT $1
      `;

    case 'unverified':
      // Photo set never checked against 1Map, or checked and found short.
      // Oldest first: during an ongoing degradation new DRs keep arriving and
      // failing, and newest-first ordering would let them crowd out the
      // incident-era backlog until it aged past the lookback window.
      return `
        SELECT drop_number
        FROM dr_photo_unified_reviews
        WHERE created_at > NOW() - INTERVAL '${LOOKBACK_WINDOW}'
          AND (
            photo_count_verified_at IS NULL
            OR (
              photo_count_mismatch = TRUE
              AND photo_count_verified_at < NOW() - INTERVAL '${RETRY_COOLDOWN}'
            )
          )
        ORDER BY created_at ASC
        LIMIT $1
      `;

    case 'all_missing':
    default:
      return `
        SELECT drop_number
        FROM dr_photo_unified_reviews
        WHERE (
          (photo_count IS NULL OR photo_count = 0)
          OR (ont_serial_scanned IS NULL AND ups_serial_scanned IS NULL)
        )
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT $1
      `;
  }
}

/**
 * DRs that fell out of the lookback window still unresolved. Nothing will ever
 * retry these, so the number is surfaced rather than left to be inferred from
 * silence — a backlog that quietly stops being worked looks identical to a
 * backlog that was cleared.
 */
export async function countAgedOut(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM dr_photo_unified_reviews
     WHERE created_at <= NOW() - INTERVAL '${LOOKBACK_WINDOW}'
       AND (photo_count_verified_at IS NULL OR photo_count_mismatch = TRUE)`
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

