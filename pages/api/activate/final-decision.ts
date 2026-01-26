/**
 * API Route: /api/activate/final-decision
 *
 * Purpose: Phase 4 of QA Wizard - Save final QA decision
 * Method: POST
 *
 * Saves the final decision (PASS/FAIL/REWORK_NEEDED) and moves to feedback phase.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import {
  evaluateAutoFail,
  getFailReasonDescription,
  type DrValidationData,
  type FailReasonCode,
} from '@/modules/activate/services/qaAutoFailService';
import { logActivity } from '@/modules/activate/services/activityLogService';
import {
  isSharePointDrSyncEnabled,
  fullDrSync,
} from '@/lib/sharepointDrSyncService';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

type QaDecision = 'PASS' | 'FAIL' | 'REWORK_NEEDED';

interface IssueClassification {
  issueType: 'ai_error' | 'photo_quality' | 'real_issue' | 'no_issue' | null;
  correctValue: string;
  createTicket: boolean;
  ticketType: 'maintenance' | 'qa' | null;
  ticketDescription: string;
}

interface FinalDecisionRequest {
  dropNumber: string;
  decision: QaDecision;
  notes?: string;
  /** If overriding auto-fail recommendation */
  overrideReason?: string;
  /** Internal notes for QA team only (not sent to technician) */
  internalNotes?: string;
  /** Feedback message to send via WhatsApp */
  technicianFeedback?: string;
  /** Structured issue classification */
  issueClassification?: IssueClassification;
  /** If true, save as draft without moving to feedback phase */
  isDraft?: boolean;
}

interface FinalDecisionResponse {
  drNumber: string;
  decision: QaDecision;
  reasons: FailReasonCode[];
  reasonDescriptions: string[];
  savedAt: string;
  savedBy: string | null;
  isDraft: boolean;
  nextPhase: 'feedback' | 'final_decision';
  feedbackTemplate: string;
}

