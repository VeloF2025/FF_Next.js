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

// Default service configurations (will be overridden by database values)
// VPS URLs (Jan 2026 migration)
const DEFAULT_BRIDGE_URL = 'http://72.61.197.178:8083';
const DEFAULT_SENDER_URL = 'http://72.61.197.178:8081';
const DEFAULT_BRIDGE_PHONE = '+27638412276';
const DEFAULT_SENDER_PHONE = '+27638412276';

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
      WHERE config_key IN ('bridge_url', 'sender_url', 'bridge_phone', 'sender_phone', 'health_check_timeout_ms')`
    );

    const config: Record<string, string> = {};
    for (const row of configResult.rows) {
      config[row.config_key] = row.config_value;
    }

    const bridgeUrl = config.bridge_url || DEFAULT_BRIDGE_URL;
    const senderUrl = config.sender_url || DEFAULT_SENDER_URL;
    const bridgePhone = config.bridge_phone || DEFAULT_BRIDGE_PHONE;
    const senderPhone = config.sender_phone || DEFAULT_SENDER_PHONE;
    const healthTimeout = parseInt(config.health_check_timeout_ms || '5000', 10);

    // Check both services in parallel
    const [bridgeStatus, senderStatus] = await Promise.all([
      checkServiceHealth('bridge', bridgeUrl, bridgePhone, healthTimeout),
      checkServiceHealth('sender', senderUrl, senderPhone, healthTimeout),
    ]);

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
    senderStatus.last_message_at = lastMessageMap.sender || null;

    // Determine overall status
    let overall: 'healthy' | 'degraded' | 'down' = 'healthy';
    if (bridgeStatus.status === 'disconnected' && senderStatus.status === 'disconnected') {
      overall = 'down';
    } else if (bridgeStatus.status === 'disconnected' || senderStatus.status === 'disconnected') {
      overall = 'degraded';
    } else if (bridgeStatus.status === 'error' || senderStatus.status === 'error') {
      overall = 'degraded';
    }

    const response: WaServicesStatusResponse = {
      bridge: bridgeStatus,
      sender: senderStatus,
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
 * Check the health of a WhatsApp service
 * Bridge uses TCP connectivity check (no HTTP health endpoint)
 * Sender uses HTTP /health endpoint
 */
async function checkServiceHealth(
  name: 'bridge' | 'sender',
  url: string,
  phone: string,
  timeoutMs: number
): Promise<WaServiceStatus> {
  const baseStatus: WaServiceStatus = {
    name,
    displayName: name === 'bridge' ? 'WhatsApp Bridge' : 'WhatsApp Sender',
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

    // Bridge doesn't have /health endpoint - check if port responds
    if (name === 'bridge') {
      // Try any HTTP request to check port is open
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      // If we get any response (even 404), the service is running
      if (response) {
        baseStatus.status = 'connected';
        baseStatus.session_valid = true;
        // Bridge is a Go binary that receives messages - it's "connected" if responding
        return baseStatus;
      } else {
        baseStatus.status = 'disconnected';
        baseStatus.error_message = 'Service not responding';
        return baseStatus;
      }
    }

    // Sender has /health endpoint
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      baseStatus.status = 'error';
      baseStatus.error_message = `HTTP ${response.status}`;
      return baseStatus;
    }

    const data = await response.json();

    // Parse health response (format may vary by service)
    baseStatus.status = parseServiceStatus(data);
    baseStatus.session_valid = data.connected === true || data.session_valid === true;
    baseStatus.needs_auth = data.needs_auth === true || data.authenticated === false;
    baseStatus.uptime = data.uptime || null;

    // Get phone number from health response if available
    if (data.phone_number) {
      baseStatus.phone_number = data.phone_number;
    }

    if (data.error) {
      baseStatus.error_message = data.error;
    }

    return baseStatus;

  } catch (error) {
    baseStatus.status = 'disconnected';
    baseStatus.error_message = error instanceof Error ? error.message : 'Connection failed';

    // Check if it's a timeout
    if (error instanceof Error && error.name === 'AbortError') {
      baseStatus.error_message = 'Connection timeout';
    }

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
