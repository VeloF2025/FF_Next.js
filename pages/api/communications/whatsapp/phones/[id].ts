/**
 * WhatsApp Phone Number API
 * GET /api/communications/whatsapp/phones/[id] - Get phone details
 * PUT /api/communications/whatsapp/phones/[id] - Update phone
 * DELETE /api/communications/whatsapp/phones/[id] - Remove phone
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type {
  WaAdminApiResponse,
  WaPhoneNumber,
} from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaPhoneNumber>>
) {
  const { id } = req.query;
  const phoneId = Array.isArray(id) ? id[0] : id;

  if (!phoneId) {
    return res.status(400).json({
      success: false,
      error: 'Phone ID is required',
    });
  }

  switch (req.method) {
    case 'GET':
      return handleGet(phoneId, res);
    case 'PUT':
      return handlePut(phoneId, req, res);
    case 'DELETE':
      return handleDelete(phoneId, req, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
  }
}

async function handleGet(
  phoneId: string,
  res: NextApiResponse<WaAdminApiResponse<WaPhoneNumber>>
) {
  try {
    const result = await pool.query(
      'SELECT * FROM wa_phone_numbers WHERE id = $1',
      [phoneId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Phone number not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('[WA Phone API] GET error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePut(
  phoneId: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaPhoneNumber>>
) {
  const { display_name, role, status } = req.body;

  try {
    // Get current phone
    const current = await pool.query(
      'SELECT * FROM wa_phone_numbers WHERE id = $1',
      [phoneId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Phone number not found',
      });
    }

    const phone = current.rows[0];

    // If promoting to primary, demote existing primary
    if (role === 'primary' && phone.role !== 'primary') {
      await pool.query(
        `UPDATE wa_phone_numbers
         SET role = 'fallback', updated_at = NOW()
         WHERE service = $1 AND role = 'primary' AND id != $2`,
        [phone.service, phoneId]
      );
    }

    // Update phone
    const result = await pool.query(
      `UPDATE wa_phone_numbers
       SET display_name = COALESCE($1, display_name),
           role = COALESCE($2, role),
           status = COALESCE($3, status),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [display_name, role, status, phoneId]
    );

    // Update service config if role changed
    if (role) {
      await pool.query(
        `UPDATE wa_service_config
         SET config_value = $1, updated_at = NOW()
         WHERE config_key = $2`,
        [result.rows[0].phone_number, `${phone.service}_${role}_phone`]
      );
    }

    // Log the action
    await pool.query(
      `INSERT INTO wa_admin_audit_log (action, entity_type, entity_id, old_value, new_value, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        'phone_updated',
        'phone',
        phoneId,
        JSON.stringify(phone),
        JSON.stringify(result.rows[0]),
        req.headers['x-user-id'] || null,
      ]
    );

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('[WA Phone API] PUT error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(
  phoneId: string,
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaPhoneNumber>>
) {
  try {
    // Get phone before deletion
    const current = await pool.query(
      'SELECT * FROM wa_phone_numbers WHERE id = $1',
      [phoneId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Phone number not found',
      });
    }

    const phone = current.rows[0];

    // Don't allow deleting the only phone for a service
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM wa_phone_numbers WHERE service = $1',
      [phone.service]
    );

    if (parseInt(countResult.rows[0].count) <= 1) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete the only phone number for this service',
      });
    }

    // Delete the phone
    await pool.query('DELETE FROM wa_phone_numbers WHERE id = $1', [phoneId]);

    // If deleted primary, promote fallback to primary
    if (phone.role === 'primary') {
      await pool.query(
        `UPDATE wa_phone_numbers
         SET role = 'primary', updated_at = NOW()
         WHERE service = $1 AND role = 'fallback'
         LIMIT 1`,
        [phone.service]
      );
    }

    // Clear the service config
    await pool.query(
      `UPDATE wa_service_config
       SET config_value = '', updated_at = NOW()
       WHERE config_key = $1`,
      [`${phone.service}_${phone.role}_phone`]
    );

    // Log the action
    await pool.query(
      `INSERT INTO wa_admin_audit_log (action, entity_type, entity_id, old_value, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        'phone_deleted',
        'phone',
        phoneId,
        JSON.stringify(phone),
        req.headers['x-user-id'] || null,
      ]
    );

    return res.status(200).json({
      success: true,
      data: phone,
      message: 'Phone number deleted',
    });
  } catch (error) {
    console.error('[WA Phone API] DELETE error:', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
