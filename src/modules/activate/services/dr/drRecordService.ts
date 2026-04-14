/**
 * DR Unified Record Service
 *
 * Manages dr_photo_unified_reviews and qa_photo_reviews for the
 * process-new-dr pipeline:
 * - Existence checks (unified + QA tables)
 * - Idempotency guard (< 60 s duplicate calls)
 * - First-WA-submission detection (pre-existing OES/ack records)
 * - Genuine resubmission with history preservation
 * - sender_phone resolution
 *
 * Insert logic → drRecordInserts.ts
 * Pure helpers  → drRecordHelpers.ts
 * Internal types → drRecordInternalTypes.ts
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('DrRecordService');
import type { ContactData, RecordResolutionResult } from './drProcessTypes';
import { createSubmissionSnapshot, flattenContact } from './drRecordHelpers';
import { insertFromQARecord, insertNewRecord } from './drRecordInserts';
import type { QARow, UnifiedRow, WaContext } from './drRecordInternalTypes';

// Re-export types used by callers
export type { WaContext } from './drRecordInternalTypes';

// ---------------------------------------------------------------------------
// Public query helpers
// ---------------------------------------------------------------------------

/** Check if a unified record exists. Returns the raw row for idempotency/history use. */
export async function checkExistingUnifiedRecord(dropNumber: string): Promise<UnifiedRow | null> {
  const result = await pool.query<UnifiedRow>(
    `SELECT
       id, drop_number, project, photo_count, photos_metadata,
       vlm_categorization_status, vlm_categorization_results, vlm_categorized_at,
       feedback_sent, feedback_sent_at, submission_count, submission_history,
       step_01_house_photo, step_02_cable_from_pole, step_03_entry_outside,
       step_04_entry_inside, step_05_wall, step_06_ont_back,
       step_07_power_meter, step_08_final_installation, step_09_green_lights,
       step_10_signature, step_11_dome_joint_open, step_12_dome_joint_closed,
       submitted_date, created_at, wa_message_id,
       wa_received_at, onemap_status
     FROM dr_photo_unified_reviews
     WHERE drop_number = $1`,
    [dropNumber]
  );
  return result.rows.length > 0 ? (result.rows[0] ?? null) : null;
}

/** Check qa_photo_reviews across relevant shared projects. */
export async function checkExistingQARecord(
  dropNumber: string,
  project?: string
): Promise<QARow | null> {
  const sharedProjects = ['Lawley', 'Mohadin', 'Mamelodi'];
  const projectsToCheck =
    project && sharedProjects.includes(project)
      ? sharedProjects
      : project
      ? [project]
      : sharedProjects;

  const placeholders = projectsToCheck.map((_, i) => `$${i + 2}`).join(',');
  const result = await pool.query<QARow>(
    `SELECT id, drop_number, project, feedback_sent, created_at, whatsapp_message_date, sender_phone
     FROM qa_photo_reviews
     WHERE drop_number = $1 AND project IN (${placeholders})`,
    [dropNumber, ...projectsToCheck]
  );
  return result.rows.length > 0 ? (result.rows[0] ?? null) : null;
}

