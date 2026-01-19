/**
 * WhatsApp Notification API Route - Send Notification
 *
 * 🟢 WORKING: Production-ready API endpoint for sending WhatsApp notifications
 *
 * POST /api/ticketing/notifications/whatsapp - Send WhatsApp notification
 *
 * Features:
 * - Template-based messaging with variable substitution
 * - Direct message content support
 * - Input validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 *
 * @module api/ticketing/notifications/whatsapp
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getDefaultWhatsAppService } from '@/modules/ticketing/services/whatsappService';
import type { SendNotificationRequest } from '@/modules/ticketing/types/whatsapp';
import { RecipientType } from '@/modules/ticketing/types/whatsapp';

// 🟢 WORKING: Logger instance for WhatsApp notification API
const logger = createLogger('ticketing:api:notifications:whatsapp');

// Valid enum values for validation
const VALID_RECIPIENT_TYPES: RecipientType[] = [
  RecipientType.CONTRACTOR,
  RecipientType.TECHNICIAN,
  RecipientType.CLIENT,
  RecipientType.TEAM,
];

// ==================== POST /api/ticketing/notifications/whatsapp ====================

/**
 * 🟢 WORKING: Send WhatsApp notification via WAHA API
 *
 * @example Request body:
 * {
 *   "ticket_id": "ticket-uuid",
 *   "recipient_type": "contractor",
 *   "recipient_phone": "+27821234567",
 *   "recipient_name": "John Contractor",
 *   "template_id": "ticket_assigned",
 *   "variables": {
 *     "assignee_name": "John Contractor",
 *     "ticket_uid": "FT123456",
 *     "dr_number": "DR-2024-001"
 *   }
 * }
 *
 * @example Response (201):
 * {
 *   "success": true,
 *   "data": {
 *     "id": "notif-uuid",
 *     "ticket_id": "ticket-uuid",
 *     "status": "sent",
 *     "waha_message_id": "waha-msg-123",
 *     "sent_at": "2024-01-15T10:00:00Z"
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body: SendNotificationRequest = await req.json();

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!body.recipient_type) {
      errors.recipient_type = 'Recipient type is required';
    } else if (!VALID_RECIPIENT_TYPES.includes(body.recipient_type)) {
      errors.recipient_type = `Invalid recipient type. Must be one of: ${VALID_RECIPIENT_TYPES.join(', ')}`;
    }

    if (!body.recipient_phone || body.recipient_phone.trim() === '') {
      errors.recipient_phone = 'Recipient phone is required';
    }

    // Validate that either template_id or message_content is provided
    if (!body.template_id && !body.message_content) {
      errors.message = 'Either template_id or message_content is required';
    }

    // If template_id is provided, variables should be provided too
    if (body.template_id && !body.variables) {
      errors.variables = 'Variables are required when using template_id';
    }

    // If validation errors, return 422
    if (Object.keys(errors).length > 0) {
      logger.warn('Validation failed for WhatsApp notification', { errors });

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

    logger.info('Sending WhatsApp notification', {
      ticket_id: body.ticket_id,
      recipient_type: body.recipient_type,
      recipient_phone: body.recipient_phone,
      template_id: body.template_id,
    });

    // Send notification via WhatsApp service
    const service = getDefaultWhatsAppService();
    const notification = await service.sendNotification(body);

    logger.info('WhatsApp notification sent successfully', {
      notification_id: notification.id,
      ticket_id: notification.ticket_id,
      status: notification.status,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: notification.id,
          ticket_id: notification.ticket_id,
          recipient_type: notification.recipient_type,
          recipient_phone: notification.recipient_phone,
          recipient_name: notification.recipient_name,
          status: notification.status,
          waha_message_id: notification.waha_message_id,
          sent_at: notification.sent_at,
          created_at: notification.created_at,
        },
        message: 'WhatsApp notification sent successfully',
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Failed to send WhatsApp notification', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Determine error type and status code
    const errorMessage = error instanceof Error ? error.message : 'Failed to send WhatsApp notification';
    let statusCode = 500;
    let errorCode = 'SEND_ERROR';

    // Check for specific error types
    if (errorMessage.includes('template') || errorMessage.includes('Template')) {
      statusCode = 422;
      errorCode = 'TEMPLATE_ERROR';
    } else if (errorMessage.includes('authentication') || errorMessage.includes('API key')) {
      statusCode = 503;
      errorCode = 'SERVICE_UNAVAILABLE';
    } else if (errorMessage.includes('session') || errorMessage.includes('Session')) {
      statusCode = 503;
      errorCode = 'SESSION_NOT_READY';
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: errorCode,
          message: errorMessage,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: statusCode }
    );
  }
}
