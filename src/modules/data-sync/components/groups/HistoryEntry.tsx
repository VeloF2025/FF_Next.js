/**
 * HistoryEntry — single row in the sync history timeline (collapsed + expanded).
 *
 * Extracted from HistoryGroup so the parent stays under the 300-line cap and
 * the row composition has a single home.
 */

'use client';

import type { ElementType } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileSpreadsheet,
  WifiOff,
  Users,
  MapPin,
  Radio,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import type { SyncHistoryEntry, SyncOperationType } from '../../types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

const STATUS_CONFIG: Record<string, { label: string; icon: ElementType; className: string }> = {
  success: { label: 'Success', icon: CheckCircle, className: 'bg-green-500/10 text-green-400 border-green-500/20' },
  failed: { label: 'Failed', icon: XCircle, className: 'bg-red-500/10 text-red-400 border-red-500/20' },
  partial: { label: 'Partial', icon: AlertTriangle, className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  running: { label: 'Running', icon: Loader2, className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
};

const TYPE_CONFIG: Record<SyncOperationType, { label: string; icon: ElementType; color: string; bgColor: string }> = {
  oes_import: { label: 'OES Import', icon: FileSpreadsheet, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
  arch_import: { label: 'ARCH Import', icon: WifiOff, color: 'text-purple-400', bgColor: 'bg-purple-500/10' },
  qcontact_sync: { label: 'QContact', icon: Users, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
  qfield_sync: { label: 'QField', icon: MapPin, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  olt_import: { label: 'OLT Import', icon: Radio, color: 'text-red-400', bgColor: 'bg-red-500/10' },
};

function formatTime(dateStr: string): string {
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
  return date.toLocaleDateString('en-ZA');
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

interface HistoryEntryProps {
  entry: SyncHistoryEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

export function HistoryEntry({ entry, isExpanded, onToggle }: HistoryEntryProps) {
  const typeConf = TYPE_CONFIG[entry.operation_type] ?? TYPE_CONFIG.oes_import;
  const statusConfEntry = (STATUS_CONFIG[entry.status] || STATUS_CONFIG.success)!;
  const StatusIcon = statusConfEntry.icon;
  const TypeIcon = typeConf.icon;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors"
      >
        <div className="flex-shrink-0">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          )}
        </div>

        <div className={`flex-shrink-0 p-2 rounded-lg ${typeConf.bgColor}`}>
          <TypeIcon className={`w-4 h-4 ${typeConf.color}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${typeConf.color}`}>{typeConf.label}</span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${statusConfEntry.className}`}
            >
              {entry.status === 'running' ? <InlineSpinner size="sm" /> : <StatusIcon className="w-3 h-3" />}
              {statusConfEntry.label}
            </span>
          </div>
          <p className="text-sm text-[var(--ff-text-primary)] mt-0.5 truncate">{entry.summary}</p>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="text-xs text-[var(--ff-text-tertiary)]">{formatTime(entry.started_at)}</p>
          {entry.duration_seconds !== null && (
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">{formatDuration(entry.duration_seconds)}</p>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--ff-border-light)] px-4 py-3 bg-[var(--ff-bg-primary)]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-[var(--ff-text-tertiary)] text-xs">Started</span>
              <p className="text-[var(--ff-text-primary)]">{new Date(entry.started_at).toLocaleString('en-ZA')}</p>
            </div>
            {entry.completed_at && (
              <div>
                <span className="text-[var(--ff-text-tertiary)] text-xs">Completed</span>
                <p className="text-[var(--ff-text-primary)]">{new Date(entry.completed_at).toLocaleString('en-ZA')}</p>
              </div>
            )}
            <div>
              <span className="text-[var(--ff-text-tertiary)] text-xs">Duration</span>
              <p className="text-[var(--ff-text-primary)]">{formatDuration(entry.duration_seconds)}</p>
            </div>
            {entry.triggered_by && (
              <div>
                <span className="text-[var(--ff-text-tertiary)] text-xs">Triggered By</span>
                <p className="text-[var(--ff-text-primary)]">{entry.triggered_by}</p>
              </div>
            )}
          </div>

          {entry.error_message && (
            <div className="mt-3 p-2 bg-red-500/5 border border-red-500/20 rounded text-sm text-red-400">
              {entry.error_message}
            </div>
          )}

          {entry.details && Object.keys(entry.details).length > 0 && (
            <div className="mt-3">
              <span className="text-[var(--ff-text-tertiary)] text-xs">Details</span>
              <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(entry.details).map(([key, value]) => (
                  <div key={key} className="px-2 py-1 bg-[var(--ff-bg-tertiary)] rounded text-xs">
                    <span className="text-[var(--ff-text-tertiary)]">{key.replace(/_/g, ' ')}:</span>{' '}
                    <span className="text-[var(--ff-text-primary)] font-medium">{String(value ?? '-')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
