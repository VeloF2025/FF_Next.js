/**
 * Serial Verification Service
 *
 * Shared service for computing 4-way serial verification badges
 * and extracting serials from WA photos.
 *
 * Used by:
 * - dr-acknowledgment.ts (delayed ack with VLM comparison)
 * - process-new-dr.ts (fire-and-forget verification after processing)
 * - import-oes.ts (batch recomputation on OES import)
 * - serial-verification.ts (API serves pre-computed data)
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { extractSerialsFromWaPhoto } from '@/modules/activate/services/vlmExtractionService';
import { logActivity, logWaPhotoVlmProcessed } from '@/modules/activate/services/activityLogService';

// VPS photo server
const VPS_PHOTO_BASE = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';

function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured');
  }
  return neon(connectionString);
}

// ============================================================================
// TYPES
// ============================================================================

export interface SerialVerificationResult {
  dropNumber: string;
  ont: {
    oes: string | null;
    offline: string | null;
    onemap: string | null;
    waPhoto: string | null;
    waPhotoConfidence: number | null;
  };
  ups: {
    oes: string | null;
    offline: string | null;
    onemap: string | null;
    waPhoto: string | null;
    waPhotoConfidence: number | null;
  };
  ontVerification: VerificationDetail;
  upsVerification: VerificationDetail;
  overallStatus: 'gold' | 'silver' | 'bronze' | 'warning' | 'none';
  badgeLabel: string;
}

interface VerificationDetail {
  sourcesWithData: number;
  sourcesAgreeing: number;
  allAgree: boolean;
  status: 'verified' | 'partial' | 'mismatch' | 'insufficient';
}

export interface WaPhotoExtractionResult {
  dropNumber: string;
  photosProcessed: number;
  bestOnt: { serial: string; confidence: number } | null;
  bestUps: { serial: string; confidence: number } | null;
  results: Array<{
    photoId: string;
    filename: string;
    success: boolean;
    ontSerial: string | null;
    upsSerial: string | null;
    confidence: number;
    processingTimeMs: number;
    error?: string;
  }>;
}

// ============================================================================
// SERIAL VERIFICATION COMPUTATION
// ============================================================================

function normalizeSerial(serial: string | null): string | null {
  if (!serial) return null;
  return serial.trim().toUpperCase();
}

function calculateVerification(serials: (string | null)[]): VerificationDetail {
  const normalized = serials.map(normalizeSerial);
  const nonNull = normalized.filter(Boolean) as string[];
  const unique = [...new Set(nonNull)];

  if (nonNull.length === 0) {
    return { sourcesWithData: 0, sourcesAgreeing: 0, allAgree: false, status: 'insufficient' };
  }

  if (nonNull.length === 1) {
    return { sourcesWithData: 1, sourcesAgreeing: 1, allAgree: true, status: 'insufficient' };
  }

  const allAgree = unique.length === 1;
  const mostCommon = nonNull.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxAgreeing = Math.max(...Object.values(mostCommon));

  if (allAgree && nonNull.length >= 3) {
    return { sourcesWithData: nonNull.length, sourcesAgreeing: nonNull.length, allAgree: true, status: 'verified' };
  }

  if (allAgree && nonNull.length === 2) {
    return { sourcesWithData: 2, sourcesAgreeing: 2, allAgree: true, status: 'partial' };
  }

  return {
    sourcesWithData: nonNull.length,
    sourcesAgreeing: maxAgreeing,
    allAgree: false,
    status: maxAgreeing >= 3 ? 'partial' : 'mismatch',
  };
}

/**
 * Compute 4-way serial verification for a DR (read-only, no persistence)
 */
