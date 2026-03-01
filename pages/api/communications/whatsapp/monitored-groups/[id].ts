/**
 * WhatsApp Monitored Group API
 * GET    /api/communications/whatsapp/monitored-groups/[id] - Get a single group
 * PUT    /api/communications/whatsapp/monitored-groups/[id] - Update a group
 * DELETE /api/communications/whatsapp/monitored-groups/[id] - Delete (deactivate) a group
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
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Group ID is required');
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
    log.error('[WA Monitored Groups API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - Get a single monitored group by ID, joined with projects table
 */
async function handleGet(
  id: string,
  res: NextApiResponse
) {
  const result = await pool.query(
    `SELECT
      mg.id, mg.group_jid, mg.group_name, mg.project_name, mg.project_id,
      mg.group_type, mg.description, mg.is_active, mg.created_at, mg.updated_at,
      p.project_name as linked_project_name
     FROM wa_monitored_groups mg
     LEFT JOIN projects p ON mg.project_id = p.id
     WHERE mg.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return apiResponse.notFound(res, 'Monitored group', id);
  }

  return apiResponse.success(res, result.rows[0] as WaMonitoredGroup);
}

/**
 * PUT - Update a monitored group
 */
async function handlePut(
  id: string,
  req: NextApiRequest,
  res: NextApiResponse
) {
  const input = req.body as Partial<WaMonitoredGroupInput>;

  // Check group exists
  const existing = await pool.query(
    'SELECT id FROM wa_monitored_groups WHERE id = $1',
    [id]
  );

  if (existing.rows.length === 0) {
    return apiResponse.notFound(res, 'Monitored group', id);
  }

  // Validate group type if provided
  const validTypes = ['dr_submission', 'maintenance', 'admin', 'civil', 'optical'];
  if (input.group_type && !validTypes.includes(input.group_type)) {
    return apiResponse.badRequest(res, `Invalid group_type. Must be one of: ${validTypes.join(', ')}`);
  }

  // Check for duplicate JID if changing
  if (input.group_jid) {
    const duplicate = await pool.query(
      'SELECT id FROM wa_monitored_groups WHERE group_jid = $1 AND id != $2',
      [input.group_jid, id]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Group with JID "${input.group_jid}" already exists`,
      });
    }
  }

  // Build dynamic update query
  const updates: string[] = [];
  const params: (string | boolean | null)[] = [];
  let paramIndex = 1;

  if (input.group_jid !== undefined) {
    updates.push(`group_jid = $${paramIndex++}`);
    params.push(input.group_jid.trim());
  }
  if (input.group_name !== undefined) {
    updates.push(`group_name = $${paramIndex++}`);
    params.push(input.group_name.trim());
  }
  if (input.project_name !== undefined) {
    updates.push(`project_name = $${paramIndex++}`);
    params.push(input.project_name?.trim() || null);
  }
  if (input.project_id !== undefined) {
    updates.push(`project_id = $${paramIndex++}`);
    params.push(input.project_id || null);
  }
  if (input.group_type !== undefined) {
    updates.push(`group_type = $${paramIndex++}`);
    params.push(input.group_type);
  }
  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(input.description?.trim() || null);
  }
  if (input.is_active !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    params.push(input.is_active);
  }

  if (updates.length === 0) {
    return apiResponse.badRequest(res, 'No fields to update');
  }

  params.push(id);

  const result = await pool.query(
    `UPDATE wa_monitored_groups
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${paramIndex}
     RETURNING id, group_jid, group_name, project_name, project_id, group_type, description, is_active, created_at, updated_at`,
    params
  );

  return apiResponse.success(res, result.rows[0] as WaMonitoredGroup, 'Group updated successfully');
}

/**
 * DELETE - Soft delete (deactivate) a monitored group
 */
async function handleDelete(
  id: string,
  res: NextApiResponse
) {
  // Check group exists
  const existing = await pool.query(
    'SELECT id, group_name FROM wa_monitored_groups WHERE id = $1',
    [id]
  );

  if (existing.rows.length === 0) {
    return apiResponse.notFound(res, 'Monitored group', id);
  }

  const groupName = existing.rows[0].group_name;

  // Soft delete by setting is_active = false
  await pool.query(
    'UPDATE wa_monitored_groups SET is_active = false, updated_at = NOW() WHERE id = $1',
    [id]
  );

  return apiResponse.success(res, null, `Group "${groupName}" has been deactivated`);
}

export default withAuth(handler);
