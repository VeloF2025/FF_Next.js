/**
 * Ticketing Module - Attachment Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for ticket attachments, photo evidence,
 * and document management via Firebase Storage.
 */

/**
 * File Type Classification
 */
export enum FileType {
  PHOTO = 'photo',
  DOCUMENT = 'document',
  EXCEL = 'excel',
  PDF = 'pdf',
}

/**
 * Ticket Attachment Interface
 * Tracks files attached to tickets (stored in Firebase Storage)
 */
export interface TicketAttachment {
  // Primary identification
  id: string; // UUID
  ticket_id: string; // UUID reference to tickets

  // File information
  filename: string;
  file_type: FileType | null;
  mime_type: string | null;
  file_size: number | null; // Bytes

  // Storage location
  storage_path: string; // Firebase Storage path
  storage_url: string | null; // Public URL

  // Metadata
  uploaded_by: string | null; // UUID reference to users
  uploaded_at: Date;

  // For photo evidence (verification steps)
  verification_step_id: string | null; // UUID reference to verification_steps
  is_evidence: boolean; // Is this file evidence for a verification step?
}

/**
 * Create attachment payload
 */
export interface CreateAttachmentPayload {
  ticket_id: string;
  filename: string;
  file_type?: FileType;
  mime_type?: string;
  file_size?: number;
  storage_path: string;
  storage_url?: string;
  uploaded_by?: string; // User ID
  verification_step_id?: string;
  is_evidence?: boolean;
}

/**
 * Update attachment payload
 */
export interface UpdateAttachmentPayload {
  storage_url?: string;
  file_type?: FileType;
  mime_type?: string;
  file_size?: number;
}

/**
 * File upload request
 */
export interface FileUploadRequest {
  ticket_id: string;
  file: File | Buffer;
  filename: string;
  verification_step_id?: string;
  is_evidence?: boolean;
  uploaded_by: string; // User ID
}

/**
 * File upload result
 */
export interface FileUploadResult {
  attachment_id: string;
  ticket_id: string;
  filename: string;
  storage_url: string;
  storage_path: string;
  file_size: number;
  mime_type: string;
  uploaded_at: Date;
}

/**
 * Attachment filters for listing
 */
export interface AttachmentFilters {
  ticket_id?: string;
  file_type?: FileType | FileType[];
  is_evidence?: boolean;
  verification_step_id?: string;
  uploaded_by?: string;
  uploaded_after?: Date;
  uploaded_before?: Date;
}

/**
 * Attachment list response
 */
export interface AttachmentListResponse {
  attachments: TicketAttachment[];
  total: number;
  total_size_bytes: number;
  by_file_type: Record<FileType, number>;
  evidence_count: number;
}

/**
 * Photo evidence summary
 */
export interface PhotoEvidenceSummary {
  ticket_id: string;
  total_photos: number;
  photos_by_step: Record<number, number>; // step_number -> count
  verified_photos: number;
  unverified_photos: number;
  missing_steps: number[]; // Step numbers without photos
  total_size_mb: number;
}

/**
 * Attachment statistics
 */
export interface AttachmentStatistics {
  total_attachments: number;
  total_size_gb: number;
  by_file_type: Record<FileType, number>;
  evidence_photos: number;
  avg_file_size_mb: number;
  attachments_this_month: number;
}
