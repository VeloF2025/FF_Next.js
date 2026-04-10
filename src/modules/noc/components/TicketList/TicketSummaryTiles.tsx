/**
 * TicketSummaryTiles — compact stat tiles shown above the ticket list.
 * Uses the lightweight /api/noc/tickets/summary endpoint (single GROUP BY)
 * instead of fetching thousands of rows just for counts.
 *
 * 🟢 WORKING: Reactive to all filters — re-fetches on filter change
 * Shows both status breakdown tiles and T1 category breakdown.
 */

'use client';

import { useMemo } from 'react';
import { useTicketSummary } from '../../hooks/useTicketSummary';
import { TicketStatus } from '../../types/ticket';
import type { TicketFilters } from '../../types/ticket';
import {
  T1_CATEGORY_MAP,
  T1_LABELS,
  type T1Category,
} from '../../constants/ticketCategories';

interface Props {
  filters: TicketFilters;
}

interface Tile {
  label: string;
  value: number | string;
  color: string;
  bg: string;
}

/** T1 category tile styling */
const T1_STYLES: Record<T1Category, { color: string; bg: string }> = {
  snags:           { color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/20' },
  non_invoiceable: { color: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/20' },
  hse:             { color: 'text-red-400',      bg: 'bg-red-500/10 border-red-500/20' },
  devops:          { color: 'text-violet-400',   bg: 'bg-violet-500/10 border-violet-500/20' },
  sales:           { color: 'text-emerald-400',  bg: 'bg-emerald-500/10 border-emerald-500/20' },
  modification:    { color: 'text-cyan-400',     bg: 'bg-cyan-500/10 border-cyan-500/20' },
  fibertime:       { color: 'text-blue-400',     bg: 'bg-blue-500/10 border-blue-500/20' },
  unspecified:     { color: 'text-gray-400',     bg: 'bg-gray-500/10 border-gray-500/20' },
};

/** Status groups for the tiles */
const STATUS_GROUPS: { label: string; statuses: TicketStatus[]; color: string; bg: string }[] = [
  {
    label: 'Open',
    statuses: [TicketStatus.OPEN],
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
  },
  {
    label: 'In Progress',
    statuses: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS],
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
  },
  {
    label: 'QA',
    statuses: [
      TicketStatus.PENDING_QA,
      TicketStatus.QA_IN_PROGRESS,
      TicketStatus.QA_REJECTED,
      TicketStatus.QA_APPROVED,
    ],
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/20',
  },
  {
    label: 'Handover',
    statuses: [TicketStatus.PENDING_HANDOVER, TicketStatus.HANDED_TO_OPS],
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
  },
  {
    label: 'Resolved',
    statuses: [TicketStatus.RESOLVED],
    color: 'text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
  },
  {
    label: 'Closed',
    statuses: [TicketStatus.CLOSED, TicketStatus.CANCELLED],
    color: 'text-gray-400',
    bg: 'bg-gray-500/10 border-gray-500/20',
  },
];

export function TicketSummaryTiles({ filters }: Props) {
  const { counts, typeCounts, total, isLoading } = useTicketSummary(filters);

  const statusTiles: Tile[] = useMemo(() => {
    const groups = STATUS_GROUPS.map((group) => ({
      label: group.label,
      value: group.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0),
      color: group.color,
      bg: group.bg,
    }));

    const totalTile: Tile = {
      label: 'Total',
      value: total,
      color: 'text-white',
      bg: 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)]',
    };

    return [totalTile, ...groups];
  }, [counts, total]);

  /** Aggregate typeCounts into T1 category buckets */
  const categoryTiles: Tile[] = useMemo(() => {
    const buckets: Record<T1Category, number> = {
      snags: 0, non_invoiceable: 0, hse: 0, devops: 0,
      sales: 0, modification: 0, fibertime: 0, unspecified: 0,
    };

    for (const [ticketType, count] of Object.entries(typeCounts)) {
      const cat = T1_CATEGORY_MAP[ticketType] ?? 'unspecified';
      buckets[cat] += count;
    }

    return (Object.keys(buckets) as T1Category[])
      .filter((cat) => buckets[cat] > 0)
      .map((cat) => ({
        label: T1_LABELS[cat],
        value: buckets[cat],
        color: T1_STYLES[cat].color,
        bg: T1_STYLES[cat].bg,
      }));
  }, [typeCounts]);

  if (isLoading && total === 0) {
    return (
      <div className="space-y-2 mb-3">
        <div className="flex gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-14 flex-1 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] animate-pulse"
            />
          ))}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 flex-1 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 mb-3">
      {/* Status breakdown */}
      <div className="flex gap-2 flex-wrap">
        {statusTiles.map((tile) => (
          <div
            key={tile.label}
            className={`flex-1 min-w-[80px] rounded-lg border px-3 py-2 ${tile.bg}`}
          >
            <div className={`text-xl font-bold tabular-nums ${tile.color}`}>
              {typeof tile.value === 'number' ? tile.value.toLocaleString() : tile.value}
            </div>
            <div className="text-[11px] text-[var(--ff-text-tertiary)] mt-0.5 whitespace-nowrap">
              {tile.label}
            </div>
          </div>
        ))}
      </div>

      {/* T1 category breakdown */}
      {categoryTiles.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center text-[10px] text-[var(--ff-text-tertiary)] uppercase tracking-wide pr-1 self-center">
            By&nbsp;Category
          </div>
          {categoryTiles.map((tile) => (
            <div
              key={tile.label}
              className={`flex-1 min-w-[80px] rounded-lg border px-3 py-1.5 ${tile.bg}`}
            >
              <div className={`text-lg font-bold tabular-nums ${tile.color}`}>
                {typeof tile.value === 'number' ? tile.value.toLocaleString() : tile.value}
              </div>
              <div className="text-[10px] text-[var(--ff-text-tertiary)] mt-0.5 whitespace-nowrap">
                {tile.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
