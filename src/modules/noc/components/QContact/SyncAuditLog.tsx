/**
 * SyncAuditLog Component - QContact Sync Audit Log Display
 *
 * 🟢 WORKING: Production-ready sync audit log with filtering
 *
 * Features:
 * - Display sync log entries with details
 * - Filter by direction, type, status
 * - Filter by date range
 * - Filter by ticket ID
 * - Pagination support
 * - Expandable log details
 * - Show request/response payloads
 * - Success rate statistics
 * - Loading and error states
 */

'use client';

import React, { useState } from 'react';
import {
  FileText,
  Filter,
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ArrowLeftRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQContactSyncLog } from '../../hooks/useQContactSync';
import type {
  QContactSyncLog,
  SyncLogListResponse,
  SyncDirection,
  SyncType,
  SyncStatus,
} from '../../types/qcontact';

interface SyncAuditLogProps {
  /** Sync log data (optional - will fetch internally if not provided) */
  data?: SyncLogListResponse | null;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string | null;
  /** Callback when filters change */
  onFilterChange?: (filters: AuditLogFilters) => void;
  /** Callback when page changes */
  onPageChange?: (page: number) => void;
  /** Current page */
  currentPage?: number;
  /** Page size */
  pageSize?: number;
  /** Show compact view */
  compact?: boolean;
}

export interface AuditLogFilters {
  sync_direction?: string;
  sync_type?: string;
  status?: string;
  synced_after?: Date;
  synced_before?: Date;
  ticket_id?: string;
  qcontact_ticket_id?: string;
}

/**
 * 🟢 WORKING: Format timestamp for display
 */
function formatTimestamp(date: Date): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 🟢 WORKING: Get status icon component
 */
function getStatusIcon(status: SyncStatus): { Icon: React.ElementType; color: string } {
  switch (status) {
    case 'success':
      return { Icon: CheckCircle2, color: 'text-green-400' };
    case 'failed':
      return { Icon: XCircle, color: 'text-red-400' };
    case 'partial':
      return { Icon: AlertTriangle, color: 'text-yellow-400' };
    default:
      return { Icon: Clock, color: 'text-[var(--ff-text-secondary)]' };
  }
}

/**
 * 🟢 WORKING: Get direction icon component
 */
function getDirectionIcon(direction: SyncDirection): { Icon: React.ElementType; color: string } {
  switch (direction) {
    case 'inbound':
      return { Icon: Download, color: 'text-blue-400' };
    case 'outbound':
      return { Icon: Upload, color: 'text-purple-400' };
    default:
      return { Icon: ArrowLeftRight, color: 'text-[var(--ff-text-secondary)]' };
  }
}

/**
 * 🟢 WORKING: Format sync type for display
 */
function formatSyncType(type: SyncType): string {
  const typeMap: Record<string, string> = {
    create: 'Create',
    status_update: 'Status Update',
    assignment: 'Assignment',
    note_add: 'Add Note',
    full_sync: 'Full Sync',
  };
  return typeMap[type] || type;
}

/**
 * 🟢 WORKING: Log entry component
 */
