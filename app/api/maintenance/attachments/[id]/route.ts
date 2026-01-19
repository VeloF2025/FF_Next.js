/**
 * Attachment API Route - Get and Delete
 *
 * 🟢 WORKING: Production-ready API endpoints for individual attachment operations
 *
 * GET    /api/ticketing/attachments/[id] - Get attachment by ID
 * DELETE /api/ticketing/attachments/[id] - Delete attachment
 *
 * Features:
 * - Retrieve attachment metadata
 * - Delete from Firebase Storage and database
 * - UUID validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  getAttachmentById,
  deleteAttachment,
} from '@/modules/ticketing/services/attachmentService';

const logger = createLogger('ticketing:api:attachment');

// ==================== GET /api/ticketing/attachments/[id] ====================

/**
 * 🟢 WORKING: Get attachment by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: attachmentId } = await params;

    logger.debug('Fetching attachment', { attachment_id: attachmentId });

    const attachment = await getAttachmentById(attachmentId);

    if (!attachment) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Attachment not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: attachment,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching attachment', { error });

    // Handle validation errors (invalid UUID)
    if (error instanceof Error && error.message.includes('Invalid')) {
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

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch attachment',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

// ==================== DELETE /api/ticketing/attachments/[id] ====================

/**
 * 🟢 WORKING: Delete attachment from Firebase Storage and database
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: attachmentId } = await params;

    logger.info('Deleting attachment', { attachment_id: attachmentId });

    await deleteAttachment(attachmentId);

    logger.info('Attachment deleted successfully', { attachment_id: attachmentId });

    return NextResponse.json({
      success: true,
      data: {
        message: 'Attachment deleted successfully',
        attachment_id: attachmentId,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error deleting attachment', { error });

    // Handle not found errors
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Attachment not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 404 }
      );
    }

    // Handle validation errors (invalid UUID)
    if (error instanceof Error && error.message.includes('Invalid')) {
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

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete attachment',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
