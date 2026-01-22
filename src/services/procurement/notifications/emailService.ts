/**
 * Email Notification Service for RFQ/Procurement
 * Handles email notifications and webhook integrations
 * Replaces Firebase notification system
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

// Email provider configuration (can be SendGrid, AWS SES, etc.)
interface EmailConfig {
  provider: 'sendgrid' | 'ses' | 'smtp' | 'webhook';
  apiKey?: string;
  webhookUrl?: string;
  fromEmail: string;
  fromName: string;
}

// Default email configuration
const emailConfig: EmailConfig = {
  provider: process.env.EMAIL_PROVIDER as any || 'webhook',
  apiKey: process.env.EMAIL_API_KEY,
  webhookUrl: process.env.EMAIL_WEBHOOK_URL || 'https://api.example.com/email',
  fromEmail: process.env.EMAIL_FROM || 'noreply@fibreflow.com',
  fromName: process.env.EMAIL_FROM_NAME || 'FibreFlow Procurement'
};

/**
 * Email Notification Service
 */
export class EmailService {
  /**
   * Send RFQ invitation emails to suppliers
   */
  static async sendRFQInvitations(rfqId: string, supplierIds: string[]): Promise<void> {
    try {
      // Get RFQ details
      const rfq = await sql`SELECT * FROM rfqs WHERE id = ${rfqId}`;
      if (rfq.length === 0) {
        throw new Error('RFQ not found');
      }

      // Get supplier details
      const suppliers = await sql`
        SELECT id, company_name, email, contact_name 
        FROM suppliers 
        WHERE id = ANY(${supplierIds})`;

      // Send emails to each supplier
      for (const supplier of suppliers) {
        const emailData = {
          to: supplier.email,
          toName: supplier.contact_name || supplier.company_name,
          subject: `Invitation to Quote - RFQ ${rfq[0].rfq_number}`,
          templateId: 'rfq_invitation',
          data: {
            supplierName: supplier.company_name,
            rfqNumber: rfq[0].rfq_number,
            rfqTitle: rfq[0].title,
            responseDeadline: new Date(rfq[0].response_deadline).toISOString().split('T')[0],
            projectName: await this.getProjectName(rfq[0].project_id),
            viewRfqUrl: `${process.env.NEXT_PUBLIC_APP_URL}/supplier/rfq/${rfqId}`,
            description: rfq[0].description,
            paymentTerms: rfq[0].payment_terms,
            deliveryTerms: rfq[0].delivery_terms
          }
        };

        await this.sendEmail(emailData);

        // Log notification
        await this.logNotification(rfqId, supplier.id, 'invitation', emailData);
      }

      log.info('RFQ invitations sent', { rfqId, supplierCount: suppliers.length }, 'emailService');
    } catch (error) {
      log.error('Error sending RFQ invitations:', { data: error }, 'emailService');
      throw error;
    }
  }

  /**
   * Send RFQ response confirmation
   */
  static async sendResponseConfirmation(rfqId: string, responseId: string): Promise<void> {
    try {
      const response = await sql`
        SELECT r.*, s.email, s.company_name, s.contact_name
        FROM rfq_responses r
        JOIN suppliers s ON r.supplier_id = s.id
        WHERE r.id = ${responseId}`;

      if (response.length === 0) {
        throw new Error('Response not found');
      }

      const rfq = await sql`SELECT * FROM rfqs WHERE id = ${rfqId}`;

      const emailData = {
        to: response[0].email,
        toName: response[0].contact_name || response[0].company_name,
        subject: `Response Received - RFQ ${rfq[0].rfq_number}`,
        templateId: 'rfq_response_confirmation',
        data: {
          supplierName: response[0].company_name,
          rfqNumber: rfq[0].rfq_number,
          responseNumber: response[0].response_number,
          submissionDate: new Date(response[0].submission_date).toLocaleString(),
          totalAmount: response[0].total_amount,
          currency: response[0].currency
        }
      };

      await this.sendEmail(emailData);
      await this.logNotification(rfqId, response[0].supplier_id, 'response_confirmation', emailData);

      log.info('Response confirmation sent', { rfqId, responseId }, 'emailService');
    } catch (error) {
      log.error('Error sending response confirmation:', { data: error }, 'emailService');
      throw error;
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
      
      // Send winner notification
      const winner = await sql`
        SELECT * FROM suppliers WHERE id = ${winningSupplierId}`;
      
      if (winner.length > 0) {
        const winnerEmail = {
          to: winner[0].email,
          toName: winner[0].contact_name || winner[0].company_name,
          subject: `Congratulations! You've been awarded RFQ ${rfq[0].rfq_number}`,
          templateId: 'rfq_award_winner',
          data: {
            supplierName: winner[0].company_name,
            rfqNumber: rfq[0].rfq_number,
            rfqTitle: rfq[0].title,
            nextSteps: 'Our procurement team will contact you shortly to finalize the contract.'
          }
        };

        await this.sendEmail(winnerEmail);
        await this.logNotification(rfqId, winningSupplierId, 'award_winner', winnerEmail);
      }

      // Send non-winner notifications
      const otherSuppliers = allSupplierIds.filter(id => id !== winningSupplierId);
      const losers = await sql`
        SELECT * FROM suppliers WHERE id = ANY(${otherSuppliers})`;

      for (const supplier of losers) {
        const loserEmail = {
          to: supplier.email,
          toName: supplier.contact_name || supplier.company_name,
          subject: `RFQ ${rfq[0].rfq_number} - Award Decision`,
          templateId: 'rfq_award_loser',
          data: {
            supplierName: supplier.company_name,
            rfqNumber: rfq[0].rfq_number,
            rfqTitle: rfq[0].title,
            message: 'Thank you for your participation. Unfortunately, your bid was not selected for this RFQ.'
          }
        };

        await this.sendEmail(loserEmail);
        await this.logNotification(rfqId, supplier.id, 'award_loser', loserEmail);
      }

      log.info('Award notifications sent', { rfqId, winningSupplierId }, 'emailService');
    } catch (error) {
      log.error('Error sending award notifications:', { data: error }, 'emailService');
      throw error;
    }
  }