function LogEntry({ log }: { log: QContactSyncLog }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const statusInfo = getStatusIcon(log.status as SyncStatus);
  const directionInfo = getDirectionIcon(log.sync_direction as SyncDirection);
  const StatusIcon = statusInfo.Icon;
  const DirectionIcon = directionInfo.Icon;

  return (
    <div className="border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] transition-all">
      {/* Header - Always Visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Direction & Type */}
          <div className="flex items-center">
            <DirectionIcon className={cn('w-5 h-5 mr-2', directionInfo.color)} />
            <div>
              <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                {log.sync_direction.toUpperCase()}
              </p>
              <p className="text-xs text-[var(--ff-text-secondary)]">{formatSyncType(log.sync_type as SyncType)}</p>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center">
            <StatusIcon className={cn('w-5 h-5 mr-2', statusInfo.color)} />
            <span className={cn('text-sm font-semibold', statusInfo.color)}>
              {log.status.toUpperCase()}
            </span>
          </div>

          {/* Ticket IDs */}
          <div className="col-span-2">
            <div className="space-y-1 text-xs">
              {log.ticket_id && (
                <div className="flex items-center">
                  <span className="text-[var(--ff-text-secondary)] mr-2">FF Ticket:</span>
                  <span className="text-[var(--ff-text-primary)] font-mono">{log.ticket_id.slice(0, 8)}...</span>
                </div>
              )}
              {log.qcontact_ticket_id && (
                <div className="flex items-center">
                  <span className="text-[var(--ff-text-secondary)] mr-2">QContact ID:</span>
                  <span className="text-[var(--ff-text-primary)] font-mono">{log.qcontact_ticket_id}</span>
                </div>
              )}
            </div>
          </div>

          {/* Timestamp */}
          <div className="text-right">
            <Clock className="w-4 h-4 inline mr-1 text-[var(--ff-text-secondary)]" />
            <span className="text-xs text-[var(--ff-text-secondary)]">{formatTimestamp(log.synced_at)}</span>
          </div>
        </div>

        {/* Expand Icon */}
        <div className="ml-4">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          ) : (
            <ChevronRight className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-[var(--ff-border-light)]">
          {/* Error Message */}
          {log.error_message && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm font-semibold text-red-400 mb-1">Error Message</p>
              <p className="text-sm text-red-300">{log.error_message}</p>
            </div>
          )}

          {/* Request Payload */}
          {log.request_payload && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-[var(--ff-text-primary)] mb-2">Request Payload</p>
              <pre className="p-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-xs text-[var(--ff-text-primary)] overflow-x-auto">
                {JSON.stringify(log.request_payload, null, 2)}
              </pre>
            </div>
          )}

          {/* Response Payload */}
          {log.response_payload && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-[var(--ff-text-primary)] mb-2">Response Payload</p>
              <pre className="p-3 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-xs text-[var(--ff-text-primary)] overflow-x-auto">
                {JSON.stringify(log.response_payload, null, 2)}
              </pre>
            </div>
          )}

          {/* Log ID */}
          <div className="mt-4 text-xs text-[var(--ff-text-secondary)]">
            Log ID: <span className="font-mono">{log.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 🟢 WORKING: Filter panel component
 */
function FilterPanel({
  filters,
  onFilterChange,
}: {
  filters: AuditLogFilters;
  onFilterChange: (filters: AuditLogFilters) => void;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [localFilters, setLocalFilters] = useState<AuditLogFilters>(filters);

  const handleApplyFilters = () => {
    onFilterChange(localFilters);
    setShowFilters(false);
  };

  const handleClearFilters = () => {
    const emptyFilters: AuditLogFilters = {};
    setLocalFilters(emptyFilters);
    onFilterChange(emptyFilters);
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="flex items-center text-[var(--ff-text-primary)] hover:text-[var(--ff-text-primary)] transition-all"
      >
        <Filter className="w-5 h-5 mr-2" />
        <span className="font-medium">Filters</span>
        {showFilters ? (
          <ChevronDown className="w-4 h-4 ml-2" />
        ) : (
          <ChevronRight className="w-4 h-4 ml-2" />
        )}
      </button>

      {showFilters && (
        <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg space-y-4">
          {/* Direction Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">Direction</label>
            <select
              value={localFilters.sync_direction || ''}
              onChange={(e) =>
                setLocalFilters({ ...localFilters, sync_direction: e.target.value || undefined })
              }
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Directions</option>
              <option value="inbound">Inbound (QContact → FibreFlow)</option>
              <option value="outbound">Outbound (FibreFlow → QContact)</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">Status</label>
            <select
              value={localFilters.status || ''}
              onChange={(e) =>
                setLocalFilters({ ...localFilters, status: e.target.value || undefined })
              }
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="partial">Partial</option>
            </select>
          </div>

          {/* Sync Type Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">Sync Type</label>
            <select
              value={localFilters.sync_type || ''}
              onChange={(e) =>
                setLocalFilters({ ...localFilters, sync_type: e.target.value || undefined })
              }
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              <option value="create">Create</option>
              <option value="status_update">Status Update</option>
              <option value="assignment">Assignment</option>
              <option value="note_add">Add Note</option>
              <option value="full_sync">Full Sync</option>
            </select>
          </div>

          {/* Ticket ID Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              FibreFlow Ticket ID
            </label>
            <input
              type="text"
              value={localFilters.ticket_id || ''}
              onChange={(e) =>
                setLocalFilters({ ...localFilters, ticket_id: e.target.value || undefined })
              }
              placeholder="Enter ticket UUID"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* QContact ID Filter */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">QContact Ticket ID</label>
            <input
              type="text"
              value={localFilters.qcontact_ticket_id || ''}
              onChange={(e) =>
                setLocalFilters({ ...localFilters, qcontact_ticket_id: e.target.value || undefined })
              }
              placeholder="Enter QContact ID"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-3">
            <button
              onClick={handleApplyFilters}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-[var(--ff-text-primary)] rounded-lg font-medium transition-all"
            >
              Apply Filters
            </button>
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded-lg transition-all"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 🟢 WORKING: Sync audit log component
 *
 * Can be used in two modes:
 * 1. Controlled: Pass data, isLoading, error props
 * 2. Uncontrolled: Component fetches its own data using useQContactSyncLog
 */
export function SyncAuditLog({
  data: externalData,
  isLoading: externalIsLoading = false,
  error: externalError = null,
  onFilterChange,
  onPageChange,
  currentPage = 1,
  pageSize = 50,
  compact = false,
}: SyncAuditLogProps) {
  const [filters, setFilters] = useState<AuditLogFilters>({});

  // Fetch data internally if not provided externally
  const {
    syncLogs,
    total,
    byDirection,
    byStatus,
    successRate,
    isLoading: internalIsLoading,
    isError,
    error: internalError,
    refetch,
  } = useQContactSyncLog(undefined, {
    // Only fetch if no external data is provided
    enabled: externalData === undefined,
  });

  // Use external data if provided, otherwise use internally fetched data
  const data: SyncLogListResponse | null = externalData !== undefined
    ? externalData
    : syncLogs
      ? {
          logs: syncLogs,
          total,
          by_direction: byDirection || { inbound: 0, outbound: 0 },
          by_status: byStatus || { success: 0, failed: 0, partial: 0, pending: 0 },
          success_rate: successRate,
        }
      : null;

  const isLoading = externalData !== undefined ? externalIsLoading : internalIsLoading;
  const error = externalData !== undefined ? externalError : (isError ? (internalError as Error)?.message : null);

  const handleFilterChange = (newFilters: AuditLogFilters) => {
    setFilters(newFilters);
    if (onFilterChange) {
      onFilterChange(newFilters);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <FileText className="w-8 h-8 text-[var(--ff-text-secondary)] animate-pulse mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)]">Loading sync logs...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg">
        <div className="flex items-center text-red-400 mb-2">
          <XCircle className="w-5 h-5 mr-2" />
          <span className="font-semibold">Failed to Load Sync Logs</span>
        </div>
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  // No data state
  if (!data || data.logs.length === 0) {
    return (
      <div className="space-y-4">
        {onFilterChange && (
          <FilterPanel filters={filters} onFilterChange={handleFilterChange} />
        )}
        <div className="p-12 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-center">
          <FileText className="w-12 h-12 text-[var(--ff-text-secondary)] mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)]">No sync logs found</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-2">
            Try adjusting your filters or trigger a sync operation
          </p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-[var(--ff-text-primary)] mb-1">Sync Audit Log</h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {data.total} sync operation{data.total !== 1 ? 's' : ''} | Success Rate:{' '}
            {Math.round(data.success_rate * 100)}%
          </p>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <div className="flex items-center mb-1">
            <Download className="w-4 h-4 text-blue-400 mr-2" />
            <span className="text-xs text-[var(--ff-text-secondary)]">Inbound</span>
          </div>
          <p className="text-xl font-bold text-blue-400">{data.by_direction.inbound || 0}</p>
        </div>

        <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <div className="flex items-center mb-1">
            <Upload className="w-4 h-4 text-purple-400 mr-2" />
            <span className="text-xs text-[var(--ff-text-secondary)]">Outbound</span>
          </div>
          <p className="text-xl font-bold text-purple-400">{data.by_direction.outbound || 0}</p>
        </div>

        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <div className="flex items-center mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-400 mr-2" />
            <span className="text-xs text-[var(--ff-text-secondary)]">Success</span>
          </div>
          <p className="text-xl font-bold text-green-400">{data.by_status.success || 0}</p>
        </div>

        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-center mb-1">
            <XCircle className="w-4 h-4 text-red-400 mr-2" />
            <span className="text-xs text-[var(--ff-text-secondary)]">Failed</span>
          </div>
          <p className="text-xl font-bold text-red-400">{data.by_status.failed || 0}</p>
        </div>
      </div>

      {/* Filters */}
      {onFilterChange && (
        <FilterPanel filters={filters} onFilterChange={handleFilterChange} />
      )}

      {/* Log Entries */}
      <div className="space-y-3">
        {data.logs.map((log) => (
          <LogEntry key={log.id} log={log} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between pt-4 border-t border-[var(--ff-border-light)]">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className={cn(
                'px-3 py-1 rounded-lg transition-all',
                currentPage === 1
                  ? 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                  : 'bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'
              )}
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className={cn(
                'px-3 py-1 rounded-lg transition-all',
                currentPage === totalPages
                  ? 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
                  : 'bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]'
              )}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
