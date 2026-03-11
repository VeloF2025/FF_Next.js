/**
 * RepeatFaultMap Component - Visual map of repeat fault locations
 *
 * 🟢 WORKING: Production-ready repeat fault visualization component
 *
 * Features:
 * - Heat map visualization of fault concentrations
 * - Group by scope type (pole, PON, zone, DR)
 * - Color-coded by fault count severity
 * - Interactive hover details
 * - Click to view escalation details
 * - Legend for severity levels
 * - Filter by scope type
 * - Sort by fault count
 * - Responsive grid layout
 * - Empty state handling
 */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  MapPin,
  Zap,
  Radio,
  FileText,
  TrendingUp,
  AlertTriangle,
  Filter,
  Grid3x3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  RepeatFaultEscalation,
  EscalationScopeType,
  EscalationStatus,
} from '../../types/escalation';

interface RepeatFaultMapProps {
  /** List of escalations to visualize */
  escalations: RepeatFaultEscalation[];
  /** Callback when location is clicked */
  onLocationClick?: (escalation: RepeatFaultEscalation) => void;
  /** Scope type to display */
  scopeType?: EscalationScopeType | 'all';
  /** Show only active escalations */
  activeOnly?: boolean;
  /** Compact mode for smaller display */
  compact?: boolean;
}

/**
 * Fault location interface
 */
interface FaultLocation {
  scope_type: EscalationScopeType;
  scope_value: string;
  fault_count: number;
  threshold: number;
  status: EscalationStatus;
  escalation_id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  created_at: Date;
}

/**
 * 🟢 WORKING: Get icon for scope type
 */
function getScopeIcon(scopeType: EscalationScopeType) {
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
function getScopeLabel(scopeType: EscalationScopeType): string {
  const labels: Record<EscalationScopeType, string> = {
    pole: 'Pole',
    pon: 'PON',
    zone: 'Zone',
    dr: 'DR',
  };
  return labels[scopeType] || scopeType;
}

/**
 * 🟢 WORKING: Calculate severity based on fault count and threshold
 */
function calculateSeverity(
  faultCount: number,
  threshold: number
): 'critical' | 'high' | 'medium' | 'low' {
  const ratio = faultCount / threshold;
  if (ratio >= 3) return 'critical';
  if (ratio >= 2) return 'high';
  if (ratio >= 1.5) return 'medium';
  return 'low';
}

/**
 * 🟢 WORKING: Get styles for severity level
 */
function getSeverityStyles(severity: 'critical' | 'high' | 'medium' | 'low'): {
  bg: string;
  border: string;
  text: string;
  glow: string;
} {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-500/20',
        border: 'border-red-500/50',
        text: 'text-red-300',
        glow: 'shadow-lg shadow-red-500/20',
      };
    case 'high':
      return {
        bg: 'bg-orange-500/20',
        border: 'border-orange-500/50',
        text: 'text-orange-300',
        glow: 'shadow-lg shadow-orange-500/20',
      };
    case 'medium':
      return {
        bg: 'bg-yellow-500/20',
        border: 'border-yellow-500/50',
        text: 'text-yellow-300',
        glow: 'shadow-md shadow-yellow-500/10',
      };
    case 'low':
      return {
        bg: 'bg-blue-500/20',
        border: 'border-blue-500/50',
        text: 'text-blue-300',
        glow: '',
      };
    default:
      return {
        bg: 'bg-[var(--ff-bg-tertiary)]',
        border: 'border-[var(--ff-border-light)]',
        text: 'text-[var(--ff-text-secondary)]',
        glow: '',
      };
  }
}

/**
 * 🟢 WORKING: Location card component
 */
