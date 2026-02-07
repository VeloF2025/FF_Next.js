/**
 * WhatsApp Monitored Groups API
 * GET  /api/communications/whatsapp/monitored-groups - List all monitored groups
 * POST /api/communications/whatsapp/monitored-groups - Create a new monitored group
 *
 * These groups are monitored by the WhatsApp Bridge service.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { WaMonitoredGroup, WaMonitoredGroupInput } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { log } from '@/lib/logger';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  ssl: { rejectUnauthorized: false }
});

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('[WA Monitored Groups API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - List all monitored WhatsApp groups
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { group_type, is_active } = req.query;

  let query = `
    SELECT
      id, group_jid, group_name, project_name, group_type,
      description, is_active, created_at, updated_at
    FROM wa_monitored_groups
    WHERE 1=1
  `;

  const params: (string | boolean)[] = [];
  let paramIndex = 1;

  if (group_type && typeof group_type === 'string') {
    query += ` AND group_type = $${paramIndex++}`;
    params.push(group_type);
  }

  if (is_active === 'true') {
    query += ` AND is_active = true`;
  } else if (is_active === 'false') {
    query += ` AND is_active = false`;
  }

  query += ' ORDER BY group_type, group_name ASC';

  const result = await pool.query(query, params);
  const groups = result.rows as WaMonitoredGroup[];

  return apiResponse.success(res, groups);
}

/**
 * POST - Create a new monitored WhatsApp group
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const input = req.body as WaMonitoredGroupInput;

  // Validation
  if (!input.group_jid?.trim()) {
    return apiResponse.badRequest(res, 'Group JID is required');
  }

  if (!input.group_name?.trim()) {
    return apiResponse.badRequest(res, 'Group name is required');
  }

  // Validate JID format (should end with @g.us for groups)
  if (!input.group_jid.endsWith('@g.us')) {
    return apiResponse.badRequest(res, 'Group JID must end with @g.us');
  }

  // Validate group type
  const validTypes = ['dr_submission', 'maintenance', 'admin'];
  if (input.group_type && !validTypes.includes(input.group_type)) {
    return apiResponse.badRequest(res, `Invalid group_type. Must be one of: ${validTypes.join(', ')}`);
  }

  // Check for duplicate JID
  const existing = await pool.query(
    'SELECT id FROM wa_monitored_groups WHERE group_jid = $1',
    [input.group_jid]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({
      success: false,
      error: `Group with JID "${input.group_jid}" already exists`,
    });
  }

  // Insert new group
  const result = await pool.query(
    `INSERT INTO wa_monitored_groups (
      group_jid, group_name, project_name, group_type, description, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, group_jid, group_name, project_name, group_type, description, is_active, created_at, updated_at`,
    [
      input.group_jid.trim(),
      input.group_name.trim(),
      input.project_name?.trim() || null,
      input.group_type || 'dr_submission',
      input.description?.trim() || null,
      input.is_active !== false,
    ]
  );

  const newGroup = result.rows[0] as WaMonitoredGroup;

  return res.status(201).json({
    success: true,
    data: newGroup,
    message: `Group "${newGroup.group_name}" created successfully`,
  });
}

export default withAuth(handler);
