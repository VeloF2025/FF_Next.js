/**
 * WhatsApp Groups API
 * GET  /api/communications/whatsapp/groups - List all groups
 * POST /api/communications/whatsapp/groups - Create a new group
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
  res: NextApiResponse<WaAdminApiResponse<WaGroupConfig | WaGroupConfig[]>>
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
    console.error('[WA Groups API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - List all WhatsApp groups
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaGroupConfig[]>>
) {
  const { enabled } = req.query;

  let query = `
    SELECT
      id, project_name, group_jid, group_name, phone_number, enabled,
      created_at, updated_at
    FROM wa_group_config
  `;

  const params: (string | boolean)[] = [];

  if (enabled === 'true') {
    query += ' WHERE enabled = true';
  } else if (enabled === 'false') {
    query += ' WHERE enabled = false';
  }

  query += ' ORDER BY project_name ASC';

  const result = await pool.query(query, params);
  const groups = result.rows as WaGroupConfig[];

  return res.status(200).json({
    success: true,
    data: groups,
  });
}

/**
 * POST - Create a new WhatsApp group
 */
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaGroupConfig>>
) {
  const input = req.body as WaGroupConfigInput;

  // Validation
  if (!input.project_name?.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Project name is required',
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

  // Check for duplicate project name
  const existing = await pool.query(
    'SELECT id FROM wa_group_config WHERE project_name = $1',
    [input.project_name]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({
      success: false,
      error: `Project "${input.project_name}" already exists`,
    });
  }

  // Insert new group
  const result = await pool.query(
    `INSERT INTO wa_group_config (
      project_name, group_jid, group_name, phone_number, enabled
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING id, project_name, group_jid, group_name, phone_number, enabled, created_at, updated_at`,
    [
      input.project_name.trim(),
      input.group_jid.trim(),
      input.group_name?.trim() || null,
      input.phone_number?.trim() || null,
      input.enabled !== false,
    ]
  );

  const newGroup = result.rows[0] as WaGroupConfig;

  // Log admin action
  await logAdminAction('create_group', 'group', newGroup.id, null, newGroup, req);

  return res.status(201).json({
    success: true,
    data: newGroup,
    message: `Group "${newGroup.project_name}" created successfully`,
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
    // Get user from session/auth if available
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
    // Don't fail the main operation if audit logging fails
  }
}

export default withAuth(handler);
