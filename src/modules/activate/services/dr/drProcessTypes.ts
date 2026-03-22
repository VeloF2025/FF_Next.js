/**
 * DR Processing — Shared Types
 *
 * All interfaces used across the DR processing pipeline.
 * Extracted from pages/api/activate/process-new-dr.ts.
 */

export interface ProcessNewDrRequest {
  dropNumber: string;
  project?: string;
  /** Date when DR was submitted (YYYY-MM-DD), defaults to today */
  submittedDate?: string;
  /** Only fetch photos, skip VLM categorization */
  skipCategorization?: boolean;
  /** Phone number of sender (from WA Monitor) */
  senderPhone?: string;
  /** Original WhatsApp message ID (stanza ID) */
  waMessageId?: string;
  /** Sender JID (may be LID format) */
  waSenderJid?: string;
  /** Original message text */
  waOriginalText?: string;
  /** WhatsApp group JID */
  waGroupJid?: string;
}

export interface PreviousSubmission {
  submission_number: number;
  snapshot_at: string;
  photo_count: number;
  photos_metadata: unknown[];
  vlm_categorization_status: string | null;
  vlm_categorization_results: unknown[];
  feedback_sent: boolean;
  feedback_sent_at: string | null;
  step_completion: Record<string, boolean>;
}

export interface PreviousSubmissionWithDate extends PreviousSubmission {
  submitted_date?: string | null;
}

export interface ProcessNewDrResponse {
  dropNumber: string;
  photosDownloaded: number;
  categorizationStatus: string;
  processingTimeMs: number;
  isResubmission?: boolean;
  submissionCount?: number;
  previousSubmission?: PreviousSubmission | null;
  dropsTableMatch?: boolean;
  projectMismatch?: boolean;
  expectedProject?: string | null;
}

export interface DropsTableRecord {
  id: string;
  drop_number: string;
  project_id: string;
  project_name: string;
}

export interface SubscriberContact {
  subscriber_name: string | null;
  subscriber_phone: string | null;
  subscriber_email: string | null;
  subscriber_language: string | null;
  signup_agent: string | null;
  installer_name: string | null;
}

export interface QContactInfo {
  qcontact_name: string | null;
  qcontact_phone: string | null;
  qcontact_email: string | null;
}

export interface ContactData {
  subscriberContact: SubscriberContact | null;
  qContactInfo: QContactInfo | null;
}

/** Flat contact fields for SQL UPDATE/INSERT params */
export interface ContactFields {
  subscriber_name: string | null;
  subscriber_phone: string | null;
  subscriber_email: string | null;
  subscriber_language: string | null;
  signup_agent: string | null;
  installer_name: string | null;
  qcontact_name: string | null;
  qcontact_phone: string | null;
  qcontact_email: string | null;
}

/** Result of the unified record resolution step */
export interface RecordResolutionResult {
  isResubmission: boolean;
  submissionCount: number;
  previousSubmission: PreviousSubmission | null;
}
