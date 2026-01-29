/**
 * History Group Component
 * Unified timeline of all data sync operations across all sources
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  RefreshCw,
  Filter,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  FileSpreadsheet,
  WifiOff,
  Users,
  MapPin,
  Radio,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { SyncHistoryEntry, SyncOperationType } from '../../types';

// Filter options
const FILTER_OPTIONS: { value: string; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'all', label: 'All Operations', icon: Clock, color: 'text-[var(--ff-text-secondary)]' },
  { value: 'oes_import', label: 'OES Import', icon: FileSpreadsheet, color: 'text-amber-400' },
  { value: 'arch_import', label: 'ARCH Import', icon: WifiOff, color: 'text-purple-400' },
  { value: 'qcontact_sync', label: 'QContact Sync', icon: Users, color: 'text-blue-400' },
  { value: 'qfield_sync', label: 'QField Sync', icon: MapPin, color: 'text-green-400' },
  { value: 'olt_import', label: 'OLT Import', icon: Radio, color: 'text-red-400' },
];

// Status badge config
const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  success: { label: 'Success', icon: CheckCircle, className: 'bg-green-500/10 text-green-400 border-green-500/20' },
  failed: { label: 'Failed', icon: XCircle, className: 'bg-red-500/10 text-red-400 border-red-500/20' },
  partial: { label: 'Partial', icon: AlertTriangle, className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  running: { label: 'Running', icon: Loader2, className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
};

// Type badge config
const TYPE_CONFIG: Record<SyncOperationType, { label: string; icon: React.ElementType; color: string; bgColor: string }> = {
  oes_import: { label: 'OES Import', icon: FileSpreadsheet, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
  arch_import: { label: 'ARCH Import', icon: WifiOff, color: 'text-purple-400', bgColor: 'bg-purple-500/10' },
  qcontact_sync: { label: 'QContact', icon: Users, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  qfield_sync: { label: 'QField', icon: MapPin, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  olt_import: { label: 'OLT Import', icon: Radio, color: 'text-red-400', bgColor: 'bg-red-500/10' },
};

interface HistoryGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function HistoryGroup({ activeTab, onTabChange }: HistoryGroupProps) {
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/system/data-sync/history?limit=100&type=${filter}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (data.success) {
        setEntries(data.data);
      } else {
        setError(data.error || 'Failed to load history');
      }
    } catch {
      setError('Failed to fetch sync history');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Fetch on mount and filter change
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  // Default tab
  useEffect(() => {
    if (!activeTab) onTabChange('timeline');
  }, [activeTab, onTabChange]);

  // Format relative time
  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Format duration
  const formatDuration = (seconds: number | null): string => {
    if (seconds === null || seconds === undefined) return '-';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  // Stats summary
  const stats = {
    total: entries.length,
    success: entries.filter(e => e.status === 'success').length,
    failed: entries.filter(e => e.status === 'failed').length,
    running: entries.filter(e => e.status === 'running').length,
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <p className="text-sm text-[var(--ff-text-secondary)]">Total Operations</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.total}</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <p className="text-sm text-green-400">Successful</p>
          <p className="text-2xl font-bold text-green-400">{stats.success}</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <p className="text-sm text-red-400">Failed</p>
          <p className="text-2xl font-bold text-red-400">{stats.failed}</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
          <p className="text-sm text-blue-400">Running</p>
          <p className="text-2xl font-bold text-blue-400">{stats.running}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
        {FILTER_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors border ${
                isActive
                  ? 'bg-[var(--ff-accent)] text-white border-[var(--ff-accent)]'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : opt.color}`} />
              {opt.label}
            </button>
          );
        })}
        <button
          onClick={fetchHistory}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded-full border border-[var(--ff-border-light)] hover:border-[var(--ff-accent)] transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Timeline */}
      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
          <span className="ml-3 text-[var(--ff-text-secondary)]">Loading history...</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No sync operations found</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            Operations will appear here as imports and syncs are run
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const typeConf = TYPE_CONFIG[entry.operation_type] ?? TYPE_CONFIG.oes_import;
            const statusConfEntry = (STATUS_CONFIG[entry.status] || STATUS_CONFIG.success)!;
            const StatusIcon = statusConfEntry.icon;
            const statusClassName = statusConfEntry.className;
            const statusLabel = statusConfEntry.label;
            const TypeIcon = typeConf.icon;
            const isExpanded = expandedId === entry.id;

            return (
              <div
                key={entry.id}
                className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden"
              >
                {/* Main Row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                >
                  {/* Expand icon */}
                  <div className="flex-shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                    )}
                  </div>

                  {/* Type Icon */}
                  <div className={`flex-shrink-0 p-2 rounded-lg ${typeConf.bgColor}`}>
                    <TypeIcon className={`w-4 h-4 ${typeConf.color}`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${typeConf.color}`}>
                        {typeConf.label}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${statusClassName}`}>
                        <StatusIcon className={`w-3 h-3 ${entry.status === 'running' ? 'animate-spin' : ''}`} />
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--ff-text-primary)] mt-0.5 truncate">
                      {entry.summary}
                    </p>
                  </div>

                  {/* Duration */}
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-[var(--ff-text-tertiary)]">
                      {formatTime(entry.started_at)}
                    </p>
                    {entry.duration_seconds !== null && (
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
                        {formatDuration(entry.duration_seconds)}
                      </p>
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-[var(--ff-border-light)] px-4 py-3 bg-[var(--ff-bg-primary)]">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-[var(--ff-text-tertiary)] text-xs">Started</span>
                        <p className="text-[var(--ff-text-primary)]">
                          {new Date(entry.started_at).toLocaleString('en-ZA')}
                        </p>
                      </div>
                      {entry.completed_at && (
                        <div>
                          <span className="text-[var(--ff-text-tertiary)] text-xs">Completed</span>
                          <p className="text-[var(--ff-text-primary)]">
                            {new Date(entry.completed_at).toLocaleString('en-ZA')}
                          </p>
                        </div>
                      )}
                      <div>
                        <span className="text-[var(--ff-text-tertiary)] text-xs">Duration</span>
                        <p className="text-[var(--ff-text-primary)]">
                          {formatDuration(entry.duration_seconds)}
                        </p>
                      </div>
                      {entry.triggered_by && (
                        <div>
                          <span className="text-[var(--ff-text-tertiary)] text-xs">Triggered By</span>
                          <p className="text-[var(--ff-text-primary)]">{entry.triggered_by}</p>
                        </div>
                      )}
                    </div>

                    {/* Error message */}
                    {entry.error_message && (
                      <div className="mt-3 p-2 bg-red-500/5 border border-red-500/20 rounded text-sm text-red-400">
                        {entry.error_message}
                      </div>
                    )}

                    {/* Details JSON */}
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <div className="mt-3">
                        <span className="text-[var(--ff-text-tertiary)] text-xs">Details</span>
                        <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                          {Object.entries(entry.details).map(([key, value]) => (
                            <div
                              key={key}
                              className="px-2 py-1 bg-[var(--ff-bg-tertiary)] rounded text-xs"
                            >
                              <span className="text-[var(--ff-text-tertiary)]">
                                {key.replace(/_/g, ' ')}:
                              </span>{' '}
                              <span className="text-[var(--ff-text-primary)] font-medium">
                                {String(value ?? '-')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
