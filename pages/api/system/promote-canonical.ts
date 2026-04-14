/**
 * API: Auto-promote high-frequency corrections to canonical
 *
 * GET  /api/system/promote-canonical - Preview candidates
 * POST /api/system/promote-canonical - Run promotion
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import db from '@/lib/db';

const MIN_FREQUENCY = 50; // Minimum corrections for a pair to qualify
const MAX_CANONICAL_PER_PAIR = 2; // Max canonical examples per correction pair

interface PromotionCandidate {
  vlmPredictedStep: number;
  correctStep: number;
  frequency: number;
  currentCanonical: number;
  willPromote: number;
}

interface PromotionResult {
  promoted: number;
  candidates: PromotionCandidate[];
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      return handlePreview(res);
    }
    if (req.method === 'POST') {
      return handlePromote(res);
    }
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  } catch (error) {
    log.error('PromoteCanonical', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

async function handlePreview(res: NextApiResponse) {
  const candidates = await getCandidates();
  const currentCanonicalCount = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM qa_correction_examples WHERE is_canonical = true`
  );

  return apiResponse.success(res, {
    currentCanonical: parseInt(currentCanonicalCount.rows[0]?.count || '0', 10),
    minFrequency: MIN_FREQUENCY,
    maxPerPair: MAX_CANONICAL_PER_PAIR,
    candidates,
  });
}

async function handlePromote(res: NextApiResponse): Promise<void> {
  const candidates = await getCandidates();
  let totalPromoted = 0;

  for (const candidate of candidates) {
    if (candidate.willPromote <= 0) continue;

    // Pick best examples: highest confidence, most recent, has description
    const best = await db.query<{ id: string }>(
      `SELECT id FROM qa_correction_examples
       WHERE workflow_type = 'dr_photo'
         AND vlm_predicted_step = $1
         AND correct_step = $2
         AND is_canonical = false
         AND photo_description IS NOT NULL
         AND photo_description != ''
       ORDER BY vlm_confidence DESC, created_at DESC
       LIMIT $3`,
      [candidate.vlmPredictedStep, candidate.correctStep, candidate.willPromote]
    );

    if (best.rows.length > 0) {
      const ids = best.rows.map((r) => r.id);
      await db.query(
        `UPDATE qa_correction_examples
         SET is_canonical = true, promoted_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      totalPromoted += ids.length;

      log.info('PromoteCanonical', {
        action: 'promoted',
        vlmPredictedStep: candidate.vlmPredictedStep,
        correctStep: candidate.correctStep,
        count: ids.length,
        frequency: candidate.frequency,
      });
    }
  }

  log.info('PromoteCanonical', { action: 'complete', totalPromoted });
  return apiResponse.success(res, { promoted: totalPromoted, candidates });
}

async function getCandidates(): Promise<PromotionCandidate[]> {
  const result = await db.query<{
    vlm_predicted_step: number;
    correct_step: number;
    freq: string;
    canonical_count: string;
  }>(
    `SELECT
       vlm_predicted_step,
       correct_step,
       COUNT(*) as freq,
       COUNT(*) FILTER (WHERE is_canonical = true) as canonical_count
     FROM qa_correction_examples
     WHERE workflow_type = 'dr_photo'
     GROUP BY vlm_predicted_step, correct_step
     HAVING COUNT(*) >= $1
     ORDER BY COUNT(*) DESC`,
    [MIN_FREQUENCY]
  );

  return result.rows.map((r) => {
    const currentCanonical = parseInt(r.canonical_count, 10);
    return {
      vlmPredictedStep: r.vlm_predicted_step,
      correctStep: r.correct_step,
      frequency: parseInt(r.freq, 10),
      currentCanonical,
      willPromote: Math.max(0, MAX_CANONICAL_PER_PAIR - currentCanonical),
    };
  });
}

export default withAuth(handler);
