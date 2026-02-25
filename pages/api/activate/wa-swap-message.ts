/**
 * API Route: /api/activate/wa-swap-message
 *
 * Receives ONT swap messages from WhatsApp pre-provision groups via the VPS bridge.
 * Parses the message, records the swap, flags the DR for review,
 * and cross-references with OES PP data.
 *
 * POST only. Auth: bridge secret (NOT withAuth).
 *
 * @module api/activate/wa-swap-message
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import { parseSwapMessage } from '@/modules/activate/services/swapMessageParser';
import { logOntSwapReported } from '@/modules/activate/services/activity-log/eventLoggers';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

const logger = createLogger('api:activate:wa-swap-message');

const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

interface IncomingSwapMessage {
  message_id: string;
  group_jid: string;
  sender_jid: string;
  sender_name?: string;
  text?: string;
  timestamp: string;
  secret?: string;
}

interface SwapApiResponse {
  success: boolean;
  data?: {
    id: string;
    drop_number: string;
    new_serial: string;
    status: string;
  };
  reaction?: string;
  error?: string;
  skipped?: boolean;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SwapApiResponse>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  try {
    const body = req.body as IncomingSwapMessage;

    // --- Auth ---
    if (!BRIDGE_SECRET) {
      logger.error('WA_BRIDGE_SECRET env var not set');
      return apiResponse.internalError(res, error);
    }
    if (body.secret !== BRIDGE_SECRET) {
      logger.warn('Invalid or missing bridge secret');
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Unauthorized');
    }

    // --- Validate required fields ---
    if (!body.group_jid || !body.sender_jid || !body.message_id) {
      logger.warn('Missing required fields');
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
    }

    if (!body.text || body.text.trim().length === 0) {
      return apiResponse.success(res, { skipped: true });
    }

    // --- Look up group to get project ---
    const groupResult = await pool.query(
      `SELECT project_name, group_type FROM wa_monitored_groups
       WHERE group_jid = $1 AND is_active = true`,
      [body.group_jid]
    );

    if (groupResult.rows.length === 0) {
      logger.warn(`Message from unknown/inactive group: ${body.group_jid}`);
      return apiResponse.success(res, { skipped: true });
    }

    const project = groupResult.rows[0].project_name;

    // --- Parse message ---
    const parsed = parseSwapMessage(body.text);

    if (!parsed) {
      // Log unparseable message for manual review
      await pool.query(
        `INSERT INTO wa_message_logs
         (direction, service, message_type, group_jid, sender_jid, message_content, status, project, metadata)
         VALUES ('inbound', 'bridge', 'swap_unparsed', $1, $2, $3, 'pending', $4, $5)`,
        [
          body.group_jid,
          body.sender_jid,
          body.text,
          project,
          JSON.stringify({ message_id: body.message_id, sender_name: body.sender_name }),
        ]
      );
      logger.info(`Swap message unparseable (${body.message_id}), logged for review`);
      return apiResponse.success(res, { skipped: true });
    }

    logger.info(`Parsed swap message: ${parsed.dropNumber} -> ${parsed.newSerial} (${parsed.swapType}, ${parsed.confidence})`);

    // --- Look up old serial from unified reviews ---
    const oldSerialResult = await pool.query(
      `SELECT ont_serial_scanned, oes_serial FROM dr_photo_unified_reviews
       WHERE drop_number = $1 LIMIT 1`,
      [parsed.dropNumber]
    );

    let oldSerial: string | null = null;
    let oldSerialSource: string | null = null;
    if (oldSerialResult.rows.length > 0) {
      const row = oldSerialResult.rows[0];
      if (row.ont_serial_scanned) {
        oldSerial = row.ont_serial_scanned;
        oldSerialSource = 'unified_reviews.ont_serial_scanned';
      } else if (row.oes_serial) {
        oldSerial = row.oes_serial;
        oldSerialSource = 'unified_reviews.oes_serial';
      }
    }

    // --- Cross-reference PP data ---
    let ppDataId: number | null = null;
    const ppResult = await pool.query(
      `SELECT id FROM oes_pp_data WHERE serial_number = $1 AND project = $2 LIMIT 1`,
      [parsed.newSerial, project]
    );
    if (ppResult.rows.length > 0) {
      ppDataId = ppResult.rows[0].id;
    }

    // --- Insert swap record (upsert for idempotency) ---
    const insertResult = await pool.query(
      `INSERT INTO ont_swap_records (
        drop_number, project, old_serial, new_serial, swap_type,
        status, oes_status, reason,
        wa_message_id, wa_group_jid, wa_sender_jid, wa_sender_name,
        raw_message, old_serial_source, pp_data_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (drop_number, new_serial) DO UPDATE SET
        oes_status = COALESCE(EXCLUDED.oes_status, ont_swap_records.oes_status),
        wa_message_id = COALESCE(EXCLUDED.wa_message_id, ont_swap_records.wa_message_id),
        raw_message = COALESCE(EXCLUDED.raw_message, ont_swap_records.raw_message),
        updated_at = NOW()
      RETURNING id, status`,
      [
        parsed.dropNumber,
        project,
        oldSerial,
        parsed.newSerial,
        parsed.swapType,
        'pending_review',
        parsed.oesStatus,
        parsed.reason,
        body.message_id,
        body.group_jid,
        body.sender_jid,
        body.sender_name || null,
        body.text,
        oldSerialSource,
        ppDataId,
      ]
    );

    const swapRecord = insertResult.rows[0];

    // --- Flag DR in unified reviews ---
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET serial_swap_detected = true,
           serial_swap_detected_at = NOW(),
           serial_swap_details = $2
       WHERE drop_number = $1 AND (serial_swap_detected = false OR serial_swap_detected IS NULL)`,
      [
        parsed.dropNumber,
        JSON.stringify({
          source: 'wa_pre_provision',
          new_serial: parsed.newSerial,
          old_serial: oldSerial,
          swap_type: parsed.swapType,
        }),
      ]
    );

    // --- Log activity ---
    try {
      await logOntSwapReported(
        parsed.dropNumber,
        oldSerial,
        parsed.newSerial,
        parsed.swapType,
        body.sender_name || body.sender_jid
      );
    } catch (err) {
      logger.warn(`Activity log failed for ${parsed.dropNumber} (non-fatal): ${err}`);
    }

    // --- Log to wa_message_logs ---
    await pool.query(
      `INSERT INTO wa_message_logs
       (direction, service, message_type, group_jid, sender_jid, message_content, status, drop_number, project, metadata)
       VALUES ('inbound', 'bridge', 'ont_swap', $1, $2, $3, 'sent', $4, $5, $6)`,
      [
        body.group_jid,
        body.sender_jid,
        body.text,
        parsed.dropNumber,
        project,
        JSON.stringify({
          message_id: body.message_id,
          new_serial: parsed.newSerial,
          old_serial: oldSerial,
          swap_type: parsed.swapType,
          confidence: parsed.confidence,
          swap_record_id: swapRecord.id,
        }),
      ]
    );

    logger.info(`ONT swap recorded: ${swapRecord.id} (${parsed.dropNumber} -> ${parsed.newSerial})`);

    return apiResponse.success(res, {
      id: swapRecord.id,
      drop_number: parsed.dropNumber,
      new_serial: parsed.newSerial,
      status: swapRecord.status,
      reaction: '👍',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to process swap message: ${errorMessage}`);
    return apiResponse.internalError(res, error);
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

// No withAuth — called by Go WhatsApp Bridge with bridge secret
export default handler;
