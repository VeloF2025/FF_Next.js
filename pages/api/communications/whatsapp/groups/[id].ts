/**
 * WhatsApp Monitored Group by ID API
 * GET    /api/communications/whatsapp/groups/[id] - Get a single group
 * PUT    /api/communications/whatsapp/groups/[id] - Update a group
 * DELETE /api/communications/whatsapp/groups/[id] - Delete a group
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
  res: NextApiResponse<WaAdminApiResponse<WaMonitoredGroup>>
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Group ID is required',
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, res);
      case 'PUT':
        return handlePut(id, req, res);
      case 'DELETE':
        return handleDelete(id, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
    }
  } catch (error) {
    log.error('[WA Group API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - Get a single group by ID
 */
async function handleGet(
  id: string,
  res: NextApiResponse<WaAdminApiResponse<WaMonitoredGroup>>
) {
  const result = await pool.query(
    `SELECT
      id, group_jid, group_name, project_name, group_type,
      description, is_active, created_at, updated_at
    FROM wa_monitored_groups
    WHERE id = $1::uuid`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Group not found',
    });
  }

  return res.status(200).json({
    success: true,
    data: result.rows[0] as WaMonitoredGroup,
  });
}

/**
 * PUT - Update a group
 */
async function handlePut(
  id: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaMonitoredGroup>>
) {
  const input = req.body as Partial<WaMonitoredGroupInput>;

  // Get existing group first
  const existing = await pool.query(
    'SELECT * FROM wa_monitored_groups WHERE id = $1::uuid',
    [id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Group not found',
    });
  }

  const oldGroup = existing.rows[0] as WaMonitoredGroup;

  // Validate JID format if provided
  if (input.group_jid && !input.group_jid.endsWith('@g.us')) {
    return res.status(400).json({
      success: false,
      error: 'Group JID must end with @g.us',
    });
  }

  // Validate group_type if provided
  const validTypes = ['dr_submission', 'maintenance', 'admin'];
  if (input.group_type && !validTypes.includes(input.group_type)) {
    return res.status(400).json({
      success: false,
      error: `Group type must be one of: ${validTypes.join(', ')}`,
    });
  }

  // Check for duplicate JID if changing
  if (input.group_jid && input.group_jid !== oldGroup.group_jid) {
    const duplicate = await pool.query(
      'SELECT id FROM wa_monitored_groups WHERE group_jid = $1 AND id != $2::uuid',
      [input.group_jid, id]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Group with JID "${input.group_jid}" already exists`,
      });
    }
  }

  // Update the group
  const result = await pool.query(
    `UPDATE wa_monitored_groups SET
      group_jid = COALESCE($1, group_jid),
      group_name = COALESCE($2, group_name),
      project_name = $3,
      group_type = COALESCE($4, group_type),
      description = $5,
      is_active = COALESCE($6, is_active),
      updated_at = NOW()
    WHERE id = $7::uuid
    RETURNING id, group_jid, group_name, project_name, group_type, description, is_active, created_at, updated_at`,
    [
      input.group_jid?.trim() ?? null,
      input.group_name?.trim() ?? null,
      input.project_name !== undefined ? (input.project_name?.trim() || null) : oldGroup.project_name,
      input.group_type ?? null,
      input.description !== undefined ? (input.description?.trim() || null) : oldGroup.description,
      input.is_active ?? null,
      id,
    ]
  );

  const updatedGroup = result.rows[0] as WaMonitoredGroup;

  // Trigger bridge reload
  try {
    await fetch('http://72.61.197.178:8083/reload-groups', { method: 'GET' });
  } catch (e) {
    log.warn('[WA Groups] Failed to trigger bridge reload', { error: e });
  }

  return res.status(200).json({
    success: true,
    data: updatedGroup,
    message: `Group "${updatedGroup.group_name}" updated successfully`,
  });
}

/**
 * DELETE - Delete a group
 */
async function handleDelete(
  id: string,
  res: NextApiResponse<WaAdminApiResponse<WaMonitoredGroup>>
) {
  // Get existing group first
  const existing = await pool.query(
    'SELECT * FROM wa_monitored_groups WHERE id = $1::uuid',
    [id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Group not found',
    });
  }

  const deletedGroup = existing.rows[0] as WaMonitoredGroup;

  // Delete the group
  await pool.query('DELETE FROM wa_monitored_groups WHERE id = $1::uuid', [id]);

  // Trigger bridge reload
  try {
    await fetch('http://72.61.197.178:8083/reload-groups', { method: 'GET' });
  } catch (e) {
    log.warn('[WA Groups] Failed to trigger bridge reload', { error: e });
  }

  return res.status(200).json({
    success: true,
    data: deletedGroup,
    message: `Group "${deletedGroup.group_name}" deleted successfully`,
  });
}

export default withAuth(handler);
