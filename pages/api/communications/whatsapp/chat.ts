/**
 * WhatsApp Chat Messages API
 * GET /api/communications/whatsapp/chat?group_id=xxx - Get chat messages for a group
 * GET /api/communications/whatsapp/chat?group_id=xxx&since=timestamp - Get new messages since timestamp
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

export interface ChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  sender_jid: string | null;
  sender_name: string | null;
  message_content: string;
  message_type: string;
  status: string;
  created_at: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { group_id, since, limit = '50' } = req.query;

  if (!group_id || typeof group_id !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'group_id is required',
    });
  }

  try {
    // Get the group's JID
    const groupResult = await pool.query(
      `SELECT group_jid, project_name FROM wa_group_config WHERE id = $1::uuid`,
      [group_id]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Group not found',
      });
    }

    const { group_jid, project_name } = groupResult.rows[0];

    // Build query based on whether we're fetching new messages or all
    let query: string;
    let params: (string | number)[];

    if (since && typeof since === 'string') {
      // Fetch messages newer than the given timestamp
      query = `
        SELECT
          id, direction, sender_jid, message_content, message_type,
          status, created_at, metadata
        FROM wa_message_logs
        WHERE group_jid = $1 AND created_at > $2::timestamptz
        ORDER BY created_at ASC
        LIMIT $3
      `;
      params = [group_jid, since, parseInt(limit as string)];
    } else {
      // Fetch recent messages
      query = `
        SELECT
          id, direction, sender_jid, message_content, message_type,
          status, created_at, metadata
        FROM wa_message_logs
        WHERE group_jid = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
      params = [group_jid, parseInt(limit as string)];
    }

    const result = await pool.query(query, params);

    // Process messages to extract sender name from metadata
    const messages: ChatMessage[] = result.rows.map(row => {
      const metadata = row.metadata || {};
      return {
        id: row.id,
        direction: row.direction,
        sender_jid: row.sender_jid,
        sender_name: metadata.sender_name || formatPhoneNumber(row.sender_jid),
        message_content: row.message_content || '',
        message_type: row.message_type || 'text',
        status: row.status,
        created_at: row.created_at,
      };
    });

    // If fetching recent (not since), reverse to get chronological order
    if (!since) {
      messages.reverse();
    }

    return res.status(200).json({
      success: true,
      data: {
        group_id,
        group_jid,
        project_name,
        messages,
        count: messages.length,
      },
    });

  } catch (error) {
    console.error('[WA Chat API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Format phone number for display
 */
function formatPhoneNumber(jid: string | null): string {
  if (!jid) return 'Unknown';

  // Extract number from JID (e.g., "27712345678@s.whatsapp.net" -> "+27 71 234 5678")
  const match = jid.match(/^(\d+)@/);
  if (match) {
    const num = match[1];
    if (num.startsWith('27') && num.length === 11) {
      return `+27 ${num.slice(2, 4)} ${num.slice(4, 7)} ${num.slice(7)}`;
    }
    return `+${num}`;
  }
  return jid;
}

export default withAuth(handler);
