/**
 * API: /api/activate/process-wa-photo-vlm
 *
 * POST - Process unprocessed WA photos for a DR using VLM
 * Extracts ONT and UPS serials from WhatsApp-submitted photos
 *
 * Body: { dropNumber: string, force?: boolean }
 *
 * Returns:
 * - Photos processed count
 * - Extracted serials for each photo
 * - Comparison with existing OneMap data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';
import { sql } from '@/lib/neon';
import { extractSerialsFromWaPhoto } from '@/modules/activate/services/vlmExtractionService';
import { logWaPhotoVlmProcessed, logSerialChange } from '@/modules/activate/services/activityLogService';

// VPS photo server (same as step photos - port 8866)
const VPS_PHOTO_BASE = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';

interface ProcessResult {
  photoId: string;
  filename: string;
  success: boolean;
  ontSerial: string | null;
  upsSerial: string | null;
  confidence: number;
  processingTimeMs: number;
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { dropNumber, force = false } = req.body;

  if (!dropNumber || typeof dropNumber !== 'string') {
    return apiResponse.badRequest(res, 'dropNumber is required');
  }

  log.info('ProcessWaPhotoVlm', `Processing WA photos for ${dropNumber}`, { force });

  try {
    // Get unprocessed (or all if force=true) WA photos for this DR
    const photosQuery = force
      ? sql`
          SELECT id, wa_message_id, original_filename, local_path, vlm_processed
          FROM wa_photos
          WHERE drop_number = ${dropNumber} AND purpose = 'activation'
          ORDER BY message_timestamp DESC
        `
      : sql`
          SELECT id, wa_message_id, original_filename, local_path, vlm_processed
          FROM wa_photos
          WHERE drop_number = ${dropNumber} AND purpose = 'activation' AND vlm_processed = false
          ORDER BY message_timestamp DESC
        `;

    const photos = await photosQuery;

    if (photos.length === 0) {
      return apiResponse.success(res, {
        dropNumber,
        message: force ? 'No WA photos found for this DR' : 'No unprocessed WA photos found',
        photosProcessed: 0,
        results: [],
      });
    }

    // Get current OneMap serials for comparison
    const currentData = await sql`
      SELECT ont_serial_scanned, ups_serial_scanned
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${dropNumber}
    `;
    const onemapOnt = currentData[0]?.ont_serial_scanned || null;
    const onemapUps = currentData[0]?.ups_serial_scanned || null;

    const results: ProcessResult[] = [];
    let bestOnt: { serial: string; confidence: number } | null = null;
    let bestUps: { serial: string; confidence: number } | null = null;

    // Process each photo
    for (const photo of photos) {
      // Transform local_path to URL path
      // From: /var/lib/docker/volumes/boss-vps_dr_photos/_data/DR470096/wa_filename.jpg
      // To:   /photos/DR470096/wa_filename.jpg
      const urlPath = photo.local_path.replace(
        '/var/lib/docker/volumes/boss-vps_dr_photos/_data/',
        '/photos/'
      );
      const photoUrl = `${VPS_PHOTO_BASE}${urlPath}`;

      log.debug('ProcessWaPhotoVlm', `Processing photo: ${photo.original_filename}`, { photoUrl });

      try {
        const extraction = await extractSerialsFromWaPhoto(photoUrl);

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
          SET
            vlm_processed = true,
            vlm_ont_serial = ${extraction.ontSerial},
            vlm_ups_serial = ${extraction.upsSerial},
            vlm_confidence = ${extraction.confidence},
            vlm_processed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${photo.id}
        `;

        // Track best extraction for each serial type
        if (extraction.ontSerial && extraction.confidence > (bestOnt?.confidence || 0)) {
          bestOnt = { serial: extraction.ontSerial, confidence: extraction.confidence };
        }
        if (extraction.upsSerial && extraction.confidence > (bestUps?.confidence || 0)) {
          bestUps = { serial: extraction.upsSerial, confidence: extraction.confidence };
        }

        // Log to activity log
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
        log.error('ProcessWaPhotoVlm', `Failed to process photo ${photo.id}: ${errorMsg}`);

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

        // Mark as processed even on error to avoid retrying indefinitely
        await sql`
          UPDATE wa_photos
          SET vlm_processed = true, vlm_processed_at = NOW(), updated_at = NOW()
          WHERE id = ${photo.id}
        `;
      }
    }

    // Build comparison results
    const comparison = {
      onemap: { ont: onemapOnt, ups: onemapUps },
      waPhoto: { ont: bestOnt?.serial || null, ups: bestUps?.serial || null },
      matches: {
        ont: onemapOnt && bestOnt?.serial
          ? onemapOnt.toUpperCase() === bestOnt.serial.toUpperCase()
          : null,
        ups: onemapUps && bestUps?.serial
          ? onemapUps.toUpperCase() === bestUps.serial.toUpperCase()
          : null,
      },
    };

    // Log serial changes if WA photo shows different serial than OneMap
    if (bestOnt?.serial && onemapOnt && onemapOnt.toUpperCase() !== bestOnt.serial.toUpperCase()) {
      log.warn('ProcessWaPhotoVlm', `ONT mismatch detected: OneMap=${onemapOnt}, WA Photo=${bestOnt.serial}`);
    }
    if (bestUps?.serial && onemapUps && onemapUps.toUpperCase() !== bestUps.serial.toUpperCase()) {
      log.warn('ProcessWaPhotoVlm', `UPS mismatch detected: OneMap=${onemapUps}, WA Photo=${bestUps.serial}`);
    }

    log.info('ProcessWaPhotoVlm', `Completed processing ${photos.length} photos for ${dropNumber}`, {
      successful: results.filter(r => r.success).length,
      comparison,
    });

    return apiResponse.success(res, {
      dropNumber,
      photosProcessed: photos.length,
      successfulExtractions: results.filter(r => r.success).length,
      results,
      comparison,
      bestExtractions: {
        ont: bestOnt,
        ups: bestUps,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('ProcessWaPhotoVlm', `Failed to process WA photos: ${message}`);
    return apiResponse.error(res, message, 500);
  }
}

export default withAuth(withErrorHandler(handler));
