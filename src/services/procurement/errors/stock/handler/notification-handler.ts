/**
 * Notification Handler
 * Handles error notifications and escalation
 */

import { RecoveryOption } from './handler-types';
import { log } from '@/lib/logger';

interface NotificationConfig {
  email: {
    enabled: boolean;
    recipients: string[];
    escalationRecipients: string[];
  };
  sms: {
    enabled: boolean;
    recipients: string[];
  };
  webhook: {
    enabled: boolean;
    url: string;
  };
}

/** Shape of a stock error as used by this notification handler */
interface StockError {
  constructor: { name: string };
  message: string;
  itemCode?: string;
  location?: string;
  quantity?: number;
}

/** Severity union used across notification methods */
type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Error notification handler
 */
export class NotificationHandler {
  private static config: NotificationConfig = {
    email: {
      enabled: true,
      recipients: ['inventory@fibreflow.com'],
      escalationRecipients: ['manager@fibreflow.com']
    },
    sms: {
      enabled: false,
      recipients: []
    },
    webhook: {
      enabled: true,
      url: '/api/webhooks/stock-errors'
    }
  };

  /**
   * Send error notification
   */
  static async sendErrorNotification({
    error,
    severity,
    recoveryOptions,
    attemptCount = 0
  }: {
    error: StockError;
    severity: Severity;
    recoveryOptions: RecoveryOption[];
    attemptCount?: number;
  }): Promise<{
    sent: boolean;
    channels: string[];
    messageId?: string;
  }> {
    const channels: string[] = [];
    let sent = false;

    try {
      // Email notification
      if (this.config.email.enabled) {
        await this.sendEmailNotification(error, severity, recoveryOptions, attemptCount);
        channels.push('email');
        sent = true;
      }

      // SMS for critical errors
      if (severity === 'critical' && this.config.sms.enabled) {
        await this.sendSMSNotification(error, severity);
        channels.push('sms');
        sent = true;
      }

      // Webhook notification
      if (this.config.webhook.enabled) {
        await this.sendWebhookNotification(error, severity, recoveryOptions);
        channels.push('webhook');
        sent = true;
      }

      return {
        sent,
        channels,
        messageId: 'MSG-' + Date.now()
      };
    } catch (notificationError) {
      log.error('Failed to send error notification:', { data: notificationError }, 'notification-handler');
      return {
        sent: false,
        channels: []
      };
    }
  }

  /**
   * Send recovery success notification
   */
  static async sendRecoveryNotification({
    originalError,
    recoveryOption,
    recoveryResult
  }: {
    originalError: StockError;
    recoveryOption: RecoveryOption;
    recoveryResult: unknown;
  }): Promise<boolean> {
    try {
      const message = {
        type: 'recovery_success',
        timestamp: new Date().toISOString(),
        originalError: {
          type: originalError.constructor.name,
          message: originalError.message,
          itemCode: originalError.itemCode || 'N/A'
        },
        recovery: {
          type: recoveryOption.type,
          description: recoveryOption.description,
          result: recoveryResult
        }
      };

      if (this.config.webhook.enabled) {
        await fetch(this.config.webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message)
        });
      }

      return true;
    } catch (error) {
      log.error('Failed to send recovery notification:', { data: error }, 'notification-handler');
      return false;
    }
  }

  /**
   * Determine if error should trigger escalation
   */
  static shouldEscalate({
    error: _error,
    severity,
    attemptCount,
    timeElapsed
  }: {
    error: StockError;
    severity: Severity;
    attemptCount: number;
    timeElapsed: number; // minutes
  }): boolean {
    // Critical errors always escalate
    if (severity === 'critical') {
      return true;
    }

    // High severity errors escalate after 2 attempts or 30 minutes
    if (severity === 'high' && (attemptCount >= 2 || timeElapsed >= 30)) {
      return true;
    }

    // Medium severity errors escalate after 3 attempts or 60 minutes
    if (severity === 'medium' && (attemptCount >= 3 || timeElapsed >= 60)) {
      return true;
    }

    return false;
  }

  // Private notification methods
  private static async sendEmailNotification(
    error: StockError,
    severity: Severity,
    recoveryOptions: RecoveryOption[],
    attemptCount: number
  ): Promise<void> {
    const recipients = this.shouldEscalate({ error, severity, attemptCount, timeElapsed: 0 })
      ? this.config.email.escalationRecipients
      : this.config.email.recipients;

    // Mock email sending - would integrate with actual email service
    const emailData = {
      to: recipients,
      subject: `Stock Error Alert - ${severity.toUpperCase()} - ${error.constructor.name}`,
      body: this.formatEmailBody(error, severity, recoveryOptions, attemptCount)
    };

    log.debug('Email notification would be sent:', emailData, 'notification-handler');
  }

  private static async sendSMSNotification(error: StockError, _severity: Severity): Promise<void> {
    // Mock SMS sending - would integrate with SMS service
    const smsMessage = `CRITICAL STOCK ERROR: ${error.constructor.name} - Item: ${error.itemCode || 'N/A'} - Immediate attention required`;

    // TODO: Replace with actual SMS service integration
    log.warn('SMS notification would be sent:', { data: smsMessage }, 'notification-handler');
  }

  private static async sendWebhookNotification(
    error: StockError,
    severity: Severity,
    recoveryOptions: RecoveryOption[]
  ): Promise<void> {
    // Mock webhook sending - would integrate with webhook service
    const webhookData = {
      type: 'stock_error',
      timestamp: new Date().toISOString(),
      severity,
      error: {
        type: error.constructor.name,
        message: error.message,
        itemCode: error.itemCode || null,
        location: error.location || null,
        quantity: error.quantity || null
      },
      recoveryOptions: recoveryOptions.map(option => ({
        type: option.type,
        description: option.description,
        priority: option.priority
      }))
    };

    log.debug('Webhook notification would be sent:', { data: webhookData }, 'notification-handler');
  }

  private static formatEmailBody(
    error: StockError,
    severity: Severity,
    recoveryOptions: RecoveryOption[],
    attemptCount: number
  ): string {
    return `
      <h2>Stock Error Alert - ${severity.toUpperCase()}</h2>
      <p><strong>Error Type:</strong> ${error.constructor.name}</p>
      <p><strong>Message:</strong> ${error.message}</p>
      <p><strong>Item Code:</strong> ${error.itemCode || 'N/A'}</p>
      <p><strong>Location:</strong> ${error.location || 'N/A'}</p>
      <p><strong>Attempt Count:</strong> ${attemptCount}</p>

      <h3>Available Recovery Options:</h3>
      <ul>
        ${recoveryOptions.map(option => `
          <li>
            <strong>${option.type}:</strong> ${option.description}
            <br><small>Priority: ${option.priority}, Est. Time: ${option.estimatedTime || 'N/A'}</small>
          </li>
        `).join('')}
      </ul>

      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    `;
  }
}
