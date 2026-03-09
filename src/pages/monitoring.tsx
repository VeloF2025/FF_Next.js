/**
 * Monitoring Dashboard
 * Story 3.5: Monitoring Dashboard & Alerts
 *
 * Real-time system health monitoring
 */

import { AppLayout } from '@/components/layout';
import { useMonitoringData } from './monitoring/hooks/useMonitoringData';
import { performanceBudgetItems } from './monitoring/data/performanceBudgetData';
import {
  MonitoringHeader,
  SystemHealthCard,
  WebVitalsCard,
  ErrorTrackingCard,
  PerformanceMetricsGrid,
  DatabasePerformanceCard,
  RateLimitingCard,
  PerformanceBudgetCard,
} from './monitoring/components';

export default function MonitoringDashboard() {
  const { webVitals, errors, systemHealth, isLoading } = useMonitoringData();

  return (
    <AppLayout>
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <MonitoringHeader lastCheck={systemHealth.lastCheck} />

        {/* System Health Status */}
        <SystemHealthCard systemHealth={systemHealth} />

        {/* Web Vitals */}
        <WebVitalsCard webVitals={webVitals} />

        {/* Error Tracking */}
        <ErrorTrackingCard errors={errors} />

        {/* Performance Metrics */}
        <PerformanceMetricsGrid />

        {/* Database Performance */}
        <DatabasePerformanceCard />

        {/* Rate Limiting */}
        <RateLimitingCard />

        {/* Performance Budget Status */}
        <PerformanceBudgetCard items={performanceBudgetItems} />
      </div>
    </AppLayout>
  );
}
