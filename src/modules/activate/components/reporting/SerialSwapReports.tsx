/**
 * SerialSwapReports - ONT/UPS serial swap tracking report
 *
 * Features:
 * - Summary cards with swap status breakdown
 * - Filter by status (pending, corrected, false positive)
 * - Paginated data table with technician info
 * - Mark as Corrected/False Positive actions
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Repeat,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
} from 'lucide-react';
import type {
  ReportFilters,
  SerialSwapReportResponse,
  SerialSwapRecord,
  SwapStatus,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid } from './shared';

interface SerialSwapReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

export function SerialSwapReports({ filters, refreshKey }: SerialSwapReportsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SerialSwapReportResponse | null>(null);

  // Filter states
  const [selectedStatus, setSelectedStatus] = useState<string>('pending_correction');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('dateFrom', filters.dateFrom);
      params.set('dateTo', filters.dateTo);
      if (filters.project) params.set('project', filters.project);
      if (selectedStatus) params.set('status', selectedStatus);
      params.set('page', page.toString());
      params.set('pageSize', pageSize.toString());

      const res = await fetch(`/api/activate/reporting/serial-swaps?${params}`);
      if (!res.ok) throw new Error('Failed to fetch serial swap report');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  }, [filters, selectedStatus, page, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filters.dateFrom, filters.dateTo, filters.project, selectedStatus]);

  // Handle status update
  const handleStatusUpdate = async (dropNumber: string, newStatus: SwapStatus) => {
    setActionLoading(dropNumber);
    try {
      const res = await fetch('/api/activate/reporting/serial-swaps/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, status: newStatus }),
      });

      if (!res.ok) throw new Error('Failed to update status');

      // Refresh data
      fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  // Export to CSV
  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      params.set('dateFrom', filters.dateFrom);
      params.set('dateTo', filters.dateTo);
      if (filters.project) params.set('project', filters.project);
      if (selectedStatus) params.set('status', selectedStatus);
      params.set('format', 'csv');

      const res = await fetch(`/api/activate/reporting/serial-swaps?${params}`);
      if (!res.ok) throw new Error('Failed to export');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Build descriptive filename with status filter
      const statusLabel = selectedStatus ? selectedStatus.replace(/_/g, '-') : 'all';
      a.download = `serial-swaps-${statusLabel}-${filters.dateFrom}-to-${filters.dateTo}.csv`;
      a.click();
    } catch (err) {
      alert('Export failed');
    }
  };

  // Get status badge style
  const getStatusBadge = (status: SwapStatus) => {
    switch (status) {
      case 'pending_correction':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        );
      case 'corrected_in_1map':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle className="h-3 w-3" />
            Corrected
          </span>
        );
      case 'false_positive':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
            <XCircle className="h-3 w-3" />
            False Positive
          </span>
        );
    }
  };

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={fetchData}
          className="mt-2 text-blue-600 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Summary Cards */}
      <ReportCardGrid>
        <ReportCard
          title="Total Detected"
          value={data?.summary?.total_detected ?? 0}
          icon={<Repeat className="h-4 w-4" />}
          color="blue"
          isLoading={isLoading}
        />
        <ReportCard
          title="Pending Correction"
          value={data?.summary?.pending_correction ?? 0}
          icon={<Clock className="h-4 w-4" />}
          color="yellow"
          isLoading={isLoading}
          onClick={() => setSelectedStatus('pending_correction')}
        />
        <ReportCard
          title="Corrected"
          value={data?.summary?.corrected ?? 0}
          icon={<CheckCircle className="h-4 w-4" />}
          color="green"
          isLoading={isLoading}
          onClick={() => setSelectedStatus('corrected_in_1map')}
        />
        <ReportCard
          title="Backlog > 7 Days"
          value={data?.summary?.backlog_over_7_days ?? 0}
          icon={<AlertTriangle className="h-4 w-4" />}
          color="red"
          isLoading={isLoading}
        />
      </ReportCardGrid>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Status:
          </label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">All</option>
            <option value="pending_correction">Pending Correction</option>
            <option value="corrected_in_1map">Corrected</option>
            <option value="false_positive">False Positive</option>
          </select>
        </div>

        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700"
          title={`Export ${selectedStatus ? selectedStatus.replace(/_/g, ' ') : 'all'} records to CSV`}
        >
          <Download className="h-4 w-4" />
          Export {selectedStatus ? selectedStatus.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'All'} CSV
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Repeat className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-blue-800 dark:text-blue-300">
              Serial Swaps Require Manual Correction in 1Map Mobile App
            </p>
            <p className="text-blue-700 dark:text-blue-400 mt-1">
              When ONT (ALCL/ALCB*) and UPS (GU18W*) serials are entered in wrong fields,
              technicians must correct them using the 1Map mobile app. Web editing is not available.
            </p>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                DR Number
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Project
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                ONT Serial
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                UPS Serial
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Swap Details
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Days Pending
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : data?.records.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No serial swaps found for the selected filters
                </td>
              </tr>
            ) : (
              data?.records.map((record: SerialSwapRecord) => (
                <tr key={record.drop_number} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3">
                    <a
                      href={`/activate/${record.drop_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {record.drop_number}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                    {record.project || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-gray-100">
                    {record.ont_serial || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-gray-100">
                    {record.ups_serial || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate">
                    {record.swap_details}
                  </td>
                  <td className="px-4 py-3">
                    {getStatusBadge(record.swap_status)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {record.swap_status === 'pending_correction' ? (
                      <span
                        className={`font-medium ${
                          record.days_pending > 7
                            ? 'text-red-600 dark:text-red-400'
                            : record.days_pending > 3
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {record.days_pending} days
                      </span>
                    ) : (
                      <span className="text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {record.swap_status === 'pending_correction' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStatusUpdate(record.drop_number, 'corrected_in_1map')}
                          disabled={actionLoading === record.drop_number}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                        >
                          {actionLoading === record.drop_number ? '...' : 'Mark Corrected'}
                        </button>
                        <button
                          onClick={() => handleStatusUpdate(record.drop_number, 'false_positive')}
                          disabled={actionLoading === record.drop_number}
                          className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                        >
                          False +
                        </button>
                      </div>
                    )}
                    {record.swap_status === 'corrected_in_1map' && record.corrected_at && (
                      <span className="text-xs text-gray-500">
                        {new Date(record.corrected_at).toISOString().split('T')[0]}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_count > pageSize && (
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Showing {(page - 1) * pageSize + 1} to{' '}
            {Math.min(page * pageSize, data.total_count)} of {data.total_count} results
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * pageSize >= data.total_count}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SerialSwapReports;
