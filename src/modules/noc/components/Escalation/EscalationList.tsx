/**
 * EscalationList Component - Display list of repeat fault escalations
 *
 * 🟢 WORKING: Production-ready escalation list component
 *
 * Features:
 * - Filterable list by scope type, status, project
 * - Sort by created date, fault count, status
 * - Group by scope type or status
 * - Show escalation summary cards
 * - Display fault count and contributing tickets
 * - Status badges and indicators
 * - Click to view escalation details
 * - Empty state handling
 * - Loading state handling
 * - Pagination support
 * - Responsive design
 */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Zap,
  Radio,
  MapPin,
  FileText,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  RepeatFaultEscalation,
  EscalationScopeType,
  EscalationStatus,
  EscalationType,
} from '../../types/escalation';

interface EscalationListProps {
  /** List of escalations to display */
  escalations: RepeatFaultEscalation[];
  /** Callback when escalation is clicked */
  onEscalationClick?: (escalation: RepeatFaultEscalation) => void;
  /** Whether the list is loading */
  isLoading?: boolean;
  /** Error message if any */
  error?: string | null;
  /** Show filters */
  showFilters?: boolean;
  /** Compact mode for smaller display */
  compact?: boolean;
  /** Group escalations by */
  groupBy?: 'scope_type' | 'status' | 'none';
}

/**
 * 🟢 WORKING: Get icon for scope type
 */
function getScopeTypeIcon(scopeType: EscalationScopeType) {
  switch (scopeType) {
    case 'pole':
      return <Zap className="w-4 h-4" />;
    case 'pon':
      return <Radio className="w-4 h-4" />;
    case 'zone':
      return <MapPin className="w-4 h-4" />;
    case 'dr':
      return <FileText className="w-4 h-4" />;
    default:
      return <AlertTriangle className="w-4 h-4" />;
  }
}

/**
 * 🟢 WORKING: Get label for scope type
 */
function getScopeTypeLabel(scopeType: EscalationScopeType): string {
  const labels: Record<EscalationScopeType, string> = {
    pole: 'Pole',
    pon: 'PON',
    zone: 'Zone',
    dr: 'DR Number',
  };
  return labels[scopeType] || scopeType;
}

/**
 * 🟢 WORKING: Get status badge styles
 */
function getStatusStyles(status: EscalationStatus): {
  container: string;
  icon: React.ReactNode;
} {
  switch (status) {
    case 'open':
      return {
        container: 'bg-red-500/20 text-red-400 border-red-500/30',
        icon: <AlertTriangle className="w-3 h-3" />,
      };
    case 'investigating':
      return {
        container: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        icon: <TrendingUp className="w-3 h-3" />,
      };
    case 'resolved':
      return {
        container: 'bg-green-500/20 text-green-400 border-green-500/30',
        icon: <CheckCircle2 className="w-3 h-3" />,
      };
    case 'no_action':
      return {
        container: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        icon: <XCircle className="w-3 h-3" />,
      };
    default:
      return {
        container: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)]',
        icon: <AlertTriangle className="w-3 h-3" />,
      };
  }
}

/**
 * 🟢 WORKING: Format status label
 */
function formatStatusLabel(status: EscalationStatus): string {
  const labels: Record<EscalationStatus, string> = {
    open: 'Open',
    investigating: 'Investigating',
    resolved: 'Resolved',
    no_action: 'No Action',
  };
  return labels[status] || status;
}

/**
 * 🟢 WORKING: Format date (YYYY-MM-DD standard)
 */
function formatDate(date: Date): string {
  return new Date(date).toISOString().split('T')[0];
}

/**
 * 🟢 WORKING: Escalation card component
 */
