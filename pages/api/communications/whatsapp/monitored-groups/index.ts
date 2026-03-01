/**
 * WhatsApp Monitored Groups API
 * GET  /api/communications/whatsapp/monitored-groups - List all monitored groups
 * POST /api/communications/whatsapp/monitored-groups - Create a new monitored group
 *
 * These groups are monitored by the WhatsApp Bridge service.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import type { WaMonitoredGroup, WaMonitoredGroupInput } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { log } from '@/lib/logger';

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
 * GET - List all monitored WhatsApp groups, joined with projects for message counts
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { group_type, is_active } = req.query;

  let query = `
    SELECT
      mg.id, mg.group_jid, mg.group_name, mg.project_name, mg.project_id,
      mg.group_type, mg.description, mg.is_active, mg.created_at, mg.updated_at,
      p.project_name as linked_project_name,
      (SELECT COUNT(*) FROM wa_message_logs wml WHERE wml.group_jid = mg.group_jid) as message_count,
      (SELECT MAX(created_at) FROM wa_message_logs wml WHERE wml.group_jid = mg.group_jid) as last_activity
    FROM wa_monitored_groups mg
    LEFT JOIN projects p ON mg.project_id = p.id
    WHERE 1=1
  `;

  const params: (string | boolean)[] = [];
  let paramIndex = 1;

  if (group_type && typeof group_type === 'string') {
    query += ` AND mg.group_type = $${paramIndex++}`;
    params.push(group_type);
  }

  if (is_active === 'true') {
    query += ` AND mg.is_active = true`;
  } else if (is_active === 'false') {
    query += ` AND mg.is_active = false`;
  }

  query += ' ORDER BY mg.group_type, mg.group_name ASC';

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
  const validTypes = ['dr_submission', 'maintenance', 'admin', 'civil', 'optical'];
  if (input.group_type && !validTypes.includes(input.group_type)) {
    return apiResponse.badRequest(res, `Invalid group_type. Must be one of: ${validTypes.join(', ')}`);
  }

  // Civil and optical types require a project_id
  if ((input.group_type === 'civil' || input.group_type === 'optical') && !input.project_id) {
    return apiResponse.badRequest(res, `Group type "${input.group_type}" requires a project to be selected`);
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
      group_jid, group_name, project_name, project_id, group_type, description, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, group_jid, group_name, project_name, project_id, group_type, description, is_active, created_at, updated_at`,
    [
      input.group_jid.trim(),
      input.group_name.trim(),
      input.project_name?.trim() || null,
      input.project_id || null,
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
