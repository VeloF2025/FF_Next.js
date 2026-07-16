/**
 * Reads the ONT + Gizzu UPS serials from the SiteCam step-6 photo using the same
 * extractor as the WhatsApp flow, and persists them to the step-6 VLM columns.
 * Corroboration only — the trusted values remain {ont,ups}_serial_scanned.
 * Never throws: a VLM failure must not break the caller (the upload trigger).
 */
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { extractSerialsFromWaPhoto } from './waPhotoExtraction';

const MODULE = 'Step6SerialExtraction';

interface Deps {
  extract?: typeof extractSerialsFromWaPhoto;
  query?: (sql: string, params: unknown[]) => Promise<unknown>;
}

export async function extractStep6Serials(
  dropNumber: string,
  photoUrl: string,
  deps: Deps = {},
): Promise<{ ont: string | null; ups: string | null }> {
  const extract = deps.extract ?? extractSerialsFromWaPhoto;
  const query = deps.query ?? ((sql: string, params: unknown[]) => pool.query(sql, params));
  try {
    const r = await extract(photoUrl);
    const ont = r.ontSerial ?? null;
    const ups = r.upsSerial ?? null;
    // COALESCE so a null read never clobbers a serial an earlier pass captured.
    await query(
      `UPDATE dr_photo_unified_reviews
         SET vlm_ont_serial_step6 = COALESCE($2, vlm_ont_serial_step6),
             vlm_ups_serial_step6 = COALESCE($3, vlm_ups_serial_step6)
       WHERE drop_number = $1`,
      [dropNumber, ont, ups],
    );
    log.info('Step-6 photo serials extracted', { dropNumber, ont, ups }, MODULE);
    return { ont, ups };
  } catch (err) {
    log.error('Step-6 serial extraction failed', { dropNumber, error: String(err) }, MODULE);
    return { ont: null, ups: null };
  }
}
