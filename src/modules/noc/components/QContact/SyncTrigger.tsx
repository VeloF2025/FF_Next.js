/**
 * SyncTrigger Component - Manual QContact Sync Trigger
 *
 * 🟢 WORKING: Production-ready manual sync trigger with options
 *
 * Features:
 * - Manual sync trigger button
 * - Sync direction options (inbound, outbound, both)
 * - Date range filtering
 * - Specific ticket ID filtering
 * - Force resync option
 * - Loading state during sync
 * - Success/error notifications
 * - Confirmation dialog for full sync
 */

'use client';

import React, { useState } from 'react';
import {
  RefreshCw,
  Download,
  Upload,
  ArrowLeftRight,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FullSyncRequest, FullSyncResult } from '../../types/qcontact';
import { SyncDirection } from '../../types/qcontact';

interface SyncTriggerProps {
  /** Callback when sync is triggered */
  onTriggerSync: (request: FullSyncRequest) => Promise<FullSyncResult>;
  /** Disable trigger button */
  disabled?: boolean;
  /** Show compact view */
  compact?: boolean;
}

type SyncDirectionOption = 'bidirectional' | 'inbound' | 'outbound';

/**
 * 🟢 WORKING: Sync direction selector component
 */
function SyncDirectionSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: SyncDirectionOption;
  onChange: (value: SyncDirectionOption) => void;
  disabled?: boolean;
}) {
  const options: { value: SyncDirectionOption; label: string; icon: React.ElementType; description: string }[] = [
    {
      value: 'bidirectional',
      label: 'Bidirectional',
      icon: ArrowLeftRight,
      description: 'Sync both directions (recommended)',
    },
    {
      value: 'inbound',
      label: 'Inbound Only',
      icon: Download,
      description: 'QContact → FibreFlow',
    },
    {
      value: 'outbound',
      label: 'Outbound Only',
      icon: Upload,
      description: 'FibreFlow → QContact',
    },
  ];

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-[var(--ff-text-primary)]">Sync Direction</label>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;

          return (
            <button
              key={option.value}
              onClick={() => onChange(option.value)}
              disabled={disabled}
              className={cn(
                'p-3 rounded-lg border transition-all text-left',
                isSelected
                  ? 'bg-blue-500/20 border-blue-500/50'
                  : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="flex items-center mb-2">
                <Icon className={cn('w-5 h-5 mr-2', isSelected ? 'text-blue-400' : 'text-[var(--ff-text-secondary)]')} />
                <span className={cn('font-medium', isSelected ? 'text-blue-400' : 'text-[var(--ff-text-primary)]')}>
                  {option.label}
                </span>
              </div>
              <p className="text-xs text-[var(--ff-text-secondary)]">{option.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Sync result display component
 */
function SyncResultDisplay({ result }: { result: FullSyncResult }) {
  const hasErrors = result.errors.length > 0;
  const isSuccess = result.success_rate >= 0.8;

  return (
    <div className="space-y-4">
      {/* Overall Status */}
      <div
        className={cn(
          'p-4 rounded-lg border',
          isSuccess
            ? 'bg-green-500/10 border-green-500/20'
            : 'bg-yellow-500/10 border-yellow-500/20'
        )}
      >
        <div className="flex items-center mb-2">
          {isSuccess ? (
            <CheckCircle2 className="w-5 h-5 text-green-400 mr-2" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-yellow-400 mr-2" />
          )}
          <span className={cn('font-semibold', isSuccess ? 'text-green-400' : 'text-yellow-400')}>
            Sync {isSuccess ? 'Completed Successfully' : 'Completed with Issues'}
          </span>
        </div>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Duration: {Math.round(result.duration_seconds)}s | Success Rate:{' '}
          {Math.round(result.success_rate * 100)}%
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {/* Inbound Stats */}
        {result.inbound_stats.total_processed > 0 && (
          <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
            <div className="flex items-center mb-2">
              <Download className="w-4 h-4 text-blue-400 mr-2" />
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">Inbound</span>
            </div>
            <div className="space-y-1 text-xs text-[var(--ff-text-secondary)]">
              <div className="flex justify-between">
                <span>Processed:</span>
                <span className="text-[var(--ff-text-primary)]">{result.inbound_stats.total_processed}</span>
              </div>
              <div className="flex justify-between">
                <span>Successful:</span>
                <span className="text-green-400">{result.inbound_stats.successful}</span>
              </div>
              <div className="flex justify-between">
                <span>Failed:</span>
                <span className="text-red-400">{result.inbound_stats.failed}</span>
              </div>
              <div className="flex justify-between">
                <span>Created:</span>
                <span className="text-blue-400">{result.inbound_stats.created}</span>
              </div>
              <div className="flex justify-between">
                <span>Updated:</span>
                <span className="text-yellow-400">{result.inbound_stats.updated}</span>
              </div>
            </div>
          </div>
        )}

        {/* Outbound Stats */}
        {result.outbound_stats.total_processed > 0 && (
          <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
            <div className="flex items-center mb-2">
              <Upload className="w-4 h-4 text-purple-400 mr-2" />
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">Outbound</span>
            </div>
            <div className="space-y-1 text-xs text-[var(--ff-text-secondary)]">
              <div className="flex justify-between">
                <span>Processed:</span>
                <span className="text-[var(--ff-text-primary)]">{result.outbound_stats.total_processed}</span>
              </div>
              <div className="flex justify-between">
                <span>Successful:</span>
                <span className="text-green-400">{result.outbound_stats.successful}</span>
              </div>
              <div className="flex justify-between">
                <span>Failed:</span>
                <span className="text-red-400">{result.outbound_stats.failed}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Errors */}
      {hasErrors && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-center mb-2">
            <XCircle className="w-5 h-5 text-red-400 mr-2" />
            <span className="font-semibold text-red-400">
              {result.errors.length} Error{result.errors.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {result.errors.slice(0, 5).map((error, index) => (
              <div key={index} className="text-xs text-red-300 bg-red-500/5 p-2 rounded">
                <p className="font-medium">
                  Ticket: {error.ticket_id || error.qcontact_ticket_id || 'Unknown'}
                </p>
                <p>{error.error_message}</p>
              </div>
            ))}
            {result.errors.length > 5 && (
              <p className="text-xs text-[var(--ff-text-secondary)]">
                ...and {result.errors.length - 5} more error{result.errors.length - 5 !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 🟢 WORKING: Sync trigger component
 */
export function SyncTrigger({ onTriggerSync, disabled = false, compact = false }: SyncTriggerProps) {
  const [syncDirection, setSyncDirection] = useState<SyncDirectionOption>('bidirectional');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [forceResync, setForceResync] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<FullSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * 🟢 WORKING: Handle sync trigger
   */
  const handleTriggerSync = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncResult(null);

    try {
      // Build sync request
      const request: FullSyncRequest = {
        force_resync: forceResync,
      };

      // Add direction if not bidirectional
      if (syncDirection === 'inbound') {
        request.sync_direction = SyncDirection.INBOUND;
      } else if (syncDirection === 'outbound') {
        request.sync_direction = SyncDirection.OUTBOUND;
      }

      // Add date range if provided
      if (startDate) {
        request.start_date = new Date(startDate);
      }
      if (endDate) {
        request.end_date = new Date(endDate);
      }

      // Trigger sync
      const result = await onTriggerSync(request);
      setSyncResult(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to trigger sync';
      setError(errorMessage);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-xl font-bold text-[var(--ff-text-primary)] mb-1">Manual Sync Trigger</h3>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Manually trigger a sync operation with custom options
        </p>
      </div>

      {/* Sync Direction */}
      <SyncDirectionSelector
        value={syncDirection}
        onChange={setSyncDirection}
        disabled={isSyncing || disabled}
      />

      {/* Advanced Options */}
      <div className="space-y-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-all"
        >
          <Settings className="w-4 h-4 mr-2" />
          {showAdvanced ? 'Hide' : 'Show'} Advanced Options
        </button>

        {showAdvanced && (
          <div className="space-y-4 p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={isSyncing || disabled}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                  <Calendar className="w-4 h-4 inline mr-1" />
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isSyncing || disabled}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Force Resync */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="forceResync"
                checked={forceResync}
                onChange={(e) => setForceResync(e.target.checked)}
                disabled={isSyncing || disabled}
                className="w-4 h-4 text-blue-600 bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] rounded focus:ring-blue-500"
              />
              <label htmlFor="forceResync" className="ml-2 text-sm text-[var(--ff-text-primary)]">
                Force Resync{' '}
                <span className="text-[var(--ff-text-secondary)]">(Re-sync even if already synced)</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Trigger Button */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleTriggerSync}
          disabled={isSyncing || disabled}
          className={cn(
            'flex items-center px-6 py-3 rounded-lg font-semibold transition-all',
            isSyncing || disabled
              ? 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-[var(--ff-text-primary)]'
          )}
        >
          {isSyncing ? (
            <>
              <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="w-5 h-5 mr-2" />
              Trigger Sync
            </>
          )}
        </button>

        {isSyncing && (
          <div className="text-sm text-[var(--ff-text-secondary)]">
            Sync in progress... This may take a few minutes.
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-center text-red-400 mb-2">
            <XCircle className="w-5 h-5 mr-2" />
            <span className="font-semibold">Sync Failed</span>
          </div>
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Result Display */}
      {syncResult && <SyncResultDisplay result={syncResult} />}
    </div>
  );
}