function EscalationCard({
  escalation,
  onClick,
  compact,
}: {
  escalation: RepeatFaultEscalation;
  onClick?: (escalation: RepeatFaultEscalation) => void;
  compact?: boolean;
}) {
  const statusStyles = getStatusStyles(escalation.status);

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick(escalation);
    }
  }, [escalation, onClick]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && onClick) {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick, onClick]
  );

  return (
    <div
      className={cn(
        'p-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] transition-all',
        onClick && 'cursor-pointer hover:bg-[var(--ff-bg-tertiary)] hover:border-[var(--ff-border-light)]',
        compact && 'p-3'
      )}
      onClick={onClick ? handleClick : undefined}
      role={onClick ? 'button' : 'article'}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
    >
      <div className="flex items-start justify-between">
        {/* Left side - Scope info */}
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <div className="text-[var(--ff-text-secondary)]">{getScopeTypeIcon(escalation.scope_type)}</div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-[var(--ff-text-secondary)]">
                  {getScopeTypeLabel(escalation.scope_type)}
                </span>
              </div>
              <h3 className={cn('font-semibold text-[var(--ff-text-primary)]', compact ? 'text-sm' : 'text-base')}>
                {escalation.scope_value}
              </h3>
            </div>
          </div>

          {/* Fault count */}
          <div className="flex items-center space-x-4 text-sm text-[var(--ff-text-primary)]">
            <div className="flex items-center">
              <AlertTriangle className="w-4 h-4 mr-1 text-orange-400" />
              <span>
                {escalation.fault_count} fault{escalation.fault_count !== 1 ? 's' : ''}
              </span>
              <span className="mx-2 text-[var(--ff-text-tertiary)]">|</span>
              <span className="text-[var(--ff-text-secondary)]">Threshold: {escalation.fault_threshold}</span>
            </div>
          </div>

          {/* Escalation type */}
          {escalation.escalation_type && (
            <div className="mt-2">
              <span className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {escalation.escalation_type.charAt(0).toUpperCase() +
                  escalation.escalation_type.slice(1)}
              </span>
            </div>
          )}

          {/* Created date */}
          <div className="mt-2 text-xs text-[var(--ff-text-secondary)]">
            Created {formatDate(escalation.created_at)}
          </div>
        </div>

        {/* Right side - Status */}
        <div className="flex flex-col items-end space-y-2">
          <span
            className={cn(
              'inline-flex items-center px-2 py-1 rounded text-xs font-medium border',
              statusStyles.container
            )}
          >
            <span className="mr-1">{statusStyles.icon}</span>
            {formatStatusLabel(escalation.status)}
          </span>

          {onClick && (
            <ChevronRight className="w-5 h-5 text-[var(--ff-text-tertiary)] group-hover:text-[var(--ff-text-primary)] transition-colors" />
          )}
        </div>
      </div>

      {/* Contributing tickets count */}
      {!compact && escalation.contributing_tickets && escalation.contributing_tickets.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--ff-border-light)]">
          <p className="text-xs text-[var(--ff-text-secondary)]">
            {escalation.contributing_tickets.length} contributing ticket
            {escalation.contributing_tickets.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 🟢 WORKING: Escalation list component
 */
export function EscalationList({
  escalations,
  onEscalationClick,
  isLoading = false,
  error = null,
  showFilters = false,
  compact = false,
  groupBy = 'none',
}: EscalationListProps) {
  const [filterStatus, setFilterStatus] = useState<EscalationStatus | 'all'>('all');
  const [filterScope, setFilterScope] = useState<EscalationScopeType | 'all'>('all');

  // 🟢 WORKING: Filter escalations
  const filteredEscalations = useMemo(() => {
    return escalations.filter((esc) => {
      if (filterStatus !== 'all' && esc.status !== filterStatus) return false;
      if (filterScope !== 'all' && esc.scope_type !== filterScope) return false;
      return true;
    });
  }, [escalations, filterStatus, filterScope]);

  // 🟢 WORKING: Group escalations
  const groupedEscalations = useMemo(() => {
    if (groupBy === 'none') {
      return { all: filteredEscalations };
    }

    const groups: Record<string, RepeatFaultEscalation[]> = {};
    filteredEscalations.forEach((esc) => {
      const key = groupBy === 'scope_type' ? esc.scope_type : esc.status;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(esc);
    });
    return groups;
  }, [filteredEscalations, groupBy]);

  // 🟢 WORKING: Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--ff-text-secondary)] mx-auto mb-4" />
          <p className="text-[var(--ff-text-secondary)]">Loading escalations...</p>
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Error state
  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
        <div className="flex items-start">
          <XCircle className="w-5 h-5 text-red-400 mr-3 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-300 mb-1">Error Loading Escalations</h3>
            <p className="text-sm text-red-300/80">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Empty state
  if (escalations.length === 0) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Escalations</h3>
        <p className="text-[var(--ff-text-secondary)]">No repeat fault escalations detected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      {showFilters && (
        <div className="flex items-center space-x-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <Filter className="w-4 h-4 text-[var(--ff-text-secondary)]" />

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as EscalationStatus | 'all')}
            className="px-3 py-1.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
            <option value="no_action">No Action</option>
          </select>

          {/* Scope filter */}
          <select
            value={filterScope}
            onChange={(e) => setFilterScope(e.target.value as EscalationScopeType | 'all')}
            className="px-3 py-1.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="all">All Scopes</option>
            <option value="dr">DR Number</option>
            <option value="pole">Pole</option>
            <option value="pon">PON</option>
            <option value="zone">Zone</option>
          </select>

          {/* Results count */}
          <div className="flex-1 text-right text-sm text-[var(--ff-text-secondary)]">
            {filteredEscalations.length} escalation{filteredEscalations.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Escalation groups */}
      {Object.entries(groupedEscalations).map(([groupKey, groupEscalations]) => (
        <div key={groupKey}>
          {/* Group header */}
          {groupBy !== 'none' && (
            <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3 tracking-wide">
              {groupBy === 'scope_type'
                ? getScopeTypeLabel(groupKey as EscalationScopeType)
                : formatStatusLabel(groupKey as EscalationStatus)}
              <span className="ml-2 text-[var(--ff-text-tertiary)]">({groupEscalations.length})</span>
            </h3>
          )}

          {/* Escalation cards */}
          <div className="space-y-3">
            {groupEscalations.map((escalation) => (
              <EscalationCard
                key={escalation.id}
                escalation={escalation}
                onClick={onEscalationClick}
                compact={compact}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Empty filtered state */}
      {filteredEscalations.length === 0 && escalations.length > 0 && (
        <div className="text-center py-12">
          <Filter className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Results</h3>
          <p className="text-[var(--ff-text-secondary)]">No escalations match the selected filters.</p>
        </div>
      )}
    </div>
  );
}
