/**
 * Email Notifications - Barrel Export
 * Centralized exports for all email notification functionality
 */

// @ts-ignore
export { RFQEmailSender } from './email-sender';
export { RFQEmailTemplates } from './email-templates';
// @ts-ignore
export { RFQEmailValidator } from './email-validator';

export type {
  EmailContent,
  EmailNotificationOptions,
  BulkNotification,
  EmailValidationResult,
  EmailTemplate,
  EmailProvider,
  EmailEvent
} from './email-types';