/**
 * Cron Job: Backfill Missing OneMap Data
 *
 * POST /api/cron/backfill-onemap-data
 *
 * Purpose: Find DRs with missing photos/serials and fetch from OneMap
 *
 * This cron job handles the backfill case where:
 * - DRs exist in dr_photo_unified_reviews but have photo_count = 0
 * - DRs have no ONT/UPS serials even though data exists in OneMap
 *
 * Run schedule: Every 15 minutes (via vercel.json or external cron)
 * Limit: Processes up to 20 DRs per run to avoid timeout
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { log } from '@/lib/logger';
import { photoTypeToStep } from '@/modules/activate/utils/stepMapper';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';

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
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    // If 404, try to trigger download
    if (response.status === 404 || response.status === 422) {
      log.info('BackfillOneMap', `Record not found, triggering download for ${dropNumber}`);

      const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000), // 15s timeout for download
      });

      if (downloadResponse.ok) {
        // Wait a moment for photos to be available
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Retry fetch
        response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
          signal: AbortSignal.timeout(10000),
        });
      }
    }

    if (!response.ok) {
      result.error = `OneMap API returned ${response.status}`;
      return result;
    }

    const data = await response.json();
    let localPhotos = data.local_photos || [];

    // If record exists but no local photos, try downloading
    if (localPhotos.length === 0 && data.photo_count > 0) {
      log.info('BackfillOneMap', `Photos on cloud but not local for ${dropNumber}, triggering download`);

      await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });

      // Wait and retry
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const retryResponse = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        localPhotos = retryData.local_photos || [];
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

    // Update unified table
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         photo_source = 'onemap',
         photo_count = $1,
         photos_metadata = $2,
         ont_serial_scanned = COALESCE($3, ont_serial_scanned),
         ups_serial_scanned = COALESCE($4, ups_serial_scanned),
         updated_at = NOW()
       WHERE drop_number = $5`,
      [photos.length, JSON.stringify(photos), ontSerial, upsSerial, dropNumber]
    );

    result.success = true;
    result.photoCount = photos.length;
    result.ontSerial = ontSerial;
    result.upsSerial = upsSerial;

    log.info('BackfillOneMap', `Updated ${dropNumber}`, {
      photoCount: photos.length,
      ontSerial,
      upsSerial,
    });

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    log.error('BackfillOneMap', `Error processing ${dropNumber}`, { error: result.error });
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
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret in production (if configured)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      log.error('BackfillOneMap', 'Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const limit = Number(req.query.limit) || Number(req.body?.limit) || 20;
  const mode = (req.query.mode as string) || (req.body?.mode as string) || 'missing_photos';

  log.info('BackfillOneMap', `Starting backfill job (limit: ${limit}, mode: ${mode})`);

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
        // DRs with photos but no serials
        query = `
          SELECT drop_number
          FROM dr_photo_unified_reviews
          WHERE photo_count > 0
            AND (ont_serial_scanned IS NULL AND ups_serial_scanned IS NULL)
            AND created_at > NOW() - INTERVAL '30 days'
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
      log.info('BackfillOneMap', 'No DRs need backfill');
      return res.status(200).json({
        success: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    log.info('BackfillOneMap', `Found ${pendingDRs.length} DRs to process`);

    const results: BackfillResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process each DR sequentially (to avoid overwhelming OneMap API)
    for (const row of pendingDRs) {
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

    log.info('BackfillOneMap', `Completed: ${succeeded}/${pendingDRs.length} succeeded`, {
      failed,
      results: results.slice(0, 5), // Log first 5 for brevity
    });

    return res.status(200).json({
      success: true,
      processed: pendingDRs.length,
      succeeded,
      failed,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('BackfillOneMap', 'Fatal error during backfill', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run backfill',
    });
  }
}
