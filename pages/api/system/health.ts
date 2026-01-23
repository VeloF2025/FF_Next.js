/**
 * System Health API Endpoint
 * Comprehensive infrastructure health monitoring
 *
 * GET /api/system/health
 * Query params:
 *   - save: boolean - Save snapshot to history (default: false)
 *   - recoveryLog: boolean - Include recovery actions (default: true)
 *   - recoveryLimit: number - Max recovery actions to return (default: 10)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { performHealthCheck, getHealthHistory } from '@/modules/system/services/infrastructureHealthService';
import type { SystemHealthResponse } from '@/modules/system/types/infrastructure.types';

interface HealthHistoryResponse {
  entries: SystemHealthResponse['summary'][];
  timestamps: string[];
}

type ApiResponse = SystemHealthResponse | HealthHistoryResponse | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const {
      save = 'false',
      recoveryLog = 'true',
      recoveryLimit = '10',
      history = 'false',
      hours = '24',
      limit = '100',
    } = req.query;

    // If history=true, return historical data instead
    if (history === 'true') {
      const historyData = await getHealthHistory(
        parseInt(hours as string, 10),
        parseInt(limit as string, 10)
      );
      return res.status(200).json(historyData);
    }

    // Perform comprehensive health check
    const healthStatus = await performHealthCheck({
      saveToHistory: save === 'true',
      includeRecoveryLog: recoveryLog === 'true',
      recoveryLogLimit: parseInt(recoveryLimit as string, 10),
    });

    // Set appropriate status code based on health
    const statusCode = healthStatus.overall === 'critical'
      ? 503
      : healthStatus.overall === 'degraded'
        ? 207
        : 200;

    // Add cache headers (short cache for real-time monitoring)
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Health-Status', healthStatus.overall);
    res.setHeader('X-Health-Percentage', healthStatus.summary.healthPercentage.toString());

    return res.status(statusCode).json(healthStatus);
  } catch (error) {
    console.error('Health check failed:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
}
