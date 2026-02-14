/**
 * Logs Tab - WhatsApp Message Log Viewer
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  X,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { waAdminApi } from '../services/waAdminApiService';
import type { WaMessageLog, WaMessageLogFilters } from '../types/wa-admin.types';

const LogsTab: React.FC = () => {
  const [logs, setLogs] = useState<WaMessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, total_pages: 0 });
  const [filters, setFilters] = useState<WaMessageLogFilters>({
    page: 1,
    limit: 25,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [selectedLog, setSelectedLog] = useState<WaMessageLog | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await waAdminApi.logs.list(filters);

    if (result.success) {
      setLogs(result.data);
      setPagination(result.pagination);
    } else {
      setError(result.error || 'Failed to fetch message logs');
    }

    setLoading(false);
  }, [filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = (key: keyof WaMessageLogFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value || undefined,
      page: 1, // Reset to first page on filter change
    }));
  };

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }));
  };

  const handleExport = () => {
    const url = waAdminApi.logs.exportUrl(filters);
    window.open(url, '_blank');
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
      case 'delivered':
      case 'read':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
      case 'delivered':
      case 'read':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
          Message Logs
        </h3>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchLogs}
            disabled={loading}
            aria-label="Refresh message logs"
            className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
            aria-controls="logs-filter-panel"
            className={`flex items-center gap-2 px-3 py-2 text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 ${
              showFilters ? 'bg-green-500/10 text-green-600' : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-border-light)]'
            }`}
          >
            <Filter className="w-4 h-4" aria-hidden="true" />
            Filters
          </button>
          <button
            onClick={handleExport}
            aria-label="Export logs to CSV file"
            title={`Export ${[filters.direction, filters.status, filters.project, filters.drop_number].filter(Boolean).join(', ') || 'all'} logs to CSV`}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Export {filters.direction || filters.status || filters.project || filters.drop_number
              ? [filters.direction, filters.status].filter(Boolean).join(' ') || 'Filtered'
              : 'All'} CSV
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && !loading && (
        <div className="text-center py-8 bg-red-50 rounded-lg border border-red-200" role="alert">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchLogs}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div id="logs-filter-panel" className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <div>
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Direction</label>
            <select
              value={filters.direction || ''}
              onChange={(e) => handleFilterChange('direction', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            >
              <option value="">All</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Status</label>
            <select
              value={filters.status || ''}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            >
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Project</label>
            <input
              type="text"
              value={filters.project || ''}
              onChange={(e) => handleFilterChange('project', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
              placeholder="e.g., Lawley"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Drop Number</label>
            <input
              type="text"
              value={filters.drop_number || ''}
              onChange={(e) => handleFilterChange('drop_number', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
              placeholder="e.g., DR1752169"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Date From</label>
            <input
              type="date"
              value={filters.date_from || ''}
              onChange={(e) => handleFilterChange('date_from', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">Date To</label>
            <input
              type="date"
              value={filters.date_to || ''}
              onChange={(e) => handleFilterChange('date_to', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-medium)] rounded bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
            />
          </div>
        </div>
      )}

      {/* Logs Table */}
      <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)]">Direction</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)]">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)]">Project</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)]">Drop</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)]">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)]">Timestamp</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-[var(--ff-text-secondary)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center" role="status" aria-label="Loading message logs">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" aria-hidden="true" />
                    <span className="sr-only">Loading message logs...</span>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                    No logs found matching your criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)]">
                    <td className="px-4 py-3">
                      {log.direction === 'inbound' ? (
                        <span className="inline-flex items-center gap-1 text-blue-600 text-sm">
                          <ArrowDownLeft className="w-4 h-4" /> In
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                          <ArrowUpRight className="w-4 h-4" /> Out
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="bg-[var(--ff-bg-tertiary)] px-2 py-0.5 rounded text-xs text-[var(--ff-text-primary)]">
                        {log.message_type || 'unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--ff-text-primary)]">
                      {log.project || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {log.drop_number ? (
                        <code className="bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded text-xs">
                          {log.drop_number}
                        </code>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${getStatusColor(log.status)}`}>
                        {getStatusIcon(log.status)}
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ff-text-secondary)]">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="p-1.5 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
                        aria-label={`View details for ${log.direction} message${log.drop_number ? ` ${log.drop_number}` : ''}`}
                      >
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--ff-bg-secondary)] border-t border-[var(--ff-border-light)]">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Showing {logs.length} of {pagination.total} logs
          </p>
          <nav className="flex items-center gap-2" aria-label="Log pagination">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              aria-label="Go to previous page"
              className="p-1.5 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <span className="text-sm text-[var(--ff-text-secondary)]" aria-live="polite">
              Page {pagination.page} of {pagination.total_pages}
            </span>
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.total_pages}
              aria-label="Go to next page"
              className="p-1.5 text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] rounded transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </button>
          </nav>
        </div>
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  );
};

interface LogDetailModalProps {
  log: WaMessageLog;
  onClose: () => void;
}

const LogDetailModal: React.FC<LogDetailModalProps> = ({ log, onClose }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trapping and escape key handling
  useEffect(() => {
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-detail-title"
        className="bg-[var(--ff-bg-card)] rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h3 id="log-detail-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">Message Details</h3>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close message details"
            className="p-1 hover:bg-[var(--ff-bg-tertiary)] rounded focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Direction</label>
              <p className="text-sm text-[var(--ff-text-primary)]">{log.direction}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Service</label>
              <p className="text-sm text-[var(--ff-text-primary)]">{log.service}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Status</label>
              <p className="text-sm text-[var(--ff-text-primary)]">{log.status}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Type</label>
              <p className="text-sm text-[var(--ff-text-primary)]">{log.message_type || '-'}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Project</label>
              <p className="text-sm text-[var(--ff-text-primary)]">{log.project || '-'}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Drop Number</label>
              <p className="text-sm text-[var(--ff-text-primary)]">{log.drop_number || '-'}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Group JID</label>
              <p className="text-sm font-mono text-xs text-[var(--ff-text-primary)]">{log.group_jid || '-'}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Timestamp</label>
              <p className="text-sm text-[var(--ff-text-primary)]">{new Date(log.created_at).toLocaleString()}</p>
            </div>
          </div>

          {log.error_message && (
            <div>
              <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Error</label>
              <p className="text-sm text-red-600 bg-red-500/10 p-2 rounded mt-1">{log.error_message}</p>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-[var(--ff-text-secondary)]">Message Content</label>
            <pre className="text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] p-3 rounded mt-1 whitespace-pre-wrap overflow-x-auto max-h-[200px]">
              {log.message_content || '(No content)'}
            </pre>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[var(--ff-border-light)]">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded hover:bg-[var(--ff-border-light)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LogsTab;
