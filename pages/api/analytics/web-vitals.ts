/**
 * Web Vitals Analytics Endpoint
 *
 * Collects Core Web Vitals metrics from clients
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { withAuth, withRole } from '@/lib/auth';
interface WebVitalsMetric {
  id: string;
  name: 'FCP' | 'LCP' | 'CLS' | 'FID' | 'TTFB' | 'INP';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  navigationType: string;
  pathname: string;
  timestamp: number;
}

/**
 * Store metrics (in production, send to analytics service)
 */
function storeMetric(metric: WebVitalsMetric): void {
  // In development, just log
  if (process.env.NODE_ENV === 'development') {
    console.log('[Web Vitals]', {
      metric: metric.name,
      value: `${metric.value.toFixed(2)}ms`,
      rating: metric.rating,
      page: metric.pathname,
    });
    return;
  }

  // In production, send to analytics service
  // Options:
  // 1. Vercel Analytics (automatically handled by Vercel)
  // 2. Google Analytics
  // 3. Custom database (for long-term storage)
  // 4. Third-party service (DataDog, New Relic, etc.)

  // For now, we'll rely on Vercel Analytics
  // If you need custom storage, uncomment below:

  /*
  try {
    // Example: Store in database
    await db.query(
      `INSERT INTO web_vitals (name, value, rating, pathname, timestamp)
       VALUES ($1, $2, $3, $4, $5)`,
      [metric.name, metric.value, metric.rating, metric.pathname, metric.timestamp]
    );
  } catch (error) {
    console.error('[Web Vitals] Failed to store metric:', error);
  }
  */
}

/**
 * Validate metric data
 */
function isValidMetric(data: any): data is WebVitalsMetric {
  return (
    data &&
    typeof data === 'object' &&
    typeof data.id === 'string' &&
    typeof data.name === 'string' &&
    typeof data.value === 'number' &&
    typeof data.rating === 'string' &&
    typeof data.pathname === 'string' &&
    typeof data.timestamp === 'number'
  );
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  // Only accept POST requests
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const metric = req.body;

    // Validate metric data
    if (!isValidMetric(metric)) {
      return res.status(400).json({ error: 'Invalid metric data' });
    }

    // Store or forward metric
    storeMetric(metric);

    // Return success (keep response minimal)
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Web Vitals API] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export default withAuth(withRole('manager')(handler));
