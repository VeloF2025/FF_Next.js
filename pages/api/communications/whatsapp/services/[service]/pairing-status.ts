/**
 * WhatsApp Service Pairing Status API
 * GET /api/communications/whatsapp/services/[service]/pairing-status
 *
 * Returns the current pairing status for the specified WhatsApp service.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type {
  WaAdminApiResponse,
  WaPairingStatus,
} from '@/modules/communications/whatsapp/types/wa-admin.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

// Default service URLs
const DEFAULT_URLS: Record<string, string> = {
  sender: 'http://100.96.203.105:8081',
  bridge: 'http://100.96.203.105:8083',
};

interface PairingStatusResponse extends WaPairingStatus {
  connected: boolean;
  session_valid: boolean;
  phone_number: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<PairingStatusResponse>>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
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

    // Call the service's /pairing-status endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const statusResponse = await fetch(`${serviceUrl}/pairing-status`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!statusResponse.ok) {
      // If endpoint doesn't exist (older service version), fall back to health check
      if (statusResponse.status === 404) {
        const healthResponse = await fetch(`${serviceUrl}/health`);
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          return res.status(200).json({
            success: true,
            data: {
              service: serviceName as 'bridge' | 'sender',
              status: healthData.connected ? 'connected' : 'idle',
              pairing_code: null,
              expires_at: null,
              error_message: null,
              connected: healthData.connected || false,
              session_valid: healthData.session_valid || healthData.connected || false,
              phone_number: healthData.phone_number || 'Unknown',
            },
          });
        }
      }

      return res.status(statusResponse.status).json({
        success: false,
        error: `Service returned error: ${statusResponse.status}`,
      });
    }

    const statusData = await statusResponse.json();

    return res.status(200).json({
      success: true,
      data: {
        service: serviceName as 'bridge' | 'sender',
        status: statusData.status || 'unknown',
        pairing_code: statusData.pairing_code || null,
        expires_at: statusData.expires_at || null,
        error_message: statusData.error_message || null,
        connected: statusData.connected || false,
        session_valid: statusData.session_valid || false,
        phone_number: statusData.phone_number || 'Unknown',
      },
    });
  } catch (error) {
    console.error(`[WA Pairing Status API] Error for ${serviceName}:`, error);

    if (error instanceof Error && error.name === 'AbortError') {
      return res.status(200).json({
        success: true,
        data: {
          service: serviceName as 'bridge' | 'sender',
          status: 'failed',
          pairing_code: null,
          expires_at: null,
          error_message: 'Connection timeout - service may be down',
          connected: false,
          session_valid: false,
          phone_number: 'Unknown',
        },
      });
    }

    return apiResponse.internalError(res, error);
  }
}