/** Resolve sender_phone: body > qa_photo_reviews > wa_monitor_drops */
export async function resolveSenderPhone(
  dropNumber: string,
  bodyPhone: string | undefined,
  qaPhone: string | null | undefined
): Promise<string | null> {
  if (bodyPhone) return bodyPhone;
  if (qaPhone) return qaPhone;

  const waDropResult = await pool.query<{ sender_phone: string }>(
    `SELECT sender_phone FROM wa_monitor_drops
     WHERE drop_number = $1 AND sender_phone IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [dropNumber]
  );

  if (waDropResult.rows[0]?.sender_phone) {
    log.info(`Resolved sender_phone from wa_monitor_drops for ${dropNumber}: ${waDropResult.rows[0].sender_phone}`);
    return waDropResult.rows[0].sender_phone;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Non-destructive COALESCE update (idempotency + first-WA paths)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main resolution entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the unified record state for a DR and apply the appropriate DB write.
 * Returns isResubmission, submissionCount, and previousSubmission snapshot.
 */
export async function resolveUnifiedRecord(params: {
  dropNumber: string;
  submittedDateStr: string;
  project: string | null;
  expectedProject: string | null;
  senderPhone: string | null;
  wa: WaContext;
  contact: ContactData;
  existingUnified: UnifiedRow | null;
  existingQA: QARow | null;
}): Promise<RecordResolutionResult> {
  const {
    dropNumber, submittedDateStr, project, expectedProject,
    senderPhone, wa, contact, existingUnified, existingQA,
  } = params;

  if (existingUnified) {
    return handleExistingUnified({
      dropNumber, submittedDateStr, project, expectedProject,
      senderPhone, wa, contact, record: existingUnified,
    });
  }

  if (existingQA) {
    await insertFromQARecord({ dropNumber, project, senderPhone, wa, contact, qaRecord: existingQA });
    return { isResubmission: false, submissionCount: 1, previousSubmission: null };
  }

  await insertNewRecord({ dropNumber, submittedDateStr, project, senderPhone, wa, contact });
  log.info(`Created/updated record for ${dropNumber}`, {
    hasWaContext: !!(wa.waMessageId && wa.waSenderJid),
    hasContactInfo: !!(contact.subscriberContact || contact.qContactInfo),
  });
  return { isResubmission: false, submissionCount: 1, previousSubmission: null };
}

// ---------------------------------------------------------------------------
// Private: handle existing unified record
// ---------------------------------------------------------------------------

async function handleExistingUnified(p: {
  dropNumber: string;
  submittedDateStr: string;
  project: string | null;
  expectedProject: string | null;
  senderPhone: string | null;
  wa: WaContext;
  contact: ContactData;
  record: UnifiedRow;
}): Promise<RecordResolutionResult> {
  const { dropNumber, submittedDateStr, project, expectedProject, senderPhone, wa, contact, record } = p;
  const ageSeconds = (Date.now() - new Date(record.created_at).getTime()) / 1000;

  // Idempotency guard: < 60 s → not a real resubmission
  if (ageSeconds < 60) {
    log.info(`Idempotency guard: ${dropNumber} unified record is only ${ageSeconds.toFixed(1)}s old`, {
      submissionCount: record.submission_count, createdAt: record.created_at,
    });
    await updateUnifiedRecordNonDestructive(
      dropNumber, submittedDateStr, project ?? expectedProject ?? null, senderPhone, wa, contact
    );
    return { isResubmission: false, submissionCount: record.submission_count ?? 1, previousSubmission: null };
  }

  // First real WA submission on a pre-existing (OES/ack-created) record
  if (!record.wa_message_id && !record.wa_received_at) {
    log.info(`First WA submission for pre-existing record ${dropNumber}`, {
      ageSeconds: ageSeconds.toFixed(1),
      createdBy: record.onemap_status ? 'dr-acknowledgment' : 'oes-import',
      submissionCount: record.submission_count,
    });
    await updateUnifiedRecordNonDestructive(
      dropNumber, submittedDateStr, project ?? expectedProject ?? null, senderPhone, wa, contact
    );
    return { isResubmission: false, submissionCount: record.submission_count ?? 1, previousSubmission: null };
  }

  // Genuine resubmission: record already has WA context
  const submissionCount = (record.submission_count ?? 1) + 1;
  const previousSubmission = createSubmissionSnapshot(record, record.submission_count ?? 1);
  const updatedHistory = [...(record.submission_history ?? []), previousSubmission];
  const c = flattenContact(contact);

  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       submission_count = $1,
       submission_history = $2,
       last_resubmitted_at = NOW(),
       resubmitted_by = 'manual_entry',
       submitted_date = COALESCE(submitted_date, $19::DATE),
       project = COALESCE($3, project),
       wa_message_id = COALESCE($5, wa_message_id),
       wa_sender_jid = COALESCE($6, wa_sender_jid),
       wa_original_text = COALESCE($7, wa_original_text),
       wa_group_jid = COALESCE($8, wa_group_jid),
       wa_received_at = CASE WHEN $5 IS NOT NULL THEN NOW() ELSE wa_received_at END,
       is_oes_only = FALSE,
       sender_phone = COALESCE($18, sender_phone),
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
     WHERE drop_number = $4`,
    [
      submissionCount, JSON.stringify(updatedHistory), project ?? null, dropNumber,
      wa.waMessageId ?? null, wa.waSenderJid ?? null,
      wa.waOriginalText ?? null, wa.waGroupJid ?? null,
      c.subscriber_name, c.subscriber_phone, c.subscriber_email,
      c.subscriber_language, c.signup_agent, c.installer_name,
      c.qcontact_name, c.qcontact_phone, c.qcontact_email,
      senderPhone, submittedDateStr,
    ]
  );

  log.info(`Resubmission detected for ${dropNumber}`, {
    submissionCount,
    previousPhotoCount: previousSubmission.photo_count,
    hadFeedback: previousSubmission.feedback_sent,
  });

  return { isResubmission: true, submissionCount, previousSubmission };
}
