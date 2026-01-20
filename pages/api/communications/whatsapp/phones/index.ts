/**
 * WhatsApp Phone Numbers API
 * GET /api/communications/whatsapp/phones - List phone numbers
 * POST /api/communications/whatsapp/phones - Add a phone number
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type {
  WaAdminApiResponse,
  WaPhoneNumber,
  WaPhoneNumberInput,
} from '@/modules/communications/whatsapp/types/wa-admin.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaPhoneNumber[] | WaPhoneNumber>>
) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaPhoneNumber[]>>
) {
  const { service } = req.query;

  try {
    let query = 'SELECT * FROM wa_phone_numbers';
    const params: string[] = [];

    if (service) {
      query += ' WHERE service = $1';
      params.push(service as string);
    }

    query += ' ORDER BY service, role';

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('[WA Phones API] GET error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaPhoneNumber>>
) {
  const input: WaPhoneNumberInput = req.body;

  if (!input.service || !input.phone_number || !input.role) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: service, phone_number, role',
    });
  }

  if (!['sender', 'bridge'].includes(input.service)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid service. Must be "sender" or "bridge".',
    });
  }

  if (!['primary', 'fallback'].includes(input.role)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid role. Must be "primary" or "fallback".',
    });
  }

  try {
    // If setting as primary, demote existing primary to fallback
    if (input.role === 'primary') {
      await pool.query(
        `UPDATE wa_phone_numbers
         SET role = 'fallback', updated_at = NOW()
         WHERE service = $1 AND role = 'primary'`,
        [input.service]
      );
    }

    // Insert or update the phone number
    const result = await pool.query(
      `INSERT INTO wa_phone_numbers (service, phone_number, display_name, role, status, updated_at)
       VALUES ($1, $2, $3, $4, 'unpaired', NOW())
       ON CONFLICT (service, phone_number)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         updated_at = NOW()
       RETURNING *`,
      [input.service, input.phone_number, input.display_name || null, input.role]
    );

    // Update the service config
    await pool.query(
      `UPDATE wa_service_config
       SET config_value = $1, updated_at = NOW()
       WHERE config_key = $2`,
      [input.phone_number, `${input.service}_${input.role}_phone`]
    );

    // Log the action
    await pool.query(
      `INSERT INTO wa_admin_audit_log (action, entity_type, entity_id, new_value, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        'phone_added',
        'phone',
        result.rows[0].id,
        JSON.stringify(input),
        req.headers['x-user-id'] || null,
      ]
    );

    return res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('[WA Phones API] POST error:', error);
    return apiResponse.internalError(res, error);
  }
}
