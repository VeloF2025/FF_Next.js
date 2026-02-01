/**
 * Technician Detail Page
 * 
 * Shows detailed performance metrics for a specific technician.
 * 
 * @author Jarvis
 * @date 2026-02-01
 */

import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { activateConfig } from '@/modules/navigation';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import {
  ArrowLeft,
  RefreshCw,
  User,
  Phone,
  MessageSquare,
  BarChart3,
  Target,
  CheckCircle,
  XCircle,
  Calendar,
  TrendingUp,
} from 'lucide-react';
import { TrendChart, GaugeChart } from '@/modules/activate/components/reporting/shared/TrendChart';
import type { TechnicianPerformance } from '@/types/technician.types';

type TimeRange = '7d' | '30d' | '90d';

const TechnicianDetailPage: NextPage = () => {
  const router = useRouter();
  const { id } = router.query;
  
  const [technician, setTechnician] = useState<any>(null);
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
      // Fetch technician details
      const techRes = await fetch(`/api/technicians?search=${id}`);
      if (techRes.ok) {
        const techData = await techRes.json();
        const tech = techData.technicians?.find((t: any) => t.id === id);
        if (tech) setTechnician(tech);
      }

      // Fetch performance
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

  if (!id) return null;

  return (
    <AppLayout>
      <ModulePage config={activateConfig}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => router.push('/activate/technicians')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                  {performance?.technicianName || 'Technician'}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={performance?.type === 'activator' ? 'success' : 'warning'}>
                    {performance?.type || 'unknown'}
                  </Badge>
                  {technician?.phone && (
                    <span className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {technician.phone}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-[var(--ff-bg-secondary)] rounded-lg p-1">
                {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      timeRange === range
                        ? 'bg-blue-500 text-white'
                        : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                    }`}
                  >
                    {range === '7d' ? '7D' : range === '30d' ? '30D' : '90D'}
                  </button>
                ))}
              </div>
              <Button variant="outline" onClick={fetchData} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="ff-card p-8 text-center">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
              <p className="text-[var(--ff-text-secondary)]">Loading performance data...</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
              {error}
            </div>
          )}

          {/* Performance Content */}
          {!isLoading && !error && performance && (
            <>
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="ff-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">Total Submissions</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {performance.summary.totalSubmissions}
                  </div>
                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                    {performance.summary.activeDays} active days
                  </div>
                </div>

                <div className="ff-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">First Pass Rate</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {performance.summary.firstPassRate}%
                  </div>
                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                    {performance.summary.firstPassSuccess} / {performance.summary.totalSubmissions}
                  </div>
                </div>

                <div className="ff-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-purple-500" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">Serial Compliance</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {performance.summary.serialComplianceRate}%
                  </div>
                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                    ONT: {performance.summary.ontScanned} • UPS: {performance.summary.upsScanned}
                  </div>
                </div>

                <div className="ff-card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-[var(--ff-text-secondary)]">Resubmission Rate</span>
                  </div>
                  <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {performance.summary.resubmissionRate}%
                  </div>
                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                    {performance.summary.resubmissions} resubmissions
                  </div>
                </div>
              </div>

              {/* Gauges */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="ff-card p-6">
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                    Performance Scores
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col items-center">
                      <GaugeChart
                        value={performance.summary.firstPassRate}
                        target={85}
                        label="First Pass"
                        color="auto"
                        size="md"
                      />
                    </div>
                    <div className="flex flex-col items-center">
                      <GaugeChart
                        value={performance.summary.serialComplianceRate}
                        target={95}
                        label="Serial Compliance"
                        color="auto"
                        size="md"
                      />
                    </div>
                  </div>
                </div>

                {/* Projects Worked */}
                <div className="ff-card p-6">
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                    Projects Worked
                  </h3>
                  {performance.summary.projectsWorked.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {performance.summary.projectsWorked.map(project => (
                        <Badge key={project} variant="secondary" className="text-sm px-3 py-1">
                          {project}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[var(--ff-text-secondary)]">No projects recorded</p>
                  )}
                </div>
              </div>

              {/* Activity Trend */}
              {performance.trend.length > 0 && (
                <div className="ff-card p-6">
                  <TrendChart
                    title="Daily Activity"
                    subtitle={`${timeRange === '7d' ? 'Last 7 days' : timeRange === '30d' ? 'Last 30 days' : 'Last 90 days'}`}
                    data={performance.trend.map(t => ({
                      date: t.date,
                      Submissions: t.submissions,
                      'First Pass': t.firstPass,
                      Resubmissions: t.resubmissions,
                    }))}
                    series={[
                      { dataKey: 'Submissions', name: 'Submissions', color: '#3B82F6' },
                      { dataKey: 'First Pass', name: 'First Pass', color: '#10B981' },
                      { dataKey: 'Resubmissions', name: 'Resubmissions', color: '#F59E0B' },
                    ]}
                    type="bar"
                    xAxisKey="date"
                    height={250}
                  />
                </div>
              )}

              {/* Project Breakdown */}
              {performance.projectBreakdown.length > 0 && (
                <div className="ff-card p-6">
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                    Project Breakdown
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-[var(--ff-border-light)]">
                          <th className="text-left py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                            Project
                          </th>
                          <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                            Submissions
                          </th>
                          <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                            First Pass
                          </th>
                          <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                            Serial Compliance
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {performance.projectBreakdown.map((p) => (
                          <tr
                            key={p.project}
                            className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]"
                          >
                            <td className="py-3 text-[var(--ff-text-primary)] font-medium">{p.project}</td>
                            <td className="py-3 text-center text-[var(--ff-text-primary)]">
                              {p.submissions}
                            </td>
                            <td className="py-3 text-center">
                              <span
                                className={`font-medium ${
                                  p.firstPassRate >= 85
                                    ? 'text-green-500'
                                    : p.firstPassRate >= 70
                                      ? 'text-yellow-500'
                                      : 'text-red-500'
                                }`}
                              >
                                {p.firstPassRate}%
                              </span>
                            </td>
                            <td className="py-3 text-center">
                              <span
                                className={`font-medium ${
                                  p.serialComplianceRate >= 95
                                    ? 'text-green-500'
                                    : p.serialComplianceRate >= 80
                                      ? 'text-yellow-500'
                                      : 'text-red-500'
                                }`}
                              >
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
              {performance.summary.totalSubmissions === 0 && (
                <div className="ff-card p-8 text-center">
                  <BarChart3 className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
                    No Submissions Found
                  </h3>
                  <p className="text-[var(--ff-text-secondary)]">
                    No DR submissions found for this technician in the selected time range.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </ModulePage>
    </AppLayout>
  );
};

export default TechnicianDetailPage;
