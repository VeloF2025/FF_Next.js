/**
 * WhatsApp Group Test Message API
 * POST /api/communications/whatsapp/groups/[id]/test - Send a test message to a group
 *
 * Uses wa_monitored_groups table (same as unified bridge)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import type { WaAdminApiResponse, WaTestMessageResult } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  ssl: { rejectUnauthorized: false },
});

// Unified bridge URL (port 8083)
const WA_BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'http://72.61.197.178:8083';

async function handler(
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
    // Get the group from wa_monitored_groups
    const groupResult = await pool.query(
      `SELECT id, group_name, project_name, group_jid, group_type, is_active
      FROM wa_monitored_groups
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

    if (!group.is_active) {
      return res.status(400).json({
        success: false,
        error: 'Cannot send test message to inactive group',
      });
    }

    // Construct test message
    const messageContent = `🧪 *Test Message from FibreFlow*

This is a test message to verify WhatsApp connectivity.

Sent at: ${new Date().toISOString()}
Group: ${group.group_name}
Type: ${group.group_type}

If you received this message, the connection is working! ✅`;

    // Send the test message via unified WhatsApp Bridge
    const sendResult = await sendTestMessage(group.group_jid, messageContent);

    // Log the message
    try {
      await pool.query(
        `INSERT INTO wa_message_logs (
          direction, service, message_type, group_jid, message_content,
          status, project, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          'outbound',
          'bridge',
          'test',
          group.group_jid,
          messageContent,
          sendResult.success ? 'sent' : 'failed',
          group.project_name,
        ]
      );
    } catch (logError) {
      console.warn('[WA Test] Failed to log message:', logError);
    }

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
      message: `Test message sent to "${group.group_name}"`,
    });

  } catch (error) {
    console.error('[WA Test Message API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Send test message via unified WhatsApp Bridge
 */
async function sendTestMessage(
  groupJid: string,
  message: string
): Promise<WaTestMessageResult> {
  try {
    const response = await fetch(`${WA_BRIDGE_URL}/send-message`, {
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

export default withAuth(handler);
