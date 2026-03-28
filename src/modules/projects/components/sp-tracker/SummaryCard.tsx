/**
 * SP Tracker Summary Card Component
 */

import type { ReactNode } from 'react';

interface SummaryCardProps {
  label: string;
  scope: number | null;
  complete: number | null;
  pct: number | null;
}

export function SummaryCard({
  label,
  scope,
  complete,
  pct,
}: SummaryCardProps): ReactNode {
  const percent = pct ? Math.round(Number(pct) * 100) : 0;
  const color =
    percent === 0
      ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
      : percent < 25
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      : percent < 75
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';

  return (
    <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-gray-200 dark:border-slate-700 flex flex-col gap-2">
      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold ${color}`}>{percent}%</span>
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {complete ?? 0} / {scope ?? 0}
        </span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${
            percent < 25
              ? 'bg-red-500'
              : percent < 75
              ? 'bg-amber-500'
              : 'bg-green-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
