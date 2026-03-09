/**
 * RFQ Notifications Module Index
 * Centralized exports for RFQ notification services
 */

// Real-time subscriptions
import { RFQSubscriptions } from './subscriptions';
export { RFQSubscriptions };
export type { SubscriptionFilter } from './subscriptions';

// Notification content generation
import { RFQContentGenerator } from './contentGenerator';
export { RFQContentGenerator };
export type { 
  NotificationContent,
  RFQNotificationEvent
} from './contentGenerator';

// Email services
import { RFQEmailService } from './emailService';
// @ts-ignore
import { RFQEmailValidator } from './email/email-validator';
export { RFQEmailService };
export type { 
  EmailContent, 
  EmailNotificationOptions 
} from './emailService';

// Deadline alerts
// @ts-ignore
import { RFQDeadlineAlerts } from './deadlineAlerts';
export { RFQDeadlineAlerts };
export type { 
  DeadlineAlert, 
  AlertThresholds 
// @ts-ignore
} from './deadlineAlerts';

// Backward compatibility - consolidated notification class
export class RFQNotifications {
  // Re-export subscription methods (only available methods)
  static subscribeToRFQ = RFQSubscriptions.subscribeToRFQ;
  static subscribeToResponses = RFQSubscriptions.subscribeToResponses;
  static subscribeToProjectRFQs = RFQSubscriptions.subscribeToProjectRFQs;
  static subscribeToRFQsByStatus = RFQSubscriptions.subscribeToRFQsByStatus;
  static subscribeToAllRFQs = RFQSubscriptions.subscribeToAllRFQs;
  static subscribeToSupplierRFQs = RFQSubscriptions.subscribeToSupplierRFQs;
  // TODO: Implement these methods in RFQSubscriptionManager
  // static subscribeToUpcomingDeadlines = RFQSubscriptions.subscribeToUpcomingDeadlines;
  // static subscribeToActivityFeed = RFQSubscriptions.subscribeToActivityFeed;
  // static batchSubscribeToRFQs = RFQSubscriptions.batchSubscribeToRFQs;
  // static subscribeToRFQMetrics = RFQSubscriptions.subscribeToRFQMetrics;
  // static createCustomSubscription = RFQSubscriptions.createCustomSubscription;

  // Re-export content generation methods
  static generateNotificationContent = RFQContentGenerator.generateNotificationContent;

  // Re-export email methods
  static sendSupplierNotification = RFQEmailService.sendSupplierNotification;
  static sendBulkNotifications = RFQEmailService.sendBulkNotifications;
  static validateEmailAddresses = RFQEmailValidator.validateEmailAddresses;
  static generateRFQAttachment = RFQEmailService.generateRFQAttachment;

  // Re-export deadline alert methods
  static subscribeToDeadlineAlerts = RFQDeadlineAlerts.subscribeToDeadlineAlerts;
  static getDetailedDeadlineAlerts = RFQDeadlineAlerts.getDetailedDeadlineAlerts;
  static subscribeToOverdueRFQs = RFQDeadlineAlerts.subscribeToOverdueRFQs;
  static generateDeadlineSummary = RFQDeadlineAlerts.generateDeadlineSummary;
  static formatDeadline = RFQDeadlineAlerts.formatDeadline;
  static getAlertColor = RFQDeadlineAlerts.getAlertColor;
  static suggestDeadlineExtension = RFQDeadlineAlerts.suggestDeadlineExtension;
}