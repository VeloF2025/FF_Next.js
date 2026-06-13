/**
 * Populates dr_photo_unified_reviews.wa_typed_ont_serial / wa_typed_ups_serial by
 * parsing wa_original_text with waTypedSerialExtractor (audit rec #5, part A).
 *
 * Idempotent + self-backfilling: it only touches rows whose
 * wa_typed_serial_extracted_at IS NULL, and stamps that marker on EVERY processed
 * row (even when no serial was found), so a row is parsed exactly once. The first
 * run drains the historical backlog; thereafter only freshly-submitted DRs qualify.
 *
 * Decoupled from the activation write path on purpose: a nightly cron
 * (pages/api/cron/extract-wa-typed-serials.ts) drives this, keeping the hot
 * dr_photo_unified_reviews INSERT/UPDATE path (process-new-dr.ts) untouched.
 *
 * @module data-sync/services/typedSerialPopulator
 */

import { pool as defaultPool } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { extractTypedSerials } from './waTypedSerialExtractor';

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 50000;

export interface PopulateResult {
  /** Rows scanned and marked extracted in this run. */
  processed: number;
  /** Of those, how many yielded a typed ONT serial. */
  ontFound: number;
  /** Of those, how many yielded a typed UPS serial. */
  upsFound: number;
  /** Rows still awaiting a first parse after this run (re-run to drain). */
  remaining: number;
}

/** Minimal surface of pg.Pool this service needs — lets tests inject a fake. */
export interface QueryableDb {
  query<R extends Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: R[] }>;
}

interface ReviewRow extends Record<string, unknown> {
  id: string;
  wa_original_text: string;
}

interface CountRow extends Record<string, unknown> {
  remaining: string;
}

/**
 * Parse typed serials for up to `limit` unprocessed rows. Returns run counts plus
 * how many rows still await a first parse (so the cron/operator can re-run to drain
 * the historical backlog).
 */
export async function populateTypedSerials(
  limit: number = DEFAULT_LIMIT,
  db: QueryableDb = defaultPool
): Promise<PopulateResult> {
  const cappedLimit = Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);

  const { rows } = await db.query<ReviewRow>(
    `SELECT id, wa_original_text
       FROM dr_photo_unified_reviews
      WHERE wa_original_text IS NOT NULL
        AND TRIM(wa_original_text) <> ''
        AND wa_typed_serial_extracted_at IS NULL
      ORDER BY wa_received_at DESC NULLS LAST, id
      LIMIT $1`,
    [cappedLimit]
  );

  let ontFound = 0;
  let upsFound = 0;

  for (const row of rows) {
    const { ont, ups } = extractTypedSerials(row.wa_original_text);
    if (ont) ontFound++;
    if (ups) upsFound++;

    // Mark extracted on every row; write serials when found (NULL otherwise). The row
    // was unprocessed (extracted_at IS NULL), so this never clobbers a prior value.
    await db.query(
      `UPDATE dr_photo_unified_reviews
          SET wa_typed_ont_serial          = $1,
              wa_typed_ups_serial          = $2,
              wa_typed_serial_extracted_at = NOW()
        WHERE id = $3`,
      [ont, ups, row.id]
    );
  }

  const { rows: countRows } = await db.query<CountRow>(
    `SELECT COUNT(*)::text AS remaining
       FROM dr_photo_unified_reviews
      WHERE wa_original_text IS NOT NULL
        AND TRIM(wa_original_text) <> ''
        AND wa_typed_serial_extracted_at IS NULL`
  );
  const remaining = Number(countRows[0]?.remaining ?? '0');

  log.info(
    'typed-serial populate run complete',
    { processed: rows.length, ontFound, upsFound, remaining },
    'typedSerialPopulator'
  );

  return { processed: rows.length, ontFound, upsFound, remaining };
}
