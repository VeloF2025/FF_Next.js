/**
 * WhatsApp Send Custom Message API
 * POST /api/communications/whatsapp/send-message - Send a custom message to a group
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type { WaAdminApiResponse, WaTestMessageResult } from '@/modules/communications/whatsapp/types/wa-admin.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

// Service URLs - use Tailscale IP for consistency across environments
const WA_SENDER_URL = process.env.WHATSAPP_SENDER_URL || 'http://100.96.203.105:8081';

interface SendMessageInput {
  group_id: string;
  message: string;
  mention_phone?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaTestMessageResult>>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { group_id, message, mention_phone } = req.body as SendMessageInput;

  if (!group_id) {
    return res.status(400).json({
      success: false,
      error: 'Group ID is required',
    });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Message is required',
    });
  }

  // Validate message length
  if (message.length > 4096) {
    return res.status(400).json({
      success: false,
      error: 'Message too long (max 4096 characters)',
    });
  }

  try {
    // Get the group
    const groupResult = await pool.query(
      `SELECT id, project_name, group_jid, group_name, enabled
      FROM wa_group_config
      WHERE id = $1::uuid`,
      [group_id]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }

    const group = groupResult.rows[0];

    if (!group.enabled) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send message to disabled group',
      });
    }

    // Format recipient JID for mentions
    let recipientJid = '0@s.whatsapp.net'; // Default: no mention
    if (mention_phone) {
      // Clean and format phone number
      let phone = mention_phone.replace(/[^0-9]/g, '');
      if (phone.startsWith('0')) {
        phone = '27' + phone.substring(1); // SA country code
      }
      recipientJid = `${phone}@s.whatsapp.net`;
    }

    // Send the message via WhatsApp Sender service
    const sendResult = await sendMessage(group.group_jid, recipientJid, message.trim());

    // Log the message
    await pool.query(
      `INSERT INTO wa_message_logs (
        direction, service, message_type, group_jid, recipient_jid, message_content,
        status, project, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        'outbound',
        'sender',
        'custom',
        group.group_jid,
        mention_phone ? recipientJid : null,
        message.trim(),
        sendResult.success ? 'sent' : 'failed',
        group.project_name,
      ]
    );

    // Log admin action
    await logAdminAction('send_message', 'group', group_id, null, {
      group_jid: group.group_jid,
      message_preview: message.substring(0, 100),
      mention_phone: mention_phone || null,
      success: sendResult.success,
    }, req);

    if (!sendResult.success) {
      return res.status(500).json({
        success: false,
        error: sendResult.error_message || 'Failed to send message',
        data: sendResult,
      });
    }

    return res.status(200).json({
      success: true,
      data: sendResult,
      message: `Message sent to "${group.project_name}"`,
    });

  } catch (error) {
    console.error('[WA Send Message API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Send message via WhatsApp Sender service
 */
async function sendMessage(
  groupJid: string,
  recipientJid: string,
  message: string
): Promise<WaTestMessageResult> {
  try {
    const response = await fetch(`${WA_SENDER_URL}/send-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        group_jid: groupJid,
        recipient_jid: recipientJid,
        message: message,
      }),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message_id: null,
        sent_at: new Date().toISOString(),
        error_message: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const result = await response.json();

    return {
      success: true,
      message_id: result.message_id || null,
      sent_at: new Date().toISOString(),
      error_message: null,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message_id: null,
      sent_at: new Date().toISOString(),
      error_message: errorMessage,
    };
  }
}

/**
 * Log admin action to audit table
 */
async function logAdminAction(
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue: unknown,
  newValue: unknown,
  req: NextApiRequest
) {
  try {
    const userEmail = req.headers['x-user-email'] as string || null;
    const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || null;

    await pool.query(
      `INSERT INTO wa_admin_audit_log (
        action, entity_type, entity_id, old_value, new_value, user_email, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        action,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        userEmail,
        typeof ipAddress === 'string' ? ipAddress.split(',')[0] : ipAddress,
      ]
    );
  } catch (error) {
    console.error('[WA Admin] Failed to log audit action:', error);
  }
}
