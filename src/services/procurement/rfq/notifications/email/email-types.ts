/**
 * Email Types
 * Type definitions for RFQ email notifications
 */

export interface EmailContent {
  subject: string;
  content: string;
}

export interface EmailNotificationOptions {
  to: string[];
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

export interface BulkNotification {
  suppliers: string[];
  event: 'rfq_issued' | 'deadline_extended' | 'cancelled';
  rfq: Record<string, unknown>;
  additionalData?: Record<string, unknown>;
}

export interface EmailValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface EmailTemplate {
  subject: string;
  htmlContent: string;
  textContent?: string;
  variables?: Record<string, unknown>;
}

export interface EmailProvider {
  name: 'sendgrid' | 'ses' | 'mailgun' | 'smtp';
  config: Record<string, unknown>;
}

export type EmailEvent = 
  | 'rfq_issued' 
  | 'deadline_extended' 
  | 'cancelled' 
  | 'response_received'
  | 'award_notification'
  | 'clarification_request';