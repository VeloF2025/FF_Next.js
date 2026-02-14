/**
 * useMonitoringData Hook
 * Manages state and API fetching for monitoring dashboard
 */

import { useState, useEffect } from 'react';
import { log } from '@/lib/logger';
import { WebVitalMetric, ErrorEvent, SystemHealth } from '../types/monitoring.types';

export function useMonitoringData() {
  const [webVitals, setWebVitals] = useState<WebVitalMetric[]>([]);
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({
    status: 'healthy',
    uptime: 100,
    lastCheck: new Date().toISOString(),
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      setIsLoading(true);
      try {
        // Fetch Web Vitals
        const vitalsRes = await fetch('/api/analytics/web-vitals/summary');
        if (vitalsRes.ok) {
          const data = await vitalsRes.json();
          setWebVitals(data.metrics || []);
        }

        // Fetch Recent Errors
        const errorsRes = await fetch('/api/analytics/errors/summary');
        if (errorsRes.ok) {
          const data = await errorsRes.json();
          setErrors(data.errors || []);
        }

        // Check System Health
        const healthRes = await fetch('/api/health');
        if (healthRes.ok) {
          const data = await healthRes.json();
          setSystemHealth(data.health || systemHealth);
        }
      } catch (error) {
        log.error('Failed to fetch monitoring data', { error }, 'useMonitoringData');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Refresh every 30s

    return () => clearInterval(interval);
  }, []);

  return {
    webVitals,
    errors,
    systemHealth,
    isLoading,
  };
}

/**
 * Utility function to get status color classes
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'healthy':
    case 'good':
      return 'text-green-600 bg-green-50';
    case 'degraded':
    case 'needs-improvement':
      return 'text-yellow-600 bg-yellow-50';
    case 'critical':
    case 'poor':
      return 'text-red-600 bg-red-50';
    default:
      return 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900';
  }
}

/**
 * Utility function to format metric values
 */
export function formatValue(name: string, value: number): string {
  if (name === 'CLS') {
    return value.toFixed(3);
  }
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(2)}s`;
}
