/**
 * WhatsApp Services Status API
 * GET /api/communications/whatsapp/services/status - Get status of all WhatsApp services
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type {
  WaServicesStatusResponse,
  WaServiceStatus,
  ServiceStatus,
  WaAdminApiResponse
} from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

// Default service configuration (sender removed 2026-02-18, bridge only)
const DEFAULT_BRIDGE_URL = 'http://72.61.197.178:8083';
const DEFAULT_BRIDGE_PHONE = '+27638412276';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaServicesStatusResponse>>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Get service configuration from database
    const configResult = await pool.query(
      `SELECT config_key, config_value
      FROM wa_service_config
      WHERE config_key IN ('bridge_url', 'bridge_phone', 'health_check_timeout_ms')`
    );

    const config: Record<string, string> = {};
    for (const row of configResult.rows) {
      config[row.config_key] = row.config_value;
    }

    const bridgeUrl = config.bridge_url || DEFAULT_BRIDGE_URL;
    const bridgePhone = config.bridge_phone || DEFAULT_BRIDGE_PHONE;
    const healthTimeout = parseInt(config.health_check_timeout_ms || '5000', 10);

    // Check bridge only (sender removed 2026-02-18)
    const bridgeStatus = await checkServiceHealth('bridge', bridgeUrl, bridgePhone, healthTimeout);

    // Get last message timestamps
    const lastMessagesResult = await pool.query(
      `SELECT
        service,
        MAX(created_at) as last_message_at
      FROM wa_message_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY service`
    );

    const lastMessageMap: Record<string, string> = {};
    for (const row of lastMessagesResult.rows) {
      lastMessageMap[row.service] = row.last_message_at;
    }

    bridgeStatus.last_message_at = lastMessageMap.bridge || null;

    // Determine overall status based on bridge only
    let overall: 'healthy' | 'degraded' | 'down';
    if (bridgeStatus.status === 'connected') {
      overall = 'healthy';
    } else if (bridgeStatus.status === 'disconnected') {
      overall = 'down';
    } else {
      overall = 'degraded';
    }

    const response: WaServicesStatusResponse = {
      bridge: bridgeStatus,
      overall,
      checked_at: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      data: response,
    });

  } catch (error) {
    log.error('[WA Services Status API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

/**
 * Check bridge health by attempting an HTTP request to the port.
 * Bridge is a Go binary with no dedicated /health endpoint — any response means it is up.
 */
async function checkServiceHealth(
  name: 'bridge',
  url: string,
  phone: string,
  timeoutMs: number
): Promise<WaServiceStatus> {
  const baseStatus: WaServiceStatus = {
    name,
    displayName: 'WhatsApp Bridge',
    status: 'unknown',
    phone_number: phone,
    url,
    port: parseInt(new URL(url).port || '80', 10),
    last_message_at: null,
    uptime: null,
    error_message: null,
    session_valid: false,
    needs_auth: false,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Any HTTP response (including 404) means the bridge process is alive
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (response) {
      baseStatus.status = 'connected';
      baseStatus.session_valid = true;
    } else {
      baseStatus.status = 'disconnected';
      baseStatus.error_message = 'Service not responding';
    }

    return baseStatus;

  } catch (error) {
    log.error('services-status', { error: error instanceof Error ? error.message : String(error) });
    baseStatus.status = 'disconnected';
    baseStatus.error_message = error instanceof Error && error.name === 'AbortError'
      ? 'Connection timeout'
      : error instanceof Error ? error.message : 'Connection failed';

    return baseStatus;
  }
}

/**
 * Parse service status from health response
 */
function parseServiceStatus(data: Record<string, unknown>): ServiceStatus {
  // Handle various health response formats
  if (data.status === 'ok' || data.status === 'healthy' || data.connected === true) {
    return 'connected';
  }
  if (data.status === 'connecting' || data.connecting === true) {
    return 'connecting';
  }
  if (data.status === 'error' || data.error) {
    return 'error';
  }
  if (data.status === 'disconnected' || data.connected === false) {
    return 'disconnected';
  }
  return 'unknown';
}

export default withAuth(handler);
