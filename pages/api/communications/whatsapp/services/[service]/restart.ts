/**
 * WhatsApp Service Restart API
 * POST /api/communications/whatsapp/services/[service]/restart - Restart a service
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import type { WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

// Rate limiting: Track last restart time per service
const lastRestartTime: Record<string, number> = {};
const RESTART_COOLDOWN_MS = 60000; // 1 minute cooldown

interface RestartResult {
  service: string;
  success: boolean;
  message: string;
  restarted_at: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<RestartResult>>
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { service } = req.query;

  if (!service || typeof service !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Service name is required',
    });
  }

  // Validate service name
  const validServices = ['bridge', 'sender'];
  if (!validServices.includes(service)) {
    return res.status(400).json({
      success: false,
      error: `Invalid service. Must be one of: ${validServices.join(', ')}`,
    });
  }

  // Check rate limiting
  const now = Date.now();
  const lastRestart = lastRestartTime[service] || 0;
  const timeSinceLastRestart = now - lastRestart;

  if (timeSinceLastRestart < RESTART_COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((RESTART_COOLDOWN_MS - timeSinceLastRestart) / 1000);
    return res.status(429).json({
      success: false,
      error: `Service "${service}" was recently restarted. Please wait ${remainingSeconds} seconds before trying again.`,
    });
  }

  try {
    // Get VPS credentials from config
    const configResult = await pool.query(
      `SELECT config_key, config_value
      FROM wa_service_config
      WHERE config_key IN ('vps_host', 'vps_user', 'vps_password')`
    );

    const config: Record<string, string> = {};
    for (const row of configResult.rows) {
      config[row.config_key] = row.config_value;
    }

    const vpsHost = config.vps_host;
    const vpsUser = config.vps_user;
    const vpsPassword = config.vps_password;

    if (!vpsHost || !vpsUser || !vpsPassword) {
      return res.status(500).json({
        success: false,
        error: 'VPS configuration is incomplete. Please configure VPS credentials in settings.',
      });
    }

    // Map service to systemd service name
    const serviceNameMap: Record<string, string> = {
      bridge: 'whatsapp-bridge.service',
      sender: 'whatsapp-sender.service',
    };

    const systemdService = serviceNameMap[service];

    // Execute restart command via SSH
    // Note: In production, this should use a secure method like SSH keys
    // Using spawn with separate arguments to prevent command injection
    const { spawnSync } = require('child_process');

    try {
      // Validate inputs contain only safe characters (alphanumeric, dots, hyphens)
      const safeHostPattern = /^[a-zA-Z0-9.-]+$/;
      const safeUserPattern = /^[a-zA-Z0-9_-]+$/;

      if (!safeHostPattern.test(vpsHost)) {
        throw new Error('Invalid VPS host format');
      }
      if (!safeUserPattern.test(vpsUser)) {
        throw new Error('Invalid VPS user format');
      }

      // Use spawnSync with separate arguments to prevent shell injection
      const sshResult = spawnSync('sshpass', [
        '-p', vpsPassword,
        'ssh',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        `${vpsUser}@${vpsHost}`,
        `echo '${vpsPassword.replace(/'/g, "'\\''")}' | sudo -S systemctl restart ${systemdService}`
      ], {
        timeout: 30000,
        encoding: 'utf8',
      });

      if (sshResult.error) {
        throw sshResult.error;
      }
      if (sshResult.status !== 0 && sshResult.stderr && !sshResult.stderr.includes('password')) {
        throw new Error(sshResult.stderr || 'SSH command failed');
      }

      // Update last restart time
      lastRestartTime[service] = now;

      // Log the admin action
      await logAdminAction('restart_service', 'service', service, null, {
        service,
        systemd_service: systemdService,
        restarted_at: new Date().toISOString(),
      }, req);

      return res.status(200).json({
        success: true,
        data: {
          service,
          success: true,
          message: `Service "${service}" restart command sent successfully`,
          restarted_at: new Date().toISOString(),
        },
        message: `WhatsApp ${service} service is restarting. It may take a few seconds to come back online.`,
      });

    } catch (execError) {
      log.error('[WA Service Restart] Failed to restart service', { service, error: execError });

      return res.status(500).json({
        success: false,
        error: `Failed to restart service: ${execError instanceof Error ? execError.message : 'Unknown error'}`,
      });
    }

  } catch (error) {
    log.error('[WA Service Restart API] Error', { error });
    return apiResponse.internalError(res, error);
  }
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
    log.error('[WA Admin] Failed to log audit action', { error });
  }
}

export default withAuth(handler);
