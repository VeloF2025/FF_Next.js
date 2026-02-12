/**
 * WhatsApp Inbound Message API
 * POST /api/communications/whatsapp/inbound - Receive messages from Bridge
 *
 * Called by whatsapp-bridge when a message is received from WhatsApp groups.
 * Auth: bridge secret (NOT withAuth - called by Go WhatsApp Bridge)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import { log } from '@/lib/logger';

const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

interface InboundMessageRequest {
  secret: string;
  sender_jid: string;
  sender_name?: string;
  group_jid: string;
  group_name?: string;
  message_content: string;
  message_type: 'text' | 'image' | 'document' | 'video' | 'audio';
  message_id?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Verify bridge secret
  if (!BRIDGE_SECRET) {
    log.error('[wa-inbound] WA_BRIDGE_SECRET env var not set');
    return res.status(500).json({ success: false, error: 'Server configuration error' });
  }

  const body = req.body as InboundMessageRequest;
  const secret = body.secret || req.headers['x-bridge-secret'];

  if (secret !== BRIDGE_SECRET) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: invalid bridge secret',
    });
  }

  // Validate required fields
  if (!body.sender_jid || !body.group_jid || !body.message_content) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: sender_jid, group_jid, message_content',
    });
  }

  try {
    // Look up project name from group config
    const groupResult = await pool.query(
      `SELECT project_name FROM wa_group_config WHERE group_jid = $1`,
      [body.group_jid]
    );

    const projectName = groupResult.rows[0]?.project_name || body.group_name || 'Unknown';

    // Insert the inbound message
    const result = await pool.query(
      `INSERT INTO wa_message_logs (
        id, direction, service, message_type, group_jid, sender_jid,
        message_content, status, project, metadata, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10
      ) RETURNING id, created_at`,
      [
        'inbound',
        'bridge',
        body.message_type || 'text',
        body.group_jid,
        body.sender_jid,
        body.message_content,
        'delivered',
        projectName,
        JSON.stringify({
          sender_name: body.sender_name,
          group_name: body.group_name,
          message_id: body.message_id,
          ...body.metadata,
        }),
        body.timestamp ? new Date(body.timestamp) : new Date(),
      ]
    );

    log.debug('waInbound', {
      action: 'messageReceived',
      senderJid: body.sender_jid,
      projectName,
      messagePreview: body.message_content.substring(0, 50)
    });

    return res.status(200).json({
      success: true,
      data: {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
      },
      message: 'Message received',
    });

  } catch (error) {
    log.error('waInbound', { action: 'messageReceive', error });
    return apiResponse.internalError(res, error);
  }
}

// No withAuth — called by Go WhatsApp Bridge with bridge secret
export default handler;
