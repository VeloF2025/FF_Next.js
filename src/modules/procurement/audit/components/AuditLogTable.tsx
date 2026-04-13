/**
 * AuditLogTable — Paginated, filterable audit log table
 * Color-coded actions: create=green, update=blue, approve=green, reject=red, override=orange, reverse=red
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Filter, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuditLogs } from '../hooks/useAuditLogs';
import type { AuditLogFilter, AuditLogListItem, AuditEntityTypeValue, AuditActionValue } from '@/types/procurement/audit.types';

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  update: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  approve: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  reject: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  override: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  reverse: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  delete: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

const ENTITY_COLORS: Record<string, string> = {
  purchase_order: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  goods_receipt: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  stock_movement: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  stock_serial: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  fault_report: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  boq: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  picking: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  stock_return: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  contractor_accountability: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
};

const ENTITY_TYPES: AuditEntityTypeValue[] = [
  'purchase_order', 'goods_receipt', 'stock_movement', 'stock_serial',
  'fault_report', 'boq', 'picking', 'stock_return', 'contractor_accountability',
];

const ACTION_TYPES: AuditActionValue[] = [
  'create', 'update', 'delete', 'approve', 'reject', 'override', 'reverse',
];

function formatEntityType(type: string): string {
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function AuditLogTable() {
  const [filter, setFilter] = useState<AuditLogFilter>({});
  const [showFilters, setShowFilters] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const { logs, total, page, loading, error, fetchLogs } = useAuditLogs();

  const handleFilterChange = (key: keyof AuditLogFilter, value: string) => {
    const newFilter = { ...filter, [key]: value || undefined };
    setFilter(newFilter);
    fetchLogs(newFilter, 1);
  };

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            <Filter className="h-4 w-4" />
            Filters
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {total} {total === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        <button
          onClick={() => fetchLogs(filter, page)}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
          <select
            value={filter.entityType ?? ''}
            onChange={(e) => handleFilterChange('entityType', e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          >
            <option value="">All Entity Types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{formatEntityType(t)}</option>
            ))}
          </select>
          <select
            value={filter.action ?? ''}
            onChange={(e) => handleFilterChange('action', e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          >
            <option value="">All Actions</option>
            {ACTION_TYPES.map((a) => (
              <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Table */}
      {loading && logs.length === 0 ? (
        <LoadingSpinner className="h-40" label="" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="w-8 px-3 py-3" />
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Entity</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">By</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Fields</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {logs.map((entry) => (
                <AuditRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedRow === entry.id}
                  onToggle={() => setExpandedRow(expandedRow === entry.id ? null : entry.id)}
                />
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No audit logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => fetchLogs(filter, page - 1)}
              disabled={page <= 1 || loading}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
            >
              Previous
            </button>
            <button
              onClick={() => fetchLogs(filter, page + 1)}
              disabled={page >= totalPages || loading}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditRow({ entry, expanded, onToggle }: {
  entry: AuditLogListItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
        onClick={onToggle}
      >
        <td className="px-3 py-3">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-gray-400" />
            : <ChevronRight className="h-4 w-4 text-gray-400" />}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
          {formatDate(entry.performedAt)}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ENTITY_COLORS[entry.entityType] ?? 'bg-gray-100 text-gray-800'}`}>
            {formatEntityType(entry.entityType)}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-800'}`}>
            {entry.action}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
          {entry.performedByName ?? 'System'}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
          {entry.changedFields?.join(', ') || '—'}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-800/50">
          <td colSpan={6} className="px-8 py-4">
            <div className="text-sm space-y-1">
              <p><span className="font-medium text-gray-600 dark:text-gray-300">Entity ID:</span>{' '}
                <code className="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700">{entry.entityId}</code>
              </p>
              {entry.changedFields && entry.changedFields.length > 0 && (
                <p><span className="font-medium text-gray-600 dark:text-gray-300">Changed:</span>{' '}
                  {entry.changedFields.join(', ')}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
