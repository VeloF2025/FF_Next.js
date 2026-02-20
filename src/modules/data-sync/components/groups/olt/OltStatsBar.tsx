/**
 * OltStatsBar — clickable stat cards that filter by status
 */

'use client';

import type { OltStats } from '../../../types';

interface OltStatsBarProps {
  stats: OltStats;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
}

const STAT_CARDS: { key: string; label: string; getValue: (s: OltStats) => number; color: string; ring: string }[] = [
  { key: 'pending', label: 'Fixable', getValue: s => s.pending, color: 'text-[var(--ff-text-primary)]', ring: 'ring-[var(--ff-accent)]' },
  { key: 'needs_investigation', label: 'Needs Investigation', getValue: s => s.needs_investigation, color: 'text-amber-400', ring: 'ring-amber-400' },
  { key: 'escalated', label: 'Escalated', getValue: s => s.escalated, color: 'text-red-400', ring: 'ring-red-400' },
  { key: 'fixed', label: 'Fixed', getValue: s => s.fixed, color: 'text-green-400', ring: 'ring-green-400' },
  { key: 'resolved', label: 'Resolved', getValue: s => s.resolved, color: 'text-blue-400', ring: 'ring-blue-400' },
  { key: 'all', label: 'Total Records', getValue: s => s.total, color: 'text-[var(--ff-text-primary)]', ring: 'ring-[var(--ff-accent)]' },
];

export function OltStatsBar({ stats, statusFilter, onStatusFilterChange }: OltStatsBarProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
      {STAT_CARDS.map(({ key, label, getValue, color, ring }) => (
        <button
          key={key}
          onClick={() => onStatusFilterChange(statusFilter === key ? 'all' : key)}
          className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-all cursor-pointer ${
            statusFilter === key
              ? `border-transparent ring-2 ${ring}`
              : 'border-[var(--ff-border-light)] hover:border-[var(--ff-text-tertiary)]'
          }`}
        >
          <div className={`text-2xl font-bold ${color}`}>{getValue(stats)}</div>
          <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
        </button>
      ))}
    </div>
  );
}
