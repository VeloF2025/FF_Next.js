/**
 * Email Notification Service for RFQ/BOQ
 * Replaces Firebase Cloud Messaging with email/webhook notifications
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export interface NotificationPayload {
  type: 'rfq_invitation' | 'rfq_reminder' | 'rfq_deadline' | 'rfq_evaluation' | 'rfq_award' | 
        'boq_approved' | 'boq_rejected' | 'response_received' | 'quote_accepted';
  recipientEmail?: string;
  recipientId?: string;
  subject: string;
  message: string;
  metadata?: Record<string, any>;
}

/** Escape HTML entities to prevent XSS in email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class EmailNotificationService {
  /**
   * Send email notification
   * This is a placeholder that would integrate with your email service (SendGrid, AWS SES, etc.)
   */
  static async sendEmail(payload: NotificationPayload): Promise<boolean> {
    try {
      // Log the notification attempt
      log.info('Sending email notification', { 
        type: payload.type,
        recipient: payload.recipientEmail,
        subject: payload.subject 
      }, 'emailNotification');

      // In production, integrate with email service provider
      if (process.env.SENDGRID_API_KEY) {
        // Example SendGrid integration
        return await this.sendViaSendGrid(payload);
      } else if (process.env.AWS_SES_REGION) {
        // Example AWS SES integration
        return await this.sendViaAWSSES(payload);
      } else {
        // Development mode - just log
        log.debug('emailNotification', {
          action: 'devModeSkip',
          to: payload.recipientEmail,
          subject: payload.subject,
          message: payload.message
        });
        return true;
      }
    } catch (error) {
      log.error('Failed to send email notification', { error }, 'emailNotification');
      return false;
    }
  }

  /**
   * Send via SendGrid (placeholder)
   */
  private static async sendViaSendGrid(payload: NotificationPayload): Promise<boolean> {
    try {
      // Implement SendGrid API call
      // const sgMail = require('@sendgrid/mail');
      // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      // await sgMail.send({
      //   to: payload.recipientEmail,
      //   from: process.env.SENDER_EMAIL,
      //   subject: payload.subject,
      //   text: payload.message,
      //   html: this.formatHtmlEmail(payload)
      // });
      return true;
    } catch (error) {
      log.error('SendGrid error', { error }, 'emailNotification');
      return false;
    }
  }

  /**
   * Send via AWS SES (placeholder)
   */
  private static async sendViaAWSSES(payload: NotificationPayload): Promise<boolean> {
    try {
      // Implement AWS SES API call
      // const AWS = require('aws-sdk');
      // const ses = new AWS.SES({ region: process.env.AWS_SES_REGION });
      // await ses.sendEmail({
      //   Source: process.env.SENDER_EMAIL,
      //   Destination: { ToAddresses: [payload.recipientEmail] },
      //   Message: {
      //     Subject: { Data: payload.subject },
      //     Body: {
      //       Text: { Data: payload.message },
      //       Html: { Data: this.formatHtmlEmail(payload) }
      //     }
      //   }
      // }).promise();
      return true;
    } catch (error) {
      log.error('AWS SES error', { error }, 'emailNotification');
      return false;
    }
  }

  /**
   * Format HTML email template
   */
  private static formatHtmlEmail(payload: NotificationPayload): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9fafb; }
            .footer { text-align: center; padding: 10px; color: #6b7280; font-size: 12px; }
            .button { display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>${escapeHtml(payload.subject)}</h2>
            </div>
            <div class="content">
              <p>${escapeHtml(payload.message)}</p>
              ${payload.metadata?.actionUrl ? `
                <p style="text-align: center; margin-top: 30px;">
                  <a href="${encodeURI(payload.metadata.actionUrl)}" class="button">View Details</a>
                </p>
              ` : ''}
            </div>
            <div class="footer">
              <p>This is an automated message from the Procurement System</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Send webhook notification
   */
  static async sendWebhook(url: string, payload: any): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Source': 'procurement-system'
        },
        body: JSON.stringify(payload)
      });

      return response.ok;
    } catch (error) {
      log.error('Webhook error', { error, url }, 'webhookNotification');
      return false;
    }
  }

  /**
   * Store notification in database
   */
  static async storeNotification(
    rfqId: string,
    notification: NotificationPayload
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO rfq_notifications (
          rfq_id,
          notification_type,
          recipient_type,
          recipient_id,
          recipient_email,
          subject,
          message,
          status,
          metadata
        ) VALUES (
          ${rfqId},
          ${notification.type},
          ${notification.recipientId ? 'internal' : 'supplier'},
          ${notification.recipientId || null},
          ${notification.recipientEmail || null},
          ${notification.subject},
          ${notification.message},
          'pending',
          ${JSON.stringify(notification.metadata || {})}
        )`;
    } catch (error) {
      log.error('Failed to store notification', { error }, 'notificationStorage');
      throw error;
    }
  }

  /**
   * Process pending notifications
   */
  static async processPendingNotifications(): Promise<void> {
    try {
      const pending = await sql`
        SELECT * FROM rfq_notifications 
        WHERE status = 'pending' 
        AND retry_count < 3
        ORDER BY created_at
        LIMIT 10`;

      for (const notification of pending) {
        const success = await this.sendEmail({
          type: notification.notification_type,
          recipientEmail: notification.recipient_email,
          recipientId: notification.recipient_id,
          subject: notification.subject,
          message: notification.message,
          metadata: notification.metadata
        });

        if (success) {
          await sql`
            UPDATE rfq_notifications 
            SET status = 'sent', sent_at = ${new Date().toISOString()}
            WHERE id = ${notification.id}`;
        } else {
          await sql`
            UPDATE rfq_notifications 
            SET retry_count = retry_count + 1,
                status = CASE WHEN retry_count >= 2 THEN 'failed' ELSE 'pending' END,
                failed_at = CASE WHEN retry_count >= 2 THEN ${new Date().toISOString()} ELSE NULL END
            WHERE id = ${notification.id}`;
        }
      }
    } catch (error) {
      log.error('Failed to process pending notifications', { error }, 'notificationProcessor');
    }
  }

  /**
   * Send RFQ invitation notifications
   */
  static async sendRFQInvitations(rfqId: string, supplierIds: string[]): Promise<void> {
    try {
      const rfq = await sql`
        SELECT * FROM rfqs WHERE id = ${rfqId}`;
      
      if (rfq.length === 0) return;

      const suppliers = await sql`
        SELECT id, company_name, email, contact_person 
        FROM suppliers 
        WHERE id = ANY(${supplierIds})`;

      for (const supplier of suppliers) {
        const notification: NotificationPayload = {
          type: 'rfq_invitation',
          recipientEmail: supplier.email,
          recipientId: supplier.id,
          subject: `RFQ Invitation: ${rfq[0].title}`,
          message: `
            Dear ${supplier.contact_person || supplier.company_name},
            
            You have been invited to submit a quote for RFQ ${rfq[0].rfq_number}.
            
            Title: ${rfq[0].title}
            Description: ${rfq[0].description}
            Response Deadline: ${new Date(rfq[0].response_deadline).toISOString().split('T')[0]}
            
            Please log in to the procurement portal to view details and submit your response.
          `,
          metadata: {
            rfqId,
            supplierId: supplier.id,
            actionUrl: `${process.env.APP_URL}/supplier/rfq/${rfqId}`
          }
        };

        await this.storeNotification(rfqId, notification);
        await this.sendEmail(notification);
      }
    } catch (error) {
      log.error('Failed to send RFQ invitations', { error, rfqId }, 'rfqInvitations');
    }
  }

  /**
   * Send RFQ deadline reminder
   */
  static async sendDeadlineReminder(rfqId: string): Promise<void> {
    try {
      const rfq = await sql`
        SELECT r.*, array_agg(s.email) as supplier_emails
        FROM rfqs r
        LEFT JOIN suppliers s ON s.id = ANY(r.invited_suppliers::uuid[])
        WHERE r.id = ${rfqId}
        GROUP BY r.id`;
      
      if (rfq.length === 0) return;

      const daysUntilDeadline = Math.ceil(
        (new Date(rfq[0].response_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntilDeadline <= 3 && daysUntilDeadline > 0) {
        for (const email of rfq[0].supplier_emails || []) {
          const notification: NotificationPayload = {
            type: 'rfq_reminder',
            recipientEmail: email,
            subject: `Reminder: RFQ ${rfq[0].rfq_number} closes in ${daysUntilDeadline} days`,
            message: `
              This is a reminder that RFQ ${rfq[0].rfq_number} - ${rfq[0].title} 
              will close in ${daysUntilDeadline} days.
              
              Please submit your response before ${new Date(rfq[0].response_deadline).toLocaleString()}.
            `
          };

          await this.storeNotification(rfqId, notification);
          await this.sendEmail(notification);
        }
      }
    } catch (error) {
      log.error('Failed to send deadline reminder', { error, rfqId }, 'deadlineReminder');
    }
  }

  /**
   * Send award notification
   */
  static async sendAwardNotification(
    rfqId: string, 
    winningSupplierId: string,
    allSupplierIds: string[]
  ): Promise<void> {
    try {
      const rfq = await sql`SELECT * FROM rfqs WHERE id = ${rfqId}`;
      if (rfq.length === 0) return;

      // Notify winning supplier
      const winner = await sql`
        SELECT * FROM suppliers WHERE id = ${winningSupplierId}`;
      
      if (winner.length > 0) {
        await this.sendEmail({
          type: 'rfq_award',
          recipientEmail: winner[0].email,
          subject: `Congratulations! RFQ ${rfq[0].rfq_number} Awarded`,
          message: `
            Dear ${winner[0].company_name},
            
            We are pleased to inform you that your quote for RFQ ${rfq[0].rfq_number} 
            has been accepted.
            
            Our procurement team will contact you shortly with further details.
          `
        });
      }

      // Notify other suppliers
      const others = allSupplierIds.filter(id => id !== winningSupplierId);
      const otherSuppliers = await sql`
        SELECT * FROM suppliers WHERE id = ANY(${others})`;
      
      for (const supplier of otherSuppliers) {
        await this.sendEmail({
          type: 'rfq_evaluation',
          recipientEmail: supplier.email,
          subject: `RFQ ${rfq[0].rfq_number} - Evaluation Complete`,
          message: `
            Dear ${supplier.company_name},
            
            Thank you for your participation in RFQ ${rfq[0].rfq_number}.
            
            After careful evaluation, we have selected another supplier for this requirement.
            We appreciate your time and effort, and look forward to future opportunities.
          `
        });
      }
    } catch (error) {
      log.error('Failed to send award notifications', { error, rfqId }, 'awardNotification');
    }
  }
}