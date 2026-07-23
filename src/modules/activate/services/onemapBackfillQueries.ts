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
 * Rows created before the cron went live were never in its scope — their null
 * photo_count_verified_at is an artifact of nothing having populated the
 * column for them (20,490 such rows the day this shipped), not a backlog this
 * job failed to work. Counting them would emit a five-figure warning every 15
 * minutes and bury the signal the metric exists to raise.
 *
 * Note this is a go-live boundary, NOT "old rows have null verified_at".
 * Fresh DRs land with a null verified_at every day — ~160/day, spread evenly
 * across the lookback window — so age alone cannot separate the two.
 *
 * Set to the day the cron actually starts running, and err EARLY when unsure.
 * Too early costs a little noise — rows flagged that the cron never had a fair
 * chance at. Too late silently drops a whole day's cohort a week after the
 * fact, which is the bug this metric exists to prevent. Production deploys are
 * after-hours here, so the go-live is the evening of the merge date, not the
 * morning after.
 *
 * Explicit +02:00 (SAST): the DB session runs in UTC, so a bare DATE literal
 * would land the boundary at 02:00 SAST rather than midnight.
 */
export const IN_SCOPE_FROM = '2026-07-23 00:00:00+02:00';

/**
 * DRs that are unresolved and can no longer be reached, because they fell out
 * of the lookback window. Nothing will ever retry these, so the number is
 * surfaced rather than left to be inferred from silence — a backlog that
 * quietly stops being worked looks identical to a cleared one.
 *
 * Two distinct populations, both genuinely stuck:
 *  - confirmed short (photo_count_mismatch), at any age — something checked
 *    and found photos missing;
 *  - in-scope but never verified at all — the cron never reached them before
 *    they aged out, which is exactly the throughput failure worth shouting
 *    about. Excluding these would leave a blind spot on the window boundary:
 *    photo_count_mismatch defaults to FALSE and is only ever written for a row
 *    that was actually selected and attempted, so a row the cron never got to
 *    would match neither the selector nor this metric.
 */
export function buildAgedOutQuery(): string {
  return `
    SELECT COUNT(*) AS count
    FROM dr_photo_unified_reviews
    WHERE created_at <= NOW() - INTERVAL '${LOOKBACK_WINDOW}'
      AND (
        photo_count_mismatch = TRUE
        OR (
          photo_count_verified_at IS NULL
          AND created_at >= TIMESTAMPTZ '${IN_SCOPE_FROM}'
        )
      )
  `;
}

export async function countAgedOut(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(buildAgedOutQuery());
  return parseInt(rows[0]?.count ?? '0', 10);
}

