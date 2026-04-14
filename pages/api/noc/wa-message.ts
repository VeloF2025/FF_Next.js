/**
 * WhatsApp Maintenance Message Endpoint
 *
 * Receives incoming WhatsApp messages from the VPS bridge
 * for the Mohadin QA maintenance tracking group.
 *
 * POST /api/noc/wa-message
 *
 * @module api/noc/wa-message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import {
  processMaintenanceMessage,
  type IncomingWAMessage,
  type ProcessedMessage,
} from '@/modules/noc/services/waMaintenanceProcessor';
import { apiResponse } from '@/lib/apiResponse';
const logger = createLogger('api:maintenance:wa-message');

// Shared secret for Bridge authentication (same as whatsapp/inbound)
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

// Known maintenance group JIDs
const MAINTENANCE_GROUP_JIDS = new Set([
  '120363424360693693@g.us', // Mohadin Maintenance
  '120363423947610853@g.us', // Lawley Maintenance
  '120363422808656601@g.us', // Marketing Activations (DR submissions)
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
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
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
      return apiResponse.unauthorized(res);
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
      logger.warn('Message from unknown maintenance group', { received: body.group_jid });
      return res.status(400).json({
        success: false,
        error: `Unknown maintenance group: ${body.group_jid}`,
      });
    }

    // Log incoming message
    logger.info('Received maintenance WA message', {
        messageId: body.message_id,
        sender: body.sender_name || body.sender_jid,
        hasText: !!body.text,
        hasMedia: body.has_media,
        mediaCount: body.media?.length || 0,
      });

    // Process the message
    const result = await processMaintenanceMessage(body);

    logger.info('Message processed successfully', {
        messageId: result.id,
        dropNumber: result.drop_number,
        drMentioned: result.dr_mentioned_directly,
        photosCount: result.photos_count,
      });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    logger.error('Failed to process WA message', { error: errorMessage });

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
