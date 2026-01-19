/**
 * Ticketing Module - WhatsApp Notification Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for WhatsApp notifications via WAHA API,
 * delivery tracking, and notification templates.
 */

/**
 * Recipient Type - Who is receiving the notification
 */
export enum RecipientType {
  CONTRACTOR = 'contractor',
  TECHNICIAN = 'technician',
  CLIENT = 'client',
  TEAM = 'team',
}

/**
 * Notification Status - Delivery tracking
 */
export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
}

/**
 * WhatsApp Notification Interface
 * Tracks WhatsApp message delivery via WAHA API
 */
export interface WhatsAppNotification {
  // Primary identification
  id: string; // UUID
  ticket_id: string | null; // UUID reference to tickets

  // Recipient details
  recipient_type: RecipientType;
  recipient_phone: string | null;
  recipient_name: string | null;

  // Message details
  message_template: string | null; // Template identifier
  message_content: string; // Actual message text

  // Delivery tracking
  status: NotificationStatus;
  waha_message_id: string | null; // WAHA API message ID
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  error_message: string | null;

  // Timestamp
  created_at: Date;
}

/**
 * Create notification payload
 */
export interface CreateNotificationPayload {
  ticket_id?: string;
  recipient_type: RecipientType;
  recipient_phone: string;
  recipient_name?: string;
  message_template?: string;
  message_content: string;
}

/**
 * Update notification status payload
 */
export interface UpdateNotificationStatusPayload {
  status: NotificationStatus;
  waha_message_id?: string;
  sent_at?: Date;
  delivered_at?: Date;
  read_at?: Date;
  error_message?: string;
}

/**
 * WhatsApp notification template
 */
export interface NotificationTemplate {
  id: string;
  name: string;
  description: string;
  template: string; // Template string with {{variables}}
  variables: string[]; // List of required variables
  use_case: NotificationUseCase;
}

/**
 * Notification use cases
 */
export enum NotificationUseCase {
  TICKET_ASSIGNED = 'ticket_assigned',
  QA_REJECTED = 'qa_rejected',
  QA_APPROVED = 'qa_approved',
  TICKET_CLOSED = 'ticket_closed',
  SLA_WARNING = 'sla_warning',
  RISK_EXPIRING = 'risk_expiring',
  ESCALATION_CREATED = 'escalation_created',
  HANDOVER_COMPLETE = 'handover_complete',
}

/**
 * Notification template variables
 */
export interface NotificationVariables {
  ticket_uid?: string;
  ticket_title?: string;
  assignee_name?: string;
  contractor_name?: string;
  dr_number?: string;
  rejection_reason?: string;
  sla_due_time?: string;
  risk_description?: string;
  expiry_date?: string;
  [key: string]: string | undefined; // Allow additional variables
}

/**
 * Send notification request
 */
export interface SendNotificationRequest {
  ticket_id?: string;
  recipient_type: RecipientType;
  recipient_phone: string;
  recipient_name?: string;
  template_id?: string;
  variables?: NotificationVariables;
  message_content?: string; // Override template
}

/**
 * Notification delivery status
 */
export interface NotificationDeliveryStatus {
  notification_id: string;
  ticket_id: string | null;
  status: NotificationStatus;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  error_message: string | null;
  retry_count: number;
  can_retry: boolean;
}

/**
 * Notification filters for listing
 */
export interface NotificationFilters {
  ticket_id?: string;
  recipient_type?: RecipientType | RecipientType[];
  status?: NotificationStatus | NotificationStatus[];
  sent_after?: Date;
  sent_before?: Date;
  failed_only?: boolean;
}

/**
 * Notification list response
 */
export interface NotificationListResponse {
  notifications: WhatsAppNotification[];
  total: number;
  by_status: Record<NotificationStatus, number>;
  delivery_rate: number; // Percentage of successfully delivered
}

/**
 * Notification statistics
 */
export interface NotificationStats {
  total_sent: number;
  delivered: number;
  failed: number;
  pending: number;
  delivery_rate: number;
  avg_delivery_time_seconds: number;
  by_recipient_type: Record<RecipientType, number>;
  by_use_case: Record<NotificationUseCase, number>;
}

/**
 * WAHA API webhook payload
 * Incoming webhook from WAHA for delivery status
 */
export interface WAHAWebhookPayload {
  event: 'message.sent' | 'message.delivered' | 'message.read' | 'message.failed';
  message_id: string;
  timestamp: Date;
  phone: string;
  error?: string;
}

/**
 * Notification retry configuration
 */
export interface NotificationRetryConfig {
  max_retries: number;
  retry_delay_seconds: number;
  exponential_backoff: boolean;
}

/**
 * Batch notification request
 */
export interface BatchNotificationRequest {
  ticket_ids?: string[];
  recipient_type: RecipientType;
  template_id: string;
  variables_per_ticket?: Record<string, NotificationVariables>; // ticket_id -> variables
}

/**
 * Batch notification result
 */
export interface BatchNotificationResult {
  total: number;
  sent: number;
  failed: number;
  notification_ids: string[];
  errors: Array<{
    ticket_id?: string;
    error: string;
  }>;
}
