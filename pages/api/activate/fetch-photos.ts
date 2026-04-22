/**
 * API Route: /api/activate/fetch-photos
 *
 * Purpose: Fetch photos for a DR using multi-source fallback strategy
 * Method: POST
 *
 * Following FibreFlow standards:
 * - Uses apiResponse helper for consistent responses
 * - Neon PostgreSQL with ep-dry-night-a9qyh4sj endpoint
 * - Proper error handling and logging
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import {
  fetchPhotosWithFallback,
  fetchFromSpecificSource,
  type SourcePhoto,
  type SourcePhotoFetchResult,
} from '@/services/activate/photoSources';

interface FetchPhotosRequest {
  dropNumber: string;
  forceSource?: 'onemap' | 'boss' | 'local'; // Optional: force specific source for testing
  force?: boolean; // Force re-fetch even if already fetched
  skipCategorization?: boolean; // If true, return photos without step mapping (for VLM categorization)
}

type PhotoFetchResult = SourcePhotoFetchResult & { skipped?: boolean };

/**
 * POST /api/activate/fetch-photos
 * Fetch photos using multi-source fallback strategy
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  try {
    const { dropNumber, forceSource, force, skipCategorization } = req.body as FetchPhotosRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info(`Fetching photos for ${dropNumber}`, { forceSource, force, skipCategorization });

    // Check if already fetched (skip unless forced)
    // NOTE: 'OES Import' is NOT a real photo source - it means record came from OES import
    // Only skip if photo_source is an actual photo source (onemap, boss, local)
    if (!force) {
      const existingResult = await pool.query(
        `SELECT photo_source, photo_count, photos_metadata, ont_serial_scanned, ups_serial_scanned,
                vlm_categorization_results, vlm_categorization_status
         FROM dr_photo_unified_reviews
         WHERE drop_number = $1 AND photo_source IN ('onemap', 'boss', 'local')`,
        [dropNumber]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        log.info(`Photos already fetched for ${dropNumber}, skipping`, {
          source: existing.photo_source,
          count: existing.photo_count,
          vlmStatus: existing.vlm_categorization_status,
        });

        // Use VLM categorization results for step data if available
        // This ensures accurate step coverage even if categorization isn't formally approved
        let photos: SourcePhoto[] = existing.photos_metadata || [];
        const vlmResults = existing.vlm_categorization_results || [];

        if (vlmResults.length > 0 && existing.vlm_categorization_status !== 'pending') {
          // Build photos array using VLM results for step data
          photos = vlmResults.map((vlm: any) => ({
            filename: vlm.photo_filename,
            step: vlm.human_override_step ?? vlm.vlm_predicted_step ?? null,
            url: `/api/activate/photo/${dropNumber}/${vlm.photo_filename}`,
            original_type: vlm.original_type,
          }));
          log.info(`Using VLM results for step data (${vlmResults.length} photos)`);
        }

        return apiResponse.success(res, {
          source: existing.photo_source,
          photos,
          count: existing.photo_count || 0,
          ont_barcode: existing.ont_serial_scanned,
          ups_serial: existing.ups_serial_scanned,
          skipped: true,
        });
      }
    }

    // Fetch photos with multi-source fallback
    const result = forceSource
      ? await fetchFromSpecificSource(dropNumber, forceSource, { skipCategorization })
      : await fetchPhotosWithFallback(dropNumber, { skipCategorization });

    // Update unified review with photo metadata and serial numbers
    await updateReviewWithPhotos(dropNumber, result);

    log.info(`Successfully fetched photos for ${dropNumber}`, {
      source: result.source,
      count: result.count,
      ont_barcode: result.ont_barcode,
      ups_serial: result.ups_serial,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    log.error('Error fetching photos:', { error: error });
    return apiResponse.internalError(res, error);
  }
}

/**
 * Update unified review with photo metadata and serial numbers
 */
async function updateReviewWithPhotos(
  dropNumber: string,
  result: PhotoFetchResult
): Promise<void> {
  try {
    await pool.query(
      `
      UPDATE dr_photo_unified_reviews
      SET
        photo_source = $1,
        photo_count = $2,
        photos_metadata = $3,
        ont_serial_scanned = COALESCE($4, ont_serial_scanned),
        ups_serial_scanned = COALESCE($5, ups_serial_scanned),
        updated_at = NOW()
      WHERE drop_number = $6;
      `,
      [
        result.source,
        result.count,
        JSON.stringify(result.photos),
        result.ont_barcode || null,
        result.ups_serial || null,
        dropNumber
      ]
    );

    log.info(`Updated review with photo metadata and serials for ${dropNumber}`, {
      ont_barcode: result.ont_barcode,
      ups_serial: result.ups_serial,
    });
  } catch (error) {
    log.error('Failed to update review with photos', { dropNumber, error });
    // Don't throw - we still want to return the photos even if DB update fails
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  return handlePost(req, res);
}

export default withAuth(handler);
