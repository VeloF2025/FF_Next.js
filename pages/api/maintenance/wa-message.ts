/**
 * WhatsApp Maintenance Message Endpoint
 *
 * Receives incoming WhatsApp messages from the VPS bridge
 * for the Mohadin QA maintenance tracking group.
 *
 * POST /api/maintenance/wa-message
 *
 * @module api/maintenance/wa-message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import {
  processMaintenanceMessage,
  type IncomingWAMessage,
  type ProcessedMessage,
} from '@/modules/maintenance/services/waMaintenanceProcessor';
const logger = createLogger('api:maintenance:wa-message');

// Shared secret for Bridge authentication (same as whatsapp/inbound)
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

// Known maintenance group JIDs
const MAINTENANCE_GROUP_JIDS = new Set([
  '120363424360693693@g.us', // Mohadin Maintenance
  '120363423947610853@g.us', // Lawley Maintenance
]);

interface ApiResponse {
  success: boolean;
  data?: ProcessedMessage;
  error?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    const body = req.body as IncomingWAMessage & { secret?: string };

    // Validate bridge secret
    if (!BRIDGE_SECRET) {
      logger.error('WA_BRIDGE_SECRET env var not set');
      return res.status(500).json({ success: false, error: 'Server configuration error' });
    }
    if (body.secret !== BRIDGE_SECRET) {
      logger.warn('Invalid or missing bridge secret');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: invalid bridge secret',
      });
    }

    // Validate required fields
    if (!body.message_id) {
      logger.warn('Missing message_id in request');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: message_id',
      });
    }

    if (!body.group_jid) {
      logger.warn('Missing group_jid in request');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: group_jid',
      });
    }

    if (!body.sender_jid) {
      logger.warn('Missing sender_jid in request');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: sender_jid',
      });
    }

    if (!body.timestamp) {
      logger.warn('Missing timestamp in request');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: timestamp',
      });
    }

    // Validate group JID is a known maintenance group
    if (!MAINTENANCE_GROUP_JIDS.has(body.group_jid)) {
      logger.warn(
        { received: body.group_jid },
        'Message from unknown maintenance group'
      );
      return res.status(400).json({
        success: false,
        error: `Unknown maintenance group: ${body.group_jid}`,
      });
    }

    // Log incoming message
    logger.info(
      {
        messageId: body.message_id,
        sender: body.sender_name || body.sender_jid,
        hasText: !!body.text,
        hasMedia: body.has_media,
        mediaCount: body.media?.length || 0,
      },
      'Received maintenance WA message'
    );

    // Process the message
    const result = await processMaintenanceMessage(body);

    logger.info(
      {
        messageId: result.id,
        dropNumber: result.drop_number,
        drMentioned: result.dr_mentioned_directly,
        photosCount: result.photos_count,
      },
      'Message processed successfully'
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    logger.error({ error: errorMessage }, 'Failed to process WA message');

    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

// Disable body parsing limit for media payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb', // Allow large media payloads
    },
  },
};

// NOTE: No withAuth - this endpoint is called by Go WhatsApp Bridge
// Authentication is via shared bridge secret in the request body
export default handler;
