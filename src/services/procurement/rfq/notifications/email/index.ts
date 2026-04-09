/**
 * Email Notifications - Barrel Export
 * Centralized exports for all email notification functionality
 */

// @ts-expect-error — module lacks type declarations
export { RFQEmailSender } from './email-sender';
export { RFQEmailTemplates } from './email-templates';
// @ts-expect-error — module lacks type declarations
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