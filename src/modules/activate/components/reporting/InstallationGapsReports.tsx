/**
 * InstallationGapsReports - Report on Installed but Not Activated DRs
 *
 * Purpose: Track DRs where money was spent (installation done) but never went live
 * - Installed = WA submission OR 1Map has installer name
 * - Activated = Appeared on OES report
 * - Gap = Installed but never activated
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Clock,
  MessageSquare,
  MapPin,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
} from 'lucide-react';
import type { ReportFilters } from '../../types/reporting.types';
import { ReportCard, ReportCardGrid } from './shared';

interface InstallationGapItem {
  drop_number: string;
  project: string | null;
  installer_name: string | null;
  install_source: 'whatsapp' | 'onemap' | 'both';
  wa_received_at: string | null;
  first_seen_at: string;
  days_since_install: number;
  photo_count: number;
  ont_serial: string | null;
  ups_serial: string | null;
  qa_decision: string | null;
  feedback_sent: boolean;
  activation_gap_reason: string | null;
}

interface InstallationGapsSummary {
  total_gaps: number;
  by_project: { project: string; count: number }[];
  by_age: {
    under_7_days: number;
    days_7_to_14: number;
    days_14_to_30: number;
    over_30_days: number;
  };
  by_source: {
    whatsapp: number;
    onemap: number;
    both: number;
  };
}

interface InstallationGapsResponse {
  success: boolean;
  summary: InstallationGapsSummary;
  items: InstallationGapItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface InstallationGapsReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

type SourceFilter = 'all' | 'whatsapp' | 'onemap' | 'both';

export function InstallationGapsReports({ filters, refreshKey }: InstallationGapsReportsProps) {
  const [data, setData] = useState<InstallationGapsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.project) params.set('project', filters.project);
      params.set('page', page.toString());
      params.set('limit', '25');

      const response = await fetch(`/api/activate/reporting/installation-gaps?${params}`);
      if (!response.ok) throw new Error('Failed to fetch installation gaps');

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
    // refreshKey is intentionally included to trigger refetch on parent refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.project, page, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.project, sourceFilter]);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { summary, items, pagination } = data;

  // Filter items by source
  const filteredItems =
    sourceFilter === 'all'
      ? items
      : items.filter((item) => item.install_source === sourceFilter);

  const filterButtons: { id: SourceFilter; label: string; count: number; color: string }[] = [
    { id: 'all', label: 'All Sources', count: summary.total_gaps, color: 'gray' },
    { id: 'whatsapp', label: 'WhatsApp', count: summary.by_source.whatsapp, color: 'green' },
    { id: 'onemap', label: '1Map Only', count: summary.by_source.onemap, color: 'blue' },
    { id: 'both', label: 'Both', count: summary.by_source.both, color: 'purple' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Summary Cards - 5 in a row like Anomalies */}
      <ReportCardGrid columns={5}>
        <ReportCard
          title="Total Gaps"
          value={summary.total_gaps}
          color="red"
          icon={<AlertTriangle className="h-4 w-4" />}
          subtitle="Installed, not activated"
        />
        <ReportCard
          title="Critical (30+ days)"
          value={summary.by_age.over_30_days}
          color="red"
          subtitle="Needs immediate attention"
        />
        <ReportCard
          title="Warning (14-30 days)"
          value={summary.by_age.days_14_to_30}
          color="orange"
          subtitle="Follow up required"
        />
        <ReportCard
          title="Recent (7-14 days)"
          value={summary.by_age.days_7_to_14}
          color="yellow"
          subtitle="Monitor closely"
        />
        <ReportCard
          title="New (< 7 days)"
          value={summary.by_age.under_7_days}
          color="green"
          subtitle="Recently installed"
        />
      </ReportCardGrid>

      {/* Filter Buttons - like Anomalies */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Source:</span>
        {filterButtons.map((btn) => {
          const isActive = sourceFilter === btn.id;
          const colorStyles: Record<string, string> = {
            gray: isActive
              ? 'bg-gray-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
            green: isActive
              ? 'bg-green-600 text-white'
              : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40',
            blue: isActive
              ? 'bg-blue-600 text-white'
              : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40',
            purple: isActive
              ? 'bg-purple-600 text-white'
              : 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40',
          };

          return (
            <button
              key={btn.id}
              onClick={() => setSourceFilter(btn.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${colorStyles[btn.color]}`}
            >
              {btn.id === 'whatsapp' && <MessageSquare className="h-3.5 w-3.5" />}
              {btn.id === 'onemap' && <MapPin className="h-3.5 w-3.5" />}
              {btn.id === 'both' && <Layers className="h-3.5 w-3.5" />}
              {btn.label} ({btn.count})
            </button>
          );
        })}
      </div>

      {/* Project Breakdown - inline chips */}
      {summary.by_project.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            By Project
          </h4>
          <div className="flex flex-wrap gap-2">
            {summary.by_project.slice(0, 10).map((p) => (
              <span
                key={p.project}
                className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300">{p.project}:</span>
                <span className="font-medium text-red-600 dark:text-red-400 ml-1">{p.count}</span>
              </span>
            ))}
            {summary.by_project.length > 10 && (
              <span className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                +{summary.by_project.length - 10} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Data Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                DR Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Project
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Source
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Days Since Install
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Photos
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                QA Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {filteredItems.map((item) => (
              <tr
                key={item.drop_number}
                className={`${
                  item.days_since_install >= 30
                    ? 'bg-red-50 dark:bg-red-900/10'
                    : item.days_since_install >= 14
                      ? 'bg-orange-50 dark:bg-orange-900/10'
                      : item.days_since_install >= 7
                        ? 'bg-yellow-50 dark:bg-yellow-900/10'
                        : ''
                } hover:opacity-90`}
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                  {item.drop_number}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {item.project || '-'}
                </td>
                <td className="px-4 py-3">
                  <SourceBadge source={item.install_source} />
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                      item.days_since_install >= 30
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                        : item.days_since_install >= 14
                          ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200'
                          : item.days_since_install >= 7
                            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
                            : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                    }`}
                  >
                    <Clock className="h-3 w-3" />
                    {item.days_since_install} days
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                  {item.photo_count || 0}
                </td>
                <td className="px-4 py-3">
                  <QAStatusBadge status={item.qa_decision} />
                </td>
                <td className="px-4 py-3">
                  <a
                    href={`/activate/${item.drop_number}`}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredItems.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No installation gaps found</p>
          <p className="text-sm mt-1">All installed DRs have been activated</p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function SourceBadge({ source }: { source: 'whatsapp' | 'onemap' | 'both' }) {
  const styles = {
    whatsapp: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    onemap: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
    both: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
  };

  const icons = {
    whatsapp: <MessageSquare className="h-3 w-3" />,
    onemap: <MapPin className="h-3 w-3" />,
    both: <Layers className="h-3 w-3" />,
  };

  const labels = {
    whatsapp: 'WhatsApp',
    onemap: '1Map',
    both: 'Both',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[source]}`}
    >
      {icons[source]}
      {labels[source]}
    </span>
  );
}

function QAStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="text-xs text-gray-400">Not reviewed</span>;
  }

  const styles: Record<string, string> = {
    PASS: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    FAIL: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
    REWORK_NEEDED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}
    >
      {status}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
      <div className="h-12 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
      <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}

export default InstallationGapsReports;
