/**
 * Health Check API
 * GET /api/health
 *
 * Returns only { status, timestamp } — infrastructure details (Node version,
 * memory stats, PG version) have been removed to avoid leaking server
 * fingerprinting data to unauthenticated callers.
 */

import { sql } from '@/lib/neon';
import { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
    });
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    // Lightweight connectivity check — no version() call that would expose PG version
    const result = await sql`SELECT 1 AS check`;

    if (result?.[0]?.check !== 1) {
      log.error('health-check: unexpected database response');
      return res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }

    return res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    log.error('health-check: database error', { error: error instanceof Error ? error.message : String(error) });
    return res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
}
