/**
 * WhatsApp Delivery Service for Unified Notifications
 * Supports group messages (via WA Feedback proxy) and individual DMs (via WAHA).
 *
 * @module notifications/services/whatsappDelivery
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type { NotifyPayload } from '../types';

const sql = neon(process.env.DATABASE_URL!);

// WA Bridge on VPS (direct — legacy 8092 proxy is deprecated)
const WA_FEEDBACK_URL = process.env.WA_BRIDGE_URL || process.env.WA_FEEDBACK_URL || 'http://72.61.197.178:8083';

// WAHA API (for individual DMs) — proven in fleet-check-reminders.ts
const WAHA_API_URL = process.env.WAHA_API_URL || 'http://100.96.203.105:3001';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

/**
 * Send a WhatsApp notification to a user.
 * If wa_group_jid is provided → group message via bridge.
 * Otherwise → individual DM via WAHA (looks up phone from staff table).
 */
export async function deliverWhatsApp(
  userId: string,
  payload: NotifyPayload,
  notificationId: string | null
): Promise<void> {
  try {
    const message = payload.wa_message || buildDefaultWAMessage(payload);

    if (payload.wa_group_jid) {
      // Group message via bridge
      await sendWhatsAppGroup(payload.wa_group_jid, message);
      await logDelivery(notificationId, userId, 'whatsapp', 'sent', payload.wa_group_jid, null);
      log.info('WA group notification sent', {
        userId, group: payload.wa_group_jid, event_type: payload.event_type,
      }, 'WADelivery');
      return;
    }

    // Individual DM — look up phone from staff table
    const phone = await lookupUserPhone(userId);
    if (!phone) {
      log.warn('WA delivery: no phone found for user', { userId }, 'WADelivery');
      await logDelivery(notificationId, userId, 'whatsapp', 'skipped', null, 'no_phone');
      return;
    }

    await sendWhatsAppDM(phone, message);
    await logDelivery(notificationId, userId, 'whatsapp', 'sent', phone, null);
    log.info('WA DM notification sent', {
      userId, phone: maskPhone(phone), event_type: payload.event_type,
    }, 'WADelivery');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('WA delivery failed', {
      userId, error: errorMsg,
    }, 'WADelivery');

    await logDelivery(notificationId, userId, 'whatsapp', 'failed', null, errorMsg).catch(() => {});
  }
}

// =============================================================================
// Group Messages (via WA Feedback proxy → bridge)
// =============================================================================

/**
 * Send a group WhatsApp message.
 * Uses the WA Feedback proxy at 8092 which forwards to the bridge.
 */
export async function sendWhatsAppGroup(
  groupJid: string,
  message: string,
  mentionJid?: string
): Promise<void> {
  const body: Record<string, string> = {
    group_jid: groupJid,
    message,
  };
  if (mentionJid) {
    body.recipient_jid = mentionJid;
  }

  const response = await fetch(`${WA_FEEDBACK_URL}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw new Error(`WA group send failed: HTTP ${response.status} — ${text}`);
  }
}

// =============================================================================
// Individual DMs (via WAHA on Velocity:3001)
// =============================================================================

/**
 * Send an individual WhatsApp DM via WAHA.
 * Phone format: +27821234567 or 0821234567 → 27821234567@c.us
 */
export async function sendWhatsAppDM(phone: string, message: string): Promise<void> {
  const chatId = formatPhoneForWAHA(phone);

  const response = await fetch(`${WAHA_API_URL}/api/sendText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: WAHA_SESSION,
      chatId,
      text: message,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw new Error(`WAHA DM failed: HTTP ${response.status} — ${text}`);
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Look up phone number for a user via staff table */
async function lookupUserPhone(userId: string): Promise<string | null> {
  try {
    // Try staff table first (staff.user_id → staff.phone)
    const staffRows = await sql`
      SELECT phone FROM staff
      WHERE user_id = ${userId}::uuid AND phone IS NOT NULL
      LIMIT 1
    `;
    const staffRow = staffRows[0];
    if (staffRow && staffRow.phone) {
      return staffRow.phone as string;
    }

    // Fallback: users table
    const userRows = await sql`
      SELECT phone_number AS phone FROM users
      WHERE id = ${userId}::uuid AND phone_number IS NOT NULL
      LIMIT 1
    `;
    const userRow = userRows[0];
    if (userRow && userRow.phone) {
      return userRow.phone as string;
    }

    return null;
  } catch {
    return null;
  }
}

/** Format phone number for WAHA: +27xxx or 0xxx → 27xxx@c.us */
function formatPhoneForWAHA(phone: string): string {
  let cleaned = phone.replace(/[^\d]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '27' + cleaned.substring(1);
  }
  return `${cleaned}@c.us`;
}

/** Build default WA message from notification payload */
function buildDefaultWAMessage(payload: NotifyPayload): string {
  let msg = payload.title;
  if (payload.body) {
    msg += `\n\n${payload.body}`;
  }
  if (payload.action_url) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';
    msg += `\n\n${baseUrl}${payload.action_url}`;
  }
  return msg;
}

/** Mask phone for logging */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
}

// =============================================================================
// Delivery Log
// =============================================================================

async function logDelivery(
  notificationId: string | null,
  userId: string,
  channel: string,
  status: string,
  recipientAddress: string | null,
  errorMessage: string | null
): Promise<void> {
  await sql`
    INSERT INTO notification_delivery_log (
      notification_id, user_id, channel, status, recipient_address, error_message
    ) VALUES (
      ${notificationId}, ${userId}::uuid, ${channel}, ${status},
      ${recipientAddress}, ${errorMessage}
    )
  `;
}
