/**
 * Field Ops WhatsApp Message Endpoint
 *
 * Receives incoming WhatsApp messages from the VPS bridge for civil/optical
 * field operations groups. Stores messages and creates pending photo records.
 *
 * POST /api/field-ops/wa-message
 * Auth: x-bridge-secret header
 *
 * @module api/field-ops/wa-message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  processPoleInstallPhoto,
  handlePoleTextMessage,
  type PhotoData,
  type GroupInfo,
} from '@/modules/field-ops/services/poleInstallAckService';

const logger = createLogger('api:field-ops:wa-message');

interface IncomingFieldOpsMessage {
  group_jid: string;
  sender_jid: string;
  sender_name?: string;
  message_text?: string;
  message_id: string;
  timestamp: string;
  has_media?: boolean;
  media_type?: string;
  media_count?: number;
  photo_base64?: string;
  photo_filename?: string;
}

interface GroupLookupResult {
  group_type: string;
  project_name: string | null;
  project_id: string | null;
}

interface MessageInsertResult {
  id: string;
}

// neon() tagged-template returns Record<string,any>[] — these helpers cast safely
function toGroupResult(row: Record<string, unknown>): GroupLookupResult {
  return {
    group_type: String(row['group_type'] ?? ''),
    project_name: row['project_name'] != null ? String(row['project_name']) : null,
    project_id: row['project_id'] != null ? String(row['project_id']) : null,
  };
}

function toMessageResult(row: Record<string, unknown>): MessageInsertResult {
  return { id: String(row['id'] ?? '') };
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const bridgeSecret = process.env.WA_BRIDGE_SECRET;
  if (!bridgeSecret) {
    logger.error('WA_BRIDGE_SECRET env var not set');
    return apiResponse.internalError(res, new Error('Server configuration error'));
  }

  const headerSecret = req.headers['x-bridge-secret'];
  if (headerSecret !== bridgeSecret) {
    logger.warn('Invalid or missing x-bridge-secret header');
    return apiResponse.unauthorized(res, 'Invalid bridge secret');
  }

  const body = req.body as IncomingFieldOpsMessage;

  if (!body.message_id) {
    return apiResponse.badRequest(res, 'Missing required field: message_id');
  }
  if (!body.group_jid) {
    return apiResponse.badRequest(res, 'Missing required field: group_jid');
  }
  if (!body.sender_jid) {
    return apiResponse.badRequest(res, 'Missing required field: sender_jid');
  }
  if (!body.timestamp) {
    return apiResponse.badRequest(res, 'Missing required field: timestamp');
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Look up group in wa_monitored_groups to get group_type and project
    const groupRows = (await sql`
      SELECT group_type, project_name, project_id
      FROM wa_monitored_groups
      WHERE group_jid = ${body.group_jid}
        AND is_active = TRUE
    `).map(toGroupResult);

    if (groupRows.length === 0) {
      logger.warn('Message from unknown or inactive group', { group_jid: body.group_jid });
      return apiResponse.badRequest(res, `Unknown or inactive group: ${body.group_jid}`);
    }

    const { group_type, project_name, project_id } = groupRows[0]!

    // Determine message timestamp from bridge payload
    const messageTimestamp = new Date(
      typeof body.timestamp === 'number' ? body.timestamp * 1000 : body.timestamp
    ).toISOString();

    // Insert the message (idempotent via ON CONFLICT DO NOTHING)
    const insertedRows = (await sql`
      INSERT INTO field_ops_wa_messages (
        wa_message_id,
        wa_group_jid,
        group_type,
        sender_jid,
        sender_name,
        message_text,
        message_timestamp,
        project,
        has_media,
        media_type,
        media_count
      ) VALUES (
        ${body.message_id},
        ${body.group_jid},
        ${group_type},
        ${body.sender_jid},
        ${body.sender_name ?? null},
        ${body.message_text ?? null},
        ${messageTimestamp},
        ${project_name ?? null},
        ${body.has_media ?? false},
        ${body.media_type ?? null},
        ${body.media_count ?? 0}
      )
      ON CONFLICT (wa_message_id) DO NOTHING
      RETURNING id
    `).map(toMessageResult);

    // If message was a duplicate, return early
    if (insertedRows.length === 0) {
      logger.info('Duplicate message ignored', { message_id: body.message_id });
      return apiResponse.success(res, { message_id: body.message_id, duplicate: true });
    }

    const messageDbId = insertedRows[0]!.id;

    // If the message has images, create pending photo records (one per image)
    const photoCount = body.media_count ?? 0;
    if (body.has_media && body.media_type === 'image' && photoCount > 0) {
      const photoInserts = Array.from({ length: photoCount }, () =>
        sql`
          INSERT INTO field_ops_wa_photos (
            message_id,
            wa_group_jid,
            group_type,
            sender_jid,
            sender_name,
            message_timestamp,
            project,
            upload_status,
            vlm_processed
          ) VALUES (
            ${messageDbId},
            ${body.group_jid},
            ${group_type},
            ${body.sender_jid},
            ${body.sender_name ?? null},
            ${messageTimestamp},
            ${project_name ?? null},
            'pending',
            FALSE
          )
        `
      );

      await Promise.all(photoInserts);

      logger.info('Photo records created', {
        message_id: body.message_id,
        photos_created: photoCount,
        project: project_name,
      });

      // Fire-and-forget: real-time pole install ACK pipeline
      if (body.photo_base64 && project_id && group_type === 'civil') {
        const photoData: PhotoData = {
          photoId: messageDbId, // Use message DB ID as photo reference
          senderJid: body.sender_jid,
          senderName: body.sender_name ?? 'Unknown',
          messageTimestamp: messageTimestamp,
        };
        const groupInfo: GroupInfo = {
          groupJid: body.group_jid,
          projectId: project_id,
          projectName: project_name ?? '',
        };
        processPoleInstallPhoto(photoData, body.photo_base64, groupInfo).catch((err) =>
          logger.error('Pole install ACK pipeline failed', {
            error: err instanceof Error ? err.message : String(err),
            message_id: body.message_id,
          })
        );
      }
    }

    // Fire-and-forget: check text messages for pole number declarations
    if (!body.has_media && body.message_text && project_id && group_type === 'civil') {
      handlePoleTextMessage(
        body.message_text, body.sender_jid, body.sender_name ?? 'Unknown',
        body.group_jid, project_id, project_name ?? ''
      ).catch((err) =>
        logger.error('Pole text message handler failed', {
          error: err instanceof Error ? err.message : String(err),
          message_id: body.message_id,
        })
      );
    }

    logger.info('Field ops WA message stored', {
      message_id: body.message_id,
      group_type,
      project: project_name,
      has_media: body.has_media,
    });

    return apiResponse.success(res, {
      message_id: body.message_id,
      db_id: messageDbId,
      group_type,
      project: project_name,
      photos_created: body.has_media && body.media_type === 'image' ? photoCount : 0,
    });
  } catch (error) {
    logger.error('Failed to store field ops WA message', {
      error: error instanceof Error ? error.message : String(error),
      message_id: body.message_id,
    });
    return apiResponse.internalError(res, error);
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

// No withAuth — authenticated via x-bridge-secret header from Go bridge
export default handler;
