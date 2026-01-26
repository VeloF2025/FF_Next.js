/**
 * WhatsApp Message Logs Export API
 * GET /api/communications/whatsapp/logs/export - Export logs to CSV
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import type { WaMessageLogFilters } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const filters = req.query as unknown as WaMessageLogFilters;

    // Build query with filters (same as logs/index.ts but no pagination)
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

    // Limit export to 10000 rows for safety
    const query = `
      SELECT
        id, direction, service, message_type, group_jid, recipient_jid,
        sender_jid, message_content, status, error_message, drop_number,
        project, template_key, created_at
      FROM wa_message_logs
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT 10000
    `;

    const result = await pool.query(query, params);
    const logs = result.rows;

    // Generate CSV
    const headers = [
      'ID',
      'Direction',
      'Service',
      'Message Type',
      'Group JID',
      'Recipient JID',
      'Sender JID',
      'Message Content',
      'Status',
      'Error Message',
      'Drop Number',
      'Project',
      'Template Key',
      'Created At',
    ];

    const csvRows = [headers.join(',')];

    for (const log of logs) {
      const row = [
        log.id,
        log.direction,
        log.service,
        log.message_type || '',
        log.group_jid || '',
        log.recipient_jid || '',
        log.sender_jid || '',
        escapeCsvField(log.message_content || ''),
        log.status,
        escapeCsvField(log.error_message || ''),
        log.drop_number || '',
        log.project || '',
        log.template_key || '',
        log.created_at,
      ];
      csvRows.push(row.join(','));
    }

    const csv = csvRows.join('\n');

    // Build descriptive filename with active filters
    const filterParts: string[] = [];
    if (filters.direction) filterParts.push(filters.direction);
    if (filters.status) filterParts.push(filters.status);
    if (filters.project) filterParts.push(filters.project.replace(/\s+/g, '-'));
    if (filters.drop_number) filterParts.push(filters.drop_number);

    const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
    const dateSuffix = filters.date_from && filters.date_to
      ? `-${filters.date_from}-to-${filters.date_to}`
      : `-${new Date().toISOString().split('T')[0]}`;

    const filename = `wa_message_logs${filterSuffix}${dateSuffix}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.status(200).send(csv);

  } catch (error) {
    console.error('[WA Logs Export API] Error:', error);
    return res.status(500).json({ error: 'Failed to export logs' });
  }
}

/**
 * Escape a field for CSV format
 */
function escapeCsvField(value: string): string {
  if (!value) return '';

  // If field contains comma, newline, or quote, wrap in quotes and escape quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export default withAuth(handler);
