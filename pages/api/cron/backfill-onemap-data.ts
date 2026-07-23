/**
 * Cron Job: Backfill Missing OneMap Data
 *
 * POST /api/cron/backfill-onemap-data
 *
 * Purpose: Find DRs with missing photos/serials and fetch from OneMap
 *
 * This cron job handles the backfill case where:
 * - DRs exist in dr_photo_unified_reviews but have photo_count = 0
 * - DRs ingested only PART of their 1Map photos (local < cloud) because the
 *   1Map API was slow mid-ingest — see the 2026-07-23 incident, where 1Map
 *   went from 0.1s to 30s+ per query for hours and DRs landed with 1-5 of
 *   their 8-15 photos. The zero case is already covered by the wired
 *   refetch-missing-photos cron; the PARTIAL case had no owner.
 * - DRs have no ONT/UPS serials even though data exists in OneMap
 *
 * Run schedule: Every 15 minutes, via scripts/cron-backfill-onemap.sh.
 * (vercel.json also lists it, but this app deploys to systemd on Velocity,
 * so the vercel entry is inert — the shell cron is the real scheduler.)
 * Limit: Processes up to 20 DRs per run, bounded by RUN_BUDGET_MS.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('BackfillOneMap');
import { photoTypeToStep } from '@/modules/activate/utils/stepMapper';
import { apiResponse } from '@/lib/apiResponse';

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';

// Nobody is waiting on this job, so it gets far more headroom than the 8s
// interactive ack path — a degraded 1Map answers in 10-30s and we still want
// the photos. RUN_BUDGET_MS stops a slow run before the next 15-min tick so
// invocations never pile up (the shell wrapper also holds an flock).
const RECORD_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const RUN_BUDGET_MS = 240_000;

interface BackfillResult {
  dropNumber: string;
  success: boolean;
  photoCount: number;
  ontSerial: string | null;
  upsSerial: string | null;
  error?: string;
}

interface BackfillResponse {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  deferred?: number;
  budgetExhausted?: boolean;
  results: BackfillResult[];
  timestamp: string;
}

/**
 * Fetch data from OneMap and update unified table
 */
async function fetchAndUpdateFromOneMap(dropNumber: string): Promise<BackfillResult> {
  const result: BackfillResult = {
    dropNumber,
    success: false,
    photoCount: 0,
    ontSerial: null,
    upsSerial: null,
  };

  try {
    // Try to get record from OneMap
    let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
      signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
    });

    // If 404, try to trigger download
    if (response.status === 404 || response.status === 422) {
      log.info(`Record not found, triggering download for ${dropNumber}`);

      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (downloadResponse.ok) {
        // Wait a moment for photos to be available
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Retry fetch
        response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
          signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
        });
      }
    }

    if (!response.ok) {
      result.error = `OneMap API returned ${response.status}`;
      return result;
    }

    const data = await response.json();
    let localPhotos = data.local_photos || [];
    let cloudPhotoCount = data.photo_count || 0;

    // Any shortfall triggers a re-download, not just a total absence. A DR that
    // ingested 5 of its 10 photos is just as broken for QA as one that got zero,
    // and only the zero case used to be handled here.
    if (cloudPhotoCount > localPhotos.length) {
      log.info(`Incomplete photo set for ${dropNumber}, triggering download`, {
        localCount: localPhotos.length,
        cloudCount: cloudPhotoCount,
      });

      await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      // Wait and retry
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const retryResponse = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
        signal: AbortSignal.timeout(RECORD_TIMEOUT_MS),
      });

      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        localPhotos = retryData.local_photos || [];
        cloudPhotoCount = retryData.photo_count || cloudPhotoCount;
        // Also update serials from retried data
        if (retryData.ont_barcode) data.ont_barcode = retryData.ont_barcode;
        if (retryData.ups_serial) data.ups_serial = retryData.ups_serial;
      }
    }

    // Map photos to our format
    const photos = localPhotos.map((photo: any) => ({
      filename: photo.filename,
      step: photoTypeToStep(photo.type) ?? 0,
      url: `/api/activate/photo/${dropNumber}/${photo.filename}`,
      size: photo.size,
      modified: photo.modified,
      original_type: photo.type,
    }));

    // Extract ONT serial from barcode data
    const ontSerial = extractOntSerial(data.ont_barcode);
    const upsSerial = data.ups_serial || null;

    // Still short after the re-download: either 1Map holds orphaned metadata
    // (a photo row with no fetchable file) or it is still degraded. Recording
    // the mismatch is what lets the 'unverified' query pick this DR up again
    // later instead of treating a partial set as done.
    const stillIncomplete = photos.length < cloudPhotoCount;

    // Update unified table
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         photo_source = 'onemap',
         photo_count = $1,
         photos_metadata = $2,
         ont_serial_scanned = COALESCE($3, ont_serial_scanned),
         ups_serial_scanned = COALESCE($4, ups_serial_scanned),
         photo_count_verified_at = NOW(),
         photo_count_mismatch = $5,
         updated_at = NOW()
       WHERE drop_number = $6`,
      [photos.length, JSON.stringify(photos), ontSerial, upsSerial, stillIncomplete, dropNumber]
    );

    result.success = true;
    result.photoCount = photos.length;
    result.ontSerial = ontSerial;
    result.upsSerial = upsSerial;

    log.info(`Updated ${dropNumber}`, {
      photoCount: photos.length,
      ontSerial,
      upsSerial,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Error processing ${dropNumber}`, { error: result.error });
    return result;
  }
}

