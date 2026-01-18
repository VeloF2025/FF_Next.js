/**
 * API Route: /api/activate/final-decision
 *
 * Purpose: Phase 4 of QA Wizard - Save final QA decision
 * Method: POST
 *
 * Saves the final decision (PASS/FAIL/REWORK_NEEDED) and moves to feedback phase.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  evaluateAutoFail,
  getFailReasonDescription,
  type DrValidationData,
  type FailReasonCode,
} from '@/modules/activate/services/qaAutoFailService';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

type QaDecision = 'PASS' | 'FAIL' | 'REWORK_NEEDED';

interface FinalDecisionRequest {
  dropNumber: string;
  decision: QaDecision;
  notes?: string;
  /** If overriding auto-fail recommendation */
  overrideReason?: string;
}

interface FinalDecisionResponse {
  drNumber: string;
  decision: QaDecision;
  reasons: FailReasonCode[];
  reasonDescriptions: string[];
  savedAt: string;
  savedBy: string | null;
  nextPhase: 'feedback';
  feedbackTemplate: string;
}

/**
 * POST /api/activate/final-decision
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber, decision, notes, overrideReason } = req.body as FinalDecisionRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    if (!decision || !['PASS', 'FAIL', 'REWORK_NEEDED'].includes(decision)) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'decision must be PASS, FAIL, or REWORK_NEEDED'
      );
    }

    // Get current user (fallback when Clerk not available)
    const userId = req.headers['x-user-id'] as string | undefined || 'system';

    log.info('FinalDecision', `Recording decision ${decision} for ${dropNumber}`, {
      userId,
      hasNotes: !!notes,
      hasOverride: !!overrideReason,
    });

    // Get current review data from dr_photo_unified_reviews (main table) and foto_ai_reviews (VLM data)
    const reviewResult = await pool.query(
      `SELECT
         u.drop_number,
         u.photos_metadata::text as photos,
         u.vlm_categorization_results::text as vlm_categorization,
         u.ont_serial_scanned as onemap_ont_serial,
         u.ups_serial_scanned as onemap_ups_serial,
         f.vlm_power_meter_dbm,
         f.vlm_ont_serial_step6,
         f.vlm_ont_serial_step9,
         f.vlm_dr_number_step9,
         f.step_coverage::text,
         f.missing_steps
       FROM dr_photo_unified_reviews u
       LEFT JOIN foto_ai_reviews f ON f.dr_number = u.drop_number
       WHERE u.drop_number = $1
       LIMIT 1`,
      [dropNumber]
    );

    if (reviewResult.rows.length === 0) {
      return apiResponse.notFound(res, 'DR review', dropNumber);
    }

    const review = reviewResult.rows[0];

    // Parse photos and categorization
    let photos: Array<{ filename: string; step: number | null }> = [];
    try {
      const parsedPhotos = review.photos ? JSON.parse(review.photos) : [];
      const parsedCategorization = review.vlm_categorization ? JSON.parse(review.vlm_categorization) : [];

      photos = parsedPhotos.map((p: { filename: string }) => {
        const cat = parsedCategorization.find(
          (c: { photo_filename: string; vlm_predicted_step?: number; human_override_step?: number }) =>
            c.photo_filename === p.filename
        );
        return {
          filename: p.filename,
          step: cat?.human_override_step ?? cat?.vlm_predicted_step ?? null,
        };
      });
    } catch (e) {
      log.warn('FinalDecision', `Failed to parse photos for ${dropNumber}: ${e}`);
    }

    // Build validation data
    const validationData: DrValidationData = {
      drNumber: dropNumber,
      photoCount: photos.length,
      photos,
      ontSerial: review.onemap_ont_serial,
      upsSerial: review.onemap_ups_serial,
      powerMeterDbm: review.vlm_power_meter_dbm,
      vlmOntSerialStep6: review.vlm_ont_serial_step6,
      vlmOntSerialStep9: review.vlm_ont_serial_step9,
      vlmDrNumberStep9: review.vlm_dr_number_step9,
    };

    // Evaluate auto-fail to get reasons
    const autoFailResult = evaluateAutoFail(validationData);
    const reasons = decision === 'PASS' ? [] : autoFailResult.reasons;
    const reasonDescriptions = reasons.map(getFailReasonDescription);

    // Build decision notes
    let finalNotes = notes || '';
    if (overrideReason && decision !== autoFailResult.recommendation) {
      finalNotes += `\n[Override: ${overrideReason}]`;
    }

    // Save decision to database
    const savedAt = new Date().toISOString();

    await pool.query(
      `UPDATE foto_ai_reviews
       SET
         qa_decision = $1,
         qa_decision_reasons = $2,
         qa_decision_at = NOW(),
         qa_decision_by = $3,
         qa_decision_notes = $4,
         qa_phase = 'feedback',
         updated_at = NOW()
       WHERE dr_number = $5`,
      [decision, JSON.stringify(reasons), userId || null, finalNotes || null, dropNumber]
    );

    // Generate feedback template based on decision
    const feedbackTemplate = generateFeedbackTemplate(
      dropNumber,
      decision,
      reasons,
      review.vlm_power_meter_dbm,
      review.onemap_ont_serial
    );

    log.info('FinalDecision', `Decision ${decision} saved for ${dropNumber}`, {
      reasons,
      userId,
    });

    const response: FinalDecisionResponse = {
      drNumber: dropNumber,
      decision,
      reasons,
      reasonDescriptions,
      savedAt,
      savedBy: userId || null,
      nextPhase: 'feedback',
      feedbackTemplate,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('FinalDecision', 'Error saving decision', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Generate WhatsApp feedback message template
 */
