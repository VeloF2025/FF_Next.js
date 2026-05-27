/**
 * PPStatsBar — clickable stat cards for PP Data, styled to match OltStatsBar.
 * Active card uses ring-2 (not border-2). Inactive uses border-[var(--ff-border-light)].
 * Last Import cell is PP-specific and always shown without click behaviour.
 */

'use client';

import { formatDisplayDate } from '@/utils/dateFormat';
import { type PPCardCategory, type PPStats } from './ppDataShared';

interface PPStatsBarProps {
  stats: PPStats;
  activeCard: PPCardCategory | null;
  onCardClick: (cat: PPCardCategory) => void;
}

const STAT_CARDS: {
  cat: PPCardCategory;
  label: string;
  getValue: (s: PPStats) => number;
  color: string;
  ring: string;
}[] = [
  { cat: 'total',     label: 'Total Imported', getValue: s => s.total,     color: 'text-[var(--ff-text-primary)]', ring: 'ring-[var(--ff-accent)]' },
  { cat: 'activated', label: 'Activated',       getValue: s => s.activated, color: 'text-green-400',               ring: 'ring-green-400' },
  { cat: 'located',   label: 'Located',         getValue: s => s.located,   color: 'text-blue-400',                ring: 'ring-blue-400' },
  { cat: 'not_found', label: 'Not Found',       getValue: s => s.notFound,  color: 'text-amber-400',               ring: 'ring-amber-400' },
  { cat: 'ticketed',  label: 'Ticketed',        getValue: s => s.ticketed,  color: 'text-orange-400',              ring: 'ring-orange-400' },
];

export function PPStatsBar({ stats, activeCard, onCardClick }: PPStatsBarProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 px-4 py-3 border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)]/35">
      {STAT_CARDS.map(({ cat, label, getValue, color, ring }) => {
        const isActive = activeCard === cat;
        return (
          <button
            key={cat}
            onClick={() => onCardClick(cat)}
            className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border text-left transition-all cursor-pointer ${
              isActive
                ? `border-transparent ring-2 ${ring}`
                : 'border-[var(--ff-border-light)] hover:border-[var(--ff-text-tertiary)]'
            }`}
          >
            <div className={`text-2xl font-bold ${color}`}>{getValue(stats)}</div>
            <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
          </button>
        );
      })}

      {/* PP-specific: Last Import (non-clickable) */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] text-left">
        <div className="text-sm text-[var(--ff-text-secondary)] mb-1">Last Import</div>
        <div className="text-sm font-medium text-[var(--ff-text-primary)] truncate">
          {stats.lastImport ? formatDisplayDate(stats.lastImport.date) : 'Never'}
        </div>
        {stats.lastImport && (
          <div className="text-xs text-[var(--ff-text-tertiary)] truncate mt-0.5">
            {stats.lastImport.totalRows} rows
          </div>
        )}
      </div>
    </div>
  );
}
