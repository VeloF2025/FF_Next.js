/**
 * POST /api/qfield/qa-actions
 * Execute QA actions: approve, reject, escalate, assign, revalidate
 *
 * HITL corrections are recorded to the VLM learning system when
 * human reviewers disagree with AI validation results.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { recordVlmCorrection } from '@/services/vlmLearningService';
import {
  sendRejectionNotification,
  sendEscalationNotification,
  sendAssignmentNotification,
} from '@/modules/qfield-qa/services/qfieldNotificationService';

const sql = neon(process.env.DATABASE_URL!);

type ActionType = 'approve' | 'reject' | 'escalate' | 'assign' | 'revalidate' | 'comment';

interface ActionRequest {
  action: ActionType;
  validationIds: string[];
  notes?: string;
  // For assign action
  assignee?: string;
  dueDate?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  // For escalate action
  escalationReason?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  try {
    const authReq = req as unknown as AuthenticatedNextApiRequest;
    const userId = authReq.user?.email || 'unknown';
    const { action, validationIds, notes, assignee, dueDate, priority, escalationReason } = req.body as ActionRequest;

    if (!action || !validationIds?.length) {
      return apiResponse.badRequest(res, 'action and validationIds required');
    }

    const validActions: ActionType[] = ['approve', 'reject', 'escalate', 'assign', 'revalidate', 'comment'];
    if (!validActions.includes(action)) {
      return apiResponse.badRequest(res, `Invalid action. Must be one of: ${validActions.join(', ')}`);
    }

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const validationId of validationIds) {
      try {
        // Get current state for audit trail and VLM learning
        const current = await sql`
          SELECT workflow_status, assigned_to, escalation_level, manual_status,
                 vlm_confidence, vlm_feedback, vlm_raw_response, needs_retake,
                 photo_key, work_type, project_id, feature_id
          FROM qfield_photo_validations
          WHERE id = ${validationId}::uuid
        `;

        if (current.length === 0) {
          results.push({ id: validationId, success: false, error: 'Not found' });
          continue;
        }

        const previousValue = current[0]!; // Guaranteed by length check above
        let newValue: Record<string, unknown> = {};

        // Execute action
        switch (action) {
          case 'approve':
            await sql`
              UPDATE qfield_photo_validations
              SET
                manual_status = 'approved',
                manual_reviewed_by = ${userId},
                manual_reviewed_at = NOW(),
                manual_notes = ${notes || null},
                workflow_status = 'approved',
                needs_retake = FALSE
              WHERE id = ${validationId}::uuid
            `;
            newValue = { manual_status: 'approved', workflow_status: 'approved' };

            // Record HITL correction if human disagrees with AI (AI said fail, human approves)
            if (previousValue.vlm_confidence !== null && previousValue.needs_retake) {
              try {
                await recordVlmCorrection({
                  module: 'qfield',
                  analysisType: 'qfield_photo_qa',
                  sourceId: validationId,
                  sourceTable: 'qfield_photo_validations',
                  photoUrl: `/api/qfield/photo-proxy?key=${encodeURIComponent(previousValue.photo_key || '')}`,
                  vlmExtractedValue: 'fail',
                  vlmConfidence: previousValue.vlm_confidence,
                  correctedValue: 'pass',
                  correctionReason: 'interpretation_error',
                  correctionNotes: notes || `Human approved despite AI flagging. Work type: ${previousValue.work_type}`,
                  context: {
                    workType: previousValue.work_type,
                    projectId: previousValue.project_id,
                    featureId: previousValue.feature_id,
                    vlmFeedback: previousValue.vlm_feedback,
                    vlmIssues: previousValue.vlm_raw_response?.issues,
                  },
                  correctedByName: userId,
                });
                log.info('qfield-qa-actions', { validationId }, 'HITL correction recorded: AI fail → Human approve');
              } catch (correctionError) {
                log.error('qfield-qa-actions', { validationId, error: correctionError }, 'Failed to record HITL correction');
              }
            }
            break;

          case 'reject':
            await sql`
              UPDATE qfield_photo_validations
              SET
                manual_status = 'rejected',
                manual_reviewed_by = ${userId},
                manual_reviewed_at = NOW(),
                manual_notes = ${notes || null},
                workflow_status = 'rejected',
                needs_retake = TRUE
              WHERE id = ${validationId}::uuid
            `;
            newValue = { manual_status: 'rejected', workflow_status: 'rejected' };

            // Record HITL correction if human disagrees with AI (AI said pass, human rejects)
            if (previousValue.vlm_confidence !== null && !previousValue.needs_retake) {
              try {
                await recordVlmCorrection({
                  module: 'qfield',
                  analysisType: 'qfield_photo_qa',
                  sourceId: validationId,
                  sourceTable: 'qfield_photo_validations',
                  photoUrl: `/api/qfield/photo-proxy?key=${encodeURIComponent(previousValue.photo_key || '')}`,
                  vlmExtractedValue: 'pass',
                  vlmConfidence: previousValue.vlm_confidence,
                  correctedValue: 'fail',
                  correctionReason: 'interpretation_error',
                  correctionNotes: notes || `Human rejected despite AI passing. Work type: ${previousValue.work_type}`,
                  context: {
                    workType: previousValue.work_type,
                    projectId: previousValue.project_id,
                    featureId: previousValue.feature_id,
                    vlmFeedback: previousValue.vlm_feedback,
                    humanFeedback: notes,
                  },
                  correctedByName: userId,
                });
                log.info('qfield-qa-actions', { validationId }, 'HITL correction recorded: AI pass → Human reject');
              } catch (correctionError) {
                log.error('qfield-qa-actions', { validationId, error: correctionError }, 'Failed to record HITL correction');
              }
            }

            // Send WhatsApp notification (fire-and-forget)
            sendRejectionNotification({
              validationId,
              photoKey: previousValue.photo_key || '',
              projectId: previousValue.project_id,
              notes: notes || undefined,
              sentBy: userId,
            }).catch((err) => {
              log.error('qfield-qa-actions', { validationId, error: err }, 'Failed to send rejection notification');
            });
            break;

          case 'escalate':
            const newLevel = (previousValue.escalation_level || 0) + 1;
            await sql`
              UPDATE qfield_photo_validations
              SET
                escalation_level = ${newLevel},
                escalated_at = NOW(),
                escalation_reason = ${escalationReason || notes || null},
                workflow_status = 'escalated'
              WHERE id = ${validationId}::uuid
            `;
            newValue = { escalation_level: newLevel, workflow_status: 'escalated' };

            // Send WhatsApp notification (fire-and-forget)
            sendEscalationNotification({
              validationId,
              photoKey: previousValue.photo_key || '',
              projectId: previousValue.project_id,
              notes: escalationReason || notes || undefined,
              sentBy: userId,
            }).catch((err) => {
              log.error('qfield-qa-actions', { validationId, error: err }, 'Failed to send escalation notification');
            });
            break;

          case 'assign':
            if (!assignee) {
              results.push({ id: validationId, success: false, error: 'Assignee required' });
              continue;
            }
            await sql`
              UPDATE qfield_photo_validations
              SET
                assigned_to = ${assignee},
                assigned_at = NOW(),
                due_date = ${dueDate || null}::timestamptz,
                priority = ${priority || 'normal'},
                workflow_status = 'in_review'
              WHERE id = ${validationId}::uuid
            `;
            // Also create assignment history record
            await sql`
              INSERT INTO qfield_qa_assignments (
                validation_id, assigned_to, assigned_by, due_date, priority, notes
              ) VALUES (
                ${validationId}::uuid, ${assignee}, ${userId},
                ${dueDate || null}::timestamptz, ${priority || 'normal'}, ${notes || null}
              )
            `;
            newValue = { assigned_to: assignee, workflow_status: 'in_review' };
            break;

          case 'revalidate':
            await sql`
              UPDATE qfield_photo_validations
              SET
                workflow_status = 'pending',
                vlm_confidence = NULL,
                vlm_feedback = NULL,
                vlm_raw_response = NULL,
                validated_at = NULL
              WHERE id = ${validationId}::uuid
            `;
            newValue = { workflow_status: 'pending', vlm_confidence: null };
            break;

          case 'comment':
            // Just add to notes, no status change
            await sql`
              UPDATE qfield_photo_validations
              SET manual_notes = COALESCE(manual_notes || E'\n', '') || ${notes || ''}
              WHERE id = ${validationId}::uuid
            `;
            newValue = { notes_added: notes };
            break;
        }

        // Record action in audit trail
        await sql`
          INSERT INTO qfield_qa_actions (
            validation_id, action_type, action_by, previous_value, new_value, notes
          ) VALUES (
            ${validationId}::uuid,
            ${action},
            ${userId},
            ${JSON.stringify(previousValue)}::jsonb,
            ${JSON.stringify(newValue)}::jsonb,
            ${notes || null}
          )
        `;

        results.push({ id: validationId, success: true });
        log.debug('qfield-qa-actions', { id: validationId, action, userId }, 'Action completed');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ id: validationId, success: false, error: errorMessage });
        log.error('qfield-qa-actions', { id: validationId, action, error: errorMessage }, 'Action failed');
      }
    }

    const successCount = results.filter(r => r.success).length;
    return apiResponse.success(res, {
      action,
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      results,
    }, `${action} completed for ${successCount}/${results.length} items`);
  } catch (error) {
    log.error('qfield-qa-actions', error instanceof Error ? { message: error.message } : { error }, 'Handler error');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
