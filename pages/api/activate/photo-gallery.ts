/**
 * API Route: /api/activate/photo-gallery
 *
 * Fetches accepted photos grouped by step for the criteria review gallery.
 * Only returns photos from DRs with qa_decision = 'PASS' and approved VLM categorization.
 *
 * GET /api/activate/photo-gallery?step=1&limit=60
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';

export interface GalleryPhoto {
  drNumber: string;
  filename: string;
  url: string;
  confidence: number;
  originalType: string | null;
}

export interface GalleryStepData {
  step: number;
  count: number;
  photos: GalleryPhoto[];
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const stepParam = req.query['step'];
    const limitParam = req.query['limit'];
    const allSteps = req.query['all'] === 'true';

    const parsedLimit = parseInt(String(limitParam ?? '60'), 10);
    const limit = Number.isNaN(parsedLimit) ? 60 : Math.min(Math.max(parsedLimit, 1), 100);

    if (allSteps) {
      // Return counts per step for the overview
      const countResult = await pool.query<{ step: number; photo_count: string }>(`
        WITH photo_data AS (
          SELECT
            drop_number,
            jsonb_array_elements(vlm_categorization_results::jsonb) AS photo_result
          FROM dr_photo_unified_reviews
          WHERE qa_decision = 'PASS'
            AND vlm_categorization_status = 'approved'
            AND vlm_categorization_results IS NOT NULL
            AND jsonb_typeof(vlm_categorization_results::jsonb) = 'array'
        )
        SELECT
          (photo_result->>'vlm_predicted_step')::int AS step,
          COUNT(*) AS photo_count
        FROM photo_data
        WHERE (photo_result->>'vlm_predicted_step')::int BETWEEN 1 AND 10
        GROUP BY step
        ORDER BY step
      `);

      return apiResponse.success(res, { counts: countResult.rows });
    }

    if (!stepParam) {
      return apiResponse.badRequest(res, 'Missing step parameter');
    }

    const step = parseInt(String(stepParam), 10);
    if (isNaN(step) || step < 1 || step > 10) {
      return apiResponse.badRequest(res, 'Step must be between 1 and 10');
    }

    const result = await pool.query<{
      drop_number: string;
      filename: string;
      confidence: number;
      original_type: string | null;
    }>(
      `
      WITH photo_data AS (
        SELECT
          drop_number,
          jsonb_array_elements(vlm_categorization_results::jsonb) AS photo_result
        FROM dr_photo_unified_reviews
        WHERE qa_decision = 'PASS'
          AND vlm_categorization_status = 'approved'
          AND vlm_categorization_results IS NOT NULL
          AND jsonb_typeof(vlm_categorization_results::jsonb) = 'array'
      )
      SELECT
        drop_number,
        photo_result->>'photo_filename' AS filename,
        (photo_result->>'vlm_confidence')::float AS confidence,
        photo_result->>'original_type' AS original_type
      FROM photo_data
      WHERE (photo_result->>'vlm_predicted_step')::int = $1
        AND photo_result->>'photo_filename' IS NOT NULL
        AND photo_result->>'photo_filename' != ''
      ORDER BY (photo_result->>'vlm_confidence')::float DESC NULLS LAST
      LIMIT $2
    `,
      [step, limit]
    );

    const photos: GalleryPhoto[] = result.rows.map((row) => ({
      drNumber: row.drop_number,
      filename: row.filename,
      // Relative URL: the browser resolves it against the current origin, so the
      // prod gallery serves prod photos and dev serves dev — no cross-env dependency.
      url: `/api/activate/photo/${row.drop_number}/${row.filename}`,
      confidence: row.confidence ?? 0,
      originalType: row.original_type,
    }));

    log.info(`Photo gallery: step ${step}, ${photos.length} photos`, undefined, 'PhotoGallery');

    return apiResponse.success(res, {
      step,
      count: photos.length,
      photos,
    } satisfies GalleryStepData);
  } catch (error) {
    log.error('[PhotoGallery] Error fetching gallery photos', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
