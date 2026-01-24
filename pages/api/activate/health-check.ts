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
 * - SharePoint (DR photo sync to SharePoint)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getSharePointDrConfig,
  isSharePointDrSyncEnabled,
  getAccessToken,
} from '@/lib/sharepointDrSyncService';

// Configure Neon transport based on NEON_USE_HTTP env var
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (!useHttpTransport) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
  } catch {
    // ws not available, will use HTTP
  }
}

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

// Service endpoints
const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://100.96.203.105:8003';
const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
// WA Feedback service (port 8092) - proxies to bridge-2 (8083) for all outgoing messages
// Phone number: 063 841 2276 (bridge-2)
const WA_FEEDBACK_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';

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
    sharepoint: ServiceStatus;
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

      // Thresholds adjusted for realistic workday patterns:
      // - < 16h: healthy (covers normal overnight gap from 5pm to 9am next day)
      // - 16-24h: degraded (more than expected gap, may need attention)
      // - > 24h: down (definitely something wrong)
      if (hoursSince < 16) {
        return {
          status: 'healthy',
          latencyMs: Date.now() - start,
          message: `Last DR ${hoursSince.toFixed(1)}h ago`,
          lastCheck: new Date().toISOString(),
        };
      } else if (hoursSince < 24) {
        return {
          status: 'degraded',
          latencyMs: Date.now() - start,
          message: `No DRs for ${hoursSince.toFixed(1)}h - may need attention`,
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
 * Check WhatsApp Feedback service (for Send Feedback feature)
 * wa-feedback (8092) proxies to bridge-2 (8083) which uses 063 841 2276
 */
async function checkWhatsAppSender(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${WA_FEEDBACK_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      // wa-feedback returns {status: "healthy", service: "wa-feedback-service", bridgeUrl, senderUrl}
      const isHealthy = data.status === 'healthy';
      return {
        status: isHealthy ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        message: isHealthy ? 'WA Feedback service healthy (063 841 2276)' : 'WA Feedback not healthy',
        lastCheck: new Date().toISOString(),
      };
    } else {
      return {
        status: 'degraded',
        latencyMs: Date.now() - start,
        message: `WA Feedback returned ${response.status}`,
        lastCheck: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: `WA Feedback unreachable: ${error instanceof Error ? error.message : 'Unknown'}`,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Check SharePoint connectivity and configuration
 */
async function checkSharePoint(): Promise<ServiceStatus> {
  const start = Date.now();

  // Check if sync is enabled
  if (!isSharePointDrSyncEnabled()) {
    return {
      status: 'degraded',
      latencyMs: Date.now() - start,
      message: 'SharePoint sync disabled',
      lastCheck: new Date().toISOString(),
    };
  }

  // Check configuration
  const config = getSharePointDrConfig();
  if (!config) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: 'SharePoint not configured - missing env vars',
      lastCheck: new Date().toISOString(),
    };
  }

  // Test OAuth token generation
  try {
    const token = await getAccessToken(config);
    if (!token) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: 'Failed to get OAuth token',
        lastCheck: new Date().toISOString(),
      };
    }

    // Test Graph API connectivity by listing drive info
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${config.driveId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        message: `SharePoint connected: ${data.name || 'Documents'}`,
        lastCheck: new Date().toISOString(),
      };
    } else {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: `SharePoint API error: ${response.status}`,
        lastCheck: new Date().toISOString(),
      };
    }
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      message: `SharePoint error: ${error instanceof Error ? error.message : 'Unknown'}`,
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
    const [database, onemap, vlm, whatsappBridge, whatsappSender, sharepoint, recentActivity] = await Promise.all([
      checkDatabase(),
      checkOneMap(),
      checkVLM(),
      checkWhatsAppBridge(),
      checkWhatsAppSender(),
      checkSharePoint(),
      getRecentActivity(),
    ]);

    // Determine overall health
    const statuses = [database.status, onemap.status, vlm.status, whatsappBridge.status, whatsappSender.status, sharepoint.status];
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
        sharepoint,
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
