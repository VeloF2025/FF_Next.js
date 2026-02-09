/**
 * FunnelReports - QA Workflow Funnel report section
 *
 * Reports:
 * - Submission Funnel
 * - Photo Step Analysis
 * - Processing Time Metrics
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect } from 'react';
import { Filter, Camera, Clock } from 'lucide-react';
import type {
  ReportFilters,
  QAFunnelResponse,
  PhotoStepMetrics,
  ProcessingTimeMetrics,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid, FunnelChart, TrendChart } from './shared';

interface FunnelReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

type FunnelSubReport = 'funnel' | 'photo-steps' | 'timing';

// Photo step labels (from 10-step checklist)
const PHOTO_STEPS = [
  { step: 1, label: 'House Photo' },
  { step: 2, label: 'Cable from Pole' },
  { step: 3, label: 'Entry Outside' },
  { step: 4, label: 'Entry Inside' },
  { step: 5, label: 'Wall' },
  { step: 6, label: 'ONT Back' },
  { step: 7, label: 'Power Meter' },
  { step: 8, label: 'Final Installation' },
  { step: 9, label: 'Green Lights' },
  { step: 10, label: 'Signature' },
];

export function FunnelReports({ filters, refreshKey }: FunnelReportsProps) {
  const [activeSubReport, setActiveSubReport] = useState<FunnelSubReport>('funnel');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QAFunnelResponse | null>(null);

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('dateFrom', filters.dateFrom);
        params.set('dateTo', filters.dateTo);
        if (filters.project) params.set('project', filters.project);

        const res = await fetch(`/api/activate/reporting/funnel?${params}`);
        if (!res.ok) throw new Error('Failed to fetch funnel data');

        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filters, refreshKey]);

  const subReports: { id: FunnelSubReport; label: string; icon: typeof Filter }[] = [
    { id: 'funnel', label: 'Submission Funnel', icon: Filter },
    { id: 'photo-steps', label: 'Photo Steps', icon: Camera },
    { id: 'timing', label: 'Processing Times', icon: Clock },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Sub-report tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-4">
        {subReports.map((sub) => {
          const Icon = sub.icon;
          return (
            <button
              key={sub.id}
              onClick={() => setActiveSubReport(sub.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t text-sm font-medium transition-colors ${
                activeSubReport === sub.id
                  ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-b-2 border-cyan-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              {sub.label}
            </button>
          );
        })}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <ReportCardGrid columns={4}>
        <ReportCard
          title="Total Submitted"
          value={data?.summary?.total_submitted || 0}
          color="blue"
          isLoading={isLoading}
        />
        <ReportCard
          title="Conversion Rate"
          value={`${(data?.summary?.conversion_rate ?? 0).toFixed(1)}%`}
          subtitle="Submitted → Feedback Sent"
          color={
            (data?.summary?.conversion_rate || 0) >= 80
              ? 'green'
              : (data?.summary?.conversion_rate || 0) >= 50
                ? 'yellow'
                : 'red'
          }
          isLoading={isLoading}
        />
        <ReportCard
          title="Avg Cycle Time"
          value={formatTime(data?.summary?.avg_cycle_time || 0)}
          subtitle="End-to-end"
          color="purple"
          isLoading={isLoading}
        />
        <ReportCard
          title="Photo Completion"
          value={`${(data?.summary?.photo_completion_rate ?? 0).toFixed(1)}%`}
          subtitle="All 10 steps"
          color={
            (data?.summary?.photo_completion_rate || 0) >= 80
              ? 'green'
              : (data?.summary?.photo_completion_rate || 0) >= 50
                ? 'yellow'
                : 'red'
          }
          isLoading={isLoading}
        />
      </ReportCardGrid>

      {/* Content */}
      {activeSubReport === 'funnel' && (
        <FunnelSection data={data} isLoading={isLoading} />
      )}
      {activeSubReport === 'photo-steps' && (
        <PhotoStepsSection data={data?.photo_steps || []} isLoading={isLoading} />
      )}
      {activeSubReport === 'timing' && (
        <TimingSection data={data?.processing_times || []} isLoading={isLoading} />
      )}
    </div>
  );
}

// ============================================================================
// FUNNEL SECTION
// ============================================================================

