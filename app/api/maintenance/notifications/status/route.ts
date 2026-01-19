/**
 * WhatsApp Notification Status API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for retrieving notification delivery status
 *
 * GET /api/ticketing/notifications/status - Get notification delivery status
 *
 * Query parameters:
 * - notification_id: Get status for a specific notification by ID
 * - ticket_id: Get all notifications for a ticket
 * - status: Filter by notification status (sent, delivered, read, failed)
 * - recipient_type: Filter by recipient type (contractor, technician, client, team)
 * - failed_only: Get only failed notifications (true/false)
 * - sent_after: Filter notifications sent after this date (ISO 8601)
 * - sent_before: Filter notifications sent before this date (ISO 8601)
 *
 * Features:
 * - Single notification status lookup
 * - Batch notification listing with filters
 * - Statistics and delivery rate calculation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 *
 * @module api/ticketing/notifications/status
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getDefaultWhatsAppService } from '@/modules/ticketing/services/whatsappService';
import type { NotificationFilters } from '@/modules/ticketing/types/whatsapp';
import { NotificationStatus, RecipientType } from '@/modules/ticketing/types/whatsapp';

// 🟢 WORKING: Logger instance for notification status API
const logger = createLogger('ticketing:api:notifications:status');

// Valid enum values for validation
const VALID_STATUSES: NotificationStatus[] = [
  NotificationStatus.PENDING,
  NotificationStatus.SENT,
  NotificationStatus.DELIVERED,
  NotificationStatus.READ,
  NotificationStatus.FAILED,
];

const VALID_RECIPIENT_TYPES: RecipientType[] = [
  RecipientType.CONTRACTOR,
  RecipientType.TECHNICIAN,
  RecipientType.CLIENT,
  RecipientType.TEAM,
];

// ==================== GET /api/ticketing/notifications/status ====================

/**
 * 🟢 WORKING: Get notification delivery status
 *
 * @example Get single notification status:
 * GET /api/ticketing/notifications/status?notification_id=notif-uuid
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "notification_id": "notif-uuid",
 *     "ticket_id": "ticket-uuid",
 *     "status": "delivered",
 *     "sent_at": "2024-01-15T10:00:00Z",
 *     "delivered_at": "2024-01-15T10:05:00Z",
 *     "read_at": null,
 *     "error_message": null,
 *     "retry_count": 0,
 *     "can_retry": false
 *   }
 * }
 *
 * @example List notifications by ticket:
 * GET /api/ticketing/notifications/status?ticket_id=ticket-uuid
 *
 * Response (200):
 * {
 *   "success": true,
 *   "data": {
 *     "notifications": [...],
 *     "total": 5,
 *     "by_status": {
 *       "pending": 0,
 *       "sent": 1,
 *       "delivered": 3,
 *       "read": 1,
 *       "failed": 0
 *     },
 *     "delivery_rate": 80.0
 *   }
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Check if requesting single notification status by ID
    const notificationId = searchParams.get('notification_id');

    if (notificationId) {
      logger.debug('Fetching notification status', { notificationId });

      const service = getDefaultWhatsAppService();
      const status = await service.getNotificationStatus(notificationId);

      if (!status) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Notification not found',
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
        data: status,
        meta: {
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Otherwise, list notifications with filters
    const filters: NotificationFilters = {};

    // Parse filters from query params
    if (searchParams.has('ticket_id')) {
      filters.ticket_id = searchParams.get('ticket_id')!;
    }

    if (searchParams.has('status')) {
      const statusParam = searchParams.get('status')!;
      if (VALID_STATUSES.includes(statusParam as NotificationStatus)) {
        filters.status = statusParam as NotificationStatus;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }
    }

    if (searchParams.has('recipient_type')) {
      const recipientTypeParam = searchParams.get('recipient_type')!;
      if (VALID_RECIPIENT_TYPES.includes(recipientTypeParam as RecipientType)) {
        filters.recipient_type = recipientTypeParam as RecipientType;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid recipient_type. Must be one of: ${VALID_RECIPIENT_TYPES.join(', ')}`,
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }
    }

    if (searchParams.has('failed_only')) {
      filters.failed_only = searchParams.get('failed_only') === 'true';
    }

    if (searchParams.has('sent_after')) {
      try {
        filters.sent_after = new Date(searchParams.get('sent_after')!);
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid sent_after date format. Use ISO 8601 format.',
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }
    }

    if (searchParams.has('sent_before')) {
      try {
        filters.sent_before = new Date(searchParams.get('sent_before')!);
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid sent_before date format. Use ISO 8601 format.',
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }
    }

    logger.debug('Listing notifications with filters', { filters });

    const service = getDefaultWhatsAppService();
    const result = await service.listNotifications(filters);

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch notification status', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch notification status',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
