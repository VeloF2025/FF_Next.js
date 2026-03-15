/**
 * Ticket Attachments API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for attachment upload and listing
 *
 * POST /api/noc/tickets/[id]/attachments - Upload attachment
 * GET  /api/noc/tickets/[id]/attachments - List all attachments for a ticket
 *
 * Features:
 * - File upload to Firebase Storage
 * - Filter by file_type, is_evidence, verification_step_id
 * - Aggregated statistics (total size, evidence count)
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  uploadAttachment,
  listAttachmentsForTicket,
  deleteAttachment,
} from '@/modules/noc/services/attachmentService';
import {
  FileType,
  AttachmentFilters,
  FileUploadRequest
} from '@/modules/noc/types/attachment';

const logger = createLogger('maintenance:api:ticket-attachments');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ==================== POST /api/noc/tickets/[id]/attachments ====================

/**
 * 🟢 WORKING: Upload attachment (photo or document) to ticket
 * Multipart form data upload with Firebase Storage integration
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;

    // Validate ticket ID format
    if (!UUID_REGEX.test(ticketId)) {
      logger.warn('Invalid ticket ID format', { ticket_id: ticketId });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid ticket ID format. Must be a valid UUID.'
          }
        },
        { status: 422 }
      );
    }

    // Parse form data
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const uploadedBy = formData.get('uploaded_by') as string | null;
    const isEvidenceStr = formData.get('is_evidence') as string | null;
    const verificationStepId = formData.get('verification_step_id') as string | null;

    // Validate required fields
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'file is required'
          }
        },
        { status: 422 }
      );
    }

    if (!uploadedBy) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'uploaded_by is required'
          }
        },
        { status: 422 }
      );
    }

    // Parse boolean
    const isEvidence = isEvidenceStr === 'true';

    // Build upload request
    const uploadRequest: FileUploadRequest = {
      ticket_id: ticketId,
      file,
      filename: file.name,
      uploaded_by: uploadedBy,
      is_evidence: isEvidence,
      verification_step_id: verificationStepId || undefined
    };

    logger.info('Uploading attachment', {
      ticket_id: ticketId,
      filename: file.name,
      is_evidence: isEvidence
    });

    // Upload file
    const result = await uploadAttachment(uploadRequest);

    logger.info('Attachment uploaded successfully', {
      attachment_id: result.attachment_id,
      ticket_id: ticketId
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        meta: {
          timestamp: new Date().toISOString()
        }
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Failed to upload attachment', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'UPLOAD_ERROR',
          message: 'Failed to upload attachment',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      },
      { status: 500 }
    );
  }
}

// ==================== GET /api/noc/tickets/[id]/attachments ====================

/**
 * 🟢 WORKING: List attachments for a ticket with optional filters
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;

    // Validate ticket ID format
    if (!UUID_REGEX.test(ticketId)) {
      logger.warn('Invalid ticket ID format', { ticket_id: ticketId });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid ticket ID format. Must be a valid UUID.'
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: AttachmentFilters = {};

    if (searchParams.has('file_type')) {
      const fileType = searchParams.get('file_type') as FileType;
      if (Object.values(FileType).includes(fileType)) {
        filters.file_type = fileType;
      }
    }

    if (searchParams.has('is_evidence')) {
      filters.is_evidence = searchParams.get('is_evidence') === 'true';
    }

    if (searchParams.has('verification_step_id')) {
      filters.verification_step_id = searchParams.get('verification_step_id')!;
    }

    if (searchParams.has('uploaded_by')) {
      filters.uploaded_by = searchParams.get('uploaded_by')!;
    }

    logger.debug('Fetching attachments for ticket', { ticket_id: ticketId, filters });

    // Only pass filters if there are any (to match test expectations)
    const result = await listAttachmentsForTicket(
      ticketId,
      Object.keys(filters).length > 0 ? filters : undefined
    );

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching ticket attachments', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'LIST_ERROR',
          message: 'Failed to list attachments',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

// ==================== DELETE /api/noc/tickets/[id]/attachments?attachment_id=X ====================

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;
    const { searchParams } = new URL(req.url);
    const attachmentId = searchParams.get('attachment_id');

    if (!attachmentId || !UUID_REGEX.test(attachmentId)) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid attachment_id required' } },
        { status: 422 }
      );
    }

    logger.info('Deleting attachment', { ticket_id: ticketId, attachment_id: attachmentId });
    await deleteAttachment(attachmentId);

    return NextResponse.json({ success: true, meta: { timestamp: new Date().toISOString() } });
  } catch (error) {
    logger.error('Failed to delete attachment', { error });
    return NextResponse.json(
      { success: false, error: { code: 'DELETE_ERROR', message: error instanceof Error ? error.message : 'Failed' } },
      { status: 500 }
    );
  }
}
