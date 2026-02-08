/**
 * WhatsApp Monitored Groups API
 * GET  /api/communications/whatsapp/groups - List all groups
 * POST /api/communications/whatsapp/groups - Create a new group
 *
 * Uses wa_monitored_groups table (same as unified bridge)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import type { WaMonitoredGroup, WaMonitoredGroupInput, WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaMonitoredGroup | WaMonitoredGroup[]>>
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
    log.error('[WA Groups API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - List all WhatsApp monitored groups
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaMonitoredGroup[]>>
) {
  const { is_active, group_type } = req.query;

  let query = `
    SELECT
      id, group_jid, group_name, project_name, group_type,
      description, is_active, created_at, updated_at
    FROM wa_monitored_groups
    WHERE 1=1
  `;

  const params: (string | boolean)[] = [];
  let paramIndex = 1;

  if (is_active === 'true') {
    query += ` AND is_active = $${paramIndex++}`;
    params.push(true);
  } else if (is_active === 'false') {
    query += ` AND is_active = $${paramIndex++}`;
    params.push(false);
  }

  if (group_type && typeof group_type === 'string') {
    query += ` AND group_type = $${paramIndex++}`;
    params.push(group_type);
  }

  query += ' ORDER BY group_name ASC';

  const result = await pool.query(query, params);
  const groups = result.rows as WaMonitoredGroup[];

  return res.status(200).json({
    success: true,
    data: groups,
  });
}

/**
 * POST - Create a new WhatsApp monitored group
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaMonitoredGroup>>
) {
  const input = req.body as WaMonitoredGroupInput;

  // Validation
  if (!input.group_name?.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Group name is required',
    });
  }

  if (!input.group_jid?.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Group JID is required',
    });
  }

  // Validate JID format (should end with @g.us for groups)
  if (!input.group_jid.endsWith('@g.us')) {
    return res.status(400).json({
      success: false,
      error: 'Group JID must end with @g.us',
    });
  }

  // Validate group_type if provided
  const validTypes = ['dr_submission', 'maintenance', 'admin'];
  const groupType = input.group_type || 'dr_submission';
  if (!validTypes.includes(groupType)) {
    return res.status(400).json({
      success: false,
      error: `Group type must be one of: ${validTypes.join(', ')}`,
    });
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
      groupType,
      input.description?.trim() || null,
      input.is_active !== false,
    ]
  );

  const newGroup = result.rows[0] as WaMonitoredGroup;

  // Trigger bridge reload
  try {
    await fetch('http://72.61.197.178:8083/reload-groups', { method: 'GET' });
  } catch (e) {
    log.warn('[WA Groups] Failed to trigger bridge reload', { error: e });
  }

  return res.status(201).json({
    success: true,
    data: newGroup,
    message: `Group "${newGroup.group_name}" created successfully`,
  });
}

export default withAuth(handler);
