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

// Expected group JID for validation
const EXPECTED_GROUP_JID =
  process.env.MAINTENANCE_WA_GROUP_JID || '120363424360693693@g.us';

interface ApiResponse {
  success: boolean;
  data?: ProcessedMessage;
  error?: string;
}

export default async function handler(
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
    const body = req.body as IncomingWAMessage;

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

    // Validate group JID
    if (body.group_jid !== EXPECTED_GROUP_JID) {
      logger.warn(
        { received: body.group_jid, expected: EXPECTED_GROUP_JID },
        'Message from unexpected group'
      );
      return res.status(400).json({
        success: false,
        error: `Unexpected group: ${body.group_jid}`,
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
