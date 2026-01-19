/**
 * Attachment Upload API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for file uploads
 *
 * POST /api/ticketing/attachments - Upload file to Firebase Storage
 *
 * Features:
 * - Multipart/form-data file upload support
 * - Firebase Storage integration
 * - Database record creation
 * - File validation (type, size)
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { uploadAttachment } from '@/modules/ticketing/services/attachmentService';
import type { FileUploadRequest } from '@/modules/ticketing/types/attachment';

const logger = createLogger('ticketing:api:attachments');

// ==================== POST /api/ticketing/attachments ====================

/**
 * 🟢 WORKING: Upload attachment to Firebase Storage
 */
export async function POST(req: NextRequest) {
  try {
    // Parse multipart/form-data
    const formData = await req.formData();

    // Extract file
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'File is required',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    // Extract metadata
    const ticketId = formData.get('ticket_id') as string;
    const uploadedBy = formData.get('uploaded_by') as string;
    const verificationStepId = formData.get('verification_step_id') as string | null;
    const isEvidence = formData.get('is_evidence') === 'true';

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!ticketId) {
      errors.ticket_id = 'ticket_id is required';
    }

    if (!uploadedBy) {
      errors.uploaded_by = 'uploaded_by is required';
    }

    // If validation errors, return 422
    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: errors,
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    logger.info('Uploading attachment', {
      ticket_id: ticketId,
      filename: file.name,
      size: file.size,
      type: file.type,
      is_evidence: isEvidence,
    });

    // Create upload request
    const uploadRequest: FileUploadRequest = {
      ticket_id: ticketId,
      file,
      filename: file.name,
      uploaded_by: uploadedBy,
      verification_step_id: verificationStepId || undefined,
      is_evidence: isEvidence,
    };

    // Upload file
    const result = await uploadAttachment(uploadRequest);

    logger.info('Attachment uploaded successfully', {
      attachment_id: result.attachment_id,
      ticket_id: ticketId,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: 'Attachment uploaded successfully',
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Error uploading attachment', { error });

    // Handle validation errors
    if (error instanceof Error) {
      if (
        error.message.includes('Invalid file type') ||
        error.message.includes('too large') ||
        error.message.includes('exceeds maximum limit')
      ) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: error.message,
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to upload attachment',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