/**
 * Extract ONT serial from barcode data
 * Format: (S)SERIAL(23S)CODE... → extracts SERIAL
 */
function extractOntSerial(barcodeData: string | null): string | null {
  if (!barcodeData) return null;

  // Pattern: (S)SERIAL(23S)...
  const serialMatch = barcodeData.match(/\(S\)([^(]+)/);
  if (serialMatch && serialMatch[1]) {
    return serialMatch[1].trim();
  }

  // If no pattern, return raw barcode (might already be clean serial)
  if (!barcodeData.includes('(')) {
    return barcodeData.trim();
  }

  return null;
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BackfillResponse | { error: string }>
): Promise<void> {
  // Accept both GET and POST for flexibility
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }

  // Verify cron secret unconditionally — dev shares the production database
  // so bypassing auth in non-production environments is not safe.
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error('CRON_SECRET not configured');
    return apiResponse.internalError(res, new Error('CRON_SECRET not configured'));
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    log.error('Unauthorized request');
    return apiResponse.unauthorized(res);
  }

  const limit = Number(req.query.limit) || Number(req.body?.limit) || 20;
  const mode = (req.query.mode as string) || (req.body?.mode as string) || 'missing_photos';

  log.info(`Starting backfill job (limit: ${limit}, mode: ${mode})`);

  try {
    // Find DRs that need backfill
    let query = '';

    switch (mode) {
      case 'missing_photos':
        // DRs with no photos
        query = `
          SELECT drop_number
          FROM dr_photo_unified_reviews
          WHERE (photo_count IS NULL OR photo_count = 0)
            AND created_at > NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC
          LIMIT $1
        `;
        break;

      case 'missing_serials':
        // DRs missing serials (regardless of photo count - serials come from 1Map API)
        query = `
          SELECT drop_number
          FROM dr_photo_unified_reviews
          WHERE (ont_serial_scanned IS NULL OR ont_serial_scanned = '')
            AND created_at > NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC
          LIMIT $1
        `;
        break;

      case 'unverified':
        // Photo set never checked against 1Map, or checked and found short.
        // A partial ingest is invisible to a photo_count-based query — the
        // count looks fine, it is just wrong — so this keys off the
        // verification columns from migration 135 instead. Self-limiting: a
        // DR verified complete sets photo_count_mismatch = false and drops
        // out; a mismatched one is retried at most every 6 hours.
        query = `
          SELECT drop_number
          FROM dr_photo_unified_reviews
          WHERE created_at > NOW() - INTERVAL '7 days'
            AND (
              photo_count_verified_at IS NULL
              OR (
                photo_count_mismatch = TRUE
                AND photo_count_verified_at < NOW() - INTERVAL '6 hours'
              )
            )
          ORDER BY created_at DESC
          LIMIT $1
        `;
        break;

      case 'all_missing':
      default:
        // DRs missing either photos OR serials
        query = `
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
        break;
    }

    const pendingResult = await pool.query(query, [limit]);
    const pendingDRs = pendingResult.rows;

    if (pendingDRs.length === 0) {
      log.info('No DRs need backfill');
      return res.status(200).json({
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    log.info(`Found ${pendingDRs.length} DRs to process`);

    const results: BackfillResult[] = [];
    let succeeded = 0;
    let failed = 0;
    const startedAt = Date.now();
    let ranOutOfBudget = false;

    // Process each DR sequentially (to avoid overwhelming OneMap API)
    for (const row of pendingDRs) {
      // A degraded 1Map can spend 30s+ on a single DR. Stop before the next
      // tick rather than silently running long — the leftovers are still
      // selected next run, so nothing is dropped, but say so out loud.
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        ranOutOfBudget = true;
        log.warn('Run budget exhausted — deferring remaining DRs to next run', {
          processed: results.length,
          remaining: pendingDRs.length - results.length,
        });
        break;
      }

      const result = await fetchAndUpdateFromOneMap(row.drop_number);
      results.push(result);

      if (result.success && (result.photoCount > 0 || result.ontSerial || result.upsSerial)) {
        succeeded++;
      } else {
        failed++;
      }

      // Small delay between requests to be nice to OneMap
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    log.info(`Completed: ${succeeded}/${results.length} succeeded`, {
      failed,
      deferred: pendingDRs.length - results.length,
      results: results.slice(0, 5), // Log first 5 for brevity
    });

    return res.status(200).json({
      success: true,
      processed: results.length,
      succeeded,
      failed,
      deferred: pendingDRs.length - results.length,
      budgetExhausted: ranOutOfBudget,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Fatal error during backfill', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run backfill',
    });
  }
}
