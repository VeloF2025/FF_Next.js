/**
 * SnagCountTiles — 5 summary count tiles for the snag list view.
 * Updates when project/category/severity filters change.
 * Status filter is intentionally excluded so the breakdown is always visible.
 */

'use client';

import type { SnagSummary } from '../../services/snagService';

interface SnagCountTilesProps {
  summary: SnagSummary | null;
  isLoading: boolean;
}

interface TileConfig {
  label: string;
  key: keyof SnagSummary;
  container: string;
  value: string;
}

const TILES: TileConfig[] = [
  {
    label: 'Total',
    key: 'total',
    container: 'bg-zinc-800/60 border-zinc-700',
    value: 'text-zinc-100',
  },
  {
    label: 'Open',
    key: 'open',
    container: 'bg-red-900/20 border-red-800/40',
    value: 'text-red-300',
  },
  {
    label: 'Assigned',
    key: 'assigned',
    container: 'bg-blue-900/20 border-blue-800/40',
    value: 'text-blue-300',
  },
  {
    label: 'In Progress',
    key: 'in_progress',
    container: 'bg-amber-900/20 border-amber-800/40',
    value: 'text-amber-300',
  },
  {
    label: 'Pending QA',
    key: 'pending_qa',
    container: 'bg-purple-900/20 border-purple-800/40',
    value: 'text-purple-300',
  },
  {
    label: 'Resolved',
    key: 'resolved',
    container: 'bg-green-900/20 border-green-800/40',
    value: 'text-green-300',
  },
  {
    label: 'Critical',
    key: 'critical',
    container: 'bg-orange-900/20 border-orange-800/40',
    value: 'text-orange-300',
  },
];

function SkeletonNumber() {
  return <div className="h-7 w-16 rounded bg-zinc-700 animate-pulse mt-0.5" />;
}

/** 5 filter-aware count tiles */
export function SnagCountTiles({ summary, isLoading }: SnagCountTilesProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {TILES.map((tile) => (
        <div
          key={tile.key}
          className={`rounded-lg border p-4 flex flex-col gap-1 ${tile.container}`}
        >
          <p className="text-xs text-zinc-400 font-medium">{tile.label}</p>
          {isLoading || summary === null ? (
            <SkeletonNumber />
          ) : (
            <span className={`text-2xl font-bold tabular-nums ${tile.value}`}>
              {summary[tile.key].toLocaleString()}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
