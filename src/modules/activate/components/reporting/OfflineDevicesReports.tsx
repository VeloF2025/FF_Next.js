/**
 * OfflineDevicesReports - Offline devices analysis report
 *
 * Features:
 * - Summary cards with match status breakdown
 * - Filter by zone, offline bucket, match status, down reason
 * - Paginated data table with sorting
 * - Serial mismatch highlighting
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  WifiOff,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import type {
  ReportFilters,
  OfflineDevicesReportResponse,
  OfflineDeviceRecord,
  OfflineMatchStatus,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid } from './shared';

interface OfflineDevicesReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

export function OfflineDevicesReports({ filters, refreshKey }: OfflineDevicesReportsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OfflineDevicesReportResponse | null>(null);

  // Filter states
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [selectedMatchStatus, setSelectedMatchStatus] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [serialMismatchOnly, setSerialMismatchOnly] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('dateFrom', filters.dateFrom);
      params.set('dateTo', filters.dateTo);
      if (filters.project) params.set('project', filters.project);
      if (selectedZone) params.set('zone', selectedZone);
      if (selectedBucket) params.set('offlineBucket', selectedBucket);
      if (selectedMatchStatus) params.set('matchStatus', selectedMatchStatus);
      if (selectedReason) params.set('lastDownReason', selectedReason);
      if (serialMismatchOnly) params.set('serialMismatchOnly', 'true');
      params.set('page', page.toString());
      params.set('pageSize', pageSize.toString());

      const res = await fetch(`/api/activate/reporting/offline-devices?${params}`);
      if (!res.ok) throw new Error('Failed to fetch offline devices report');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  }, [
    filters,
    selectedZone,
    selectedBucket,
    selectedMatchStatus,
    selectedReason,
    serialMismatchOnly,
    page,
    refreshKey,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedZone, selectedBucket, selectedMatchStatus, selectedReason, serialMismatchOnly]);

  // Export handler
  const handleExport = useCallback(() => {
    if (!data) return;

    const headers = [
      'DR Number',
      'Serial',
      'Zone',
      'Address',
      'Pole',
      'Down Reason',
      'Days Offline',
      'Bucket',
      'Match Status',
      'Serial Mismatch',
      'Report Date',
    ];

    const rows = data.records.map((r) => [
      r.drop_number,
      r.serial_number,
      r.zone || '',
      r.address || '',
      r.pole_number || '',
      r.last_down_reason,
      r.days_since_last_inform,
      r.offline_bucket,
      r.match_status,
      r.serial_mismatch ? 'Yes' : 'No',
      r.report_date,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `offline-devices-${filters.dateFrom}-to-${filters.dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, filters]);

  const totalPages = data ? Math.ceil(data.total_count / pageSize) : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header with export */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <WifiOff className="h-5 w-5 text-red-500" />
          Offline Devices Report
        </h3>
        {data && data.total_count > 0 && (
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {isLoading && !data ? (
        <LoadingSkeleton />
      ) : data ? (
        <>
          {/* Summary Cards */}
          <ReportCardGrid columns={5}>
            <ReportCard
              title="Total Offline"
              value={data.summary.total_devices}
              color="red"
              icon={<WifiOff className="h-4 w-4" />}
            />
            <ReportCard
              title="Matched Drops"
              value={data.summary.matched_drops}
              color="green"
              icon={<CheckCircle className="h-4 w-4" />}
              subtitle={`${Math.round((data.summary.matched_drops / Math.max(data.summary.total_devices, 1)) * 100)}%`}
            />
            <ReportCard
              title="Matched OES"
              value={data.summary.matched_oes}
              color="blue"
              subtitle="OES only match"
            />
            <ReportCard
              title="Unmatched"
              value={data.summary.unmatched}
              color="orange"
              icon={<XCircle className="h-4 w-4" />}
              subtitle="No system match"
            />
            <ReportCard
              title="Serial Mismatches"
              value={data.summary.serial_mismatches}
              color="red"
              icon={<AlertTriangle className="h-4 w-4" />}
              subtitle="Wrong ONT?"
              onClick={() => setSerialMismatchOnly(!serialMismatchOnly)}
            />
          </ReportCardGrid>

          {/* Bucket Distribution */}
          {Object.keys(data.summary.by_bucket).length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Offline Duration Distribution
              </h4>
              <div className="flex flex-wrap gap-3">
                {Object.entries(data.summary.by_bucket)
                  .sort((a, b) => {
                    // Sort by bucket order
                    const order = ['Less than 20 days', '20 - 40 Days', '40 - 60 Days', 'More than 60 Days'];
                    return order.indexOf(a[0]) - order.indexOf(b[0]);
                  })
                  .map(([bucket, count]) => (
                    <button
                      key={bucket}
                      onClick={() => setSelectedBucket(selectedBucket === bucket ? '' : bucket)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        selectedBucket === bucket
                          ? 'bg-blue-600 text-white'
                          : getBucketColor(bucket)
                      }`}
                    >
                      {bucket}: <span className="font-bold">{count}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Zones</option>
              {data.available_zones.map((z) => (
                <option key={z} value={z}>
                  {z} ({data.summary.by_zone[z] || 0})
                </option>
              ))}
            </select>

            <select
              value={selectedBucket}
              onChange={(e) => setSelectedBucket(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Buckets</option>
              {data.available_buckets.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <select
              value={selectedMatchStatus}
              onChange={(e) => setSelectedMatchStatus(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Match Status</option>
              <option value="matched_drops">Matched Drops</option>
              <option value="matched_oes">Matched OES</option>
              <option value="unmatched">Unmatched</option>
            </select>

            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Down Reasons</option>
              {data.available_reasons.slice(0, 20).map((r) => (
                <option key={r} value={r}>
                  {r} ({data.summary.by_reason[r] || 0})
                </option>
              ))}
            </select>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={serialMismatchOnly}
                onChange={(e) => setSerialMismatchOnly(e.target.checked)}
                className="rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Serial mismatches only
              </span>
            </label>

            {(selectedZone || selectedBucket || selectedMatchStatus || selectedReason || serialMismatchOnly) && (
              <button
                onClick={() => {
                  setSelectedZone('');
                  setSelectedBucket('');
                  setSelectedMatchStatus('');
                  setSelectedReason('');
                  setSerialMismatchOnly(false);
                }}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Data Table */}
          <OfflineDevicesTable records={data.records} isLoading={isLoading} />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, data.total_count)} of{' '}
                {data.total_count} devices
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <span className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyState message="No offline devices data available" />
      )}
    </div>
  );
}

// ============================================================================
// DATA TABLE
// ============================================================================

function OfflineDevicesTable({
  records,
  isLoading,
}: {
  records: OfflineDeviceRecord[];
  isLoading: boolean;
}) {
  if (records.length === 0 && !isLoading) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        No offline devices found matching the filters
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/50">
          <tr>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              DR Number
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Serial
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Zone
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Pole
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Down Reason
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              <Clock className="h-4 w-4 inline mr-1" />
              Days Offline
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Match
            </th>
            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          {records.map((record) => (
            <tr
              key={`${record.drop_number}-${record.report_date}-${record.pole_number}`}
              className={`${
                record.serial_mismatch
                  ? 'bg-red-50 dark:bg-red-900/10'
                  : record.days_since_last_inform > 60
                    ? 'bg-orange-50 dark:bg-orange-900/10'
                    : record.days_since_last_inform > 40
                      ? 'bg-yellow-50 dark:bg-yellow-900/10'
                      : ''
              }`}
            >
              <td className="px-3 py-3 text-sm font-medium text-gray-900 dark:text-white">
                {record.drop_number}
              </td>
              <td className="px-3 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                <div className="flex flex-col">
                  <span>{record.serial_number || '-'}</span>
                  {record.serial_mismatch && record.expected_serial && (
                    <span className="text-xs text-red-600 dark:text-red-400">
                      Expected: {record.expected_serial}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
                {record.zone || '-'}
              </td>
              <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400">
                {record.pole_number || '-'}
              </td>
              <td className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-[200px] truncate" title={record.last_down_reason}>
                {record.last_down_reason}
              </td>
              <td className="px-3 py-3 text-sm">
                <span
                  className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getDaysColor(
                    record.days_since_last_inform
                  )}`}
                >
                  {record.days_since_last_inform} days
                </span>
              </td>
              <td className="px-3 py-3 text-sm">
                <MatchStatusBadge status={record.match_status} serialMismatch={record.serial_mismatch} />
              </td>
              <td className="px-3 py-3 text-sm">
                <a
                  href={`/activate/${record.drop_number}`}
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  title="View DR Details"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function MatchStatusBadge({
  status,
  serialMismatch,
}: {
  status: OfflineMatchStatus;
  serialMismatch: boolean;
}) {
  if (serialMismatch) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200">
        <AlertTriangle className="h-3 w-3" />
        Mismatch
      </span>
    );
  }

  const styles: Record<OfflineMatchStatus, string> = {
    matched_drops: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    matched_oes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
    unmatched: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200',
  };

  const labels: Record<OfflineMatchStatus, string> = {
    matched_drops: 'Drops',
    matched_oes: 'OES',
    unmatched: 'None',
  };

  return (
    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function getDaysColor(days: number): string {
  if (days > 60) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200';
  if (days > 40) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200';
  if (days > 20) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200';
  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200';
}

function getBucketColor(bucket: string): string {
  if (bucket.includes('Less than 20')) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
  if (bucket.includes('20')) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
  if (bucket.includes('40')) return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
      <div className="h-12 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg" />
      <div className="h-64 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-500 dark:text-gray-400">
      <WifiOff className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>{message}</p>
      <p className="text-sm mt-2">Import offline data using the Data Import tab first.</p>
    </div>
  );
}

export default OfflineDevicesReports;
