/**
 * Read-only listing of monitored WhatsApp groups, scoped by group_type.
 *
 * Consumed by the wa-mention-poller on the bridge VPS to learn which JIDs
 * it should SKIP (the bridge already POSTs maintenance + dr_submission
 * directly; the poller fills the rest). Replaces the previous brittle
 * bridge.log text parser.
 *
 * GET /api/noc/wa-monitored-groups?types=maintenance,dr_submission
 *
 * Auth: same shared bridge secret as /api/noc/wa-message (header
 * `x-wa-bridge-secret`). No user-level auth — this is a peer service.
 *
 * @module api/noc/wa-monitored-groups
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:noc:wa-monitored-groups');
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

interface ApiResponse {
  success: boolean;
  data?: { group_jids: string[] };
  error?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  if (!BRIDGE_SECRET) {
    logger.error('WA_BRIDGE_SECRET env var not set');
    return res.status(500).json({ success: false, error: 'Server configuration error' });
  }

  const provided = req.headers['x-wa-bridge-secret'];
  const secret = Array.isArray(provided) ? provided[0] : provided;
  if (secret !== BRIDGE_SECRET) {
    return apiResponse.unauthorized(res);
  }

  // types=maintenance,dr_submission -> ['maintenance','dr_submission']
  const rawTypes = typeof req.query.types === 'string' ? req.query.types : '';
  const types = rawTypes
    .split(',')
    .map((t: string) => t.trim())
    .filter((t: string) => t.length > 0 && /^[a-z_]+$/.test(t));

  if (types.length === 0) {
    return res.status(400).json({ success: false, error: 'Missing or invalid ?types= query param' });
  }

  const sql = getDb();
  const rows = (await sql`
    SELECT group_jid
    FROM wa_monitored_groups
    WHERE is_active = true
      AND group_type = ANY(${types}::text[])
  `) as Array<{ group_jid: string }>;

  return res.status(200).json({
    success: true,
    data: { group_jids: rows.map((r) => r.group_jid) },
  });
}

export default handler;
