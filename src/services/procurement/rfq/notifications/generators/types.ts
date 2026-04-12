/**
 * RFQ Notification Content Types
 * Common types used across notification generators
 */

export interface NotificationContent {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  actions?: Array<{
    label: string;
    action: string;
    variant?: 'default' | 'primary' | 'secondary' | 'destructive';
    href?: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface EmailContent {
  subject: string;
  content: string;
  textContent?: string;
}

export type RFQNotificationEvent = 
  | 'created' 
  | 'issued' 
  | 'response_received' 
  | 'awarded' 
  | 'closed' 
  | 'cancelled'
  | 'deadline_extended'
  | 'deadline_approaching'
  | 'overdue'
  | 'updated'
  | 'published'
  | 'withdrawn';

export type EmailEvent = 
  | 'rfq_issued' 
  | 'deadline_extended' 
  | 'cancelled'
  | 'awarded'
  | 'reminder_deadline'
  | 'response_confirmation';

export type UserRole = 'buyer' | 'supplier' | 'admin' | 'viewer';

export interface NotificationContext {
  recentActivity?: string;
  pendingActions?: string[];
  userSupplier?: string;
}