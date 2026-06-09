import pool from '@/lib/db';
import { log } from '@/lib/logger';

const MODULE = 'FeedbackSendService';

export interface SendResult {
  success: boolean;
  messageId?: string;
}

export async function sendPrivateToTech(
  techJid: string,
  message: string,
  context: { dropNumber: string; project: string | null }
): Promise<SendResult> {
  try {
    const waFeedbackUrl = process.env.WA_FEEDBACK_URL ?? 'http://100.96.203.105:8092';
    const response = await fetch(`${waFeedbackUrl}/send-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: techJid, message }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      log.error('wa-feedback API error', { status: response.status, err }, MODULE);
      return { success: false };
    }

    const data = (await response.json()) as { success?: boolean; messageId?: string };
    log.info('Private WA sent', { dropNumber: context.dropNumber }, MODULE);
    return { success: data.success !== false, messageId: data.messageId };
  } catch (err) {
    log.error('sendPrivateToTech failed', { err: String(err), dropNumber: context.dropNumber }, MODULE);
    return { success: false };
  }
}

export async function markAutoFeedbackSent(
  dropNumber: string,
  message: string,
  sentMessageId?: string
): Promise<void> {
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       feedback_sent = true,
       feedback_message = $1,
       feedback_sent_at = NOW(),
       auto_feedback_sent_at = NOW(),
       human_review_status = 'completed',
       human_review_completed_at = NOW(),
       qa_decision_by = COALESCE(qa_decision_by, 'system:auto-feedback'),
       wa_message_id = COALESCE(wa_message_id, $3),
       updated_at = NOW()
     WHERE drop_number = $2`,
    [message, dropNumber, sentMessageId ?? null]
  );
}

export async function markAutoFeedbackSkipped(
  dropNumber: string,
  reason: string
): Promise<void> {
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET auto_feedback_skip_reason = $1, updated_at = NOW()
     WHERE drop_number = $2`,
    [reason, dropNumber]
  );
}
