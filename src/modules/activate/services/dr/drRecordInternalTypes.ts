/**
 * DR Record Service — Internal Types
 *
 * Interfaces shared across drRecordService, drRecordInserts, drRecordHelpers.
 * Not re-exported from the public dr service index.
 */

/** Row shape from dr_photo_unified_reviews used during DR processing */
export interface UnifiedRow {
  id: string;
  drop_number: string;
  created_at: string;
  submission_count: number | null;
  submission_history: unknown[] | null;
  wa_message_id: string | null;
  wa_received_at: string | null;
  photo_count: number | null;
  photos_metadata: unknown[] | null;
  vlm_categorization_status: string | null;
  vlm_categorization_results: unknown[] | null;
  feedback_sent: boolean | null;
  feedback_sent_at: string | null;
  submitted_date: string | null;
  onemap_status: string | null;
  step_01_house_photo: boolean | null;
  step_02_cable_from_pole: boolean | null;
  step_03_entry_outside: boolean | null;
  step_04_entry_inside: boolean | null;
  step_05_wall: boolean | null;
  step_06_ont_back: boolean | null;
  step_07_power_meter: boolean | null;
  step_08_final_installation: boolean | null;
  step_09_green_lights: boolean | null;
  step_10_signature: boolean | null;
}

/** Row shape from qa_photo_reviews used during DR processing */
export interface QARow {
  id: string;
  drop_number: string;
  project: string;
  feedback_sent: boolean | null;
  created_at: string;
  whatsapp_message_date: string | null;
  sender_phone: string | null;
}

/** WhatsApp message context passed through the pipeline */
export interface WaContext {
  waMessageId?: string | null;
  waSenderJid?: string | null;
  waOriginalText?: string | null;
  waGroupJid?: string | null;
}
