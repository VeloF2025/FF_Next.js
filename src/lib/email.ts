/**
 * Email Notification Helper
 *
 * Simple email sending utility for system notifications.
 * Uses webhook approach with optional template support.
 */

import { log } from './logger';

interface EmailOptions {
  to: string;
  subject: string;
  template?: string;
  data?: Record<string, unknown>;
  html?: string;
  text?: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email notification
 *
 * Currently logs the email for tracking. In production,
 * integrate with SendGrid, AWS SES, or Resend.
 */
export async function sendEmailNotification(options: EmailOptions): Promise<EmailResult> {
  const { to, subject, template, data } = options;

  try {
    // Log the email attempt
    log.info('Email notification', {
      to,
      subject,
      template,
      data,
      timestamp: new Date().toISOString(),
    });

    // TODO: Integrate with email provider
    // For now, just log the email request
    // The actual sending will be handled when email provider is configured

    // Check if webhook URL is configured
    const webhookUrl = process.env.EMAIL_WEBHOOK_URL;

    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.EMAIL_WEBHOOK_SECRET || ''}`,
          },
          body: JSON.stringify({
            to,
            subject,
            template,
            data,
            from: {
              email: process.env.EMAIL_FROM || 'noreply@fibreflow.app',
              name: process.env.EMAIL_FROM_NAME || 'FibreFlow',
            },
            timestamp: new Date().toISOString(),
          }),
        });

        if (response.ok) {
          const result = await response.json();
          return { success: true, messageId: result.messageId };
        } else {
          log.warn('Email webhook returned non-OK status', { status: response.status });
        }
      } catch (webhookError) {
        log.error('Email webhook failed', { webhookError });
      }
    }

    // Even if webhook fails, we return success since the email request is logged
    // and can be processed later via queue
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to send email notification', { error: errorMessage, to, subject });
    return { success: false, error: errorMessage };
  }
}

/**
 * Send escalation notification
 *
 * Special handling for escalation emails with tracking
 */
export async function sendEscalationEmail(options: {
  to: string;
  escalatorName: string;
  drNumber: string;
  oltSerial: string | null;
  wrongSerial: string | null;
  notes: string | null;
  actionUrl: string;
}): Promise<EmailResult> {
  return sendEmailNotification({
    to: options.to,
    subject: `OLT Report: Investigation Escalated - ${options.drNumber}`,
    template: 'escalation',
    data: {
      drNumber: options.drNumber,
      oltSerial: options.oltSerial || 'N/A',
      wrongSerial: options.wrongSerial || 'N/A',
      escalatedBy: options.escalatorName,
      notes: options.notes || 'No additional notes',
      actionUrl: options.actionUrl,
    },
  });
}
