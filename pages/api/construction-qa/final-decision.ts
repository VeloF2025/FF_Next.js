/**
 * POST /api/construction-qa/final-decision
 *
 * Phase 4: Record final QA decision (PASS / FAIL / REWORK_NEEDED)
 * Optionally triggers WhatsApp feedback in the same request.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  // Authenticated user is the decision-maker — not caller-supplied
  const authReq = req as AuthenticatedNextApiRequest;
  const decidedBy = authReq.user?.name || authReq.user?.email || 'unknown';

  try {
    const {
      reviewId,
      decision,
      reasonCodes = [],
      notes = '',
      sendFeedback = false,
    } = req.body;

    if (!reviewId || !decision) {
      return apiResponse.badRequest(res, 'reviewId and decision are required');
    }

    const validDecisions = ['PASS', 'FAIL', 'REWORK_NEEDED'];
    if (!validDecisions.includes(decision)) {
      return apiResponse.badRequest(res, `decision must be one of: ${validDecisions.join(', ')}`);
    }

    // Map decision to workflow status
    const statusMap: Record<string, string> = {
      PASS: 'approved',
      FAIL: 'rejected',
      REWORK_NEEDED: 'rework_needed',
    };
    const newStatus = statusMap[decision];

    // Require notes for FAIL and REWORK_NEEDED
    if ((decision === 'FAIL' || decision === 'REWORK_NEEDED') && !notes.trim()) {
      return apiResponse.badRequest(res, 'Notes are required for FAIL and REWORK_NEEDED decisions');
    }

    // Build the snapshot for rework tracking
    const currentReview = await sql`
      SELECT workflow_status, photo_count, vlm_confidence, qa_decision, qa_notes
      FROM construction_qa_reviews WHERE id = ${reviewId}::uuid LIMIT 1
    `;

    if (currentReview.length === 0) {
      return apiResponse.notFound(res, 'Review', reviewId);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = currentReview[0]!;
    const snapshot = {
      captured_at: new Date().toISOString(),
      workflow_status: row.workflow_status,
      photo_count: Number(row.photo_count),
      vlm_confidence: row.vlm_confidence ? Number(row.vlm_confidence) : null,
      qa_decision: row.qa_decision,
      qa_notes: row.qa_notes,
      reason_codes: reasonCodes,
    };

    // Update the review
    await sql`
      UPDATE construction_qa_reviews
      SET workflow_status = ${newStatus},
          qa_decision = ${decision},
          qa_decision_at = NOW(),
          qa_decision_by = ${decidedBy},
          qa_reason_code = ${reasonCodes.length > 0 ? reasonCodes[0] : null},
          qa_notes = ${notes || null},
          rework_count = CASE WHEN ${decision} = 'REWORK_NEEDED' THEN rework_count + 1 ELSE rework_count END,
          resubmission_snapshots = COALESCE(resubmission_snapshots, '[]'::jsonb) || ${JSON.stringify(snapshot)}::jsonb,
          updated_at = NOW()
      WHERE id = ${reviewId}::uuid
    `;

    // Log activity
    await sql`
      INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
      VALUES (
        ${reviewId}::uuid,
        'decision_made',
        ${decidedBy},
        ${JSON.stringify({ decision, reason_codes: reasonCodes, notes })}::jsonb
      )
    `;

    // Send WhatsApp feedback if requested
    let waSent = false;
    let waError: string | undefined;

    if (sendFeedback && (decision === 'FAIL' || decision === 'REWORK_NEEDED')) {
      try {
        const reviewDetails = await sql`
          SELECT r.feature_id, r.discipline, r.wa_group_jid, r.wa_technician_phone,
                 p.project_name
          FROM construction_qa_reviews r
          JOIN projects p ON p.id = r.project_id
          WHERE r.id = ${reviewId}::uuid
        `;

        if (reviewDetails.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const detail = reviewDetails[0]!;
          const message = buildFeedbackMessage(
            detail.project_name as string,
            detail.feature_id as string,
            detail.discipline as string,
            decision,
            reasonCodes,
            notes,
          );

          await sql`
            UPDATE construction_qa_reviews
            SET wa_feedback_sent_at = NOW(),
                wa_feedback_message = ${message}
            WHERE id = ${reviewId}::uuid
          `;

          waSent = true;
          log.info('WhatsApp feedback recorded', { module: 'construction-qa', reviewId });
        }
      } catch (waErr) {
        waError = (waErr as Error).message;
        log.error('WhatsApp feedback failed', { module: 'construction-qa', error: waError });
      }
    }

    // Push QA notes back to QField GPKG (async, non-blocking)
    let qfieldPushed = false;
    if (decision === 'FAIL' || decision === 'REWORK_NEEDED') {
      try {
        const pushUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/api/construction-qa/push-qfield-comment`;
        fetch(pushUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: req.headers.cookie || '',
          },
          body: JSON.stringify({ reviewId }),
        }).catch(err => {
          log.warn('QField push-back fire-and-forget failed', { module: 'construction-qa', error: String(err) });
        });
        qfieldPushed = true;
      } catch (pushErr) {
        log.warn('QField push-back failed', { module: 'construction-qa', error: (pushErr as Error).message });
      }
    }

    return apiResponse.success(res, {
      reviewId,
      decision,
      waSent,
      waError,
      qfieldPushed,
    });
  } catch (error) {
    log.error('Final decision error', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));

function buildFeedbackMessage(
  projectName: string,
  featureId: string,
  discipline: string,
  decision: string,
  reasonCodes: string[],
  notes: string,
): string {
  const emoji = decision === 'FAIL' ? '\u274c' : '\u26a0\ufe0f';
  const action = decision === 'FAIL' ? 'REJECTED' : 'REWORK NEEDED';

  let msg = `${emoji} *Construction QA — ${action}*\n\n`;
  msg += `*Project:* ${projectName}\n`;
  msg += `*Feature:* ${featureId}\n`;
  msg += `*Discipline:* ${discipline}\n\n`;

  if (reasonCodes.length > 0) {
    msg += `*Issues:*\n`;
    reasonCodes.forEach(code => {
      msg += `\u2022 ${code.replace(/_/g, ' ').toLowerCase()}\n`;
    });
    msg += '\n';
  }

  if (notes) {
    msg += `*Notes:* ${notes}\n\n`;
  }

  msg += `Please address the issues and resubmit photos.`;
  return msg;
}