export async function computeSerialVerification(dropNumber: string): Promise<SerialVerificationResult> {
  const sql = getDb();

  const result = await sql`
    WITH oes_data AS (
      SELECT serial_number as ont
      FROM oes_activations
      WHERE drop_number = ${dropNumber}
      LIMIT 1
    ),
    offline_data AS (
      SELECT serial_number as ont
      FROM offline_devices
      WHERE drop_number = ${dropNumber}
      LIMIT 1
    ),
    onemap_data AS (
      SELECT ont_serial_scanned as ont, ups_serial_scanned as ups
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${dropNumber}
      LIMIT 1
    ),
    wa_photo_data AS (
      SELECT vlm_ont_serial as ont, vlm_ups_serial as ups, vlm_confidence
      FROM wa_photos
      WHERE drop_number = ${dropNumber}
        AND purpose = 'activation'
        AND vlm_processed = true
      ORDER BY vlm_confidence DESC NULLS LAST, message_timestamp DESC
      LIMIT 1
    )
    SELECT
      (SELECT ont FROM oes_data) as oes_ont,
      (SELECT ont FROM offline_data) as offline_ont,
      (SELECT ont FROM onemap_data) as onemap_ont,
      (SELECT ups FROM onemap_data) as onemap_ups,
      (SELECT ont FROM wa_photo_data) as wa_ont,
      (SELECT ups FROM wa_photo_data) as wa_ups,
      (SELECT vlm_confidence FROM wa_photo_data) as wa_confidence
  `;

  const row = result[0] || {};

  const ontSerials = [
    row.oes_ont as string | null,
    row.offline_ont as string | null,
    row.onemap_ont as string | null,
    row.wa_ont as string | null,
  ];

  const upsSerials = [
    null, // OES doesn't track UPS
    null, // No offline UPS tracking
    row.onemap_ups as string | null,
    row.wa_ups as string | null,
  ];

  const ontVerification = calculateVerification(ontSerials);
  const upsVerification = calculateVerification(upsSerials);

  // Determine overall badge
  let overallStatus: 'gold' | 'silver' | 'bronze' | 'warning' | 'none' = 'none';
  let badgeLabel = '';

  if (ontVerification.status === 'verified' && upsVerification.status === 'verified') {
    overallStatus = 'gold';
    badgeLabel = '4-Way Verified';
  } else if (ontVerification.status === 'verified' || upsVerification.status === 'verified') {
    overallStatus = 'silver';
    badgeLabel = 'Serial Verified';
  } else if (ontVerification.allAgree && ontVerification.sourcesWithData >= 2) {
    overallStatus = 'bronze';
    badgeLabel = 'Serial Confirmed';
  } else if (ontVerification.status === 'mismatch' || upsVerification.status === 'mismatch') {
    overallStatus = 'warning';
    badgeLabel = 'Serial Mismatch';
  }

  return {
    dropNumber,
    ont: {
      oes: row.oes_ont || null,
      offline: row.offline_ont || null,
      onemap: row.onemap_ont || null,
      waPhoto: row.wa_ont || null,
      waPhotoConfidence: row.wa_confidence ? Number(row.wa_confidence) : null,
    },
    ups: {
      oes: null,
      offline: null,
      onemap: row.onemap_ups || null,
      waPhoto: row.wa_ups || null,
      waPhotoConfidence: row.wa_confidence ? Number(row.wa_confidence) : null,
    },
    ontVerification,
    upsVerification,
    overallStatus,
    badgeLabel,
  };
}

/**
 * Compute and persist serial verification to dr_photo_unified_reviews
 */
export async function computeAndPersistVerification(dropNumber: string): Promise<SerialVerificationResult> {
  const verification = await computeSerialVerification(dropNumber);
  const sql = getDb();

  try {
    await sql`
      UPDATE dr_photo_unified_reviews
      SET serial_verification_status = ${verification.overallStatus},
          serial_verification_label = ${verification.badgeLabel},
          serial_verification_details = ${JSON.stringify({
            ont: verification.ont,
            ups: verification.ups,
            ontVerification: verification.ontVerification,
            upsVerification: verification.upsVerification,
          })},
          serial_verification_computed_at = NOW()
      WHERE drop_number = ${dropNumber}
    `;

    // Log to activity
    await logActivity(
      dropNumber,
      'SERIAL_VERIFICATION_COMPUTED',
      {
        status: verification.overallStatus,
        label: verification.badgeLabel,
        details: `${verification.overallStatus.toUpperCase()}: ${verification.badgeLabel || 'No badge'} (ONT: ${verification.ontVerification.sourcesAgreeing}/${verification.ontVerification.sourcesWithData} agree)`,
        ontSources: verification.ontVerification.sourcesWithData,
        upsSources: verification.upsVerification.sourcesWithData,
      },
      'system'
    );

    log.info('SerialVerification', `Persisted verification for ${dropNumber}: ${verification.overallStatus}`, {
      ontStatus: verification.ontVerification.status,
      upsStatus: verification.upsVerification.status,
    });
  } catch (error) {
    log.error('SerialVerification', `Failed to persist verification for ${dropNumber}`, { error });
  }

  return verification;
}

// ============================================================================
// WA PHOTO SERIAL EXTRACTION
// ============================================================================

/**
 * Extract serials from WA photos for a DR
 *
 * Queries wa_photos table, transforms paths to URLs, calls VLM extraction,
 * and updates wa_photos with results.
 */
