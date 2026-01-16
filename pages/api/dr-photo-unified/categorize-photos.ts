/**
 * API Route: /api/dr-photo-unified/categorize-photos
 *
 * Purpose: Run VLM categorization on photos for a DR
 * Method: POST
 *
 * This endpoint:
 * 1. Fetches ALL photos from OneMap (raw, without pre-categorization)
 * 2. Sends photos to Qwen3 VLM for category prediction
 * 3. Stores VLM predictions for human review
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  categorizePhotos,
  PhotoInput,
} from '@/modules/dr-photo-unified/services/categorizationVlmService';
import {
  CategorizePhotosRequest,
  CategorizePhotosResponse,
  VlmCategorizationResult,
} from '@/modules/dr-photo-unified/types/unified.types';
import { photoTypeToStep } from '@/modules/dr-photo-unified/utils/stepMapper';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

// OneMap API host
const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://192.168.1.150:8003';

/**
 * Fetch raw photos from OneMap (without step mapping)
 */
async function fetchRawPhotos(
  dropNumber: string
): Promise<{ photos: PhotoInput[]; ont_barcode: string | null; ups_serial: string | null }> {
  // Try to get the record from OneMap
  let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);

  // If 404, trigger download first
  if (response.status === 404 || response.status === 422) {
    log.info('CategorizePhotos', `Record not found for ${dropNumber}, triggering download`);

    const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
      method: 'POST',
    });

    if (downloadResponse.ok) {
      // Retry fetching record
      response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
    } else {
      throw new Error(`Download failed: ${downloadResponse.status}`);
    }
  }

  if (!response.ok) {
    throw new Error(`OneMap API error: ${response.status}`);
  }

  const data = await response.json();
  const localPhotos = data.local_photos || [];

  // Map to PhotoInput format (raw, for categorization)
  const photos: PhotoInput[] = localPhotos.map((photo: any) => ({
    filename: photo.filename,
    url: `/api/dr-photo-unified/photo/${dropNumber}/${photo.filename}`,
    original_type: photo.type || null,
    original_step: photo.type ? photoTypeToStep(photo.type) : null,
  }));

  return {
    photos,
    ont_barcode: data.ont_barcode || null,
    ups_serial: data.ups_serial || null,
  };
}

/**
 * POST /api/dr-photo-unified/categorize-photos
 * Run VLM categorization on photos
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, force, batchSize } = req.body as CategorizePhotosRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('CategorizePhotos', `Starting categorization for ${dropNumber}`, { force, batchSize });

    // Check if already categorized (skip unless forced)
    if (!force) {
      const existingResult = await pool.query(
        `SELECT vlm_categorization_status, vlm_categorization_results
         FROM dr_photo_unified_reviews
         WHERE drop_number = $1`,
        [dropNumber]
      );

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];

        if (existing.vlm_categorization_status === 'categorized' ||
            existing.vlm_categorization_status === 'approved') {
          log.info('CategorizePhotos', `Already categorized for ${dropNumber}, skipping`);

          return apiResponse.success(res, {
            dropNumber,
            status: existing.vlm_categorization_status,
            photoCount: existing.vlm_categorization_results?.length || 0,
            categorizations: existing.vlm_categorization_results || [],
            processingTimeMs: Date.now() - startTime,
            skipped: true,
          } as CategorizePhotosResponse & { skipped: boolean });
        }
      }
    }

    // Update status to processing
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET vlm_categorization_status = 'processing', updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );

    // Fetch raw photos from OneMap
    log.info('CategorizePhotos', `Fetching raw photos for ${dropNumber}`);
    const { photos, ont_barcode, ups_serial } = await fetchRawPhotos(dropNumber);

    if (photos.length === 0) {
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET vlm_categorization_status = 'failed', updated_at = NOW()
         WHERE drop_number = $1`,
        [dropNumber]
      );

      return apiResponse.error(res, ErrorCode.NOT_FOUND, `No photos found for ${dropNumber}`);
    }

    log.info('CategorizePhotos', `Found ${photos.length} photos for ${dropNumber}`);

    // Run VLM categorization
    const categorizations = await categorizePhotos(dropNumber, photos, batchSize);

    // Store results in database
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         vlm_categorization_status = 'categorized',
         vlm_categorization_results = $1,
         vlm_categorized_at = NOW(),
         ont_serial_scanned = COALESCE($2, ont_serial_scanned),
         ups_serial_scanned = COALESCE($3, ups_serial_scanned),
         updated_at = NOW()
       WHERE drop_number = $4`,
      [JSON.stringify(categorizations), ont_barcode, ups_serial, dropNumber]
    );

    const processingTimeMs = Date.now() - startTime;

    log.info('CategorizePhotos', `Categorization complete for ${dropNumber}`, {
      photoCount: categorizations.length,
      processingTimeMs,
    });

    const response: CategorizePhotosResponse = {
      dropNumber,
      status: 'categorized',
      photoCount: categorizations.length,
      categorizations,
      processingTimeMs,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('CategorizePhotos', 'Error during categorization', error);

    // Try to update status to failed
    try {
      const { dropNumber } = req.body as CategorizePhotosRequest;
      if (dropNumber) {
        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET vlm_categorization_status = 'failed', updated_at = NOW()
           WHERE drop_number = $1`,
          [dropNumber]
        );
      }
    } catch (dbError) {
      log.error('CategorizePhotos', 'Failed to update status to failed', dbError);
    }

    return apiResponse.internalError(res, error);
  }
}

/**
 * GET /api/dr-photo-unified/categorize-photos?dropNumber=XXX
 * Get existing categorization results
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    const result = await pool.query(
      `SELECT vlm_categorization_status, vlm_categorization_results, vlm_categorized_at,
              vlm_approved_by, vlm_approved_at
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Review', dropNumber);
    }

    const row = result.rows[0];

    return apiResponse.success(res, {
      dropNumber,
      status: row.vlm_categorization_status,
      categorizations: row.vlm_categorization_results || [],
      categorizedAt: row.vlm_categorized_at,
      approvedBy: row.vlm_approved_by,
      approvedAt: row.vlm_approved_at,
    });
  } catch (error) {
    log.error('CategorizePhotos', 'Error getting categorization', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  } else if (req.method === 'GET') {
    return handleGet(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}
