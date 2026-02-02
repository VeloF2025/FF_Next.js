/**
 * Alert Checking API
 * Story 3.5: Monitoring Dashboard & Alerts
 *
 * Checks current metrics against alert rules and triggers alerts
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';
import { ALERT_RULES, checkAlertRule, createAlert, sendAlert } from '@/lib/alerts';

/**
 * Check all alert rules against current metrics
 * Call this endpoint periodically (e.g., every 5 minutes via cron job)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch current metrics
    const metrics = await getCurrentMetrics();

    // Check each alert rule
    const triggeredAlerts = [];

    for (const rule of ALERT_RULES) {
      if (!rule.enabled) continue;

      const metricValue = metrics[rule.metric];
      if (metricValue === undefined) continue;

      const result = checkAlertRule(rule, metricValue);

      if (result.triggered) {
        const alert = createAlert(rule, metricValue, result.message);
        triggeredAlerts.push(alert);

        // Send alert through configured channels
        await sendAlert(alert, rule.channels);

        // In production, store alert in database
        // await storeAlert(alert);
      }
    }

    return res.status(200).json({
      success: true,
      alertsTriggered: triggeredAlerts.length,
      alerts: triggeredAlerts,
      meta: {
        timestamp: new Date().toISOString(),
        rulesChecked: ALERT_RULES.filter((r) => r.enabled).length,
      },
    });
  } catch (error) {
    log.error('Error checking alerts', { error }, 'api/monitoring/alerts/check');
    return res.status(500).json({
      success: false,
      error: 'Failed to check alerts',
    });
  }
}

/**
 * Fetch current metrics for alert checking
 * In production, query from database or monitoring service
 */
async function getCurrentMetrics(): Promise<Record<string, number>> {
  // In production, fetch real metrics from:
  // 1. Database (query performance, slow queries)
  // 2. Analytics service (Web Vitals, error rates)
  // 3. Cache service (hit rates)
  // 4. Rate limiter (blocked requests)

  // Demo data - would be populated from actual monitoring
  return {
    // System
    'system.uptime': 99.95,

    // Web Vitals (p75 values)
    'webvitals.lcp': 2100,
    'webvitals.fid': 45,
    'webvitals.cls': 0.08,
    'webvitals.ttfb': 180,
    'webvitals.fcp': 950,
    'webvitals.inp': 120,

    // API Performance
    'api.response_time.p95': 234,
    'api.response_time.avg': 156,

    // Error Rates
    'errors.rate': 0.08,
    'errors.count': 12,

    // Database
    'database.slow_queries': 3,
    'database.n_plus_one': 0,
    'database.avg_query_time': 42,

    // Cache
    'cache.hit_rate': 73.2,
    'cache.miss_rate': 26.8,

    // Rate Limiting
    'ratelimit.blocked': 127,
    'ratelimit.active_entries': 2453,
  };
}
