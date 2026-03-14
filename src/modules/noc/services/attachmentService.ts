/**
 * Attachment Service
 * 🟢 WORKING: Production-ready attachment service with VF Storage API
 *
 * Handles file uploads to VF Storage (Velo server port 8091) and attachment record management.
 * Supports photo evidence for verification steps and general document uploads.
 *
 * @see docs/ARCHITECTURE_STORAGE.md for unified storage architecture
 */

import { vfStorage } from '@/services/vfStorageAdapter';
import { query, queryOne } from '../utils/db';
import { createLogger } from '@/lib/logger';
import {
  TicketAttachment,
  CreateAttachmentPayload,
  UpdateAttachmentPayload,
  FileUploadRequest,
  FileUploadResult,
  AttachmentFilters,
  AttachmentListResponse,
  PhotoEvidenceSummary,
  AttachmentStatistics,
  FileType
} from '../types/attachment';

const logger = createLogger({ module: 'AttachmentService' });

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validation options for file uploads
 */
interface ValidationOptions {
  allowedTypes?: string[];
  maxSize?: number; // bytes
}

/**
 * Default allowed MIME types for uploads
 */
const DEFAULT_ALLOWED_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

/**
 * Default maximum file size: 10MB
 */
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

/**
 * Validate file before upload
 * 🟢 WORKING: File validation with type and size checks
 */
export function validateFileUpload(
  file: File,
  options: ValidationOptions = {}
): { valid: boolean; error?: string } {
  const allowedTypes = options.allowedTypes || DEFAULT_ALLOWED_TYPES;
  const maxSize = options.maxSize || DEFAULT_MAX_SIZE;

  // Check file type
  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed: ${allowedTypes.join(', ')}`
    };
  }

  // Check file size
  if (file.size > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File too large. Maximum size: ${maxSizeMB}MB`
    };
  }

  return { valid: true };
}

/**
 * Determine file type from MIME type
 */
function getFileTypeFromMimeType(mimeType: string): FileType {
  if (mimeType.startsWith('image/')) {
    return FileType.PHOTO;
  }
  if (mimeType.startsWith('video/')) {
    return FileType.VIDEO;
  }
  if (mimeType === 'application/pdf') {
    return FileType.PDF;
  }
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
    return FileType.EXCEL;
  }
  return FileType.DOCUMENT;
}

/**
 * Sanitize filename to prevent issues
 */
function sanitizeFileName(fileName: string): string {
  // Get file extension
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.substring(lastDot) : '';

  // Remove special characters, keep only alphanumeric, dash, underscore
  const sanitized = name
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100); // Limit length

  return sanitized + ext;
}

/**
 * Upload file to Velo server storage and create attachment record
 * 🟢 WORKING: Complete upload workflow with validation
 */
export async function uploadAttachment(
  request: FileUploadRequest
): Promise<FileUploadResult> {
  try {
    logger.info('Starting file upload', {
      ticket_id: request.ticket_id,
      filename: request.filename,
      is_evidence: request.is_evidence
    });

    // Validate file
    const validation = validateFileUpload(request.file as File);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Sanitize filename
    const sanitizedFileName = sanitizeFileName(request.filename);

    // Generate unique filename with timestamp to avoid collisions
    const timestamp = Date.now();
    const uniqueFilename = `${timestamp}_${sanitizedFileName}`;

    // Get file buffer from File object
    const file = request.file as File;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to VF Storage API (Velo server port 8091)
    // Path convention: maintenance/attachments/{ticketId}/{filename}
    let uploadResult;
    try {
      uploadResult = await vfStorage.uploadFile(
        buffer,
        'maintenance',
        `attachments/${request.ticket_id}`,
        uniqueFilename
      );
    } catch (error) {
      logger.error('VF Storage upload failed', {
        error,
        ticket_id: request.ticket_id,
        filename: request.filename
      });
      throw new Error('Failed to upload file to VF Storage');
    }

    // Use URL from VF Storage response
    const downloadURL = uploadResult.url;
    const storagePath = uploadResult.path;

    // Determine file type
    const fileType = getFileTypeFromMimeType((request.file as File).type);

    // Create attachment record in database
    const attachmentPayload: CreateAttachmentPayload = {
      ticket_id: request.ticket_id,
      filename: sanitizedFileName,
      file_type: fileType,
      mime_type: (request.file as File).type,
      file_size: (request.file as File).size,
      storage_path: storagePath,
      storage_url: downloadURL,
      uploaded_by: request.uploaded_by,
      verification_step_id: request.verification_step_id,
      is_evidence: request.is_evidence || false
    };

    let attachment;
    try {
      attachment = await createAttachment(attachmentPayload);
    } catch (error) {
      logger.error('Failed to create attachment DB record', {
        error,
        ticket_id: request.ticket_id
      });
      // Note: File is already uploaded to Storage, but DB record failed
      // In production, consider cleanup job or manual intervention
      throw new Error('Failed to create attachment record');
    }

    logger.info('File upload completed successfully', {
      attachment_id: attachment.id,
      ticket_id: request.ticket_id,
      storage_url: downloadURL
    });

    return {
      attachment_id: attachment.id,
      ticket_id: attachment.ticket_id,
      filename: attachment.filename,
      storage_url: downloadURL,
      storage_path: storagePath,
      file_size: (request.file as File).size,
      mime_type: (request.file as File).type,
      uploaded_at: attachment.uploaded_at
    };
  } catch (error) {
    logger.error('Upload attachment failed', {
      error,
      ticket_id: request.ticket_id
    });
    throw error;
  }
}

