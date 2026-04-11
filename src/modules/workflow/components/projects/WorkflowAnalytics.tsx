// 🟢 WORKING: WorkflowAnalytics component - analytics dashboard for workflow performance
import { useState } from 'react';
import { useWorkflowAnalytics } from './analytics/hooks/useWorkflowAnalytics';
import type { DateRange } from './analytics/types/analytics.types';
import {
  AnalyticsHeader,
  KeyMetricsGrid,
  TemplateUsageChart,
  PhasePerformanceCard,
  BottlenecksCard,
  SuccessFactorsCard,
  LoadingState,
  ErrorState
} from './analytics/components';

export function WorkflowAnalytics() {
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const { analyticsData, loading, error, loadAnalytics } = useWorkflowAnalytics(dateRange);

  if (loading) {
    return <LoadingState />;
  }

  if (error || !analyticsData) {
    return <ErrorState error={error} onRetry={loadAnalytics} />;
  }

  const { performanceMetrics, templateUsage, phaseMetrics } = analyticsData;

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <AnalyticsHeader
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onRefresh={loadAnalytics}
        />

        {/* Key Metrics */}
        <KeyMetricsGrid
          performanceMetrics={performanceMetrics}
          templateUsageCount={templateUsage.length}
        />

        {/* Template Usage Chart */}
        <TemplateUsageChart templateUsage={templateUsage} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Phase Performance */}
          <PhasePerformanceCard phaseMetrics={phaseMetrics} />

          {/* Bottlenecks */}
          <BottlenecksCard bottlenecks={performanceMetrics.commonBottlenecks} />
        </div>

        {/* Success Factors */}
        <SuccessFactorsCard />
      </div>
    </div>
  );
}