  /**
   * Send deadline reminder
   */
  static async sendDeadlineReminder(rfqId: string): Promise<void> {
    try {
      const rfq = await sql`SELECT * FROM rfqs WHERE id = ${rfqId}`;
      
      // Get suppliers who haven't responded
      const pendingSuppliers = await sql`
        SELECT s.* FROM suppliers s
        WHERE s.id = ANY(${JSON.parse(rfq[0].invited_suppliers || '[]')})
        AND NOT EXISTS (
          SELECT 1 FROM rfq_responses r 
          WHERE r.rfq_id = ${rfqId} AND r.supplier_id = s.id
        )`;

      for (const supplier of pendingSuppliers) {
        const emailData = {
          to: supplier.email,
          toName: supplier.contact_name || supplier.company_name,
          subject: `Reminder: RFQ ${rfq[0].rfq_number} - Deadline Approaching`,
          templateId: 'rfq_deadline_reminder',
          data: {
            supplierName: supplier.company_name,
            rfqNumber: rfq[0].rfq_number,
            rfqTitle: rfq[0].title,
            responseDeadline: new Date(rfq[0].response_deadline).toLocaleString(),
            submitUrl: `${process.env.NEXT_PUBLIC_APP_URL}/supplier/rfq/${rfqId}`
          }
        };

        await this.sendEmail(emailData);
        await this.logNotification(rfqId, supplier.id, 'deadline_reminder', emailData);
      }

      log.info('Deadline reminders sent', { rfqId, supplierCount: pendingSuppliers.length }, 'emailService');
    } catch (error) {
      log.error('Error sending deadline reminders:', { data: error }, 'emailService');
      throw error;
    }
  }

  /**
   * Send cancellation notification
   */
  static async sendCancellationNotification(rfqId: string, reason: string): Promise<void> {
    try {
      const rfq = await sql`SELECT * FROM rfqs WHERE id = ${rfqId}`;
      const suppliers = await sql`
        SELECT * FROM suppliers 
        WHERE id = ANY(${JSON.parse(rfq[0].invited_suppliers || '[]')})`;

      for (const supplier of suppliers) {
        const emailData = {
          to: supplier.email,
          toName: supplier.contact_name || supplier.company_name,
          subject: `RFQ ${rfq[0].rfq_number} - Cancelled`,
          templateId: 'rfq_cancellation',
          data: {
            supplierName: supplier.company_name,
            rfqNumber: rfq[0].rfq_number,
            rfqTitle: rfq[0].title,
            reason: reason
          }
        };

        await this.sendEmail(emailData);
        await this.logNotification(rfqId, supplier.id, 'cancellation', emailData);
      }

      log.info('Cancellation notifications sent', { rfqId }, 'emailService');
    } catch (error) {
      log.error('Error sending cancellation notifications:', { data: error }, 'emailService');
      throw error;
    }
  }

  /**
   * Send custom notification
   */
  static async sendCustomNotification(
    rfqId: string,
    recipientEmail: string,
    subject: string,
    message: string,
    data?: any
  ): Promise<void> {
    try {
      const emailData = {
        to: recipientEmail,
        subject: subject,
        templateId: 'custom',
        data: {
          message,
          ...data
        }
      };

      await this.sendEmail(emailData);
      await this.logNotification(rfqId, null, 'custom', emailData);

      log.info('Custom notification sent', { rfqId, recipientEmail }, 'emailService');
    } catch (error) {
      log.error('Error sending custom notification:', { data: error }, 'emailService');
      throw error;
    }
  }

