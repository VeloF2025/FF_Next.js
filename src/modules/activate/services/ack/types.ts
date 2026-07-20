/**
 * Shared types for the DR acknowledgment service layer.
 *
 * These types are used across drLookupService, drStatusService, and ackMessageBuilder.
 */

export interface ExistingSubmission {
  submission_count: number;
  photo_count: number;
  feedback_message: string | null;
  qa_decision: string | null;
}

export interface DuplicateSerialHit {
  drop_number: string;
  type: 'ont' | 'ups' | 'oes';
}

export interface DuplicateSerialResult {
  ontDuplicates: DuplicateSerialHit[];
  upsDuplicates: DuplicateSerialHit[];
}

export interface WAPhotoCheck {
  hasPhoto: boolean;
  photoCount: number;
}

export interface OneMapRecordResponse {
  dr_number: string;
  site?: string;
  site_name?: string;
  status?: string;
  photo_count?: number;
  local_photos?: Array<{ filename: string; type?: string }>;
  ont_barcode?: string | null;
  ups_serial?: string | null;
}

export interface DropsTableRecord {
  drop_number: string;
  pole_number: string | null;
  project_name: string | null;
  project_id: string | null;
}

export interface VlmSerialResult {
  ontSerial: string | null;
  upsSerial: string | null;
  confidence: number;
  ontConfidence?: number;
  upsConfidence?: number;
  // True when the ONT serial was read from a decoded barcode (reliable). When
  // false/absent the read is VLM OCR, which is ~89% false-positive on ONT hex
  // labels, so an ONT/1Map conflict is shown as a soft prompt, not a MISMATCH.
  ontFromBarcode?: boolean;
}

export interface AckResult {
  message: string;
  swapped: boolean;
  swapDetails: string | null;
}

export interface OneMapLookupResult {
  found: boolean;
  photoCount: number;
  ontSerial: string | null;
  upsSerial: string | null;
  /** Live BOSS/1Map lookup errored or timed out — `found:false` is NOT evidence the sign-up is missing. */
  lookupFailed?: boolean;
  /** Set alongside lookupFailed: the DR exists in our synced onemap_properties mirror. */
  mirrorFound?: boolean;
}
