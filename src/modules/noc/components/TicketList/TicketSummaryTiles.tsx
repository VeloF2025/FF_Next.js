/**
 * TicketSummaryTiles — compact stat tiles shown above the ticket list.
 * Uses the lightweight /api/noc/tickets/summary endpoint (single GROUP BY)
 * instead of fetching thousands of rows just for counts.
 *
 * 🟢 WORKING: Reactive to all filters — re-fetches on filter change
 */

'use client';

import { useMemo } from 'react';
import { useTicketSummary } from '../../hooks/useTicketSummary';
import { TicketStatus } from '../../types/ticket';
import type { TicketFilters } from '../../types/ticket';

interface Props {
  filters: TicketFilters;
}

interface Tile {
  label: string;
  value: number | string;
  color: string;
  bg: string;
}

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
  const { counts, total, isLoading } = useTicketSummary(filters);

  const tiles: Tile[] = useMemo(() => {
    const statusTiles: Tile[] = STATUS_GROUPS.map((group) => ({
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

    return [totalTile, ...statusTiles];
  }, [counts, total]);

  if (isLoading && total === 0) {
    return (
      <div className="flex gap-2 mb-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="h-14 flex-1 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-2 mb-3 flex-wrap">
      {tiles.map((tile) => (
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
  );
}
