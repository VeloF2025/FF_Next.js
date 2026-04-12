/**
 * RFQ Notification Service
 * Handles notification creation and sending for RFQs
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { getNotificationMessage } from '../utils/rfqMessageTemplates';

/** Shape of a notification record passed to createNotification */
interface RfqNotificationInput {
  type: string;
  recipientType: string;
  recipientId?: string;
  recipientEmail?: string;
  subject: string;
  message: string;
  metadata?: Record<string, unknown>;
  id?: string;
}

/** Supplier row from DB */
interface SupplierRow {
  email: string;
  company_name: string;
}

/** RFQ row from DB */
interface RfqRow {
  rfq_number: string;
  response_deadline: string | null;
}

/** Shape of a notification row returned from the DB */
interface RfqNotificationRow {
  id: string;
  notification_type: string;
  recipient_type: string;
  recipient_email: string;
  subject: string;
  message: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

const sql = neon(process.env.DATABASE_URL!);

export class RfqNotificationService {
  /**
   * Create notification
   */
  static async createNotification(rfqId: string, notification: RfqNotificationInput): Promise<void> {
    try {
      await sql`
        INSERT INTO rfq_notifications (
          rfq_id, notification_type, recipient_type,
          recipient_id, recipient_email, subject, message,
          status, metadata
        ) VALUES (
          ${rfqId},
          ${notification.type},
          ${notification.recipientType},
          ${notification.recipientId || null},
          ${notification.recipientEmail || null},
          ${notification.subject},
          ${notification.message},
          'pending',
          ${JSON.stringify(notification.metadata || {})}
        )`;

      // Trigger email/webhook sending (async)
      this.sendNotification(notification).catch(error => {
        log.error('Failed to send notification:', { data: error }, 'RfqNotificationService');
      });
    } catch (error) {
      log.error('Error creating notification:', { data: error }, 'RfqNotificationService');
      throw error;
    }
  }

  /**
   * Create supplier-specific notification
   */
  static async createSupplierNotification(rfqId: string, supplierId: string, type: string): Promise<void> {
    try {
      // Get supplier details
      const supplierRows = (await sql`
        SELECT * FROM suppliers WHERE id = ${supplierId}`) as SupplierRow[];

      if (supplierRows.length === 0) {
        log.warn('Supplier not found for notification', { supplierId }, 'RfqNotificationService');
        return;
      }

      // Get RFQ details
      const rfqRows = (await sql`
        SELECT rfq_number, response_deadline FROM rfqs WHERE id = ${rfqId}`) as RfqRow[];

      if (rfqRows.length === 0) {
        log.warn('RFQ not found for notification', { rfqId }, 'RfqNotificationService');
        return;
      }

      const supplierRow = supplierRows[0]!;
      const rfqRow = rfqRows[0]!;

      await this.createNotification(rfqId, {
        type,
        recipientType: 'supplier',
        recipientId: supplierId,
        recipientEmail: supplierRow.email,
        subject: `RFQ ${rfqRow.rfq_number}: ${type}`,
        message: getNotificationMessage(type, rfqRow),
        metadata: {
          supplierName: supplierRow.company_name,
          rfqNumber: rfqRow.rfq_number
        }
      });
    } catch (error) {
      log.error('Error creating supplier notification:', { data: error }, 'RfqNotificationService');
    }
  }

  /**
   * Send notification (email/webhook)
   */
  private static async sendNotification(notification: RfqNotificationInput): Promise<void> {
    try {
      // This would integrate with your email service (SendGrid, AWS SES, etc.)
      // or webhook service

      // For now, just log the notification
      log.info('Sending notification', notification, 'RfqNotificationService');

      // Update notification status
      if (notification.id) {
        await sql`
          UPDATE rfq_notifications
          SET
            status = 'sent',
            sent_at = ${new Date().toISOString()}
          WHERE id = ${notification.id}`;
      }
    } catch (error) {
      log.error('Error sending notification:', { data: error }, 'RfqNotificationService');
      throw error;
    }
  }

  /**
   * Get notifications for an RFQ
   */
  static async getNotifications(rfqId: string): Promise<RfqNotificationInput[]> {
    try {
      const notifications = await sql`
        SELECT * FROM rfq_notifications
        WHERE rfq_id = ${rfqId}
        ORDER BY created_at DESC`;

      return (notifications as RfqNotificationRow[]).map((n) => ({
        id: n.id,
        type: n.notification_type,
        recipientType: n.recipient_type,
        recipientEmail: n.recipient_email,
        subject: n.subject,
        message: n.message,
        status: n.status,
        sentAt: n.sent_at,
        createdAt: n.created_at
      }));
    } catch (error) {
      log.error('Error fetching notifications:', { data: error }, 'RfqNotificationService');
      return [];
    }
  }
}
