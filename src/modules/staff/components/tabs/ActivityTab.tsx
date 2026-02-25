'use client';

/**
 * Staff Activity/Audit Tab
 * Displays audit trail of all actions performed on a staff record
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  FileText,
  UserCog,
  Download,
  Shield,
  MessageSquare,
  Clock,
  User,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Upload,
} from 'lucide-react';
import { formatDisplayDateTime, formatDisplayDateShort } from '@/utils/dateFormat';
import { safeToDate } from '@/utils/dateHelpers';
import { log } from '@/lib/logger';
import { formatLabel } from '@/lib/utils';

interface AuditEntry {
  id: string;
  actionType: string;
  actionDescription: string;
  details: Record<string, unknown>;
  performedByName: string | null;
  createdAt: string;
}

interface ActivityTabProps {
  staffId: string;
}

// Map action types to icons and colors
const actionConfig: Record<string, { icon: typeof Activity; color: string; bg: string }> = {
  document_uploaded: { icon: Upload, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  document_verified: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20' },
  document_rejected: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20' },
  document_deleted: { icon: FileText, color: 'text-red-400', bg: 'bg-red-500/20' },
  document_downloaded: { icon: Download, color: 'text-purple-400', bg: 'bg-purple-500/20' },
  profile_created: { icon: UserCog, color: 'text-green-400', bg: 'bg-green-500/20' },
  profile_updated: { icon: UserCog, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  profile_viewed: { icon: UserCog, color: 'text-gray-400', bg: 'bg-gray-500/20' },
  profile_deleted: { icon: UserCog, color: 'text-red-400', bg: 'bg-red-500/20' },
  data_exported: { icon: Download, color: 'text-orange-400', bg: 'bg-orange-500/20' },
  report_generated: { icon: FileText, color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
  permission_changed: { icon: Shield, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  note_added: { icon: MessageSquare, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  note_deleted: { icon: MessageSquare, color: 'text-red-400', bg: 'bg-red-500/20' },
};

const defaultConfig = { icon: Activity, color: 'text-gray-400', bg: 'bg-gray-500/20' };

export function ActivityTab({ staffId }: ActivityTabProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  const fetchAuditLog = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/staff/${staffId}/audit-log?limit=${limit}&offset=${offset}`);

      if (!response.ok) {
        throw new Error('Failed to fetch audit log');
      }

      const data = await response.json();
      setEntries(data.data?.entries || []);
      setTotal(data.data?.total || 0);
    } catch (err) {
      log.error('Failed to fetch audit log', { staffId, error: err });
      setError('Failed to load activity log');
    } finally {
      setIsLoading(false);
    }
  }, [staffId, limit, offset]);

  useEffect(() => {
    fetchAuditLog();
  }, [fetchAuditLog]);

  const toggleExpanded = (id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatDate = (dateStr: string) => {
    return formatDisplayDateTime(dateStr, 'Unknown date');
  };

  const getRelativeTime = (dateStr: string) => {
    try {
      const date = safeToDate(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return formatDisplayDateShort(date);
    } catch {
      return '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-[var(--ff-text-secondary)]" />
          <h2 className="text-lg font-medium text-[var(--ff-text-primary)]">Activity Log</h2>
          <span className="text-sm text-[var(--ff-text-secondary)]">({total} entries)</span>
        </div>
        <button
          onClick={fetchAuditLog}
          className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded-lg"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {entries.length === 0 && !error ? (
        <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-8 text-center">
          <Activity className="w-12 h-12 text-[var(--ff-text-muted)] mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No activity recorded yet</p>
          <p className="text-sm text-[var(--ff-text-muted)] mt-1">
            Actions like document uploads, verifications, and profile edits will appear here.
          </p>
        </div>
      ) : (
        /* Activity Timeline */
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-[var(--ff-border-light)]" />

          <div className="space-y-3">
            {entries.map((entry) => {
              const config = actionConfig[entry.actionType] || defaultConfig;
              const Icon = config.icon;
              const isExpanded = expandedEntries.has(entry.id);
              const hasDetails = entry.details && Object.keys(entry.details).length > 0;

              return (
                <div
                  key={entry.id}
                  className="relative pl-12"
                >
                  {/* Timeline dot */}
                  <div className={`absolute left-3 w-4 h-4 rounded-full ${config.bg} flex items-center justify-center`}>
                    <div className={`w-2 h-2 rounded-full ${config.color.replace('text-', 'bg-')}`} />
                  </div>

                  {/* Entry card */}
                  <div
                    className={`bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden ${
                      hasDetails ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => hasDetails && toggleExpanded(entry.id)}
                  >
                    <div className="flex items-center gap-3 p-3">
                      {/* Icon */}
                      <div className={`p-1.5 rounded ${config.bg} flex-shrink-0`}>
                        <Icon className={`w-4 h-4 ${config.color}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--ff-text-primary)]">
                          {entry.actionDescription}
                        </p>
                        <p className="text-xs text-[var(--ff-text-secondary)] flex items-center gap-2 mt-0.5">
                          <Clock className="w-3 h-3" />
                          <span title={formatDate(entry.createdAt)}>{getRelativeTime(entry.createdAt)}</span>
                          {entry.performedByName && (
                            <>
                              <span className="text-[var(--ff-text-muted)]">•</span>
                              <User className="w-3 h-3" />
                              <span>{entry.performedByName}</span>
                            </>
                          )}
                        </p>
                      </div>

                      {/* Expand indicator */}
                      {hasDetails && (
                        <div className="flex-shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expanded details */}
                    {isExpanded && hasDetails && (
                      <div className="px-3 pb-3 pt-0 border-t border-[var(--ff-border-light)]">
                        <div className="mt-2 space-y-1 text-sm">
                          {entry.details.syncedFields && Array.isArray(entry.details.syncedFields) && (
                            <div className="space-y-1">
                              <p className="text-[var(--ff-text-secondary)] text-xs">Synced Fields:</p>
                              {(entry.details.syncedFields as string[]).map((field, idx) => (
                                <div key={idx} className="flex items-center gap-2 ml-2">
                                  <span className="text-green-400">•</span>
                                  <span className="text-[var(--ff-text-primary)]">{field}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {entry.details.changedFields && Array.isArray(entry.details.changedFields) && (
                            <div className="space-y-1">
                              <p className="text-[var(--ff-text-secondary)] text-xs">Changed Fields:</p>
                              {(entry.details.changedFields as string[]).map((field, idx) => (
                                <div key={idx} className="flex items-center gap-2 ml-2">
                                  <span className="text-yellow-400">•</span>
                                  <span className="text-[var(--ff-text-primary)]">{field}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {entry.details.reason && (
                            <p className="text-[var(--ff-text-primary)]">
                              <span className="text-[var(--ff-text-secondary)]">Reason:</span> {entry.details.reason as string}
                            </p>
                          )}
                          {entry.details.documentType && !entry.details.syncedFields && (
                            <p className="text-[var(--ff-text-primary)]">
                              <span className="text-[var(--ff-text-secondary)]">Document:</span> {formatLabel(entry.details.documentType as string)}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-3 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--ff-text-secondary)]">
            {offset + 1} - {Math.min(offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            className="px-3 py-1.5 text-sm bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
