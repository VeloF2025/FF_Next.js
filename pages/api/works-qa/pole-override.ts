import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

interface OverrideBody {
  pole_id?: string;
  slot?: string;
  decision?: string;
  reason?: string;
}

interface VlmSlotResult {
  valid?: boolean;
  confidence?: number;
  feedback?: string;
  overridden_by?: string;
  override_reason?: string;
}

interface VlmResults {
  [slot: string]: VlmSlotResult;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, slot, decision, reason } = req.body as OverrideBody;

  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');
  if (!slot) return apiResponse.badRequest(res, 'slot required');
  if (!decision) return apiResponse.badRequest(res, 'decision required');
  if (decision !== 'pass' && decision !== 'fail') {
    return apiResponse.badRequest(res, "decision must be 'pass' or 'fail'");
  }

  const slotMeta = getSlotMeta(slot);
  if (!slotMeta) return apiResponse.badRequest(res, `Unknown slot: ${slot}`);

  const userEmail = (req as AuthenticatedNextApiRequest).user.email;

  try {
    // Fetch current pole record
    const fetchResult = await pool.query<{ id: string; vlm_results: VlmResults }>(
      'SELECT id, vlm_results FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (fetchResult.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    const poleRow = fetchResult.rows[0]!;
    const existingVlm = poleRow.vlm_results ?? {};
    const existingSlot = existingVlm[slot] ?? {};

    // Build correction example using actual qa_correction_examples columns:
    // workflow_type, photo_filename, vlm_predicted_step, vlm_predicted_category,
    // vlm_confidence, vlm_reasoning, correct_step, correct_category,
    // correction_reason, corrected_by
    const vlmPredictedStep = slotMeta.stepNumber;
    // Encode VLM's actual prediction: pass → discipline, fail → discipline_fail
    const vlmPredictedValid = existingSlot.valid === true;
    const vlmPredictedCategory = vlmPredictedValid ? slotMeta.discipline : `${slotMeta.discipline}_fail`;
    const correctCategory = decision === 'pass' ? slotMeta.discipline : `${slotMeta.discipline}_fail`;
    const vlmConfidence = typeof existingSlot.confidence === 'number'
      ? existingSlot.confidence
      : 0;
    const vlmReasoning = existingSlot.feedback ?? '';
    const photoFilename = `works_qa:${pole_id}:${slot}`;

    await pool.query(`
      INSERT INTO qa_correction_examples
        (workflow_type, photo_filename, vlm_predicted_step, vlm_predicted_category,
         vlm_confidence, vlm_reasoning, correct_step, correct_category,
         correction_reason, corrected_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      'works_qa',
      photoFilename,
      vlmPredictedStep,
      vlmPredictedCategory,
      vlmConfidence,
      vlmReasoning,
      vlmPredictedStep,
      correctCategory,
      reason ?? '',
      userEmail,
    ]);

    // Merge override into vlm_results for this slot
    const updatedSlot: VlmSlotResult = {
      ...existingSlot,
      valid: decision === 'pass',
      overridden_by: userEmail,
      override_reason: reason ?? '',
    };
    const patch = JSON.stringify({ [slot]: updatedSlot });

    await pool.query(`
      UPDATE pole_qa_photos
      SET vlm_results = vlm_results || $1::jsonb, updated_at = NOW()
      WHERE id = $2::uuid
    `, [patch, pole_id]);

    return apiResponse.success(res, { overridden: true, slot, decision });
  } catch (err) {
    log.error('works-qa/pole-override', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withRole('manager')(handler));
