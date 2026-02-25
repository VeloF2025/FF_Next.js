/**
 * FaultReportList Component
 * Table view of fault reports with filtering, pagination, and actions
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, Plus, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateFormat';
import { useFaultReports } from '../../hooks/useFaultReports';
import { CreateFaultReportForm } from './CreateFaultReportForm';
import { FaultReportDetail } from './FaultReportDetail';
import { FaultAnalyticsDashboard } from './FaultAnalyticsDashboard';
import type {
  FaultReportListItem,
  FaultTypeValue,
  FaultSeverityValue,
  FaultResolutionStatusValue,
} from '@/types/procurement/fault.types';

const FAULT_TYPE_LABELS: Record<FaultTypeValue, string> = {
  dead_on_arrival: 'Dead on Arrival',
  field_failure: 'Field Failure',
  physical_damage: 'Physical Damage',
  configuration_error: 'Config Error',
  unknown: 'Unknown',
};

const SEVERITY_CONFIG: Record<FaultSeverityValue, { label: string; classes: string }> = {
  minor: { label: 'Minor', classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  major: { label: 'Major', classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
  critical: { label: 'Critical', classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

const STATUS_CONFIG: Record<FaultResolutionStatusValue, { label: string; classes: string }> = {
  open: { label: 'Open', classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
  investigating: { label: 'Investigating', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  confirmed: { label: 'Confirmed', classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  resolved: { label: 'Resolved', classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  warranty_claim: { label: 'Warranty', classes: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  scrapped: { label: 'Scrapped', classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

type ViewMode = 'list' | 'create' | 'detail' | 'analytics';

export function FaultReportList() {
  const { faultReports, loading, error, total, page, fetchFaultReports, createFaultReport, updateFaultReport } = useFaultReports();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedFault, setSelectedFault] = useState<FaultReportListItem | null>(null);
  const [filterType, setFilterType] = useState<FaultTypeValue | ''>('');
  const [filterSeverity, setFilterSeverity] = useState<FaultSeverityValue | ''>('');
  const [filterStatus, setFilterStatus] = useState<FaultResolutionStatusValue | ''>('');

  useEffect(() => {
    fetchFaultReports(buildFilter(), 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterSeverity, filterStatus]);

  function buildFilter() {
    return {
      ...(filterType ? { faultType: filterType as FaultTypeValue } : {}),
      ...(filterSeverity ? { severity: filterSeverity as FaultSeverityValue } : {}),
      ...(filterStatus ? { resolutionStatus: filterStatus as FaultResolutionStatusValue } : {}),
    };
  }

  const handlePageChange = (newPage: number) => {
    fetchFaultReports(buildFilter(), newPage);
  };

  const handleRowClick = (fault: FaultReportListItem) => {
    setSelectedFault(fault);
    setViewMode('detail');
  };

  const handleDetailUpdate = () => {
    fetchFaultReports(buildFilter(), page);
    setViewMode('list');
    setSelectedFault(null);
  };

  const totalPages = Math.ceil(total / 50);

  if (viewMode === 'create') {
    return (
      <CreateFaultReportForm
        createFaultReport={createFaultReport}
        onSuccess={() => { fetchFaultReports(buildFilter(), 1); setViewMode('list'); }}
        onCancel={() => setViewMode('list')}
      />
    );
  }

  if (viewMode === 'detail' && selectedFault) {
    return (
      <FaultReportDetail
        faultReport={selectedFault}
        updateFaultReport={updateFaultReport}
        onUpdate={handleDetailUpdate}
        onClose={() => { setViewMode('list'); setSelectedFault(null); }}
      />
    );
  }

  if (viewMode === 'analytics') {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => setViewMode('list')}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            Back to List
          </button>
        </div>
        <FaultAnalyticsDashboard />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Fault Reports</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
            {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('analytics')}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Analytics
          </button>
          <button
            onClick={() => fetchFaultReports(buildFilter(), page)}
            className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('create')}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            <Plus className="h-4 w-4" />
            Report Fault
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as FaultTypeValue | '')}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Types</option>
          {Object.entries(FAULT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as FaultSeverityValue | '')}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Severities</option>
          <option value="minor">Minor</option>
          <option value="major">Major</option>
          <option value="critical">Critical</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as FaultResolutionStatusValue | '')}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                {['Item Code', 'Serial', 'Fault Type', 'Severity', 'Status', 'Reported By', 'Date', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : faultReports.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No fault reports found
                  </td>
                </tr>
              ) : (
                faultReports.map((fault) => (
                  <tr
                    key={fault.id}
                    onClick={() => handleRowClick(fault)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      {fault.itemCode ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {fault.serialNumber ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {FAULT_TYPE_LABELS[fault.faultType]}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CONFIG[fault.severity].classes}`}>
                        {SEVERITY_CONFIG[fault.severity].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CONFIG[fault.resolutionStatus].classes}`}>
                        {STATUS_CONFIG[fault.resolutionStatus].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {fault.discoveredByName ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {formatDisplayDate(fault.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRowClick(fault); }}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages} ({total} total)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
