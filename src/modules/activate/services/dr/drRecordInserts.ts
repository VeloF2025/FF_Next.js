/**
 * DR Record Insert Helpers
 *
 * Low-level UPSERT functions for dr_photo_unified_reviews.
 * Handles the two insert paths:
 * - From an existing qa_photo_reviews record (migration path)
 * - Brand-new DR (first submission)
 *
 * Separated from drRecordService.ts to keep files under 300 lines.
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import type { ContactData } from './drProcessTypes';
import type { QARow, WaContext } from './drRecordInternalTypes';
import { flattenContact } from './drRecordHelpers';

/** ON CONFLICT clause shared by both insert paths */
const UPSERT_ON_CONFLICT = `
  ON CONFLICT (drop_number) DO UPDATE SET
    project = COALESCE(EXCLUDED.project, dr_photo_unified_reviews.project),
    submission_count = COALESCE(dr_photo_unified_reviews.submission_count, 1),
    submitted_date = COALESCE(EXCLUDED.submitted_date, dr_photo_unified_reviews.submitted_date),
    sender_phone = COALESCE(EXCLUDED.sender_phone, dr_photo_unified_reviews.sender_phone),
    wa_message_id = COALESCE(EXCLUDED.wa_message_id, dr_photo_unified_reviews.wa_message_id),
    wa_sender_jid = COALESCE(EXCLUDED.wa_sender_jid, dr_photo_unified_reviews.wa_sender_jid),
    wa_original_text = COALESCE(EXCLUDED.wa_original_text, dr_photo_unified_reviews.wa_original_text),
    wa_group_jid = COALESCE(EXCLUDED.wa_group_jid, dr_photo_unified_reviews.wa_group_jid),
    wa_received_at = CASE WHEN EXCLUDED.wa_message_id IS NOT NULL THEN NOW() ELSE dr_photo_unified_reviews.wa_received_at END,
    auto_qa_eligible_at = CASE WHEN EXCLUDED.wa_message_id IS NOT NULL THEN NOW() + INTERVAL '30 minutes' ELSE dr_photo_unified_reviews.auto_qa_eligible_at END,
    is_oes_only = FALSE,
    subscriber_name = COALESCE(EXCLUDED.subscriber_name, dr_photo_unified_reviews.subscriber_name),
    subscriber_phone = COALESCE(EXCLUDED.subscriber_phone, dr_photo_unified_reviews.subscriber_phone),
    subscriber_email = COALESCE(EXCLUDED.subscriber_email, dr_photo_unified_reviews.subscriber_email),
    subscriber_language = COALESCE(EXCLUDED.subscriber_language, dr_photo_unified_reviews.subscriber_language),
    signup_agent = COALESCE(EXCLUDED.signup_agent, dr_photo_unified_reviews.signup_agent),
    installer_name = COALESCE(EXCLUDED.installer_name, dr_photo_unified_reviews.installer_name),
    qcontact_name = COALESCE(EXCLUDED.qcontact_name, dr_photo_unified_reviews.qcontact_name),
    qcontact_phone = COALESCE(EXCLUDED.qcontact_phone, dr_photo_unified_reviews.qcontact_phone),
    qcontact_email = COALESCE(EXCLUDED.qcontact_email, dr_photo_unified_reviews.qcontact_email),
    updated_at = NOW()`;

/**
 * Insert a unified record based on an existing qa_photo_reviews row.
 * Uses the WhatsApp message date from the QA record as the submitted_date.
 * Preserves the original created_at timestamp.
 */
