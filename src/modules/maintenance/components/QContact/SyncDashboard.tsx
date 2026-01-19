/**
 * SyncDashboard Component - QContact Sync Status Dashboard
 *
 * 🟢 WORKING: Production-ready sync status dashboard component
 *
 * Features:
 * - Display sync status overview
 * - Show last sync time and duration
 * - Display success rate metrics
 * - Show pending sync counts
 * - Health status indicator
 * - Manual refresh capability
 * - Loading and error states
 * - Real-time updates (auto-refresh)
 */

'use client';

import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ArrowUpCircle,
  ArrowDownCircle,
  Clock,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { useQContactSyncStatus } from '../../hooks/useQContactSync';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SyncDashboardProps {
  /** Auto-refresh interval in milliseconds (default: 30000 = 30 seconds) */
  refreshInterval?: number;
  /** Compact mode for smaller display */
  compact?: boolean;
}

/**
 * 🟢 WORKING: QContact sync status dashboard component
 */
export function SyncDashboard({
  refreshInterval = 30000,
  compact = false,
}: SyncDashboardProps) {
  const { syncStatus, isLoading, isError, error, refetch } = useQContactSyncStatus({
    refetchInterval: refreshInterval,
  });

  // 🟢 WORKING: Handle manual refresh
  const handleRefresh = () => {
    refetch();
  };

  // 🟢 WORKING: Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 text-[var(--ff-text-secondary)] animate-spin" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading sync status...</span>
      </div>
    );
  }

  // 🟢 WORKING: Error state
  if (isError) {
    return (
      <div className="flex items-center justify-center p-8 bg-red-500/10 border border-red-500/20 rounded-lg">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <span className="ml-2 text-red-400">
          Failed to load sync status: {error?.message || 'Unknown error'}
        </span>
      </div>
    );
  }

  // 🟢 WORKING: Empty state
  if (!syncStatus) {
    return (
      <div className="flex items-center justify-center p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <AlertCircle className="w-6 h-6 text-[var(--ff-text-secondary)]" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">
          No sync status available
        </span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-2')}>
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Sync Status</h3>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--ff-text-primary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors"
          aria-label="Refresh sync status"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Health Status Card */}
      <div className={cn(
        'bg-[var(--ff-bg-secondary)] border rounded-lg p-4',
        syncStatus.is_healthy ? 'border-green-500/20' : 'border-red-500/20'
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {syncStatus.is_healthy ? (
              <CheckCircle2
                className="w-6 h-6 text-green-400"
                data-testid="health-indicator"
              />
            ) : (
              <AlertTriangle
                className="w-6 h-6 text-red-400"
                data-testid="health-indicator"
              />
            )}
            <div>
              <h4 className="font-medium text-[var(--ff-text-primary)]">
                {syncStatus.is_healthy ? 'Healthy' : 'Unhealthy'}
              </h4>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                System health status
              </p>
            </div>
          </div>
        </div>

        {/* Health Issues */}
        {!syncStatus.is_healthy && syncStatus.health_issues.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
            <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Issues:</p>
            <ul className="space-y-1">
              {syncStatus.health_issues.map((issue, index) => (
                <li key={index} className="text-sm text-red-400 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Metrics Grid */}
      <div className={cn(
        'grid gap-4',
        compact ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      )}>
        {/* Success Rate */}
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <p className="text-sm text-[var(--ff-text-secondary)]">Success Rate (7d)</p>
          </div>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {syncStatus.success_rate_last_7d.toFixed(1)}%
          </p>
        </div>

        {/* Pending Outbound */}
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpCircle className="w-4 h-4 text-blue-400" />
            <p className="text-sm text-[var(--ff-text-secondary)]">Pending Outbound</p>
          </div>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {syncStatus.pending_outbound}
          </p>
        </div>

        {/* Pending Inbound */}
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownCircle className="w-4 h-4 text-purple-400" />
            <p className="text-sm text-[var(--ff-text-secondary)]">Pending Inbound</p>
          </div>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {syncStatus.pending_inbound}
          </p>
        </div>

        {/* Failed (24h) */}
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <p className="text-sm text-[var(--ff-text-secondary)]">Failed (24h)</p>
          </div>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {syncStatus.failed_last_24h}
          </p>
        </div>
      </div>

      {/* Last Sync Info */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-[var(--ff-text-secondary)] mt-0.5" />
          <div className="flex-1">
            <h4 className="font-medium text-[var(--ff-text-primary)] mb-1">Last Sync</h4>
            {syncStatus.last_sync_at ? (
              <div className="space-y-1">
                <p className="text-sm text-[var(--ff-text-primary)]">
                  {formatDistanceToNow(new Date(syncStatus.last_sync_at), { addSuffix: true })}
                </p>
                <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
                  <span>
                    Status:{' '}
                    <span className={cn(
                      'font-medium',
                      syncStatus.last_sync_status === 'success' ? 'text-green-400' :
                      syncStatus.last_sync_status === 'failed' ? 'text-red-400' :
                      'text-yellow-400'
                    )}>
                      {syncStatus.last_sync_status}
                    </span>
                  </span>
                  {syncStatus.last_sync_duration_seconds !== null && (
                    <span>
                      Duration: {syncStatus.last_sync_duration_seconds}s
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--ff-text-secondary)]">No sync performed yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
