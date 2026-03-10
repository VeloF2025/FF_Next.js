/**
 * Unified Notification Bus
 * Central entry point: all modules call notify(payload) to dispatch notifications.
 * Handles in-app storage + channel dispatch (email, WhatsApp).
 *
 * @module notifications/services/notificationBus
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import {
  DEFAULT_CHANNEL_PREFERENCES,
  EVENT_ICONS,
  EVENT_SEVERITY,
} from '../constants';
import type {
  NotifyPayload,
  UserNotification,
  ChannelPreferences,
} from '../types';
import { deliverEmail } from './emailDelivery';
import { deliverWhatsApp } from './whatsappDelivery';

const sql = neon(process.env.DATABASE_URL!);

// =============================================================================
// Core notify() function
// =============================================================================

/**
 * Send a notification to one or more users.
 * Creates in-app records and dispatches to email/WA based on preferences.
 * Non-blocking — errors are logged, never thrown to callers.
 */
export async function notify(payload: NotifyPayload): Promise<void> {
  const {
    event_type,
    title,
    body,
    action_url,
    source_module,
    source_id,
    metadata,
    recipient_user_ids,
  } = payload;

  if (!recipient_user_ids || recipient_user_ids.length === 0) {
    log.warn('notify() called with no recipients', { event_type }, 'NotificationBus');
    return;
  }

  const icon = payload.icon || EVENT_ICONS[event_type] || 'bell';
  const severity = payload.severity || EVENT_SEVERITY[event_type] || 'info';

  for (const userId of recipient_user_ids) {
    try {
      const channels = await getEffectiveChannels(userId, event_type);

      // Always create in-app notification if enabled
      let notificationId: string | null = null;
      if (channels.in_app) {
        const sourceIdValue = source_id || null;
        const result = await sql`
          INSERT INTO user_notifications (
            user_id, event_type, title, body, icon, severity,
            action_url, source_module, source_id, metadata
          ) VALUES (
            ${userId}::uuid, ${event_type}, ${title}, ${body || null},
            ${icon}, ${severity}, ${action_url || null},
            ${source_module || null}, ${sourceIdValue},
            ${JSON.stringify(metadata || {})}::jsonb
          )
          RETURNING id
        `;
        notificationId = result[0]?.id || null;
      }

      // Fire-and-forget email delivery
      if (channels.email) {
        deliverEmail(userId, payload, notificationId).catch(err =>
          log.error('Email delivery failed', {
            userId, event_type, error: err instanceof Error ? err.message : String(err),
          }, 'NotificationBus')
        );
      }

      // Fire-and-forget WhatsApp delivery
      if (channels.whatsapp) {
        deliverWhatsApp(userId, payload, notificationId).catch(err =>
          log.error('WA delivery failed', {
            userId, event_type, error: err instanceof Error ? err.message : String(err),
          }, 'NotificationBus')
        );
      }
    } catch (err) {
      log.error('notify() failed for user', {
        userId, event_type, error: err instanceof Error ? err.message : String(err),
      }, 'NotificationBus');
    }
  }
}

// =============================================================================
// Channel resolution
// =============================================================================

/**
 * Determine which channels a notification should be delivered to.
 * User overrides take priority, then system defaults, then _fallback.
 */
export async function getEffectiveChannels(
  userId: string,
  eventType: string
): Promise<ChannelPreferences> {
  try {
    const rows = await sql`
      SELECT channel_in_app, channel_email, channel_whatsapp
      FROM notification_preferences
      WHERE user_id = ${userId}::uuid AND event_type = ${eventType}
      LIMIT 1
    `;

    if (rows.length > 0 && rows[0]) {
      return {
        in_app: rows[0].channel_in_app,
        email: rows[0].channel_email,
        whatsapp: rows[0].channel_whatsapp,
      };
    }
  } catch (err) {
    log.error('Failed to load notification preferences', {
      userId, eventType, error: err instanceof Error ? err.message : String(err),
    }, 'NotificationBus');
  }

  // Fall back to system defaults
  const prefs = DEFAULT_CHANNEL_PREFERENCES[eventType] || DEFAULT_CHANNEL_PREFERENCES._fallback;
  return prefs || { in_app: true, email: false, whatsapp: false };
}

// =============================================================================
// Read helpers (for API routes)
// =============================================================================

/** Get unread notification count for a user */
export async function getUnreadCount(userId: string): Promise<number> {
  const result = await sql`
    SELECT COUNT(*)::int as count
    FROM user_notifications
    WHERE user_id = ${userId}::uuid AND is_read = FALSE
  `;
  return result[0]?.count || 0;
}

/** Get notification list for a user */
export async function getNotifications(
  userId: string,
  limit = 20,
  offset = 0,
  unreadOnly = false
): Promise<UserNotification[]> {
  if (unreadOnly) {
    const rows = await sql`
      SELECT * FROM user_notifications
      WHERE user_id = ${userId}::uuid AND is_read = FALSE
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return rows as UserNotification[];
  }

  const rows = await sql`
    SELECT * FROM user_notifications
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows as UserNotification[];
}

/** Mark specific notifications as read */
export async function markAsRead(
  notificationIds: string[],
  userId: string
): Promise<number> {
  if (notificationIds.length === 0) return 0;

  const result = await sql`
    UPDATE user_notifications
    SET is_read = TRUE, read_at = NOW(), updated_at = NOW()
    WHERE id = ANY(${notificationIds}::uuid[])
      AND user_id = ${userId}::uuid
      AND is_read = FALSE
  `;
  return (result as unknown as { count: number }).count || notificationIds.length;
}

/** Mark all notifications as read for a user */
export async function markAllAsRead(userId: string): Promise<number> {
  const result = await sql`
    UPDATE user_notifications
    SET is_read = TRUE, read_at = NOW(), updated_at = NOW()
    WHERE user_id = ${userId}::uuid AND is_read = FALSE
  `;
  return (result as unknown as { count: number }).count || 0;
}