function FunnelSection({
  data,
  isLoading,
}: {
  data: QAFunnelResponse | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!data || data.funnel.length === 0) {
    return <EmptyState message="No funnel data available" />;
  }

  const funnelStages = data.funnel.map((stage, idx) => ({
    name: stage.stage,
    value: stage.count,
    percentage: stage.percentage,
    color: [
      '#3B82F6', // blue - Submitted
      '#8B5CF6', // purple - VLM Processed
      '#10B981', // green - Approved
      '#06B6D4', // cyan - Feedback Sent
    ][idx % 4],
  }));

  return (
    <div className="space-y-6">
      {/* Visual Funnel */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6">
        <FunnelChart
          stages={funnelStages}
          title="QA Submission Funnel"
          height={300}
        />
      </div>

      {/* Drop-off Analysis */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          Drop-off Analysis
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.funnel.slice(1).map((stage, idx) => (
            <div
              key={stage.stage}
              className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4"
            >
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {data.funnel[idx]?.stage} → {stage.stage}
              </div>
              <div className="flex items-end justify-between mt-2">
                <span
                  className={`text-2xl font-bold ${
                    stage.drop_off_percent <= 10
                      ? 'text-green-600 dark:text-green-400'
                      : stage.drop_off_percent <= 25
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  -{(stage.drop_off_percent ?? 0).toFixed(1)}%
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  drop-off
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PHOTO STEPS SECTION
// ============================================================================

function PhotoStepsSection({
  data,
  isLoading,
}: {
  data: PhotoStepMetrics[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (data.length === 0) {
    return <EmptyState message="No photo step data available" />;
  }

  // Prepare chart data
  const chartData = PHOTO_STEPS.map((s) => {
    const stepData = data.find((d) => d.step === s.step);
    return {
      step: `${s.step}. ${s.label}`,
      'Completion %': stepData?.completion_rate || 0,
      'VLM Pass %': stepData?.vlm_pass_rate || 0,
    };
  });

  // Find most commonly missing steps
  const sortedByCompletion = [...data].sort(
    (a, b) => a.completion_rate - b.completion_rate
  );
  const lowestSteps = sortedByCompletion.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Horizontal Bar Chart */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        <TrendChart
          title="Photo Step Completion Rates"
          data={chartData}
          series={[
            { dataKey: 'Completion %', name: 'Completion %', color: '#10B981' },
            { dataKey: 'VLM Pass %', name: 'VLM Pass %', color: '#8B5CF6' },
          ]}
          type="bar"
          xAxisKey="step"
          height={400}
        />
      </div>

      {/* Most Commonly Missing */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          Most Commonly Missing Steps
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {lowestSteps.map((step) => {
            const stepInfo = PHOTO_STEPS.find((s) => s.step === step.step);
            return (
              <div
                key={step.step}
                className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-red-600 dark:text-red-400">
                    #{step.step}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {stepInfo?.label || `Step ${step.step}`}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Completion rate:
                  </span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {(step.completion_rate ?? 0).toFixed(1)}%
                  </span>
                </div>
                <div className="mt-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full"
                    style={{ width: `${step.completion_rate}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Step
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Label
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Completed
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Total
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Completion %
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                VLM Pass %
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {PHOTO_STEPS.map((s) => {
              const stepData = data.find((d) => d.step === s.step);
              return (
                <tr key={s.step}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    {s.step}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {s.label}
                  </td>
                  <td className="px-4 py-3 text-sm text-green-600 dark:text-green-400">
                    {stepData?.completed || 0}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {stepData?.total || 0}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <RateCell value={stepData?.completion_rate || 0} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {stepData && stepData.vlm_pass_rate !== null ? (
                      <RateCell value={stepData.vlm_pass_rate} />
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// TIMING SECTION
// ============================================================================

function TimingSection({
  data,
  isLoading,
}: {
  data: ProcessingTimeMetrics[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (data.length === 0) {
    return <EmptyState message="No processing time data available" />;
  }

  return (
    <div className="space-y-6">
      {/* Timing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {data.map((stage) => (
          <div
            key={stage.stage}
            className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4"
          >
            <h4 className="font-medium text-gray-900 dark:text-white mb-3">
              {stage.stage}
            </h4>

            {/* Percentile breakdown */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">P50:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatTime(stage.p50)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">P90:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatTime(stage.p90)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">P99:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {formatTime(stage.p99)}
                </span>
              </div>
            </div>

            {/* Target comparison */}
            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-500 dark:text-gray-400">
                  Target: {formatTime(stage.target)}
                </span>
                <span
                  className={`font-medium ${
                    stage.meeting_target_rate >= 80
                      ? 'text-green-600 dark:text-green-400'
                      : stage.meeting_target_rate >= 50
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {stage.meeting_target_rate.toFixed(0)}% on target
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    stage.meeting_target_rate >= 80
                      ? 'bg-green-500'
                      : stage.meeting_target_rate >= 50
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${stage.meeting_target_rate}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Comparison Chart */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        <TrendChart
          title="Processing Time Comparison (P50 vs Target)"
          data={data.map((d) => ({
            stage: d.stage,
            P50: d.p50,
            Target: d.target,
          }))}
          series={[
            { dataKey: 'P50', name: 'P50 (Actual)', color: '#3B82F6' },
            { dataKey: 'Target', name: 'Target', color: '#EF4444' },
          ]}
          type="bar"
          xAxisKey="stage"
          height={250}
        />
      </div>
    </div>
  );
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function RateCell({ value }: { value: number }) {
  const isGood = value >= 80;
  const isOkay = value >= 50;

  return (
    <span
      className={`font-medium ${
        isGood
          ? 'text-green-600 dark:text-green-400'
          : isOkay
            ? 'text-yellow-600 dark:text-yellow-400'
            : 'text-red-600 dark:text-red-400'
      }`}
    >
      {value.toFixed(1)}%
    </span>
  );
}

function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
      <Filter className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>{message}</p>
    </div>
  );
}

export default FunnelReports;
