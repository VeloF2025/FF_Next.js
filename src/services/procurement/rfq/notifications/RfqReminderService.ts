/**
 * RFQ Reminder Service
 * Handles automated reminder notifications for RFQs
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { RFQStatus } from '@/types/procurement.types';
import { RfqNotificationService } from './RfqNotificationService';

const sql = neon(process.env.DATABASE_URL!);

export class RfqReminderService {
  /**
   * Send deadline reminders
   */
  static async sendDeadlineReminders(): Promise<void> {
    try {
      // Find RFQs with approaching deadlines (24 hours)
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const rfqs = await sql`
        SELECT * FROM rfqs
        WHERE status = ${RFQStatus.ISSUED}
        AND response_deadline BETWEEN NOW() AND ${tomorrow.toISOString()}
        AND NOT EXISTS (
          SELECT 1 FROM rfq_notifications
          WHERE rfq_id = rfqs.id
          AND notification_type = 'deadline_reminder'
          AND created_at > NOW() - INTERVAL '24 hours'
        )`;

      for (const rfq of rfqs) {
        await RfqNotificationService.createNotification(rfq.id, {
          type: 'deadline_reminder',
          recipientType: 'all',
          subject: `RFQ ${rfq.rfq_number} - Deadline Approaching`,
          message: `The deadline for RFQ ${rfq.rfq_number} is approaching. Please submit your response before ${new Date(rfq.response_deadline).toLocaleString()}`
        });
      }

      log.info(`Sent deadline reminders for ${rfqs.length} RFQs`, {}, 'RfqReminderService');
    } catch (error) {
      log.error('Error sending deadline reminders:', { data: error }, 'RfqReminderService');
    }
  }

  /**
   * Send overdue reminders
   */
  static async sendOverdueReminders(): Promise<void> {
    try {
      const rfqs = await sql`
        SELECT * FROM rfqs
        WHERE status = ${RFQStatus.ISSUED}
        AND response_deadline < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM rfq_notifications
          WHERE rfq_id = rfqs.id
          AND notification_type = 'overdue_reminder'
          AND created_at > NOW() - INTERVAL '24 hours'
        )`;

      for (const rfq of rfqs) {
        await RfqNotificationService.createNotification(rfq.id, {
          type: 'overdue_reminder',
          recipientType: 'internal',
          subject: `RFQ ${rfq.rfq_number} - Overdue`,
          message: `RFQ ${rfq.rfq_number} is past its deadline. Consider extending the deadline or closing the RFQ.`
        });
      }

      log.info(`Sent overdue reminders for ${rfqs.length} RFQs`, {}, 'RfqReminderService');
    } catch (error) {
      log.error('Error sending overdue reminders:', { data: error }, 'RfqReminderService');
    }
  }

  /**
   * Send response received notifications
   */
  static async sendResponseReceivedNotifications(): Promise<void> {
    try {
      // Find responses submitted in the last hour without notification
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const responses = await sql`
        SELECT
          rr.id,
          rr.rfq_id,
          rr.supplier_name,
          r.rfq_number
        FROM rfq_responses rr
        JOIN rfqs r ON rr.rfq_id = r.id
        WHERE rr.submission_date > ${oneHourAgo.toISOString()}
        AND NOT EXISTS (
          SELECT 1 FROM rfq_notifications
          WHERE rfq_id = rr.rfq_id
          AND notification_type = 'response_received'
          AND metadata::jsonb @> jsonb_build_object('responseId', rr.id)
        )`;

      for (const response of responses) {
        await RfqNotificationService.createNotification(response.rfq_id, {
          type: 'response_received',
          recipientType: 'internal',
          subject: `New Response for RFQ ${response.rfq_number}`,
          message: `${response.supplier_name} has submitted a response for RFQ ${response.rfq_number}`,
          metadata: {
            responseId: response.id,
            supplierName: response.supplier_name
          }
        });
      }

      log.info(`Sent response notifications for ${responses.length} new responses`, {}, 'RfqReminderService');
    } catch (error) {
      log.error('Error sending response notifications:', { data: error }, 'RfqReminderService');
    }
  }
}
