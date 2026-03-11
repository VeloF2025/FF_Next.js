/**
 * Email Delivery Service for Unified Notifications
 * Sends notification emails via Resend.
 *
 * @module notifications/services/emailDelivery
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type { NotifyPayload } from '../types';

const sql = neon(process.env.DATABASE_URL!);

const FROM_ADDRESS = 'FibreFlow <notifications@fibreflow.app>';
const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';

/**
 * Send an email notification to a user.
 * Looks up the user's email, builds or uses provided HTML, sends via Resend,
 * and logs the result to notification_delivery_log.
 */
export async function deliverEmail(
  userId: string,
  payload: NotifyPayload,
  notificationId: string | null
): Promise<void> {
  let recipientEmail: string | null = null;

  try {
    // Look up user email
    const userRows = await sql`
      SELECT email, first_name FROM users
      WHERE id = ${userId}::uuid AND is_active = TRUE
      LIMIT 1
    `;

    const userRow = userRows[0];
    if (!userRow) {
      log.warn('Email delivery: user not found or inactive', { userId }, 'EmailDelivery');
      return;
    }

    recipientEmail = userRow.email;
    const firstName = userRow.first_name || 'there';

    if (!recipientEmail) {
      log.warn('Email delivery: user has no email', { userId }, 'EmailDelivery');
      return;
    }

    // Lazy import Resend to avoid top-level throw if RESEND_API_KEY missing
    const { resend } = await import('@/lib/email/resendClient');

    const subject = payload.email_subject || payload.title;
    const html = payload.email_html || buildDefaultEmailHtml(payload, firstName);

    const sendResult = await resend.emails.send({
      from: FROM_ADDRESS,
      to: recipientEmail,
      subject,
      html,
    });

    const resendId = sendResult.data?.id || null;

    // Log success
    await logDelivery(notificationId, userId, 'email', 'sent', recipientEmail, null);

    // Record in email_outbox for unified tracking
    await sql`
      INSERT INTO email_outbox (
        sender_id, recipient_email, recipient_name, subject, body_html,
        source_module, source_id, status, resend_id, sent_at
      ) VALUES (
        ${userId}::uuid, ${recipientEmail}, ${firstName}, ${subject}, ${html},
        ${payload.source_module || 'notification'}, ${payload.source_id || null},
        'sent', ${resendId}, NOW()
      )
    `.catch(outboxErr => {
      log.warn('Failed to record email in outbox', { error: outboxErr }, 'EmailDelivery');
    });

    log.info('Email notification sent', {
      userId, to: recipientEmail, event_type: payload.event_type,
    }, 'EmailDelivery');
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('Email delivery failed', {
      userId, to: recipientEmail, error: errorMsg,
    }, 'EmailDelivery');

    await logDelivery(notificationId, userId, 'email', 'failed', recipientEmail, errorMsg).catch(() => {});
  }
}

// =============================================================================
// Default Email Template
// =============================================================================

function buildDefaultEmailHtml(payload: NotifyPayload, firstName: string): string {
  const severityColors: Record<string, string> = {
    info: '#3b82f6',
    warning: '#f59e0b',
    error: '#ef4444',
    success: '#10b981',
  };
  const color = severityColors[payload.severity || 'info'] || '#3b82f6';
  const ctaUrl = payload.action_url ? `${APP_BASE_URL}${payload.action_url}` : APP_BASE_URL;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr><td style="padding:32px 40px;background:linear-gradient(135deg,${color},${color}dd);border-radius:8px 8px 0 0;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">${escapeHtml(payload.title)}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi ${escapeHtml(firstName)},</p>
          ${payload.body ? `<p style="margin:0 0 24px;font-size:15px;color:#374151;">${escapeHtml(payload.body)}</p>` : ''}
          ${payload.action_url ? `
          <table cellpadding="0" cellspacing="0"><tr><td style="background-color:${color};border-radius:6px;">
            <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
              View Details
            </a>
          </td></tr></table>` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 40px;background-color:#f9fafb;border-radius:0 0 8px 8px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#6b7280;text-align:center;">
            FibreFlow Notifications |
            <a href="${APP_BASE_URL}/app/settings/notifications" style="color:#2563eb;text-decoration:none;">Manage Preferences</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
