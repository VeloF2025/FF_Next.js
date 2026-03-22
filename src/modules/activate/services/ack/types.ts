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
}