function generateFeedbackTemplate(
  dropNumber: string,
  decision: QaDecision,
  reasons: FailReasonCode[],
  powerMeterDbm: number | null,
  ontSerial: string | null
): string {
  const lines: string[] = [];

  if (decision === 'PASS') {
    lines.push(`✅ ${dropNumber} APPROVED`);
    lines.push('• All 10 installation steps verified');
    if (powerMeterDbm !== null) {
      lines.push(`• Power meter: ${powerMeterDbm} dBm (PASS)`);
    }
    if (ontSerial) {
      lines.push(`• ONT Serial: ${ontSerial} ✓`);
    }
  } else if (decision === 'FAIL') {
    lines.push(`❌ ${dropNumber} FAILED`);
    lines.push('');
    lines.push('Issues found:');
    for (const reason of reasons) {
      lines.push(`• ${getFailReasonDescription(reason)}`);
    }
    lines.push('');
    lines.push('Please resubmit with corrected photos.');
  } else {
    lines.push(`⚠️ ${dropNumber} NEEDS ATTENTION`);
    lines.push('');
    lines.push('Issues to address:');
    for (const reason of reasons) {
      lines.push(`• ${getFailReasonDescription(reason)}`);
    }
    lines.push('');
    lines.push('Please review and resubmit if needed.');
  }

  return lines.join('\n');
}

/**
 * GET /api/activate/final-decision?dropNumber=XXX
 * Get current decision status
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    const result = await pool.query(
      `SELECT
         qa_decision,
         qa_decision_reasons::text,
         qa_decision_at,
         qa_decision_by,
         qa_decision_notes,
         qa_phase
       FROM foto_ai_reviews
       WHERE dr_number = $1
       LIMIT 1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'DR review', dropNumber);
    }

    const review = result.rows[0];

    return apiResponse.success(res, {
      drNumber: dropNumber,
      decision: review.qa_decision,
      reasons: review.qa_decision_reasons ? JSON.parse(review.qa_decision_reasons) : [],
      decidedAt: review.qa_decision_at,
      decidedBy: review.qa_decision_by,
      notes: review.qa_decision_notes,
      phase: review.qa_phase,
    });
  } catch (error) {
    log.error('FinalDecision', 'Error getting decision', error);
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
