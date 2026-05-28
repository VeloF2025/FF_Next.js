/**
 * History Group Component
 * Unified timeline of all data sync operations across all sources.
 *
 * Filters: operation type pills + DateChipFilter (date range) + clickable
 * stat cards (status filter, OLT Investigate aesthetic). Date filtering is
 * client-side because /api/system/data-sync/history doesn't accept date
 * params yet — fine while the fetch caps at limit=100.
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Clock,
  RefreshCw,
  Filter,
  FileSpreadsheet,
  WifiOff,
  Users,
  MapPin,
  Radio,
  Lock,
} from 'lucide-react';
import type { SyncHistoryEntry } from '../../types';
import { getDateRange, type DateFilter } from '../../types';
import { usePermission } from '@/hooks/usePermission';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { DateChipFilter } from '../DateChipFilter';
import { HistoryEntry } from './HistoryEntry';

const FILTER_OPTIONS: { value: string; label: string; icon: React.ElementType; color: string }[] = [
  { value: 'all', label: 'All Operations', icon: Clock, color: 'text-[var(--ff-text-secondary)]' },
  { value: 'oes_import', label: 'OES Import', icon: FileSpreadsheet, color: 'text-amber-400' },
  { value: 'arch_import', label: 'ARCH Import', icon: WifiOff, color: 'text-purple-400' },
  { value: 'qcontact_sync', label: 'QContact Sync', icon: Users, color: 'text-blue-400' },
  { value: 'qfield_sync', label: 'QField Sync', icon: MapPin, color: 'text-green-400' },
  { value: 'olt_import', label: 'OLT Import', icon: Radio, color: 'text-red-400' },
];

type StatusFilter = 'all' | 'success' | 'failed' | 'running';

const STAT_CARDS: { key: StatusFilter; label: string; color: string; ring: string }[] = [
  { key: 'all', label: 'Total Operations', color: 'text-[var(--ff-text-primary)]', ring: 'ring-[var(--ff-accent)]' },
  { key: 'success', label: 'Successful', color: 'text-green-400', ring: 'ring-green-400' },
  { key: 'failed', label: 'Failed', color: 'text-red-400', ring: 'ring-red-400' },
  { key: 'running', label: 'Running', color: 'text-blue-400', ring: 'ring-blue-400' },
];

interface HistoryGroupProps {
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function HistoryGroup({ activeTab, onTabChange }: HistoryGroupProps) {
  const { can, isLoading: permissionsLoading } = usePermission();
  const [entries, setEntries] = useState<SyncHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDateFrom, setCustomDateFrom] = useState<string>('');
  const [customDateTo, setCustomDateTo] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hasAccess = useMemo(() => {
    if (permissionsLoading) return true;
    return can('system.data-sync.history.timeline', 'view');
  }, [permissionsLoading, can]);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/system/data-sync/history?limit=100&type=${filter}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (data.success) setEntries(data.data);
      else setError(data.error || 'Failed to load history');
    } catch {
      setError('Failed to fetch sync history');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  useEffect(() => {
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, [fetchHistory]);

  useEffect(() => {
    if (!activeTab) onTabChange('timeline');
  }, [activeTab, onTabChange]);

  // Client-side date + status filtering. Date predicate uses the shared
  // getDateRange (ISO timestamps); started_at is also ISO so direct compare.
  const visibleEntries = useMemo(() => {
    const range = getDateRange(dateFilter, customDateFrom, customDateTo);
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (range.dateFrom && e.started_at < range.dateFrom) return false;
      if (range.dateTo && e.started_at >= range.dateTo) return false;
      return true;
    });
  }, [entries, statusFilter, dateFilter, customDateFrom, customDateTo]);

  const stats = useMemo(() => ({
    all: visibleEntries.length,
    success: visibleEntries.filter((e) => e.status === 'success').length,
    failed: visibleEntries.filter((e) => e.status === 'failed').length,
    running: visibleEntries.filter((e) => e.status === 'running').length,
  }), [visibleEntries]);

  if (permissionsLoading) {
    return <LoadingSpinner className="py-16" size="lg" label="Loading..." />;
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">Access Restricted</h2>
        <p className="text-[var(--ff-text-secondary)] max-w-md">
          You don&apos;t have permission to access sync history.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards — clickable, ring-on-active (OLT Investigate aesthetic) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ key, label, color, ring }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
            className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-all cursor-pointer ${
              statusFilter === key
                ? `border-transparent ring-2 ${ring}`
                : 'border-[var(--ff-border-light)] hover:border-[var(--ff-text-tertiary)]'
            }`}
          >
            <div className={`text-2xl font-bold ${color}`}>{stats[key]}</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
          </button>
        ))}
      </div>

      {/* Date Chip Filter */}
      <DateChipFilter
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        customDateFrom={customDateFrom}
        customDateTo={customDateTo}
        onCustomDateFromChange={setCustomDateFrom}
        onCustomDateToChange={setCustomDateTo}
      />

      {/* Operation type filter pills */}
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

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <LoadingSpinner className="py-12" size="md" label="Loading history..." />
      ) : visibleEntries.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="w-12 h-12 mx-auto text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No sync operations found</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
            {entries.length === 0
              ? 'Operations will appear here as imports and syncs are run'
              : 'Try widening the date range or clearing the status filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleEntries.map((entry) => (
            <HistoryEntry
              key={entry.id}
              entry={entry}
              isExpanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
