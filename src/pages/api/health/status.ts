/**
 * System Health Check API
 * Story 3.5: Monitoring Dashboard & Alerts
 *
 * Returns overall system health status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { neon } from '@/lib/db-neon';

const sql = neon(process.env.DATABASE_URL || '');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const checks = {
      database: false,
      timestamp: new Date().toISOString(),
    };

    // Check database connectivity
    try {
      await sql`SELECT 1 as health_check`;
      checks.database = true;
    } catch (error) {
      log.error('Database health check failed', { error }, 'api/monitoring/health');
    }

    // Calculate overall status
    const allChecksPass = checks.database;
    const status = allChecksPass ? 'healthy' : 'degraded';

    // In production, calculate actual uptime from monitoring service
    // For now, return target uptime
    const uptime = allChecksPass ? 99.95 : 99.5;

    return res.status(200).json({
      success: true,
      health: {
        status,
        uptime,
        lastCheck: checks.timestamp,
        checks: {
          database: checks.database ? 'pass' : 'fail',
          // Add more checks as needed:
          // api: 'pass',
          // cache: 'pass',
          // storage: 'pass',
        },
      },
      meta: {
        timestamp: checks.timestamp,
        version: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
      },
    });
  } catch (error) {
    log.error('Health check failed', { error }, 'api/monitoring/health');
    return res.status(500).json({
      success: false,
      health: {
        status: 'critical',
        uptime: 0,
        lastCheck: new Date().toISOString(),
      },
      error: 'Health check failed',
    });
  }
}
