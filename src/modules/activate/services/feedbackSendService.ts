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
      const err = await response
        .json()
        .catch((parseErr: unknown) => ({ parseError: String(parseErr) }));
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
  // The `AND auto_feedback_sent_at IS NULL` guard makes this idempotent: if a
  // prior tick already stamped the row (an overlapping run, or a retry after a
  // transient mark failure), the second call is a no-op instead of re-stamping.
  // The eligible query already excludes stamped rows, so this is defence in
  // depth against a duplicate technician message.
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
     WHERE drop_number = $2
       AND auto_feedback_sent_at IS NULL`,
    [message, dropNumber, sentMessageId ?? null]
  );
}

/**
 * Records a failed WA send attempt. Increments auto_feedback_attempts; once the
 * count reaches `maxAttempts` the DR is parked with skip reason 'wa_send_failed'
 * so the cron stops retrying a permanently-undeliverable JID (dead bridge,
 * invalid recipient) every tick forever. Returns the running attempt count and
 * whether the DR was capped (parked for human handling).
 */
export async function recordAutoFeedbackFailure(
  dropNumber: string,
  maxAttempts: number
): Promise<{ attempts: number; capped: boolean }> {
  const { rows } = await pool.query<{ auto_feedback_attempts: number }>(
    `UPDATE dr_photo_unified_reviews
     SET auto_feedback_attempts = COALESCE(auto_feedback_attempts, 0) + 1,
         updated_at = NOW()
     WHERE drop_number = $1
     RETURNING auto_feedback_attempts`,
    [dropNumber]
  );
  const attempts = rows[0]?.auto_feedback_attempts ?? 0;
  const capped = attempts >= maxAttempts;
  if (capped) {
    await markAutoFeedbackSkipped(dropNumber, 'wa_send_failed');
    log.error(
      `Auto-feedback gave up after ${attempts} failed sends`,
      { dropNumber },
      MODULE
    );
  }
  return { attempts, capped };
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
