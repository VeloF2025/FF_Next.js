/**
 * Unified Notification Service - Type Definitions
 * @module notifications/types
 */

/** Severity levels for notifications */
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';

/** Delivery channels */
export type NotificationChannel = 'in_app' | 'email' | 'whatsapp';

/** Channel preference flags */
export interface ChannelPreferences {
  in_app: boolean;
  email: boolean;
  whatsapp: boolean;
}

/** Stored in-app notification (from user_notifications table) */
export interface UserNotification {
  id: string;
  user_id: string;
  event_type: string;
  title: string;
  body: string | null;
  icon: string;
  severity: NotificationSeverity;
  action_url: string | null;
  source_module: string | null;
  source_id: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload passed to notify() by calling modules */
export interface NotifyPayload {
  /** Event type key, e.g. 'maintenance.ticket_assigned' */
  event_type: string;
  /** Title shown in bell dropdown */
  title: string;
  /** Optional body text for detail */
  body?: string;
  /** Lucide icon name override (defaults from EVENT_ICONS) */
  icon?: string;
  /** Severity override (defaults from EVENT_SEVERITY) */
  severity?: NotificationSeverity;
  /** In-app link when notification is clicked */
  action_url?: string;
  /** Source module name for grouping */
  source_module?: string;
  /** Source entity ID (ticket, project, etc.) */
  source_id?: string;
  /** Additional metadata stored as JSONB */
  metadata?: Record<string, unknown>;
  /** User IDs to notify — caller resolves recipients */
  recipient_user_ids: string[];
  /** Custom HTML for email (optional, else default template used) */
  email_html?: string;
  /** Custom email subject (defaults to title) */
  email_subject?: string;
  /** WA group JID for group messages (optional) */
  wa_group_jid?: string;
  /** Custom WA message text (optional, else title+body used) */
  wa_message?: string;
}

/** Notification preference row from DB */
export interface NotificationPreference {
  user_id: string;
  event_type: string;
  channel_in_app: boolean;
  channel_email: boolean;
  channel_whatsapp: boolean;
}

/** Delivery log entry */
export interface DeliveryLogEntry {
  id: string;
  notification_id: string | null;
  user_id: string;
  channel: NotificationChannel;
  status: 'sent' | 'delivered' | 'failed' | 'skipped';
  recipient_address: string | null;
  error_message: string | null;
  sent_at: string;
}

/** Merged preference (system default + user override) for API response */
export interface MergedPreference {
  event_type: string;
  label: string;
  group: string;
  channel_in_app: boolean;
  channel_email: boolean;
  channel_whatsapp: boolean;
  is_user_override: boolean;
}
