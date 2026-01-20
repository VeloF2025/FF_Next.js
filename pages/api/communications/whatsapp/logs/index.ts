/**
 * WhatsApp Message Logs API
 * GET /api/communications/whatsapp/logs - Get paginated message logs
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type {
  WaMessageLog,
  WaMessageLogFilters,
  WaPaginatedResponse
} from '@/modules/communications/whatsapp/types/wa-admin.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaPaginatedResponse<WaMessageLog>>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const filters = req.query as unknown as WaMessageLogFilters;

    // Parse pagination
    const page = Math.max(1, parseInt(filters.page?.toString() || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit?.toString() || '50', 10)));
    const offset = (page - 1) * limit;

    // Build query with filters
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.direction) {
      conditions.push(`direction = $${paramIndex++}`);
      params.push(filters.direction);
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }

    if (filters.project) {
      conditions.push(`project = $${paramIndex++}`);
      params.push(filters.project);
    }

    if (filters.message_type) {
      conditions.push(`message_type = $${paramIndex++}`);
      params.push(filters.message_type);
    }

    if (filters.drop_number) {
      conditions.push(`drop_number = $${paramIndex++}`);
      params.push(filters.drop_number);
    }

    if (filters.date_from) {
      conditions.push(`created_at >= $${paramIndex++}::timestamptz`);
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      conditions.push(`created_at <= $${paramIndex++}::timestamptz`);
      params.push(filters.date_to);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM wa_message_logs
      WHERE ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // Get paginated results
    const dataQuery = `
      SELECT
        id, direction, service, message_type, group_jid, recipient_jid,
        sender_jid, message_content, status, error_message, drop_number,
        project, template_key, metadata, created_at, updated_at
      FROM wa_message_logs
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(limit, offset);

    const dataResult = await pool.query(dataQuery, params);
    const logs = dataResult.rows as WaMessageLog[];

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });

  } catch (error) {
    console.error('[WA Logs API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}