/**
 * POST /api/activate/final-decision
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const {
      dropNumber,
      decision,
      notes,
      overrideReason,
      internalNotes,
      technicianFeedback,
      issueClassification,
      isDraft = false,
    } = req.body as FinalDecisionRequest;

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

    // Get current user from auth middleware
    const authReq = req as AuthenticatedNextApiRequest;
    const userId = authReq.user?.id || 'system';
    const reviewerName = authReq.user?.name || 'unknown';

    log.info('FinalDecision', `Recording decision ${decision} for ${dropNumber}`, {
      userId,
      hasNotes: !!notes,
      hasOverride: !!overrideReason,
      isDraft,
      hasIssueClassification: !!issueClassification?.issueType,
    });

    // Get current review data from unified table (after migration 127)
    const reviewResult = await pool.query(
      `SELECT
         drop_number,
         photos_metadata::text as photos,
         vlm_categorization_results::text as vlm_categorization,
         ont_serial_scanned as onemap_ont_serial,
         ups_serial_scanned as onemap_ups_serial,
         vlm_power_meter_dbm,
         vlm_ont_serial_step6,
         vlm_ont_serial_step9,
         vlm_dr_number_step9,
         step_coverage::text,
         missing_steps
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1
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

    // Determine the next phase based on draft status
    const nextPhase = isDraft ? 'final_decision' : 'feedback';

    // Update unified table (after migration 127 - no longer need foto_ai_reviews)
    const vlmQaResults = {
      power_meter: {
        value: review.vlm_power_meter_dbm,
        status: validationData.powerMeterDbm !== null ?
          (validationData.powerMeterDbm >= -24 && validationData.powerMeterDbm <= -18 ? 'pass' : 'fail') : 'pending',
        validRange: { min: -24, max: -18 },
      },
      ont_serial: {
        step6: review.vlm_ont_serial_step6,
        step9: review.vlm_ont_serial_step9,
        onemap: review.onemap_ont_serial,
        match: validationData.vlmOntSerialStep6 === validationData.ontSerial ||
               validationData.vlmOntSerialStep9 === validationData.ontSerial,
        status: (validationData.vlmOntSerialStep6 === validationData.ontSerial ||
                validationData.vlmOntSerialStep9 === validationData.ontSerial) ? 'pass' : 'pending',
      },
      dr_number: {
        value: review.vlm_dr_number_step9,
        match: review.vlm_dr_number_step9 === dropNumber,
        status: review.vlm_dr_number_step9 === dropNumber ? 'pass' : 'pending',
      },
    };

    const vlmQaSummary = {
      overall: decision,
      power_meter: vlmQaResults.power_meter.status,
      serial_match: vlmQaResults.ont_serial.status,
      dr_match: vlmQaResults.dr_number.status,
      all_checks_passed: decision === 'PASS',
    };

    // Calculate step coverage from photos for boolean columns
    const stepCounts: Record<number, number> = {};
    for (const photo of photos) {
      if (photo.step && photo.step >= 1 && photo.step <= 10) {
        stepCounts[photo.step] = (stepCounts[photo.step] || 0) + 1;
      }
    }

    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         vlm_qa_status = CASE WHEN $18 THEN 'in_progress' ELSE 'completed' END,
         vlm_qa_results = $1::jsonb,
         vlm_qa_summary = $2::jsonb,
         vlm_qa_validated_at = NOW(),
         qa_decision = $3,
         qa_decision_reasons = $4::jsonb,
         qa_decision_at = NOW(),
         qa_decision_by = $5,
         qa_decision_notes = $6,
         qa_decision_is_draft = $18,
         qa_internal_notes = $19,
         qa_technician_feedback = $20,
         qa_issue_classification = $21::jsonb,
         qa_phase = $22,
         human_review_status = CASE WHEN $18 THEN 'in_progress' ELSE 'completed' END,
         human_review_completed_at = CASE WHEN $18 THEN NULL ELSE NOW() END,
         reviewed_at = CASE WHEN $18 THEN NULL ELSE NOW() END,
         reviewed_by = CASE WHEN $18 THEN NULL ELSE $5 END,
         step_01_house_photo = $8,
         step_02_cable_from_pole = $9,
         step_03_entry_outside = $10,
         step_04_entry_inside = $11,
         step_05_wall = $12,
         step_06_ont_back = $13,
         step_07_power_meter = $14,
         step_08_final_installation = $15,
         step_09_green_lights = $16,
         step_10_signature = $17,
         updated_at = NOW()
       WHERE drop_number = $7`,
      [
        JSON.stringify(vlmQaResults),
        JSON.stringify(vlmQaSummary),
        decision,
        JSON.stringify(reasons.map(r => ({ check: r, status: 'fail', message: getFailReasonDescription(r) }))),
        userId || null,
        finalNotes || null,
        dropNumber,
        !!stepCounts[1],
        !!stepCounts[2],
        !!stepCounts[3],
        !!stepCounts[4],
        !!stepCounts[5],
        !!stepCounts[6],
        !!stepCounts[7],
        !!stepCounts[8],
        !!stepCounts[9],
        !!stepCounts[10],
        isDraft,
        internalNotes || null,
        technicianFeedback || null,
        JSON.stringify(issueClassification || {}),
        nextPhase,
      ]
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

    // Log activity for audit trail (only for non-draft saves)
    if (!isDraft) {
      try {
        await logActivity(
          dropNumber,
          'human_review_completed',
          {
            decision,
            reasons,
            reasonDescriptions,
            notes: finalNotes || null,
            reviewer: reviewerName,
            reviewerId: userId || 'system',
            stepsApproved: Object.entries(stepCounts)
              .filter(([_, count]) => count > 0)
              .map(([step]) => `step_${step.padStart(2, '0')}`),
            approved: Object.keys(stepCounts).filter(k => stepCounts[parseInt(k)] > 0).length,
            rejected: 10 - Object.keys(stepCounts).filter(k => stepCounts[parseInt(k)] > 0).length,
          },
          userId || 'system'
        );
      } catch (activityError) {
        log.warn('FinalDecision', `Failed to log activity for ${dropNumber}`, activityError);
      }

      // Trigger SharePoint sync on first QA completion (fire-and-forget)
      // This creates the folder hierarchy and syncs photos to SharePoint
      if (isSharePointDrSyncEnabled()) {
        log.info('FinalDecision', `Triggering SharePoint sync for ${dropNumber}`);
        fullDrSync(dropNumber, 'qa_completion')
          .then(result => {
            if (result.folderResult.success) {
              log.info('FinalDecision', `SharePoint folder created for ${dropNumber}`, {
                folderPath: result.folderResult.folderPath,
                photosUploaded: result.photoResult?.photosUploaded || 0,
              });
            } else {
              log.warn('FinalDecision', `SharePoint sync failed for ${dropNumber}`, {
                error: result.folderResult.error,
              });
            }
          })
          .catch(err => {
            log.warn('FinalDecision', `SharePoint sync error for ${dropNumber}`, err);
          });
      }
    } else {
      log.info('FinalDecision', `Draft saved for ${dropNumber} - skipping activity log`);
    }

    const response: FinalDecisionResponse = {
      drNumber: dropNumber,
      decision,
      reasons,
      reasonDescriptions,
      savedAt,
      savedBy: userId || null,
      isDraft,
      nextPhase: isDraft ? 'final_decision' : 'feedback',
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
 * Get current decision status including draft state
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    // Get data from dr_photo_unified_reviews (primary table with draft fields)
    const result = await pool.query(
      `SELECT
         qa_decision,
         qa_decision_reasons::text,
         qa_decision_at,
         qa_decision_by,
         qa_decision_notes,
         qa_decision_is_draft,
         qa_internal_notes,
         qa_technician_feedback,
         qa_issue_classification::text
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1
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
      isDraft: review.qa_decision_is_draft || false,
      internalNotes: review.qa_internal_notes,
      technicianFeedback: review.qa_technician_feedback,
      issueClassification: review.qa_issue_classification ? JSON.parse(review.qa_issue_classification) : null,
    });
  } catch (error) {
    log.error('FinalDecision', 'Error getting decision', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
async function handler(
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

export default withAuth(handler);
