/**
 * DR Record Update Helpers
 *
 * Non-destructive COALESCE update for dr_photo_unified_reviews, used by the
 * idempotency (<60s duplicate) and first-WA-submission paths in
 * drRecordService.ts. Split out to keep drRecordService.ts under the file-size
 * limit (mirrors the insert split in drRecordInserts.ts).
 */

import pool from '@/lib/db';
import type { ContactData } from './drProcessTypes';
import type { WaContext } from './drRecordInternalTypes';
import { flattenContact } from './drRecordHelpers';

/**
 * COALESCE-based update that never overwrites existing values with NULL.
 * Marks the record as a real WA submission (is_oes_only = FALSE) and stamps
 * wa_received_at only when a WhatsApp message id is present.
 */
export async function updateUnifiedRecordNonDestructive(
  dropNumber: string,
  submittedDateStr: string,
  project: string | null,
  senderPhone: string | null,
  wa: WaContext,
  contact: ContactData
): Promise<void> {
  const c = flattenContact(contact);
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       submitted_date = COALESCE(submitted_date, $2::DATE),
       project = COALESCE($3, project),
       wa_message_id = COALESCE($4, wa_message_id),
       wa_sender_jid = COALESCE($5, wa_sender_jid),
       wa_original_text = COALESCE($6, wa_original_text),
       wa_group_jid = COALESCE($7, wa_group_jid),
       wa_received_at = CASE WHEN $4 IS NOT NULL THEN NOW() ELSE wa_received_at END,
       sender_phone = COALESCE($8, sender_phone),
       is_oes_only = FALSE,
       subscriber_name = COALESCE($9, subscriber_name),
       subscriber_phone = COALESCE($10, subscriber_phone),
       subscriber_email = COALESCE($11, subscriber_email),
       subscriber_language = COALESCE($12, subscriber_language),
       signup_agent = COALESCE($13, signup_agent),
       installer_name = COALESCE($14, installer_name),
       qcontact_name = COALESCE($15, qcontact_name),
       qcontact_phone = COALESCE($16, qcontact_phone),
       qcontact_email = COALESCE($17, qcontact_email),
       updated_at = NOW()
     WHERE drop_number = $1`,
    [
      dropNumber, submittedDateStr, project,
      wa.waMessageId ?? null, wa.waSenderJid ?? null,
      wa.waOriginalText ?? null, wa.waGroupJid ?? null,
      senderPhone,
      c.subscriber_name, c.subscriber_phone, c.subscriber_email,
      c.subscriber_language, c.signup_agent, c.installer_name,
      c.qcontact_name, c.qcontact_phone, c.qcontact_email,
    ]
  );
}
