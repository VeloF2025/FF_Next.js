/**
 * WhatsApp Group Test Message API
 * POST /api/communications/whatsapp/groups/[id]/test - Send a test message to a group
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaTestMessageResult>>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Group ID is required',
    });
  }

  try {
    // Get the group
    const groupResult = await pool.query(
      `SELECT id, project_name, group_jid, group_name, enabled
      FROM wa_group_config
      WHERE id = $1::uuid`,
      [id]
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
        error: 'Cannot send test message to disabled group',
      });
    }

    // Get test message template from database
    const templateResult = await pool.query(
      `SELECT template_content FROM wa_message_templates
      WHERE template_key = 'test_message' AND enabled = true`
    );

    let messageContent: string;
    if (templateResult.rows.length > 0) {
      // Use template with variable substitution
      messageContent = templateResult.rows[0].template_content
        .replace('{{timestamp}}', new Date().toISOString())
        .replace('{{service}}', 'FibreFlow Communications Admin')
        .replace('{{groupName}}', group.group_name || group.project_name);
    } else {
      // Fallback message
      messageContent = `🧪 *Test Message from FibreFlow*

This is a test message to verify WhatsApp connectivity.

Sent at: ${new Date().toISOString()}
Group: ${group.group_name || group.project_name}

If you received this message, the connection is working! ✅`;
    }

    // Send the test message via WhatsApp Sender service
    const sendResult = await sendTestMessage(group.group_jid, messageContent);

    // Log the message
    await pool.query(
      `INSERT INTO wa_message_logs (
        direction, service, message_type, group_jid, message_content,
        status, project, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        'outbound',
        'sender',
        'test',
        group.group_jid,
        messageContent,
        sendResult.success ? 'sent' : 'failed',
        group.project_name,
      ]
    );

    // Log admin action
    await logAdminAction('test_message', 'group', id, null, {
      group_jid: group.group_jid,
      success: sendResult.success,
    }, req);

    if (!sendResult.success) {
      return res.status(500).json({
        success: false,
        error: sendResult.error_message || 'Failed to send test message',
        data: sendResult,
      });
    }

    return res.status(200).json({
      success: true,
      data: sendResult,
      message: `Test message sent to "${group.project_name}"`,
    });

  } catch (error) {
    console.error('[WA Test Message API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Send test message via WhatsApp Sender service
 */
async function sendTestMessage(
  groupJid: string,
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
        recipient_jid: '0@s.whatsapp.net', // Dummy JID for no @mention
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
