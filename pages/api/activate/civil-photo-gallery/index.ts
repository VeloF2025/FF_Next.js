/**
 * API Route: /api/activate/civil-photo-gallery
 *
 * Fetches civils photos from vlm_visual_photo_examples.
 *
 * GET /api/activate/civil-photo-gallery?all=true  — step counts
 * GET /api/activate/civil-photo-gallery?step=N    — photos for step N (1–8)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';
import { CIVIL_STEP_LABELS } from '@/modules/sitecam/lib/sitecamSteps';

export interface CivilGalleryPhoto {
  id: string;
  stepNumber: number;
  photoUrl: string;
  label: 'positive' | 'negative';
  confidence: number | null;
  savedAt: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const allSteps = req.query['all'] === 'true';
    const stepParam = req.query['step'];
    const limitParam = req.query['limit'];

    const parsedLimit = parseInt(String(limitParam ?? '60'), 10);
    const limit = Number.isNaN(parsedLimit) ? 60 : Math.min(Math.max(parsedLimit, 1), 100);

    if (allSteps) {
      const countResult = await pool.query<{ step_number: number; photo_count: string }>(
        `SELECT step_number, COUNT(*) AS photo_count
         FROM vlm_visual_photo_examples
         WHERE job_type = 'civils'
         GROUP BY step_number
         ORDER BY step_number`,
      );

      return apiResponse.success(res, { counts: countResult.rows });
    }

    if (!stepParam) {
      return apiResponse.badRequest(res, 'Missing step parameter');
    }

    const step = parseInt(String(stepParam), 10);
    if (Number.isNaN(step) || step < 1 || step > 8) {
      return apiResponse.badRequest(res, 'Step must be between 1 and 8');
    }

    const result = await pool.query<{
      id: string;
      step_number: number;
      photo_url: string;
      label: 'positive' | 'negative';
      confidence: number | null;
      saved_at: string;
    }>(
      `SELECT id, step_number, photo_url, label, confidence, saved_at
       FROM vlm_visual_photo_examples
       WHERE job_type = 'civils'
         AND step_number = $1
       ORDER BY saved_at DESC
       LIMIT $2`,
      [step, limit],
    );

    // Civil photos are stored as Microsoft Graph URLs which require OAuth —
    // route through the proxy endpoint so the browser can load them.
    const photos: CivilGalleryPhoto[] = result.rows.map((row) => ({
      id: row.id,
      stepNumber: row.step_number,
      photoUrl: `/api/activate/civil-photo-gallery/photo?id=${encodeURIComponent(row.id)}`,
      label: row.label,
      confidence: row.confidence,
      savedAt: row.saved_at,
    }));

    const stepLabel = CIVIL_STEP_LABELS[step] ?? `Step ${step}`;

    log.info(`Civil photo gallery: step ${step}, ${photos.length} photos`, undefined, 'CivilPhotoGallery');

    return apiResponse.success(res, {
      step,
      stepLabel,
      photos,
    });
  } catch (error) {
    log.error('[CivilPhotoGallery] Error fetching gallery photos', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