/**
 * Create attachment record in database
 * 🟢 WORKING: Direct DB record creation
 */
export async function createAttachment(
  payload: CreateAttachmentPayload
): Promise<TicketAttachment> {
  try {
    // Validate required fields
    if (!payload.ticket_id) {
      throw new Error('ticket_id is required');
    }
    if (!payload.filename) {
      throw new Error('filename is required');
    }
    if (!payload.storage_path) {
      throw new Error('storage_path is required');
    }

    logger.info('Creating attachment record', {
      ticket_id: payload.ticket_id,
      filename: payload.filename
    });

    const sql = `
      INSERT INTO maintenance_attachments (
        ticket_id,
        filename,
        file_type,
        mime_type,
        file_size,
        storage_path,
        storage_url,
        uploaded_by,
        verification_step_id,
        is_evidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const attachment = await queryOne<TicketAttachment>(sql, [
      payload.ticket_id,
      payload.filename,
      payload.file_type || null,
      payload.mime_type || null,
      payload.file_size || null,
      payload.storage_path,
      payload.storage_url || null,
      payload.uploaded_by || null,
      payload.verification_step_id || null,
      payload.is_evidence || false
    ]);

    if (!attachment) {
      throw new Error('Failed to create attachment record');
    }

    logger.info('Attachment record created', {
      attachment_id: attachment.id,
      ticket_id: attachment.ticket_id
    });

    return attachment;
  } catch (error) {
    logger.error('Failed to create attachment', {
      error,
      ticket_id: payload.ticket_id
    });
    throw new Error(`Failed to create attachment: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get attachment by ID
 * 🟢 WORKING: Retrieve attachment with UUID validation
 */
export async function getAttachmentById(
  attachmentId: string
): Promise<TicketAttachment | null> {
  try {
    // Validate UUID format
    if (!UUID_REGEX.test(attachmentId)) {
      throw new Error('Invalid attachment ID format');
    }

    const sql = `
      SELECT * FROM maintenance_attachments
      WHERE id = $1
    `;

    const attachment = await queryOne<TicketAttachment>(sql, [attachmentId]);

    if (attachment) {
      logger.debug('Attachment retrieved', { attachment_id: attachmentId });
    }

    return attachment;
  } catch (error) {
    logger.error('Failed to get attachment by ID', {
      error,
      attachment_id: attachmentId
    });
    throw error;
  }
}

/**
 * List attachments for a ticket with optional filters
 * 🟢 WORKING: Multi-criteria filtering and aggregation
 */
export async function listAttachmentsForTicket(
  ticketId: string,
  filters?: AttachmentFilters
): Promise<AttachmentListResponse> {
  try {
    logger.debug('Listing attachments for ticket', {
      ticket_id: ticketId,
      filters
    });

    // Build WHERE clause
    const whereClauses = ['ticket_id = $1'];
    const params: any[] = [ticketId];
    let paramIndex = 2;

    if (filters?.file_type) {
      if (Array.isArray(filters.file_type)) {
        whereClauses.push(`file_type = ANY($${paramIndex})`);
        params.push(filters.file_type);
      } else {
        whereClauses.push(`file_type = $${paramIndex}`);
        params.push(filters.file_type);
      }
      paramIndex++;
    }

    if (filters?.is_evidence !== undefined) {
      whereClauses.push(`is_evidence = $${paramIndex}`);
      params.push(filters.is_evidence);
      paramIndex++;
    }

    if (filters?.verification_step_id) {
      whereClauses.push(`verification_step_id = $${paramIndex}`);
      params.push(filters.verification_step_id);
      paramIndex++;
    }

    if (filters?.uploaded_by) {
      whereClauses.push(`uploaded_by = $${paramIndex}`);
      params.push(filters.uploaded_by);
      paramIndex++;
    }

    if (filters?.uploaded_after) {
      whereClauses.push(`uploaded_at >= $${paramIndex}`);
      params.push(filters.uploaded_after);
      paramIndex++;
    }

    if (filters?.uploaded_before) {
      whereClauses.push(`uploaded_at <= $${paramIndex}`);
      params.push(filters.uploaded_before);
      paramIndex++;
    }

    const whereClause = whereClauses.join(' AND ');

    const sql = `
      SELECT * FROM maintenance_attachments
      WHERE ${whereClause}
      ORDER BY uploaded_at DESC
    `;

    const result = await query<TicketAttachment>(sql, params);
    const attachments = result.rows;

    // Calculate statistics
    const total = attachments.length;
    const totalSizeBytes = attachments.reduce((sum, att) => sum + (att.file_size || 0), 0);
    const evidenceCount = attachments.filter(att => att.is_evidence).length;

    // Count by file type
    const byFileType = attachments.reduce((acc, att) => {
      if (att.file_type) {
        acc[att.file_type] = (acc[att.file_type] || 0) + 1;
      }
      return acc;
    }, {} as Record<FileType, number>);

    return {
      attachments,
      total,
      total_size_bytes: totalSizeBytes,
      by_file_type: byFileType,
      evidence_count: evidenceCount
    };
  } catch (error) {
    logger.error('Failed to list attachments', {
      error,
      ticket_id: ticketId
    });
    throw new Error(`Failed to list attachments: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Delete attachment from both local storage and database
 * 🟢 WORKING: Cascade delete with cleanup
 */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  try {
    // Validate UUID format
    if (!UUID_REGEX.test(attachmentId)) {
      throw new Error('Invalid attachment ID format');
    }

    logger.info('Deleting attachment', { attachment_id: attachmentId });

    // Get attachment to retrieve storage path
    const attachment = await getAttachmentById(attachmentId);

    if (!attachment) {
      throw new Error('Attachment not found');
    }

    // Delete from VF Storage API
    // Parse storage_path: maintenance/attachments/{ticketId}/{filename}
    try {
      const pathParts = attachment.storage_path.split('/');
      if (pathParts.length >= 4) {
        const type = pathParts[0]; // 'maintenance'
        const category = pathParts.slice(1, -1).join('/'); // 'attachments/{ticketId}'
        const filename = pathParts[pathParts.length - 1];
        await vfStorage.deleteFile(type, category, filename);
        logger.debug('Deleted file from VF Storage', {
          storage_path: attachment.storage_path
        });
      } else {
        logger.warn('Invalid storage path format, skipping VF Storage deletion', {
          storage_path: attachment.storage_path
        });
      }
    } catch (error) {
      // Log warning but continue - file might already be deleted
      logger.warn('Failed to delete file from VF Storage (continuing with DB deletion)', {
        error,
        storage_path: attachment.storage_path
      });
    }

    // Delete from database
    const sql = `
      DELETE FROM maintenance_attachments
      WHERE id = $1
    `;

    await query(sql, [attachmentId]);

    logger.info('Attachment deleted successfully', {
      attachment_id: attachmentId
    });
  } catch (error) {
    logger.error('Failed to delete attachment', {
      error,
      attachment_id: attachmentId
    });
    throw error;
  }
}

/**
 * Get photo evidence summary for a ticket
 * 🟢 WORKING: Aggregates photo evidence metrics
 */
export async function getPhotoEvidenceSummary(
  ticketId: string
): Promise<PhotoEvidenceSummary> {
  try {
    logger.debug('Getting photo evidence summary', { ticket_id: ticketId });

    // Get all photo attachments for ticket
    const attachmentsSql = `
      SELECT * FROM maintenance_attachments
      WHERE ticket_id = $1 AND file_type = $2
      ORDER BY uploaded_at DESC
    `;

    const attachmentsResult = await query<TicketAttachment>(attachmentsSql, [
      ticketId,
      FileType.PHOTO
    ]);
    const photos = attachmentsResult.rows;

    // Get verification steps with photo status
    const stepsSql = `
      SELECT
        step_number,
        id as verification_step_id,
        photo_verified
      FROM maintenance_verification_steps
      WHERE ticket_id = $1 AND photo_required = true
      ORDER BY step_number
    `;

    const stepsResult = await query<{
      step_number: number;
      verification_step_id: string;
      photo_verified: boolean;
    }>(stepsSql, [ticketId]);
    const steps = stepsResult.rows;

    // Count photos by step
    const photosByStep: Record<number, number> = {};
    const verifiedStepIds = new Set(
      steps.filter(s => s.photo_verified).map(s => s.verification_step_id)
    );

    photos.forEach(photo => {
      if (photo.verification_step_id) {
        const step = steps.find(s => s.verification_step_id === photo.verification_step_id);
        if (step) {
          photosByStep[step.step_number] = (photosByStep[step.step_number] || 0) + 1;
        }
      }
    });

    // Calculate metrics
    const totalPhotos = photos.length;
    const verifiedPhotos = photos.filter(p =>
      p.verification_step_id && verifiedStepIds.has(p.verification_step_id)
    ).length;
    const unverifiedPhotos = totalPhotos - verifiedPhotos;

    const totalSizeBytes = photos.reduce((sum, p) => sum + (p.file_size || 0), 0);
    const totalSizeMB = totalSizeBytes / (1024 * 1024);

    const missingSteps = steps
      .filter(s => !photosByStep[s.step_number])
      .map(s => s.step_number);

    return {
      ticket_id: ticketId,
      total_photos: totalPhotos,
      photos_by_step: photosByStep,
      verified_photos: verifiedPhotos,
      unverified_photos: unverifiedPhotos,
      missing_steps: missingSteps,
      total_size_mb: totalSizeMB
    };
  } catch (error) {
    logger.error('Failed to get photo evidence summary', {
      error,
      ticket_id: ticketId
    });
    throw new Error(`Failed to get photo evidence summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get attachment statistics across all tickets
 * 🟢 WORKING: Global attachment metrics
 */
export async function getAttachmentStatistics(): Promise<AttachmentStatistics> {
  try {
    logger.debug('Getting attachment statistics');

    const sql = `
      SELECT
        COUNT(*)::int as total_attachments,
        COALESCE(SUM(file_size), 0)::bigint as total_size_bytes,
        COUNT(*) FILTER (WHERE file_type = 'photo')::int as photo_count,
        COUNT(*) FILTER (WHERE file_type = 'pdf')::int as pdf_count,
        COUNT(*) FILTER (WHERE file_type = 'document')::int as document_count,
        COUNT(*) FILTER (WHERE file_type = 'excel')::int as excel_count,
        COUNT(*) FILTER (WHERE is_evidence = true)::int as evidence_photos,
        COUNT(*) FILTER (WHERE uploaded_at >= DATE_TRUNC('month', CURRENT_DATE))::int as attachments_this_month
      FROM maintenance_attachments
    `;

    const result = await queryOne<{
      total_attachments: number;
      total_size_bytes: number;
      photo_count: number;
      pdf_count: number;
      document_count: number;
      excel_count: number;
      evidence_photos: number;
      attachments_this_month: number;
    }>(sql, []);

    // Handle null/undefined result (no attachments in system)
    if (!result || result.total_attachments === null || result.total_attachments === undefined) {
      return {
        total_attachments: 0,
        total_size_gb: 0,
        by_file_type: {
          [FileType.PHOTO]: 0,
          [FileType.PDF]: 0,
          [FileType.DOCUMENT]: 0,
          [FileType.EXCEL]: 0
        },
        evidence_photos: 0,
        avg_file_size_mb: 0,
        attachments_this_month: 0
      };
    }

    const totalSizeGB = result.total_size_bytes / (1024 * 1024 * 1024);
    const avgFileSizeMB = result.total_attachments > 0
      ? result.total_size_bytes / result.total_attachments / (1024 * 1024)
      : 0;

    return {
      total_attachments: result.total_attachments,
      total_size_gb: totalSizeGB,
      by_file_type: {
        [FileType.PHOTO]: result.photo_count,
        [FileType.PDF]: result.pdf_count,
        [FileType.DOCUMENT]: result.document_count,
        [FileType.EXCEL]: result.excel_count
      },
      evidence_photos: result.evidence_photos,
      avg_file_size_mb: avgFileSizeMB,
      attachments_this_month: result.attachments_this_month
    };
  } catch (error) {
    logger.error('Failed to get attachment statistics', { error });
    throw new Error(`Failed to get attachment statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
