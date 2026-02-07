/**
 * Technician Detail Page
 *
 * Shows detailed performance metrics for a specific technician.
 * Styled to match DrSummaryPage patterns.
 *
 * @author Jarvis
 * @updated 2026-02-05
 */

import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import type { TechnicianPerformance, ActivatorPerformance, InstallerPerformance } from '@/types/technician.types';
import { isActivatorPerformance, isInstallerPerformance } from '@/types/technician.types';

type TimeRange = '7d' | '30d' | '90d';

const TechnicianDetailPage: NextPage = () => {
  const router = useRouter();
  const { id } = router.query;

  const [performance, setPerformance] = useState<TechnicianPerformance | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getDateRange = useCallback(() => {
    const today = new Date();
    const to = today.toISOString().split('T')[0];
    let from: string;

    switch (timeRange) {
      case '7d':
        from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case '30d':
        from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case '90d':
        from = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      default:
        from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    return { from, to };
  }, [timeRange]);

  const fetchData = useCallback(async () => {
    if (!id) return;

    setIsLoading(true);
    setError(null);

    try {
      const { from, to } = getDateRange();
      const perfRes = await fetch(`/api/technicians/${id}/performance?dateFrom=${from}&dateTo=${to}`);
      if (!perfRes.ok) throw new Error('Failed to fetch performance data');

      const perfData = await perfRes.json();
      setPerformance(perfData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [id, getDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleBack = () => {
    router.push('/activate/technicians');
  };

  if (!id) return null;

  // Loading state
  if (isLoading) {
    return (
      <AppLayout>
        <ModulePage config={activateConfig}>
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">Loading performance data...</p>
            </div>
          </div>
        </ModulePage>
      </AppLayout>
    );
  }

  // Error state
  if (error) {
    return (
      <AppLayout>
        <ModulePage config={activateConfig}>
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="text-red-500 text-4xl mb-4">!</div>
              <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
              <button
                onClick={handleBack}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Back to Directory
              </button>
            </div>
          </div>
        </ModulePage>
      </AppLayout>
    );
  }

  if (!performance) return null;

  // Render based on technician type
  if (isInstallerPerformance(performance)) {
    return (
      <InstallerDetailView
        performance={performance}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        onRefresh={fetchData}
        onBack={handleBack}
        isLoading={isLoading}
      />
    );
  }

  // Default: Activator view
  return (
    <ActivatorDetailView
      performance={performance as ActivatorPerformance}
      timeRange={timeRange}
      setTimeRange={setTimeRange}
      onRefresh={fetchData}
      onBack={handleBack}
      isLoading={isLoading}
    />
  );
};

/**
 * Detail view for Activators (DR photo submitters)
 */
function ActivatorDetailView({
  performance,
  timeRange,
  setTimeRange,
  onRefresh,
  onBack,
  isLoading,
}: {
  performance: ActivatorPerformance;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  onRefresh: () => void;
  onBack: () => void;
  isLoading: boolean;
}) {
  const { summary } = performance;
  const firstPassPercent = summary.firstPassRate;
  const serialPercent = summary.serialComplianceRate;

  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {performance.technicianName}
              </h1>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                activator
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                      timeRange === range
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {range.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon="📊"
              label="Total Submissions"
              value={summary.totalSubmissions}
              detail={`${summary.activeDays} active days`}
            />
            <StatCard
              icon="✅"
              label="First Pass Rate"
              value={`${summary.firstPassRate}%`}
              detail={`${summary.firstPassSuccess} / ${summary.totalSubmissions}`}
              highlight={summary.firstPassRate >= 85 ? 'green' : summary.firstPassRate >= 70 ? 'yellow' : 'red'}
            />
            <StatCard
              icon="🎯"
              label="Serial Compliance"
              value={`${summary.serialComplianceRate}%`}
              detail={`ONT: ${summary.ontScanned} • UPS: ${summary.upsScanned}`}
              highlight={summary.serialComplianceRate >= 95 ? 'green' : summary.serialComplianceRate >= 80 ? 'yellow' : 'red'}
            />
            <StatCard
              icon="🔄"
              label="Resubmission Rate"
              value={`${summary.resubmissionRate}%`}
              detail={`${summary.resubmissions} resubmissions`}
              highlight={summary.resubmissionRate <= 10 ? 'green' : summary.resubmissionRate <= 20 ? 'yellow' : 'red'}
            />
          </div>

          {/* Performance & Projects Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Performance Scores
              </h3>
              <div className="space-y-4">
                <ProgressBar label="First Pass Rate" value={firstPassPercent} target={85} />
                <ProgressBar label="Serial Compliance" value={serialPercent} target={95} />
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Projects Worked
              </h3>
              {summary.projectsWorked.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {summary.projectsWorked.map(project => (
                    <span key={project} className="px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full text-sm">
                      {project}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">No projects recorded</p>
              )}
            </div>
          </div>

          {/* Daily Activity */}
          {performance.trend.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Daily Activity ({timeRange === '7d' ? 'Last 7 Days' : timeRange === '30d' ? 'Last 30 Days' : 'Last 90 Days'})
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 text-gray-500 dark:text-gray-400 font-medium">Date</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Submissions</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">First Pass</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Resubmissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.trend.slice(-10).map((t) => (
                      <tr key={t.date} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="py-2 text-gray-900 dark:text-white">{t.date}</td>
                        <td className="py-2 text-center text-gray-900 dark:text-white">{t.submissions}</td>
                        <td className="py-2 text-center text-green-600 dark:text-green-400">{t.firstPass}</td>
                        <td className="py-2 text-center text-orange-600 dark:text-orange-400">{t.resubmissions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Project Breakdown */}
          {performance.projectBreakdown.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Project Breakdown
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 text-gray-500 dark:text-gray-400 font-medium">Project</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Submissions</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">First Pass</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Serial Compliance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.projectBreakdown.map((p) => (
                      <tr key={p.project} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2 text-gray-900 dark:text-white font-medium">{p.project}</td>
                        <td className="py-2 text-center text-gray-900 dark:text-white">{p.submissions}</td>
                        <td className="py-2 text-center">
                          <span className={`font-medium ${
                            p.firstPassRate >= 85 ? 'text-green-600 dark:text-green-400' :
                            p.firstPassRate >= 70 ? 'text-yellow-600 dark:text-yellow-400' :
                            'text-red-600 dark:text-red-400'
                          }`}>
                            {p.firstPassRate}%
                          </span>
                        </td>
                        <td className="py-2 text-center">
                          <span className={`font-medium ${
                            p.serialComplianceRate >= 95 ? 'text-green-600 dark:text-green-400' :
                            p.serialComplianceRate >= 80 ? 'text-yellow-600 dark:text-yellow-400' :
                            'text-red-600 dark:text-red-400'
                          }`}>
                            {p.serialComplianceRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* No Data State */}
          {summary.totalSubmissions === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-8 border border-gray-200 dark:border-gray-700 text-center">
              <div className="text-4xl mb-4">📊</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Submissions Found</h3>
              <p className="text-gray-600 dark:text-gray-400">
                No DR submissions found for this technician in the selected time range.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 justify-center pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              ← Back to Directory
            </button>
          </div>
        </div>
      </ModulePage>
    </AppLayout>
  );
}

/**
 * Detail view for Installers (based on QA review outcomes)
 */
function InstallerDetailView({
  performance,
  timeRange,
  setTimeRange,
  onRefresh,
  onBack,
  isLoading,
}: {
  performance: InstallerPerformance;
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  onRefresh: () => void;
  onBack: () => void;
  isLoading: boolean;
}) {
  const { summary } = performance;

  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {performance.technicianName}
              </h1>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                installer
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                      timeRange === range
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    {range.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {/* Stats Cards - Installer specific */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon="🔧"
              label="Total Installations"
              value={summary.totalInstallations}
              detail={`${summary.activeDays} active days`}
            />
            <StatCard
              icon="✅"
              label="QA Pass Rate"
              value={`${summary.qaPassRate}%`}
              detail={`${summary.qaPassedCount} / ${summary.totalInstallations}`}
              highlight={summary.qaPassRate >= 90 ? 'green' : summary.qaPassRate >= 75 ? 'yellow' : 'red'}
            />
            <StatCard
              icon="🔄"
              label="Rework Rate"
              value={`${summary.reworkRate}%`}
              detail={`${summary.reworkCount} reworks`}
              highlight={summary.reworkRate <= 5 ? 'green' : summary.reworkRate <= 15 ? 'yellow' : 'red'}
            />
            <StatCard
              icon="📋"
              label="Steps Compliance"
              value={`${summary.avgStepsCompliance}%`}
              detail="Avg 12-step checklist"
              highlight={summary.avgStepsCompliance >= 90 ? 'green' : summary.avgStepsCompliance >= 75 ? 'yellow' : 'red'}
            />
          </div>

          {/* Performance & Projects Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Performance Gauges */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Performance Scores
              </h3>
              <div className="space-y-4">
                <ProgressBar label="QA Pass Rate" value={summary.qaPassRate} target={90} />
                <ProgressBar label="Steps Compliance" value={summary.avgStepsCompliance} target={90} />
                <ProgressBar label="Activation Rate" value={summary.activationRate} target={85} />
              </div>
            </div>

            {/* Common Failures */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Common Failures
              </h3>
              {performance.commonFailures.length > 0 ? (
                <div className="space-y-2">
                  {performance.commonFailures.map((f) => (
                    <div key={f.step} className="flex items-center justify-between">
                      <span className="text-gray-700 dark:text-gray-300">{f.step}</span>
                      <span className="px-2 py-0.5 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded text-sm font-medium">
                        {f.failCount} fails
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">No common failures recorded</p>
              )}
            </div>
          </div>

          {/* Projects Worked */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
              Projects Worked
            </h3>
            {summary.projectsWorked.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {summary.projectsWorked.map(project => (
                  <span key={project} className="px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full text-sm">
                    {project}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No projects recorded</p>
            )}
          </div>

          {/* Daily Activity */}
          {performance.trend.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Daily Activity ({timeRange === '7d' ? 'Last 7 Days' : timeRange === '30d' ? 'Last 30 Days' : 'Last 90 Days'})
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 text-gray-500 dark:text-gray-400 font-medium">Date</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Installations</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Passed</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.trend.slice(-10).map((t) => (
                      <tr key={t.date} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="py-2 text-gray-900 dark:text-white">{t.date}</td>
                        <td className="py-2 text-center text-gray-900 dark:text-white">{t.installations}</td>
                        <td className="py-2 text-center text-green-600 dark:text-green-400">{t.passed}</td>
                        <td className="py-2 text-center text-red-600 dark:text-red-400">{t.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Project Breakdown */}
          {performance.projectBreakdown.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">
                Project Breakdown
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 text-gray-500 dark:text-gray-400 font-medium">Project</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">Installations</th>
                      <th className="text-center py-2 text-gray-500 dark:text-gray-400 font-medium">QA Pass Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.projectBreakdown.map((p) => (
                      <tr key={p.project} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-2 text-gray-900 dark:text-white font-medium">{p.project}</td>
                        <td className="py-2 text-center text-gray-900 dark:text-white">{p.installations}</td>
                        <td className="py-2 text-center">
                          <span className={`font-medium ${
                            p.qaPassRate >= 90 ? 'text-green-600 dark:text-green-400' :
                            p.qaPassRate >= 75 ? 'text-yellow-600 dark:text-yellow-400' :
                            'text-red-600 dark:text-red-400'
                          }`}>
                            {p.qaPassRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* No Data State */}
          {summary.totalInstallations === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-8 border border-gray-200 dark:border-gray-700 text-center">
              <div className="text-4xl mb-4">🔧</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Installations Found</h3>
              <p className="text-gray-600 dark:text-gray-400">
                No installations found for this technician in the selected time range.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 justify-center pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onBack}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              ← Back to Directory
            </button>
          </div>
        </div>
      </ModulePage>
    </AppLayout>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  highlight,
}: {
  icon: string;
  label: string;
  value: string | number;
  detail?: string;
  highlight?: 'green' | 'yellow' | 'red';
}) {
  const highlightColor = highlight === 'green'
    ? 'text-green-600 dark:text-green-400'
    : highlight === 'yellow'
      ? 'text-yellow-600 dark:text-yellow-400'
      : highlight === 'red'
        ? 'text-red-600 dark:text-red-400'
        : 'text-gray-900 dark:text-white';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{icon}</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${highlightColor}`}>{value}</div>
      {detail && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{detail}</div>
      )}
    </div>
  );
}

function ProgressBar({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const isGood = value >= target;
  const barColor = isGood
    ? 'bg-green-500'
    : value >= target * 0.8
      ? 'bg-yellow-500'
      : 'bg-red-500';

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className={`font-medium ${isGood ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
          {value}%
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden relative">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
        {/* Target marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-gray-400 dark:bg-gray-500"
          style={{ left: `${target}%` }}
          title={`Target: ${target}%`}
        />
      </div>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
        Target: {target}%
      </div>
    </div>
  );
}

export default TechnicianDetailPage;
