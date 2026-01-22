/**
 * WhatsApp Service Pairing API
 * POST /api/communications/whatsapp/services/[service]/pair
 *
 * Initiates pairing process for the specified WhatsApp service.
 * Returns a pairing code that must be entered in WhatsApp on the phone.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type { WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

// Default service URLs
const DEFAULT_URLS: Record<string, string> = {
  sender: 'http://72.61.197.178:8081',
  bridge: 'http://72.61.197.178:8083',
};

interface PairResponse {
  success: boolean;
  pairing_code?: string;
  phone_number?: string;
  expires_at?: string;
  instructions?: string[];
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<PairResponse>>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { service } = req.query;
  const serviceName = Array.isArray(service) ? service[0] : service;

  if (!serviceName || !['bridge', 'sender'].includes(serviceName)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid service. Must be "bridge" or "sender".',
    });
  }

  try {
    // Get service URL from database config
    const configKey = `${serviceName}_url`;
    const configResult = await pool.query(
      'SELECT config_value FROM wa_service_config WHERE config_key = $1',
      [configKey]
    );

    const serviceUrl = configResult.rows[0]?.config_value || DEFAULT_URLS[serviceName];

    // Get optional phone number from request body
    const { phone_number } = req.body || {};

    // Call the service's /pair endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for pairing

    const pairResponse = await fetch(`${serviceUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!pairResponse.ok) {
      const errorText = await pairResponse.text();
      return res.status(pairResponse.status).json({
        success: false,
        error: `Service returned error: ${errorText}`,
      });
    }

    const pairData = await pairResponse.json();

    // Log the pairing attempt
    await pool.query(
      `INSERT INTO wa_admin_audit_log (action, entity_type, entity_id, new_value, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        'pair_initiated',
        'service',
        serviceName,
        JSON.stringify({ phone_number: pairData.phone_number }),
        req.headers['x-user-id'] || null,
      ]
    );

    return res.status(200).json({
      success: true,
      data: {
        success: true,
        pairing_code: pairData.pairing_code,
        phone_number: pairData.phone_number,
        expires_at: pairData.expires_at,
        instructions: pairData.instructions || [
          '1. Open WhatsApp on your phone',
          '2. Go to Settings → Linked Devices',
          '3. Tap "Link a Device"',
          '4. Tap "Link with Phone Number Instead"',
          `5. Enter code: ${pairData.pairing_code}`,
        ],
      },
    });
  } catch (error) {
    console.error(`[WA Pair API] Error for ${serviceName}:`, error);

    if (error instanceof Error && error.name === 'AbortError') {
      return res.status(504).json({
        success: false,
        error: 'Pairing request timed out. The service may be unresponsive.',
      });
    }

    return apiResponse.internalError(res, error);
  }
}
