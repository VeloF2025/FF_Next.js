/**
 * WA Monitor System Health Check API
 * Verifies all components of the WA Monitor system are operational
 *
 * Checks:
 * 1. VPS Services (WhatsApp Bridge, Drop Monitors)
 * 2. Database (Connection, Tables, Recent Data)
 * 3. API Endpoints (Response times, functionality)
 * 4. Data Pipeline (End-to-end verification)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { exec } from 'child_process';
import { promisify } from 'util';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const execAsync = promisify(exec);
const sql = neon(process.env.DATABASE_URL || '');

// VPS SSH credentials - must be set in env, no hardcoded secrets
const VPS_HOST = process.env.WA_VPS_HOST || '72.61.197.178';
const VPS_USER = process.env.WA_VPS_USER || 'root';
const VPS_PASS = process.env.WA_VPS_PASS;

interface HealthCheck {
  status: 'up' | 'down' | 'degraded' | 'stale';
  details: Record<string, any>;
  latency_ms?: number;
  error?: string;
}

interface HealthResponse {
  success: boolean;
  data: {
    overall_status: 'healthy' | 'degraded' | 'down';
    timestamp: string;
    checks: {
      vps: {
        whatsapp_bridge: HealthCheck;
        drop_monitor_prod: HealthCheck;
        drop_monitor_dev: HealthCheck;
        log_activity: HealthCheck;
      };
      database: {
        connection: HealthCheck;
        table_exists: HealthCheck;
        recent_data: HealthCheck;
      };
      api: {
        get_drops: HealthCheck;
        get_daily_drops: HealthCheck;
      };
    };
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const startTime = Date.now();

    // Run all health checks in parallel for speed
    const [vpsChecks, dbChecks, apiChecks] = await Promise.all([
      checkVPSServices(),
      checkDatabase(),
      checkAPIEndpoints(req),
    ]);

    const totalTime = Date.now() - startTime;

    // Determine overall status
    const allChecks = [
      ...Object.values(vpsChecks),
      ...Object.values(dbChecks),
      ...Object.values(apiChecks),
    ];

    const hasDown = allChecks.some((c) => c.status === 'down');
    const hasDegraded = allChecks.some((c) => c.status === 'degraded' || c.status === 'stale');

    const overallStatus = hasDown ? 'down' : hasDegraded ? 'degraded' : 'healthy';

    return res.status(200).json({
      success: true,
      data: {
        overall_status: overallStatus,
        timestamp: new Date().toISOString(),
        checks: {
          vps: vpsChecks,
          database: dbChecks,
          api: apiChecks,
        },
      },
    });
  } catch (error) {
    log.error('Health check error', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
}

// ==================== VPS SERVICE CHECKS ====================

async function checkVPSServices() {
  if (!VPS_PASS) {
    const noCredCheck: HealthCheck = {
      status: 'down',
      details: { message: 'WA_VPS_PASS env var not set' },
      error: 'VPS credentials not configured',
    };
    return {
      whatsapp_bridge: noCredCheck,
      drop_monitor_prod: noCredCheck,
      drop_monitor_dev: noCredCheck,
      log_activity: noCredCheck,
    };
  }

  const sshCmd = (cmd: string) =>
    `sshpass -p '${VPS_PASS}' ssh -o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no ${VPS_USER}@${VPS_HOST} "${cmd}"`;

  // Check WhatsApp Bridge process
  const whatsappBridge = await checkProcess(
    'WhatsApp Bridge',
    sshCmd("ps aux | grep '[w]hatsapp-bridge'")
  );

  // Check Drop Monitor Prod service
  const dropMonitorProd = await checkSystemdService(
    'Drop Monitor Prod',
    sshCmd('systemctl is-active wa-monitor-prod')
  );

  // Check Drop Monitor Dev service
  const dropMonitorDev = await checkSystemdService(
    'Drop Monitor Dev',
    sshCmd('systemctl is-active wa-monitor-dev')
  );

  // Check recent log activity
  const logActivity = await checkLogActivity(
    sshCmd("stat -c '%Y' /opt/wa-monitor/prod/logs/wa-monitor-prod.log")
  );

  return {
    whatsapp_bridge: whatsappBridge,
    drop_monitor_prod: dropMonitorProd,
    drop_monitor_dev: dropMonitorDev,
    log_activity: logActivity,
  };
}

async function checkProcess(name: string, command: string): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const { stdout } = await execAsync(command);
    const latency = Date.now() - start;

    if (!stdout || stdout.trim() === '') {
      return {
        status: 'down',
        details: { name, message: 'Process not found' },
        latency_ms: latency,
        error: 'Process not running',
      };
    }

    // Parse process info
    const lines = stdout.trim().split('\n');
    const processInfo = lines[0].split(/\s+/);

    return {
      status: 'up',
      details: {
        name,
        pid: processInfo[1],
        cpu: processInfo[2],
        mem: processInfo[3],
        uptime: processInfo[8],
      },
      latency_ms: latency,
    };
  } catch (error) {
    log.error('wa-monitor-health', { error: error instanceof Error ? error.message : String(error) });
    return {
      status: 'down',
      details: { name },
      error: error instanceof Error ? error.message : 'Check failed',
    };
  }
}

async function checkSystemdService(name: string, command: string): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const { stdout } = await execAsync(command);
    const latency = Date.now() - start;

    const status = stdout.trim();

    if (status === 'active') {
      return {
        status: 'up',
        details: { name, service_status: status },
        latency_ms: latency,
      };
    } else {
      return {
        status: 'down',
        details: { name, service_status: status },
        latency_ms: latency,
        error: `Service is ${status}`,
      };
    }
  } catch (error) {
    return {
      status: 'down',
      details: { name },
      error: error instanceof Error ? error.message : 'Check failed',
    };
  }
}

async function checkLogActivity(command: string): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const { stdout } = await execAsync(command);
    const latency = Date.now() - start;

    const lastModified = parseInt(stdout.trim(), 10);
    const now = Math.floor(Date.now() / 1000);
    const ageSeconds = now - lastModified;
    const ageMinutes = Math.floor(ageSeconds / 60);

    let status: HealthCheck['status'] = 'up';
    if (ageMinutes > 30) {
      status = 'down';
    } else if (ageMinutes > 5) {
      status = 'stale';
    }

    return {
      status,
      details: {
        last_modified_minutes_ago: ageMinutes,
        last_modified_timestamp: new Date(lastModified * 1000).toISOString(),
      },
      latency_ms: latency,
      error: status !== 'up' ? `No log activity for ${ageMinutes} minutes` : undefined,
    };
  } catch (error) {
    return {
      status: 'down',
      details: {},
      error: error instanceof Error ? error.message : 'Check failed',
    };
  }
}

// ==================== DATABASE CHECKS ====================

async function checkDatabase() {
  // Check connection
  const connection = await checkDatabaseConnection();

  // Check table exists
  const tableExists = await checkTableExists();

  // Check recent data
  const recentData = await checkRecentData();

  return {
    connection,
    table_exists: tableExists,
    recent_data: recentData,
  };
}

async function checkDatabaseConnection(): Promise<HealthCheck> {
  try {
    const start = Date.now();
    await sql`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: 'up',
      details: { message: 'Connected to Neon PostgreSQL' },
      latency_ms: latency,
    };
  } catch (error) {
    return {
      status: 'down',
      details: {},
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

async function checkTableExists(): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const [result] = await sql`
      SELECT COUNT(*) as total FROM qa_photo_reviews
    `;
    const latency = Date.now() - start;

    const total = parseInt(result.total, 10);

    return {
      status: 'up',
      details: {
        table_name: 'qa_photo_reviews',
        total_rows: total,
      },
      latency_ms: latency,
    };
  } catch (error) {
    return {
      status: 'down',
      details: { table_name: 'qa_photo_reviews' },
      error: error instanceof Error ? error.message : 'Table check failed',
    };
  }
}

async function checkRecentData(): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const [result] = await sql`
      SELECT
        COUNT(*) as count_24h,
        MAX(created_at) as latest_timestamp
      FROM qa_photo_reviews
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    const latency = Date.now() - start;

    const count = parseInt(result.count_24h, 10);
    const latestTimestamp = result.latest_timestamp;

    const status = count > 0 ? 'up' : 'degraded';

    return {
      status,
      details: {
        drops_last_24h: count,
        latest_drop: latestTimestamp,
      },
      latency_ms: latency,
      error: count === 0 ? 'No drops received in last 24 hours' : undefined,
    };
  } catch (error) {
    return {
      status: 'down',
      details: {},
      error: error instanceof Error ? error.message : 'Recent data check failed',
    };
  }
}

// ==================== API CHECKS ====================

async function checkAPIEndpoints(req: NextApiRequest) {
  const baseUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  // Check GET /api/wa-monitor-drops
  const getDrops = await checkAPIEndpoint(
    'GET /api/wa-monitor-drops',
    `${baseUrl}/api/wa-monitor-drops`
  );

  // Check GET /api/wa-monitor-daily-drops
  const getDailyDrops = await checkAPIEndpoint(
    'GET /api/wa-monitor-daily-drops',
    `${baseUrl}/api/wa-monitor-daily-drops`
  );

  return {
    get_drops: getDrops,
    get_daily_drops: getDailyDrops,
  };
}

async function checkAPIEndpoint(name: string, url: string): Promise<HealthCheck> {
  try {
    const start = Date.now();
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const latency = Date.now() - start;

    if (!response.ok) {
      return {
        status: 'down',
        details: { name, url, status_code: response.status },
        latency_ms: latency,
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();

    let status: HealthCheck['status'] = 'up';
    if (latency > 2000) {
      status = 'degraded';
    }

    return {
      status,
      details: {
        name,
        url,
        status_code: response.status,
        response_size: JSON.stringify(data).length,
      },
      latency_ms: latency,
      error: latency > 2000 ? 'Response time > 2s (slow)' : undefined,
    };
  } catch (error) {
    return {
      status: 'down',
      details: { name, url },
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

export default withAuth(handler);
