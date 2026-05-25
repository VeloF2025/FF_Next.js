/**
 * upsSightingService — non-authoritative UPS lifecycle sightings.
 *
 * The WhatsApp-photo VLM read of a UPS (Gizzu) serial is RECON ONLY. Field techs
 * frequently post the wrong photo, so a confident read can still be the wrong
 * unit — it must never override the authoritative `ups_serial_scanned`. Instead,
 * when a read is confident AND maps to a known stock_serials unit, we append a
 * `wa_photo_sighting` event so the unit accrues a lifecycle trail
 * (stock_serial_events) that lets someone trace/locate it later.
 *
 * Idempotent per (unit, DR) via the `uq_sse_dedupe` partial index (source_id set).
 * Designed for hot paths (the DR acknowledgment endpoint): it never throws.
 */
import type { Pool, PoolClient } from 'pg';

import { log } from '@/lib/logger';
import { emitSerialEvent } from '@/lib/serial-events';

type DbClient = Pool | PoolClient;

/** Only log a sighting at/above the established VLM trust threshold. */
export const SIGHTING_MIN_CONFIDENCE = 0.95;

export type SightingOutcome = 'recorded' | 'duplicate' | 'skipped';

export async function recordUpsPhotoSighting(
  db: DbClient,
  args: { dropNumber: string; upsSerial: string | null; confidence: number; occurredAt?: Date },
): Promise<SightingOutcome> {
  const { dropNumber, upsSerial, confidence, occurredAt } = args;

  try {
    if (!upsSerial || confidence < SIGHTING_MIN_CONFIDENCE) return 'skipped';
    const serial = upsSerial.trim().toUpperCase();
    if (!serial) return 'skipped';

    // A read that maps to no issued unit has no lifecycle to attach to (and is a
    // likely wrong/placeholder photo) — don't record it.
    const unit = await db.query(
      `SELECT id FROM stock_serials WHERE UPPER(TRIM(serial_number)) = $1 LIMIT 1`,
      [serial],
    );
    if (unit.rows.length === 0) return 'skipped';
    const serialId = unit.rows[0].id as string;

    // source_id must be the DR review row (uuid) so the uq_sse_dedupe partial
    // index enforces one sighting per (unit, DR).
    const review = await db.query(
      `SELECT id FROM dr_photo_unified_reviews WHERE drop_number = $1 LIMIT 1`,
      [dropNumber],
    );
    const reviewId = (review.rows[0]?.id as string | undefined) ?? null;
    if (!reviewId) return 'skipped';

    const event = await emitSerialEvent(db, {
      serialId,
      eventType: 'wa_photo_sighting',
      sourceTable: 'dr_photo_unified_reviews',
      sourceId: reviewId,
      payload: { drop_number: dropNumber, vlm_serial: serial, confidence, source: 'wa_photo' },
      occurredAt,
    });

    return event ? 'recorded' : 'duplicate';
  } catch (err) {
    log.warn('recordUpsPhotoSighting failed (non-fatal)', {
      dropNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'skipped';
  }
}
