/**
 * API Route: /api/activate/photo-gallery
 *
 * Fetches photos grouped by step for the criteria review gallery.
 * Steps 1-10: photos from PASS/approved DRs via VLM categorization results.
 * Steps 11-12 (dome joints): photos from photos_metadata by original_type — these DRs
 * rarely go through the full QA wizard, so the attribute tag is used as the step signal.
 *
 * GET /api/activate/photo-gallery?step=1&limit=60
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';
// Shared shape — single source of truth used by the gallery UI components too.
import type { GalleryPhoto, GalleryStepData } from '@/modules/activate/components/photo-gallery/types';

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
      // Return counts per step for the overview.
      // Steps 1-10: count from VLM categorization results on PASS/approved DRs.
      // Steps 11-12: count from photos_metadata by original_type (dome joints are
      //   optional and rarely go through the full QA wizard, so qa_decision = 'PASS'
      //   would return almost nothing).
      const countResult = await pool.query<{ step: number; photo_count: string }>(`
        SELECT step, COUNT(*) AS photo_count FROM (
          -- Steps 1-10: VLM results from QA-passed DRs
          SELECT (photo_result->>'vlm_predicted_step')::int AS step
          FROM dr_photo_unified_reviews,
               jsonb_array_elements(vlm_categorization_results::jsonb) AS photo_result
          WHERE qa_decision = 'PASS'
            AND vlm_categorization_status = 'approved'
            AND vlm_categorization_results IS NOT NULL
            AND jsonb_typeof(vlm_categorization_results::jsonb) = 'array'
            AND (photo_result->>'vlm_predicted_step')::int BETWEEN 1 AND 10

          UNION ALL

          -- Step 11: ph_hh1 photos from any DR (attribute tag is reliable)
          SELECT 11 AS step
          FROM dr_photo_unified_reviews,
               jsonb_array_elements(photos_metadata) AS p
          WHERE photos_metadata IS NOT NULL
            AND jsonb_typeof(photos_metadata) = 'array'
            AND p->>'original_type' = 'ph_hh1'
            AND p->>'filename' IS NOT NULL
            AND p->>'filename' != ''

          UNION ALL

          -- Step 12: ph_hh2 photos from any DR
          SELECT 12 AS step
          FROM dr_photo_unified_reviews,
               jsonb_array_elements(photos_metadata) AS p
          WHERE photos_metadata IS NOT NULL
            AND jsonb_typeof(photos_metadata) = 'array'
            AND p->>'original_type' = 'ph_hh2'
            AND p->>'filename' IS NOT NULL
            AND p->>'filename' != ''
        ) combined
        GROUP BY step
        ORDER BY step
      `);

      return apiResponse.success(res, { counts: countResult.rows });
    }

    if (!stepParam) {
      return apiResponse.badRequest(res, 'Missing step parameter');
    }

    const step = parseInt(String(stepParam), 10);
    if (isNaN(step) || step < 1 || step > 12) {
      return apiResponse.badRequest(res, 'Step must be between 1 and 12');
    }

    // Steps 11-12 (dome joints) use photos_metadata by original_type because these
    // DRs are rarely put through the full QA wizard, so qa_decision = 'PASS' would
    // return almost nothing. The original_type attribute is a reliable 100% signal.
    const isDomeJoint = step === 11 || step === 12;
    const domeJointType = step === 11 ? 'ph_hh1' : 'ph_hh2';

    const result = await pool.query<{
      drop_number: string;
      filename: string;
      confidence: number;
      original_type: string | null;
    }>(
      isDomeJoint
        ? `
          SELECT
            drop_number,
            p->>'filename' AS filename,
            1.0::float AS confidence,
            p->>'original_type' AS original_type
          FROM dr_photo_unified_reviews,
               jsonb_array_elements(photos_metadata) AS p
          WHERE photos_metadata IS NOT NULL
            AND jsonb_typeof(photos_metadata) = 'array'
            AND p->>'original_type' = $1
            AND p->>'filename' IS NOT NULL
            AND p->>'filename' != ''
          ORDER BY drop_number DESC
          LIMIT $2
        `
        : `
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
      [isDomeJoint ? domeJointType : step, limit]
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