export async function extractWaPhotoSerials(
  dropNumber: string,
  options?: { force?: boolean; timeoutMs?: number }
): Promise<WaPhotoExtractionResult> {
  const sql = getDb();
  const force = options?.force ?? false;
  const timeoutMs = options?.timeoutMs ?? 8000; // 8s per photo default

  // Get unprocessed (or all if force) WA photos
  const photos = force
    ? await sql`
        SELECT id, wa_message_id, original_filename, local_path, vlm_processed
        FROM wa_photos
        WHERE drop_number = ${dropNumber} AND purpose = 'activation'
        ORDER BY message_timestamp DESC
      `
    : await sql`
        SELECT id, wa_message_id, original_filename, local_path, vlm_processed
        FROM wa_photos
        WHERE drop_number = ${dropNumber} AND purpose = 'activation' AND vlm_processed = false
        ORDER BY message_timestamp DESC
      `;

  if (photos.length === 0) {
    return { dropNumber, photosProcessed: 0, bestOnt: null, bestUps: null, results: [] };
  }

  // Get current OneMap serials for comparison
  const currentData = await sql`
    SELECT ont_serial_scanned, ups_serial_scanned
    FROM dr_photo_unified_reviews
    WHERE drop_number = ${dropNumber}
  `;
  const onemapOnt = currentData[0]?.ont_serial_scanned || null;
  const onemapUps = currentData[0]?.ups_serial_scanned || null;

  const results: WaPhotoExtractionResult['results'] = [];
  let bestOnt: { serial: string; confidence: number } | null = null;
  let bestUps: { serial: string; confidence: number } | null = null;

  for (const photo of photos) {
    // Transform local_path to URL
    const urlPath = photo.local_path.replace(
      '/var/lib/docker/volumes/boss-vps_dr_photos/_data/',
      '/photos/'
    );
    const photoUrl = `${VPS_PHOTO_BASE}${urlPath}`;

    try {
      // Wrap extraction in timeout
      const extraction = await Promise.race([
        extractSerialsFromWaPhoto(photoUrl),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`VLM timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      results.push({
        photoId: photo.id,
        filename: photo.original_filename || 'unknown',
        success: extraction.success,
        ontSerial: extraction.ontSerial,
        upsSerial: extraction.upsSerial,
        confidence: extraction.confidence,
        processingTimeMs: extraction.processingTimeMs,
        error: extraction.error,
      });

      // Update wa_photos table
      await sql`
        UPDATE wa_photos
        SET vlm_processed = true,
            vlm_ont_serial = ${extraction.ontSerial},
            vlm_ups_serial = ${extraction.upsSerial},
            vlm_confidence = ${extraction.confidence},
            vlm_processed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${photo.id}
      `;

      // Track best extractions using per-serial confidence (not overall)
      const ontConf = extraction.ontConfidence ?? extraction.confidence;
      const upsConf = extraction.upsConfidence ?? extraction.confidence;
      if (extraction.ontSerial && ontConf > (bestOnt?.confidence || 0)) {
        bestOnt = { serial: extraction.ontSerial, confidence: ontConf };
      }
      if (extraction.upsSerial && upsConf > (bestUps?.confidence || 0)) {
        bestUps = { serial: extraction.upsSerial, confidence: upsConf };
      }

      // Log to activity
      if (extraction.success) {
        await logWaPhotoVlmProcessed(dropNumber, {
          photoId: photo.id,
          filename: photo.original_filename,
          ontExtracted: extraction.ontSerial,
          upsExtracted: extraction.upsSerial,
          confidence: extraction.confidence,
          onemapOnt,
          onemapUps,
        });
      }
    } catch (photoError) {
      const errorMsg = photoError instanceof Error ? photoError.message : String(photoError);
      log.error('SerialVerification', `VLM extraction failed for photo ${photo.id}: ${errorMsg}`);

      results.push({
        photoId: photo.id,
        filename: photo.original_filename || 'unknown',
        success: false,
        ontSerial: null,
        upsSerial: null,
        confidence: 0,
        processingTimeMs: 0,
        error: errorMsg,
      });

      // Mark as processed to avoid retrying indefinitely
      await sql`
        UPDATE wa_photos
        SET vlm_processed = true, vlm_processed_at = NOW(), updated_at = NOW()
        WHERE id = ${photo.id}
      `;
    }
  }

  log.info('SerialVerification', `Extracted serials from ${photos.length} WA photos for ${dropNumber}`, {
    successful: results.filter(r => r.success).length,
    bestOnt: bestOnt?.serial || null,
    bestUps: bestUps?.serial || null,
  });

  return { dropNumber, photosProcessed: photos.length, bestOnt, bestUps, results };
}

/**
 * Poll for wa_photos records (race condition: Go Bridge creates them separately)
 *
 * @returns true if photos found, false if timeout
 */
export async function waitForWaPhotos(
  dropNumber: string,
  maxWaitMs: number = 10000,
  pollIntervalMs: number = 2000
): Promise<boolean> {
  const sql = getDb();
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const result = await sql`
      SELECT COUNT(*) as count FROM wa_photos
      WHERE drop_number = ${dropNumber} AND purpose = 'activation'
    `;
    const count = parseInt(result[0]?.count || '0', 10);

    if (count > 0) {
      log.info('SerialVerification', `WA photos found for ${dropNumber} after ${Date.now() - start}ms`, { count });
      return true;
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  log.info('SerialVerification', `No WA photos found for ${dropNumber} after ${maxWaitMs}ms timeout`);
  return false;
}
