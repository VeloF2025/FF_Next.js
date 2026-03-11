/**
 * Convenience logging functions for specific event types
 */

import { log } from '@/lib/logger';
import { logActivity } from './coreLogger';
import { getDb } from './_shared';

/**
 * Log WhatsApp submission
 */
export async function logWhatsAppSubmission(
  drNumber: string,
  sender: string,
  group: string,
  messageId?: string
): Promise<string> {
  return logActivity(drNumber, 'whatsapp_submitted', { sender, group, messageId }, 'whatsapp-bridge');
}

/**
 * Log DR acknowledgment
 */
export async function logAcknowledgment(
  drNumber: string,
  photoCount: number,
  ontSerial?: string,
  upsSerial?: string
): Promise<string> {
  return logActivity(
    drNumber,
    'dr_acknowledged',
    { photoCount, ontSerial, upsSerial },
    'whatsapp-bridge'
  );
}

/**
 * Log photos fetched
 */
export async function logPhotosFetched(
  drNumber: string,
  source: string,
  count: number
): Promise<string> {
  return logActivity(drNumber, 'photos_fetched', { source, count }, 'onemap-api');
}

/**
 * Log photos synced (when new photos are downloaded from 1Map)
 */
export async function logPhotosSynced(
  drNumber: string,
  previousCount: number,
  newCount: number,
  source: string = '1Map',
  trigger: string = 'user'
): Promise<string> {
  return logActivity(
    drNumber,
    'PHOTOS_SYNCED',
    {
      previousCount,
      newCount,
      newPhotos: newCount - previousCount,
      source,
      trigger,
    },
    trigger === 'user' ? 'user' : 'system'
  );
}

/**
 * Log attribute categorization
 */
export async function logAttributeCategorization(
  drNumber: string,
  total: number,
  categorized: number,
  needsVlm: number,
  processingTimeMs: number
): Promise<string> {
  return logActivity(
    drNumber,
    'attribute_categorized',
    { total, categorized, needsVlm, processingTimeMs },
    'step-mapper'
  );
}

/**
 * Log VLM QA started
 */
export async function logVlmQaStarted(drNumber: string, photoCount: number): Promise<string> {
  return logActivity(drNumber, 'vlm_qa_started', { photoCount }, 'qwen3-vl');
}

/**
 * Log VLM QA completed
 */
export async function logVlmQaCompleted(
  drNumber: string,
  total: number,
  passed: number,
  passRate: number,
  processingTimeMs: number
): Promise<string> {
  return logActivity(
    drNumber,
    'vlm_qa_completed',
    { total, passed, passRate, processingTimeMs },
    'qwen3-vl'
  );
}

/**
 * Log VLM QA failed
 */
export async function logVlmQaFailed(drNumber: string, error: string): Promise<string> {
  return logActivity(drNumber, 'vlm_qa_failed', { error }, 'qwen3-vl');
}

/**
 * Log human review started
 */
export async function logHumanReviewStarted(drNumber: string, userId: string): Promise<string> {
  return logActivity(drNumber, 'human_review_started', {}, userId);
}

/**
 * Log human review completed
 */
export async function logHumanReviewCompleted(
  drNumber: string,
  userId: string,
  approved: number,
  rejected: number
): Promise<string> {
  // Look up the user's name for display
  let reviewerName = 'unknown';
  try {
    const sql = getDb();
    const userRows = await sql`
      SELECT first_name, last_name FROM users WHERE id = ${userId}::uuid
    `;
    const firstRow = userRows[0];
    if (firstRow && (firstRow.first_name || firstRow.last_name)) {
      reviewerName = [firstRow.first_name, firstRow.last_name].filter(Boolean).join(' ');
    }
  } catch (err) {
    log.warn(`Could not look up user name for ${userId}: ${err}`, undefined, 'ActivityLog');
  }

  return logActivity(
    drNumber,
    'human_review_completed',
    { reviewer: reviewerName, reviewerId: userId, approved, rejected },
    userId
  );
}

/**
 * Log step approval
 */
export async function logStepApproval(
  drNumber: string,
  step: number,
  stepLabel: string,
  userId: string
): Promise<string> {
  return logActivity(drNumber, 'step_approved', { step, stepLabel }, userId);
}

/**
 * Log step rejection
 */
export async function logStepRejection(
  drNumber: string,
  step: number,
  stepLabel: string,
  reason: string,
  userId: string
): Promise<string> {
  return logActivity(drNumber, 'step_rejected', { step, stepLabel, reason }, userId);
}

/**
 * Log feedback generated
 */
export async function logFeedbackGenerated(drNumber: string, feedbackLength: number): Promise<string> {
  return logActivity(drNumber, 'feedback_generated', { feedbackLength }, 'feedback-agent');
}

/**
 * Log feedback sent
 */
export async function logFeedbackSent(drNumber: string, group: string, messageId?: string): Promise<string> {
  return logActivity(drNumber, 'feedback_sent', { group, messageId }, 'whatsapp-sender');
}

/**
 * Log error
 */
export async function logError(drNumber: string, message: string, details?: unknown): Promise<string> {
  return logActivity(drNumber, 'error', { message, details }, 'error-handler');
}

/**
 * Log ONT swap reported via WhatsApp pre-provision group
 */
export async function logOntSwapReported(
  drNumber: string,
  oldSerial: string | null,
  newSerial: string,
  swapType: string,
  senderName: string
): Promise<string> {
  return logActivity(
    drNumber,
    'ONT_SWAP_REPORTED',
    { oldSerial, newSerial, swapType, reportedBy: senderName },
    'whatsapp-bridge'
  );
}
