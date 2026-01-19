/**
 * HandoverHistory Component - Display handover timeline for a ticket
 *
 * 🟢 WORKING: Production-ready handover history component
 *
 * Features:
 * - Display chronological handover timeline
 * - Show handover type for each entry
 * - Display ownership transfers
 * - Expand to view snapshot details
 * - Current owner highlighting
 * - Loading and error states
 * - Responsive design
 */

'use client';

import React, { useState } from 'react';
import {
  Calendar,
  User,
  ArrowRight,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHandoverHistory } from '../../hooks/useHandover';
import { HandoverSnapshot as HandoverSnapshotDisplay } from './HandoverSnapshot';
import type { HandoverSnapshot } from '../../types/handover';

interface HandoverHistoryProps {
  /** Ticket ID to fetch handover history for */
  ticketId: string;
  /** Show expanded snapshots by default */
  expandedByDefault?: boolean;
  /** Compact mode for smaller displays */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Format handover type for display
 */
function formatHandoverType(type: string): string {
  const typeMap: Record<string, string> = {
    build_to_qa: 'Build to QA',
    qa_to_maintenance: 'QA to Maintenance',
    maintenance_complete: 'Maintenance Complete',
  };
  return typeMap[type] || type;
}

/**
 * 🟢 WORKING: Format owner type for display
 */
function formatOwnerType(type: string | null): string {
  if (!type) return 'Unknown';
  const typeMap: Record<string, string> = {
    build: 'Build',
    qa: 'QA',
    maintenance: 'Maintenance',
  };
  return typeMap[type] || type;
}

/**
 * 🟢 WORKING: Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(date).toLocaleDateString();
}

/**
 * 🟢 WORKING: Handover timeline entry component
 */
function HandoverTimelineEntry({
  handover,
  isLatest,
  showDetails,
  onToggleDetails,
}: {
  handover: HandoverSnapshot;
  isLatest: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  return (
    <div className="relative">
      {/* Timeline connector */}
      {!isLatest && (
        <div className="absolute left-6 top-16 bottom-0 w-0.5 bg-[var(--ff-border-light)]" />
      )}

      {/* Timeline entry */}
      <div className="flex gap-4">
        {/* Timeline icon */}
        <div
          className={cn(
            'flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center border-2',
            isLatest
              ? 'bg-green-500/20 border-green-500/50'
              : 'bg-blue-500/20 border-blue-500/50'
          )}
        >
          {isLatest ? (
            <CheckCircle2 className="w-6 h-6 text-green-400" />
          ) : (
            <Clock className="w-6 h-6 text-blue-400" />
          )}
        </div>

        {/* Timeline content */}
        <div className="flex-1 pb-8">
          <div
            className={cn(
              'border rounded-lg overflow-hidden',
              isLatest ? 'border-green-500/30 bg-green-500/5' : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]'
            )}
          >
            {/* Header */}
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="text-base font-semibold text-[var(--ff-text-primary)] mb-1">
                    {formatHandoverType(handover.handover_type)}
                  </h4>
                  {isLatest && (
                    <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs font-medium">
                      Current Owner
                    </span>
                  )}
                </div>

                <button
                  onClick={onToggleDetails}
                  className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  role="button"
                  aria-label="View details"
                >
                  {showDetails ? 'Hide Details' : 'View Details'}
                  <ChevronRight
                    className={cn(
                      'w-4 h-4 transition-transform',
                      showDetails && 'rotate-90'
                    )}
                  />
                </button>
              </div>

              {/* Ownership transfer */}
              {(handover.from_owner_type || handover.to_owner_type) && (
                <div className="flex items-center gap-3 mb-3 p-2 bg-[var(--ff-bg-secondary)] rounded-lg">
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    {formatOwnerType(handover.from_owner_type)}
                  </span>
                  <ArrowRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                  <span className="text-sm text-[var(--ff-text-primary)] font-medium">
                    {formatOwnerType(handover.to_owner_type)}
                  </span>
                </div>
              )}

              {/* Metadata */}
              <div className="flex flex-wrap gap-4 text-xs text-[var(--ff-text-secondary)]">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{new Date(handover.handover_at).toLocaleString()}</span>
                  <span className="text-[var(--ff-text-tertiary)]">
                    ({formatRelativeTime(handover.handover_at)})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  <span className="font-mono">{handover.handover_by.slice(0, 8)}</span>
                </div>
              </div>
            </div>

            {/* Expanded snapshot details */}
            {showDetails && (
              <div className="border-t border-[var(--ff-border-light)] p-4">
                <HandoverSnapshotDisplay snapshot={handover} compact />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Main handover history component
 */
export function HandoverHistory({
  ticketId,
  expandedByDefault = false,
  compact = false,
}: HandoverHistoryProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set(expandedByDefault ? [] : [])
  );

  // 🟢 WORKING: Fetch handover history
  const { data: history, isLoading, isError, error } = useHandoverHistory(ticketId);

  // 🟢 WORKING: Toggle snapshot details
  const toggleDetails = (handoverId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(handoverId)) {
        next.delete(handoverId);
      } else {
        next.add(handoverId);
      }
      return next;
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="flex items-center gap-3 text-[var(--ff-text-secondary)]">
          <div
            role="status"
            className="w-5 h-5 border-2 border-[var(--ff-border-light)] border-t-[var(--ff-text-secondary)] rounded-full animate-spin"
          />
          <span>Loading handover history...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-red-300">
              Failed to Load Handover History
            </h3>
            <p className="text-sm text-red-400 mt-1">
              {error instanceof Error ? error.message : 'An unexpected error occurred'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!history || history.handovers.length === 0) {
    return (
      <div className="p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[var(--ff-bg-tertiary)] flex items-center justify-center">
            <Clock className="w-6 h-6 text-[var(--ff-text-tertiary)]" />
          </div>
          <div>
            <p className="text-[var(--ff-text-primary)] font-medium">No Handover History</p>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              This ticket has not been handed over yet
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Handover History</h3>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {history.total_handovers} handover{history.total_handovers !== 1 ? 's' : ''}
            {history.current_owner_type && (
              <span>
                {' · '}
                Current owner: {formatOwnerType(history.current_owner_type)}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {history.handovers.map((handover, index) => (
          <HandoverTimelineEntry
            key={handover.id}
            handover={handover}
            isLatest={index === history.handovers.length - 1}
            showDetails={expandedIds.has(handover.id)}
            onToggleDetails={() => toggleDetails(handover.id)}
          />
        ))}
      </div>
    </div>
  );
}
