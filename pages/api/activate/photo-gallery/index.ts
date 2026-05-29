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
      // Steps 1-10: VLM results from QA-passed/approved DRs.
      // Steps 11-12: VLM predictions from any categorized/approved DR — original_type
      //   'ph_hh1'/'ph_hh2' proved too broad (matched thousands of non-dome-joint photos).
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

          -- Steps 11-12: VLM predictions from any categorized DR (dome-joint DRs
          --   rarely reach qa_decision = 'PASS' so we drop that requirement here)
          SELECT (photo_result->>'vlm_predicted_step')::int AS step
          FROM dr_photo_unified_reviews,
               jsonb_array_elements(vlm_categorization_results::jsonb) AS photo_result
          WHERE vlm_categorization_status IN ('categorized', 'approved')
            AND vlm_categorization_results IS NOT NULL
            AND jsonb_typeof(vlm_categorization_results::jsonb) = 'array'
            AND (photo_result->>'vlm_predicted_step')::int BETWEEN 11 AND 12
            AND photo_result->>'photo_filename' IS NOT NULL
            AND photo_result->>'photo_filename' != ''
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

    // Steps 1-10: must be from a qa_decision='PASS', vlm_status='approved' DR.
    // Steps 11-12 (dome joints): original_type 'ph_hh1'/'ph_hh2' proved too broad —
    //   it matched thousands of non-dome-joint photos. Use VLM vlm_predicted_step
    //   instead, relaxing the qa_decision='PASS' requirement because dome-joint DRs
    //   rarely go through the full QA wizard.
    const isDomeJoint = step === 11 || step === 12;

    // Two separate query strings — avoids string interpolation into SQL.
    // isDomeJoint is a server-side boolean, never derived from request params directly,
    // but keeping the queries explicit makes the intent unambiguous.
    const STEPS_1_10_QUERY = `
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
        photo_result->>'original_type' AS original_type,
        (SELECT CASE WHEN is_canonical THEN 'good'::text ELSE 'bad'::text END
         FROM vlm_corrections
         WHERE photo_url = '/api/activate/photo/' || drop_number || '/' || (photo_result->>'photo_filename')
           AND module = 'activate'
           AND analysis_type = 'photo_categorization'
         LIMIT 1) AS existing_decision
      FROM photo_data
      WHERE (photo_result->>'vlm_predicted_step')::int = $1
        AND photo_result->>'photo_filename' IS NOT NULL
        AND photo_result->>'photo_filename' != ''
      ORDER BY (photo_result->>'vlm_confidence')::float DESC NULLS LAST
      LIMIT $2
    `;

    // Dome joints (steps 11-12): same shape, no PASS requirement.
    const STEPS_11_12_QUERY = `
      WITH photo_data AS (
        SELECT
          drop_number,
          jsonb_array_elements(vlm_categorization_results::jsonb) AS photo_result
        FROM dr_photo_unified_reviews
        WHERE vlm_categorization_status IN ('categorized', 'approved')
          AND vlm_categorization_results IS NOT NULL
          AND jsonb_typeof(vlm_categorization_results::jsonb) = 'array'
      )
      SELECT
        drop_number,
        photo_result->>'photo_filename' AS filename,
        (photo_result->>'vlm_confidence')::float AS confidence,
        photo_result->>'original_type' AS original_type,
        (SELECT CASE WHEN is_canonical THEN 'good'::text ELSE 'bad'::text END
         FROM vlm_corrections
         WHERE photo_url = '/api/activate/photo/' || drop_number || '/' || (photo_result->>'photo_filename')
           AND module = 'activate'
           AND analysis_type = 'photo_categorization'
         LIMIT 1) AS existing_decision
      FROM photo_data
      WHERE (photo_result->>'vlm_predicted_step')::int = $1
        AND photo_result->>'photo_filename' IS NOT NULL
        AND photo_result->>'photo_filename' != ''
      ORDER BY (photo_result->>'vlm_confidence')::float DESC NULLS LAST
      LIMIT $2
    `;

    const result = await pool.query<{
      drop_number: string;
      filename: string;
      confidence: number;
      original_type: string | null;
      existing_decision: 'good' | 'bad' | null;
    }>(
      isDomeJoint ? STEPS_11_12_QUERY : STEPS_1_10_QUERY,
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
      existingDecision: row.existing_decision,
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
