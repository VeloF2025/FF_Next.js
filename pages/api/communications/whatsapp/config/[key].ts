/**
 * WhatsApp Config by Key API
 * GET /api/communications/whatsapp/config/[key] - Get a config value
 * PUT /api/communications/whatsapp/config/[key] - Update a config value
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type {
  WaServiceConfig,
  WaServiceConfigInput,
  WaAdminApiResponse
} from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaServiceConfig>>
) {
  const { key } = req.query;

  if (!key || typeof key !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Config key is required',
    });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(key, res);
      case 'PUT':
        return handlePut(key, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT']);
    }
  } catch (error) {
    console.error('[WA Config API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET - Get a single config by key
 */
async function handleGet(
  key: string,
  res: NextApiResponse<WaAdminApiResponse<WaServiceConfig>>
) {
  const result = await pool.query(
    `SELECT
      id, config_key, config_value, config_type, category,
      description, is_sensitive, updated_at, updated_by
    FROM wa_service_config
    WHERE config_key = $1`,
    [key]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Config not found',
    });
  }

  const config = result.rows[0] as WaServiceConfig;

  // Mask sensitive values
  if (config.is_sensitive) {
    config.config_value = '********';
  }

  return res.status(200).json({
    success: true,
    data: config,
  });
}

/**
 * PUT - Update a config value
 */
async function handlePut(
  key: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaServiceConfig>>
) {
  const input = req.body as WaServiceConfigInput;

  if (input.config_value === undefined) {
    return res.status(400).json({
      success: false,
      error: 'config_value is required',
    });
  }

  // Get existing config first
  const existing = await pool.query(
    'SELECT * FROM wa_service_config WHERE config_key = $1',
    [key]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: 'Config not found',
    });
  }

  const oldConfig = existing.rows[0] as WaServiceConfig;

  // Validate value based on type
  const validationError = validateConfigValue(input.config_value, oldConfig.config_type);
  if (validationError) {
    return res.status(400).json({
      success: false,
      error: validationError,
    });
  }

  // Get user email from headers
  const userEmail = req.headers['x-user-email'] as string || null;

  // Update the config
  const result = await pool.query(
    `UPDATE wa_service_config SET
      config_value = $1,
      updated_at = NOW(),
      updated_by = $2
    WHERE config_key = $3
    RETURNING id, config_key, config_value, config_type, category, description, is_sensitive, updated_at, updated_by`,
    [input.config_value, userEmail, key]
  );

  const updatedConfig = result.rows[0] as WaServiceConfig;

  // Log admin action (mask sensitive values in audit log)
  await logAdminAction(
    'update_config',
    'config',
    key,
    { ...oldConfig, config_value: oldConfig.is_sensitive ? '[REDACTED]' : oldConfig.config_value },
    { ...updatedConfig, config_value: updatedConfig.is_sensitive ? '[REDACTED]' : updatedConfig.config_value },
    req
  );

  // Mask sensitive value in response
  if (updatedConfig.is_sensitive) {
    updatedConfig.config_value = '********';
  }

  return res.status(200).json({
    success: true,
    data: updatedConfig,
    message: `Config "${key}" updated successfully`,
  });
}

/**
 * Validate config value based on type
 */
function validateConfigValue(value: string, type: string): string | null {
  switch (type) {
    case 'number':
      if (isNaN(Number(value))) {
        return 'Value must be a valid number';
      }
      break;
    case 'boolean':
      if (value !== 'true' && value !== 'false') {
        return 'Value must be "true" or "false"';
      }
      break;
    case 'json':
      try {
        JSON.parse(value);
      } catch {
        return 'Value must be valid JSON';
      }
      break;
    // 'string' type accepts any value
  }
  return null;
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
