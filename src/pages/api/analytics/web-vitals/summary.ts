/**
 * Web Vitals Summary API
 * Story 3.5: Monitoring Dashboard & Alerts
 *
 * Returns aggregated Web Vitals metrics for monitoring dashboard
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';

// In production, this would query stored metrics from database or analytics service
// For now, returning demo structure - integrate with Vercel Analytics or custom storage

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // In production:
    // 1. Query last hour of Web Vitals from database
    // 2. Calculate p75 or median for each metric
    // 3. Apply rating thresholds from src/lib/performance.ts

    // Demo data structure
    const metrics = [
      {
        name: 'LCP',
        value: 2100,
        rating: 'good' as const,
        timestamp: new Date().toISOString(),
      },
      {
        name: 'FID',
        value: 45,
        rating: 'good' as const,
        timestamp: new Date().toISOString(),
      },
      {
        name: 'CLS',
        value: 0.08,
        rating: 'good' as const,
        timestamp: new Date().toISOString(),
      },
      {
        name: 'TTFB',
        value: 180,
        rating: 'good' as const,
        timestamp: new Date().toISOString(),
      },
      {
        name: 'FCP',
        value: 950,
        rating: 'good' as const,
        timestamp: new Date().toISOString(),
      },
      {
        name: 'INP',
        value: 120,
        rating: 'good' as const,
        timestamp: new Date().toISOString(),
      },
    ];

    return res.status(200).json({
      success: true,
      metrics,
      meta: {
        timestamp: new Date().toISOString(),
        period: 'last_hour',
        sampleSize: 0, // Number of metrics collected
      },
    });
  } catch (error) {
    log.error('Error fetching Web Vitals summary', { error }, 'api/analytics/web-vitals/summary');
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch Web Vitals summary',
    });
  }
}