function LocationCard({
  location,
  onClick,
  compact,
}: {
  location: FaultLocation;
  onClick?: (escalation_id: string) => void;
  compact?: boolean;
}) {
  const styles = getSeverityStyles(location.severity);

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick(location.escalation_id);
    }
  }, [location.escalation_id, onClick]);

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
        'p-4 rounded-lg border-2 transition-all',
        styles.bg,
        styles.border,
        styles.glow,
        onClick && 'cursor-pointer hover:scale-105 hover:z-10',
        compact && 'p-3'
      )}
      onClick={onClick ? handleClick : undefined}
      role={onClick ? 'button' : 'article'}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className={cn('flex items-center', styles.text)}>
          {getScopeIcon(location.scope_type)}
          <span className={cn('ml-2 text-xs font-medium', compact && 'text-[10px]')}>
            {getScopeLabel(location.scope_type)}
          </span>
        </div>
        {location.severity === 'critical' && (
          <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
        )}
      </div>

      {/* Location value */}
      <div className={cn('font-bold text-[var(--ff-text-primary)] mb-2', compact ? 'text-sm' : 'text-lg')}>
        {location.scope_value}
      </div>

      {/* Fault count */}
      <div className="flex items-center justify-between">
        <div className={cn(styles.text, compact ? 'text-xs' : 'text-sm')}>
          <span className="font-semibold">{location.fault_count}</span> fault
          {location.fault_count !== 1 ? 's' : ''}
        </div>
        <div className={cn('text-[var(--ff-text-tertiary)]', compact ? 'text-[10px]' : 'text-xs')}>
          Limit: {location.threshold}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-2 w-full bg-black/30 rounded-full h-1.5 overflow-hidden">
        <div
          className={cn(
            'h-1.5 rounded-full transition-all',
            location.severity === 'critical'
              ? 'bg-red-500'
              : location.severity === 'high'
              ? 'bg-orange-500'
              : location.severity === 'medium'
              ? 'bg-yellow-500'
              : 'bg-blue-500'
          )}
          style={{
            width: `${Math.min((location.fault_count / location.threshold) * 100, 100)}%`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Repeat fault map component
 */
export function RepeatFaultMap({
  escalations,
  onLocationClick,
  scopeType = 'all',
  activeOnly = false,
  compact = false,
}: RepeatFaultMapProps) {
  const [selectedScope, setSelectedScope] = useState<EscalationScopeType | 'all'>(scopeType);
  const [sortBy, setSortBy] = useState<'count' | 'severity' | 'recent'>('severity');

  // 🟢 WORKING: Convert escalations to fault locations
  const locations = useMemo<FaultLocation[]>(() => {
    let filtered = escalations;

    // Filter by scope type
    if (selectedScope !== 'all') {
      filtered = filtered.filter((esc) => esc.scope_type === selectedScope);
    }

    // Filter by active status
    if (activeOnly) {
      filtered = filtered.filter(
        (esc) => esc.status === 'open' || esc.status === 'investigating'
      );
    }

    // Convert to locations
    return filtered.map((esc) => ({
      scope_type: esc.scope_type,
      scope_value: esc.scope_value,
      fault_count: esc.fault_count,
      threshold: esc.fault_threshold,
      status: esc.status,
      escalation_id: esc.id,
      severity: calculateSeverity(esc.fault_count, esc.fault_threshold),
      created_at: esc.created_at,
    }));
  }, [escalations, selectedScope, activeOnly]);

  // 🟢 WORKING: Sort locations
  const sortedLocations = useMemo(() => {
    const sorted = [...locations];

    switch (sortBy) {
      case 'count':
        sorted.sort((a, b) => b.fault_count - a.fault_count);
        break;
      case 'severity': {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        sorted.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
        break;
      }
      case 'recent':
        sorted.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        break;
      default:
        break;
    }

    return sorted;
  }, [locations, sortBy]);

  // 🟢 WORKING: Calculate statistics
  const stats = useMemo(() => {
    const total = locations.length;
    const critical = locations.filter((loc) => loc.severity === 'critical').length;
    const high = locations.filter((loc) => loc.severity === 'high').length;
    const medium = locations.filter((loc) => loc.severity === 'medium').length;
    const low = locations.filter((loc) => loc.severity === 'low').length;

    return { total, critical, high, medium, low };
  }, [locations]);

  // 🟢 WORKING: Handle location click
  const handleLocationClick = useCallback(
    (escalationId: string) => {
      const escalation = escalations.find((esc) => esc.id === escalationId);
      if (escalation && onLocationClick) {
        onLocationClick(escalation);
      }
    },
    [escalations, onLocationClick]
  );

  // Empty state
  if (escalations.length === 0) {
    return (
      <div className="text-center py-12">
        <Grid3x3 className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Fault Patterns</h3>
        <p className="text-[var(--ff-text-secondary)]">No repeat fault patterns detected yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        {/* Scope filter */}
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          <select
            value={selectedScope}
            onChange={(e) => setSelectedScope(e.target.value as EscalationScopeType | 'all')}
            className="px-3 py-1.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="all">All Scopes</option>
            <option value="pole">Poles</option>
            <option value="pon">PONs</option>
            <option value="zone">Zones</option>
            <option value="dr">DR Numbers</option>
          </select>
        </div>

        {/* Sort */}
        <div className="flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-[var(--ff-text-secondary)]" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'count' | 'severity' | 'recent')}
            className="px-3 py-1.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded text-sm text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="severity">By Severity</option>
            <option value="count">By Fault Count</option>
            <option value="recent">Most Recent</option>
          </select>
        </div>

        {/* Statistics */}
        <div className="flex-1 flex items-center justify-end space-x-4 text-sm">
          {stats.critical > 0 && (
            <div className="flex items-center text-red-400">
              <span className="font-semibold">{stats.critical}</span>
              <span className="ml-1 text-[var(--ff-text-secondary)]">critical</span>
            </div>
          )}
          {stats.high > 0 && (
            <div className="flex items-center text-orange-400">
              <span className="font-semibold">{stats.high}</span>
              <span className="ml-1 text-[var(--ff-text-secondary)]">high</span>
            </div>
          )}
          {stats.medium > 0 && (
            <div className="flex items-center text-yellow-400">
              <span className="font-semibold">{stats.medium}</span>
              <span className="ml-1 text-[var(--ff-text-secondary)]">medium</span>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      {!compact && (
        <div className="flex items-center space-x-6 text-xs text-[var(--ff-text-secondary)]">
          <span className="font-medium">Severity:</span>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span>Critical (3x+ threshold)</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 rounded bg-orange-500" />
            <span>High (2x+ threshold)</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 rounded bg-yellow-500" />
            <span>Medium (1.5x+ threshold)</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 rounded bg-blue-500" />
            <span>Low (&lt; 1.5x threshold)</span>
          </div>
        </div>
      )}

      {/* Location grid */}
      <div
        className={cn(
          'grid gap-4',
          compact
            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
            : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
        )}
      >
        {sortedLocations.map((location) => (
          <LocationCard
            key={location.escalation_id}
            location={location}
            onClick={onLocationClick ? handleLocationClick : undefined}
            compact={compact}
          />
        ))}
      </div>

      {/* Empty filtered state */}
      {sortedLocations.length === 0 && locations.length === 0 && escalations.length > 0 && (
        <div className="text-center py-12">
          <Filter className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Results</h3>
          <p className="text-[var(--ff-text-secondary)]">No locations match the selected filters.</p>
        </div>
      )}
    </div>
  );
}
