/**
 * WhatsApp Group by ID API
 * GET    /api/communications/whatsapp/groups/[id] - Get a single group
 * PUT    /api/communications/whatsapp/groups/[id] - Update a group
 * DELETE /api/communications/whatsapp/groups/[id] - Delete a group
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type { WaGroupConfig, WaGroupConfigInput, WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaGroupConfig>>
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
        return handleDelete(id, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
    }
  } catch (error) {
    console.error('[WA Group API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - Get a single group by ID
 */
async function handleGet(
  id: string,
  res: NextApiResponse<WaAdminApiResponse<WaGroupConfig>>
) {
  const result = await pool.query(
    `SELECT
      id, project_name, group_jid, group_name, phone_number, enabled,
      created_at, updated_at
    FROM wa_group_config
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
    data: result.rows[0] as WaGroupConfig,
  });
}

/**
 * PUT - Update a group
 */
async function handlePut(
  id: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaGroupConfig>>
) {
  const input = req.body as Partial<WaGroupConfigInput>;

  // Get existing group first
  const existing = await pool.query(
    'SELECT * FROM wa_group_config WHERE id = $1::uuid',
    [id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Group not found',
    });
  }

  const oldGroup = existing.rows[0] as WaGroupConfig;

  // Validate JID format if provided
  if (input.group_jid && !input.group_jid.endsWith('@g.us')) {
    return res.status(400).json({
      success: false,
      error: 'Group JID must end with @g.us',
    });
  }

  // Check for duplicate project name if changing
  if (input.project_name && input.project_name !== oldGroup.project_name) {
    const duplicate = await pool.query(
      'SELECT id FROM wa_group_config WHERE project_name = $1 AND id != $2::uuid',
      [input.project_name, id]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Project "${input.project_name}" already exists`,
      });
    }
  }

  // Build update query dynamically
  const updates: Record<string, unknown> = {};
  if (input.project_name !== undefined) updates.project_name = input.project_name.trim();
  if (input.group_jid !== undefined) updates.group_jid = input.group_jid.trim();
  if (input.group_name !== undefined) updates.group_name = input.group_name?.trim() || null;
  if (input.phone_number !== undefined) updates.phone_number = input.phone_number?.trim() || null;
  if (input.enabled !== undefined) updates.enabled = input.enabled;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No fields to update',
    });
  }

  // Update the group
  const result = await pool.query(
    `UPDATE wa_group_config SET
      project_name = COALESCE($1, project_name),
      group_jid = COALESCE($2, group_jid),
      group_name = $3,
      phone_number = $4,
      enabled = COALESCE($5, enabled),
      updated_at = NOW()
    WHERE id = $6::uuid
    RETURNING id, project_name, group_jid, group_name, phone_number, enabled, created_at, updated_at`,
    [
      updates.project_name ?? null,
      updates.group_jid ?? null,
      updates.group_name !== undefined ? updates.group_name : oldGroup.group_name,
      updates.phone_number !== undefined ? updates.phone_number : oldGroup.phone_number,
      updates.enabled ?? null,
      id,
    ]
  );

  const updatedGroup = result.rows[0] as WaGroupConfig;

  // Log admin action
  await logAdminAction('update_group', 'group', id, oldGroup, updatedGroup, req);

  return res.status(200).json({
    success: true,
    data: updatedGroup,
    message: `Group "${updatedGroup.project_name}" updated successfully`,
  });
}

/**
 * DELETE - Delete a group
 */
async function handleDelete(
  id: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaGroupConfig>>
) {
  // Get existing group first for audit log
  const existing = await pool.query(
    'SELECT * FROM wa_group_config WHERE id = $1::uuid',
    [id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Group not found',
    });
  }

  const deletedGroup = existing.rows[0] as WaGroupConfig;

  // Delete the group
  await pool.query('DELETE FROM wa_group_config WHERE id = $1::uuid', [id]);

  // Log admin action
  await logAdminAction('delete_group', 'group', id, deletedGroup, null, req);

  return res.status(200).json({
    success: true,
    data: deletedGroup,
    message: `Group "${deletedGroup.project_name}" deleted successfully`,
  });
}

/**
 * Log admin action to audit table
 */
async function logAdminAction(
  action: string,
  entityType: string,
  entityId: string | null,
  oldValue: unknown,
  newValue: unknown,
  req: NextApiRequest
) {
  try {
    const userEmail = req.headers['x-user-email'] as string || null;
    const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || null;

    await pool.query(
      `INSERT INTO wa_admin_audit_log (
        action, entity_type, entity_id, old_value, new_value, user_email, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        action,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        userEmail,
        typeof ipAddress === 'string' ? ipAddress.split(',')[0] : ipAddress,
      ]
    );
  } catch (error) {
    console.error('[WA Admin] Failed to log audit action:', error);
  }
}

export default withAuth(handler);
