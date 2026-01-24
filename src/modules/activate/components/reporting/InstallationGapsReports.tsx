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
  MapPin,
  MessageSquare,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import type { ReportFilters } from '../../types/reporting.types';

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

export function InstallationGapsReports({ filters, refreshKey }: InstallationGapsReportsProps) {
  const [data, setData] = useState<InstallationGapsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [ageFilter, setAgeFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.project) params.set('project', filters.project);
      params.set('page', page.toString());
      params.set('limit', '25');

      // Age filter
      if (ageFilter === 'under7') {
        params.set('maxDays', '7');
      } else if (ageFilter === '7to14') {
        params.set('minDays', '7');
        params.set('maxDays', '14');
      } else if (ageFilter === '14to30') {
        params.set('minDays', '14');
        params.set('maxDays', '30');
      } else if (ageFilter === 'over30') {
        params.set('minDays', '30');
      }

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
  }, [filters.project, page, ageFilter, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.project, ageFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
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
    );
  }

  if (!data) return null;

  const { summary, items, pagination } = data;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
          <div className="text-3xl font-bold text-red-600 dark:text-red-400">
            {summary.total_gaps}
          </div>
          <div className="text-sm text-red-700 dark:text-red-300">Total Installation Gaps</div>
          <div className="text-xs text-red-600/70 dark:text-red-400/70 mt-1">
            Money spent, not activated
          </div>
        </div>

        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4">
          <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {summary.by_age.over_30_days}
          </div>
          <div className="text-sm text-orange-700 dark:text-orange-300">Over 30 Days</div>
          <div className="text-xs text-orange-600/70 dark:text-orange-400/70 mt-1">
            Critical attention needed
          </div>
        </div>

        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
          <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
            {summary.by_age.days_14_to_30}
          </div>
          <div className="text-sm text-yellow-700 dark:text-yellow-300">14-30 Days</div>
          <div className="text-xs text-yellow-600/70 dark:text-yellow-400/70 mt-1">
            Needs follow-up
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
            {summary.by_age.under_7_days + summary.by_age.days_7_to_14}
          </div>
          <div className="text-sm text-blue-700 dark:text-blue-300">Under 14 Days</div>
          <div className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-1">
            Recently installed
          </div>
        </div>
      </div>

      {/* Source Breakdown */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Installation Source
        </h3>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-green-500" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              WhatsApp: <strong>{summary.by_source.whatsapp}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-500" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              1Map Only: <strong>{summary.by_source.onemap}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Both: <strong>{summary.by_source.both}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Project Breakdown */}
      {summary.by_project.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            By Project
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.by_project.slice(0, 10).map((p) => (
              <div
                key={p.project}
                className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-full text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300">{p.project}:</span>
                <span className="font-medium text-red-600 dark:text-red-400 ml-1">{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Age Filter */}
      <div className="flex gap-2">
        {[
          { value: 'under7', label: '< 7 days' },
          { value: '7to14', label: '7-14 days' },
          { value: '14to30', label: '14-30 days' },
          { value: 'over30', label: '30+ days' },
          { value: 'all', label: 'All' },
        ].map((option) => (
          <button
            key={option.value}
            onClick={() => setAgeFilter(option.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              ageFilter === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Data Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
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
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((item) => (
                <tr
                  key={item.drop_number}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-mono text-sm text-blue-600 dark:text-blue-400">
                      {item.drop_number}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    {item.project || '-'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.install_source === 'whatsapp'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : item.install_source === 'onemap'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                      }`}
                    >
                      {item.install_source === 'whatsapp' && <MessageSquare className="h-3 w-3" />}
                      {item.install_source === 'onemap' && <MapPin className="h-3 w-3" />}
                      {item.install_source}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1 text-sm font-medium ${
                        item.days_since_install >= 30
                          ? 'text-red-600 dark:text-red-400'
                          : item.days_since_install >= 14
                            ? 'text-orange-600 dark:text-orange-400'
                            : item.days_since_install >= 7
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" />
                      {item.days_since_install} days
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                    {item.photo_count || 0}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {item.qa_decision ? (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          item.qa_decision === 'PASS'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : item.qa_decision === 'FAIL'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}
                      >
                        {item.qa_decision}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Not reviewed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <a
                      href={`/activate/${item.drop_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      View
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {items.length === 0 && (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <AlertTriangle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No installation gaps found</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            All installed DRs have been activated
          </p>
        </div>
      )}
    </div>
  );
}

export default InstallationGapsReports;