export async function insertFromQARecord(p: {
  dropNumber: string;
  project: string | null;
  senderPhone: string | null;
  wa: WaContext;
  contact: ContactData;
  qaRecord: QARow;
}): Promise<void> {
  const { dropNumber, project, senderPhone, wa, contact, qaRecord } = p;
  const qaSubmittedDate = qaRecord.whatsapp_message_date ?? qaRecord.created_at;
  const qaSubmittedDateStr = new Date(qaSubmittedDate).toISOString().split('T')[0];
  const originalCreatedAt = qaRecord.created_at;
  const c = flattenContact(contact);

  log.info(`Inserting from QA record for ${dropNumber} in ${qaRecord.project}`, {
    whatsapp_message_date: qaRecord.whatsapp_message_date,
    using_date: qaSubmittedDateStr,
    original_created_at: originalCreatedAt,
  }, 'DrRecordInserts');


  const initialHistory = JSON.stringify([
    {
      submission_number: 0,
      snapshot_at: qaRecord.created_at,
      whatsapp_message_date: qaRecord.whatsapp_message_date,
      sender_phone: senderPhone,
      photo_count: 0,
      photos_metadata: [],
      vlm_categorization_status: null,
      vlm_categorization_results: [],
      feedback_sent: qaRecord.feedback_sent ?? false,
      feedback_sent_at: null,
      step_completion: {},
      note: `Originally submitted via WhatsApp to ${qaRecord.project}`,
    },
  ]);

  await pool.query(
    `INSERT INTO dr_photo_unified_reviews (
       drop_number, project, submission_count, submitted_date, sender_phone,
       wa_message_id, wa_sender_jid, wa_original_text, wa_group_jid, wa_received_at,
       created_at, updated_at, submission_history, is_oes_only,
       subscriber_name, subscriber_phone, subscriber_email, subscriber_language,
       signup_agent, installer_name,
       qcontact_name, qcontact_phone, qcontact_email,
       auto_qa_eligible_at
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, NOW(), $9, $9, $10, FALSE,
       $11, $12, $13, $14, $15, $16, $17, $18, $19,
       NOW() + INTERVAL '30 minutes')
    ${UPSERT_ON_CONFLICT}`,
    [
      dropNumber,
      project ?? qaRecord.project,
      qaSubmittedDateStr,
      senderPhone,
      wa.waMessageId ?? null,
      wa.waSenderJid ?? null,
      wa.waOriginalText ?? null,
      wa.waGroupJid ?? null,
      originalCreatedAt,
      initialHistory,
      c.subscriber_name,
      c.subscriber_phone,
      c.subscriber_email,
      c.subscriber_language,
      c.signup_agent,
      c.installer_name,
      c.qcontact_name,
      c.qcontact_phone,
      c.qcontact_email,
    ]
  );
}

/**
 * Insert a brand-new unified record.
 * Uses UPSERT to handle concurrent inserts from dr-acknowledgment or OES imports.
 */
export async function insertNewRecord(p: {
  dropNumber: string;
  submittedDateStr: string;
  project: string | null;
  senderPhone: string | null;
  wa: WaContext;
  contact: ContactData;
}): Promise<void> {
  const { dropNumber, submittedDateStr, project, senderPhone, wa, contact } = p;
  const c = flattenContact(contact);

  await pool.query(
    `INSERT INTO dr_photo_unified_reviews (
       drop_number, project, submission_count, submitted_date, sender_phone,
       wa_message_id, wa_sender_jid, wa_original_text, wa_group_jid, wa_received_at,
       created_at, updated_at, is_oes_only,
       subscriber_name, subscriber_phone, subscriber_email, subscriber_language,
       signup_agent, installer_name,
       qcontact_name, qcontact_phone, qcontact_email,
       auto_qa_eligible_at
     )
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW(), FALSE,
       $9, $10, $11, $12, $13, $14, $15, $16, $17,
       NOW() + INTERVAL '30 minutes')
    ${UPSERT_ON_CONFLICT}`,
    [
      dropNumber,
      project ?? null,
      submittedDateStr,
      senderPhone,
      wa.waMessageId ?? null,
      wa.waSenderJid ?? null,
      wa.waOriginalText ?? null,
      wa.waGroupJid ?? null,
      c.subscriber_name,
      c.subscriber_phone,
      c.subscriber_email,
      c.subscriber_language,
      c.signup_agent,
      c.installer_name,
      c.qcontact_name,
      c.qcontact_phone,
      c.qcontact_email,
    ]
  );
}
