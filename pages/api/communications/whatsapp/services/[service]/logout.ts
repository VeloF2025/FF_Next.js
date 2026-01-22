/**
 * WhatsApp Service Logout API
 * POST /api/communications/whatsapp/services/[service]/logout
 *
 * Logs out and clears the session for the specified WhatsApp service.
 * After logout, the service will require re-pairing via /pair endpoint.
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

interface LogoutResponse {
  success: boolean;
  message: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<LogoutResponse>>
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

    // Call the service's /logout endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const logoutResponse = await fetch(`${serviceUrl}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!logoutResponse.ok) {
      const errorText = await logoutResponse.text();
      return res.status(logoutResponse.status).json({
        success: false,
        error: `Service returned error: ${errorText}`,
      });
    }

    const logoutData = await logoutResponse.json();

    // Log the logout action
    await pool.query(
      `INSERT INTO wa_admin_audit_log (action, entity_type, entity_id, user_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        'logout',
        'service',
        serviceName,
        req.headers['x-user-id'] || null,
      ]
    );

    return res.status(200).json({
      success: true,
      data: {
        success: true,
        message: logoutData.message || `${serviceName} service logged out. Use pairing to re-authenticate.`,
      },
    });
  } catch (error) {
    console.error(`[WA Logout API] Error for ${serviceName}:`, error);

    if (error instanceof Error && error.name === 'AbortError') {
      return res.status(504).json({
        success: false,
        error: 'Logout request timed out. The service may be unresponsive.',
      });
    }

    return apiResponse.internalError(res, error);
  }
}
