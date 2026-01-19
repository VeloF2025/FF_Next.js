/**
 * API Route: /api/activate/health-check
 *
 * Purpose: Check health of all DR Photo Unified system components
 * Method: GET
 *
 * Components checked:
 * - Database (Neon PostgreSQL)
 * - OneMap API (photo storage)
 * - VLM Server (Qwen3 for categorization)
 * - WhatsApp Bridge (via recent activity)
 * - WhatsApp Sender (for Send Feedback feature)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

// Service endpoints
const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://192.168.1.150:8003';
const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
// WA Sender (port 8081) - sends QA feedback from FibreFlow Sender number (082 418 9511)
const WA_SENDER_URL = process.env.WHATSAPP_SENDER_URL || 'http://100.96.203.105:8081';

interface ServiceStatus {
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  latencyMs: number;
  message: string;
  lastCheck: string;
}

interface HealthCheckResponse {
  overall: 'healthy' | 'degraded' | 'down';
  services: {
    database: ServiceStatus;
    onemap: ServiceStatus;
    vlm: ServiceStatus;
    whatsappBridge: ServiceStatus;
    whatsappSender: ServiceStatus;
  };
  recentActivity: {
    lastDRProcessed: string | null;
    drsLast24h: number;
    pendingCategorization: number;
    failedCategorization: number;
  };
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const result = await pool.query('SELECT 1 as health');
    return {
      status: 'healthy',
      latencyMs: Date.now() - start,
      message: 'Database connected',
      lastCheck: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: `Database error: ${error instanceof Error ? error.message : 'Unknown'}`,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Check OneMap API
 */
async function checkOneMap(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${ONEMAP_HOST}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        message: '1M responding',
        lastCheck: new Date().toISOString(),
      };
    } else {
      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        message: `1M returned ${response.status}`,
        lastCheck: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: `1M unreachable: ${error instanceof Error ? error.message : 'Unknown'}`,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Check VLM Server
 */
async function checkVLM(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    // Check /v1/models endpoint (standard for vLLM)
    const response = await fetch(`${VLM_API_BASE}/v1/models`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      const modelCount = data.data?.length || 0;
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        message: `VLM server online (${modelCount} model${modelCount !== 1 ? 's' : ''})`,
        lastCheck: new Date().toISOString(),
      };
    } else {
      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        message: `VLM returned ${response.status}`,
        lastCheck: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: `VLM unreachable: ${error instanceof Error ? error.message : 'Unknown'}`,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Check WhatsApp Bridge (inferred from recent activity)
 */
async function checkWhatsAppBridge(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    // Check for recent DR submissions in dr_photo_unified_reviews (the active table)
    // Use subqueries to get both last hour count AND overall last submission
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM dr_photo_unified_reviews WHERE created_at > NOW() - INTERVAL '1 hour') as recent_count,
        (SELECT MAX(created_at) FROM dr_photo_unified_reviews) as last_submission
    `);

    const recentCount = parseInt(result.rows[0]?.recent_count || '0');
    const lastSubmission = result.rows[0]?.last_submission;

    if (recentCount > 0) {
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        message: `${recentCount} DR${recentCount !== 1 ? 's' : ''} in last hour`,
        lastCheck: new Date().toISOString(),
      };
    } else if (lastSubmission) {
      // Check how long since last submission
      const hoursSince = (Date.now() - new Date(lastSubmission).getTime()) / (1000 * 60 * 60);

      if (hoursSince < 4) {
        return {
          status: 'healthy',
          latencyMs: Date.now() - start,
          message: `Last DR ${hoursSince.toFixed(1)}h ago`,
          lastCheck: new Date().toISOString(),
        };
      } else if (hoursSince < 12) {
        return {
          status: 'degraded',
          latencyMs: Date.now() - start,
          message: `No DRs for ${hoursSince.toFixed(1)}h - may be offline`,
          lastCheck: new Date().toISOString(),
        };
      } else {
        return {
          status: 'down',
          latencyMs: Date.now() - start,
          message: `No DRs for ${hoursSince.toFixed(1)}h - likely offline`,
          lastCheck: new Date().toISOString(),
        };
      }
    } else {
      return {
        status: 'unknown',
        latencyMs: Date.now() - start,
        message: 'No DR history found',
        lastCheck: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      status: 'unknown',
      latencyMs: Date.now() - start,
      message: `Check failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Check WhatsApp Sender API (for Send Feedback feature)
 */
async function checkWhatsAppSender(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${WA_SENDER_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      // Support both formats: {connected: true, phone: "..."} (sender) and {status: "healthy"} (wa-feedback proxy)
      const isHealthy = data.connected === true || data.status === 'healthy';
      const phone = data.phone ? ` (${data.phone})` : '';
      return {
        status: isHealthy ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        message: isHealthy ? `WA Sender connected${phone}` : 'WA Sender not connected',
        lastCheck: new Date().toISOString(),
      };
    } else {
      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        message: `Sender returned ${response.status}`,
        lastCheck: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: `Sender unreachable: ${error instanceof Error ? error.message : 'Unknown'}`,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Get recent activity stats
 */
async function getRecentActivity() {
  try {
    const [lastProcessed, last24h, pending, failed] = await Promise.all([
      pool.query(`
        SELECT drop_number, created_at
        FROM dr_photo_unified_reviews
        ORDER BY created_at DESC
        LIMIT 1
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM dr_photo_unified_reviews
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM dr_photo_unified_reviews
        WHERE vlm_categorization_status = 'pending'
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM dr_photo_unified_reviews
        WHERE vlm_categorization_status = 'failed'
      `),
    ]);

    return {
      lastDRProcessed: lastProcessed.rows[0]?.drop_number || null,
      drsLast24h: parseInt(last24h.rows[0]?.count || '0'),
      pendingCategorization: parseInt(pending.rows[0]?.count || '0'),
      failedCategorization: parseInt(failed.rows[0]?.count || '0'),
    };
  } catch (error) {
    log.error('HealthCheck', 'Failed to get recent activity', error);
    return {
      lastDRProcessed: null,
      drsLast24h: 0,
      pendingCategorization: 0,
      failedCategorization: 0,
    };
  }
}

/**
 * GET /api/activate/health-check
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    // Run all checks in parallel
    const [database, onemap, vlm, whatsappBridge, whatsappSender, recentActivity] = await Promise.all([
      checkDatabase(),
      checkOneMap(),
      checkVLM(),
      checkWhatsAppBridge(),
      checkWhatsAppSender(),
      getRecentActivity(),
    ]);

    // Determine overall health
    const statuses = [database.status, onemap.status, vlm.status, whatsappBridge.status, whatsappSender.status];
    let overall: 'healthy' | 'degraded' | 'down';

    if (statuses.every((s) => s === 'healthy')) {
      overall = 'healthy';
    } else if (statuses.includes('down')) {
      overall = 'down';
    } else {
      overall = 'degraded';
    }

    const response: HealthCheckResponse = {
      overall,
      services: {
        database,
        onemap,
        vlm,
        whatsappBridge,
        whatsappSender,
      },
      recentActivity,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('HealthCheck', 'Error during health check', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end('Method Not Allowed');
  }
}