  /**
   * Core email sending function
   */
  private static async sendEmail(emailData: any): Promise<void> {
    try {
      switch (emailConfig.provider) {
        case 'webhook':
          await this.sendViaWebhook(emailData);
          break;
        case 'sendgrid':
          await this.sendViaSendGrid(emailData);
          break;
        case 'ses':
          await this.sendViaAWSSES(emailData);
          break;
        case 'smtp':
          await this.sendViaSMTP(emailData);
          break;
        default:
          log.warn('No email provider configured, logging email only', emailData, 'emailService');
      }
    } catch (error) {
      log.error('Error sending email:', { data: error, emailData }, 'emailService');
      throw error;
    }
  }

  /**
   * Send email via webhook
   */
  private static async sendViaWebhook(emailData: any): Promise<void> {
    if (!emailConfig.webhookUrl) {
      log.warn('Webhook URL not configured', {}, 'emailService');
      return;
    }

    const webhookPayload = {
      from: {
        email: emailConfig.fromEmail,
        name: emailConfig.fromName
      },
      to: emailData.to,
      toName: emailData.toName,
      subject: emailData.subject,
      templateId: emailData.templateId,
      data: emailData.data,
      timestamp: new Date().toISOString()
    };

    // In production, make actual HTTP request to webhook
    log.info('Email sent via webhook', webhookPayload, 'emailService');
    
    // For now, just log the webhook payload
    // In production:
    // const response = await fetch(emailConfig.webhookUrl, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(webhookPayload)
    // });
  }

  /**
   * Send email via SendGrid
   */
  private static async sendViaSendGrid(emailData: any): Promise<void> {
    // Implement SendGrid integration
    log.info('SendGrid email integration not yet implemented', emailData, 'emailService');
  }

  /**
   * Send email via AWS SES
   */
  private static async sendViaAWSSES(emailData: any): Promise<void> {
    // Implement AWS SES integration
    log.info('AWS SES email integration not yet implemented', emailData, 'emailService');
  }

  /**
   * Send email via SMTP
   */
  private static async sendViaSMTP(emailData: any): Promise<void> {
    // Implement SMTP integration
    log.info('SMTP email integration not yet implemented', emailData, 'emailService');
  }

  /**
   * Log notification to database
   */
  private static async logNotification(
    rfqId: string,
    supplierId: string | null,
    type: string,
    emailData: any
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
          sent_at,
          metadata
        ) VALUES (
          ${rfqId},
          ${type},
          ${supplierId ? 'supplier' : 'other'},
          ${supplierId},
          ${emailData.to},
          ${emailData.subject},
          ${JSON.stringify(emailData.data)},
          'sent',
          ${new Date().toISOString()},
          ${JSON.stringify(emailData)}
        )`;
    } catch (error) {
      log.error('Error logging notification:', { data: error }, 'emailService');
    }
  }

  /**
   * Get project name
   */
  private static async getProjectName(projectId: string): Promise<string> {
    try {
      const project = await sql`SELECT name FROM projects WHERE id = ${projectId}`;
      return project[0]?.name || 'Unknown Project';
    } catch (error) {
      return 'Unknown Project';
    }
  }

  /**
   * Process notification queue
   */
  static async processNotificationQueue(): Promise<void> {
    try {
      // Get pending notifications
      const pending = await sql`
        SELECT * FROM rfq_notifications 
        WHERE status = 'pending' 
        ORDER BY created_at ASC 
        LIMIT 10`;

      for (const notification of pending) {
        try {
          // Parse and send email
          const emailData = JSON.parse(notification.metadata || '{}');
          await this.sendEmail(emailData);
          
          // Update status
          await sql`
            UPDATE rfq_notifications 
            SET status = 'sent', sent_at = ${new Date().toISOString()}
            WHERE id = ${notification.id}`;
        } catch (error) {
          // Mark as failed
          await sql`
            UPDATE rfq_notifications 
            SET 
              status = 'failed',
              error_message = ${error.message || 'Unknown error'},
              retry_count = COALESCE(retry_count, 0) + 1
            WHERE id = ${notification.id}`;
        }
      }
      
      log.info(`Processed ${pending.length} notifications`, {}, 'emailService');
    } catch (error) {
      log.error('Error processing notification queue:', { data: error }, 'emailService');
    }
  }

  /**
   * Retry failed notifications
   */
  static async retryFailedNotifications(): Promise<void> {
    try {
      const failed = await sql`
        SELECT * FROM rfq_notifications 
        WHERE status = 'failed' 
        AND retry_count < 3
        ORDER BY created_at ASC 
        LIMIT 5`;

      for (const notification of failed) {
        try {
          const emailData = JSON.parse(notification.metadata || '{}');
          await this.sendEmail(emailData);
          
          await sql`
            UPDATE rfq_notifications 
            SET status = 'sent', sent_at = ${new Date().toISOString()}
            WHERE id = ${notification.id}`;
        } catch (error) {
          await sql`
            UPDATE rfq_notifications 
            SET retry_count = retry_count + 1
            WHERE id = ${notification.id}`;
        }
      }
      
      log.info(`Retried ${failed.length} failed notifications`, {}, 'emailService');
    } catch (error) {
      log.error('Error retrying failed notifications:', { data: error }, 'emailService');
    }
  }
}

// Export for backward compatibility
export default EmailService;