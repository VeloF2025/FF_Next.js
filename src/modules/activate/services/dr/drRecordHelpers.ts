/**
 * DR Record Service — Pure Helpers
 *
 * Stateless helpers shared by drRecordService and drRecordInserts.
 */

import type { ContactData, ContactFields, PreviousSubmissionWithDate } from './drProcessTypes';
import type { UnifiedRow } from './drRecordInternalTypes';

/**
 * Build a point-in-time snapshot of a unified row.
 * Stored in submission_history before overwriting on genuine resubmission.
 */
export function createSubmissionSnapshot(
  record: UnifiedRow,
  submissionNumber: number
): PreviousSubmissionWithDate {
  return {
    submission_number: submissionNumber,
    snapshot_at: new Date().toISOString(),
    submitted_date: record.submitted_date ?? null,
    photo_count: record.photo_count ?? 0,
    photos_metadata: record.photos_metadata ?? [],
    vlm_categorization_status: record.vlm_categorization_status,
    vlm_categorization_results: record.vlm_categorization_results ?? [],
    feedback_sent: record.feedback_sent ?? false,
    feedback_sent_at: record.feedback_sent_at ?? null,
    step_completion: {
      step_01_house_photo: record.step_01_house_photo ?? false,
      step_02_cable_from_pole: record.step_02_cable_from_pole ?? false,
      step_03_entry_outside: record.step_03_entry_outside ?? false,
      step_04_entry_inside: record.step_04_entry_inside ?? false,
      step_05_wall: record.step_05_wall ?? false,
      step_06_ont_back: record.step_06_ont_back ?? false,
      step_07_power_meter: record.step_07_power_meter ?? false,
      step_08_final_installation: record.step_08_final_installation ?? false,
      step_09_green_lights: record.step_09_green_lights ?? false,
      step_10_signature: record.step_10_signature ?? false,
    },
  };
}

/** Flatten ContactData into individual nullable SQL param fields */
export function flattenContact(contact: ContactData): ContactFields {
  return {
    subscriber_name: contact.subscriberContact?.subscriber_name ?? null,
    subscriber_phone: contact.subscriberContact?.subscriber_phone ?? null,
    subscriber_email: contact.subscriberContact?.subscriber_email ?? null,
    subscriber_language: contact.subscriberContact?.subscriber_language ?? null,
    signup_agent: contact.subscriberContact?.signup_agent ?? null,
    installer_name: contact.subscriberContact?.installer_name ?? null,
    qcontact_name: contact.qContactInfo?.qcontact_name ?? null,
    qcontact_phone: contact.qContactInfo?.qcontact_phone ?? null,
    qcontact_email: contact.qContactInfo?.qcontact_email ?? null,
  };
}
