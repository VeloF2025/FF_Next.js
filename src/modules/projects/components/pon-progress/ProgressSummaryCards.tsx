/**
 * Progress Summary Cards
 * Shows 4 category cards with target vs actual for PON progress
 */

import type { ProgressCategory } from '@/types/pon-stages.types';

interface CategorySummary {
  target: number;
  actual: number;
  pct: number;
}

interface ProgressSummaryCardsProps {
  summary: Record<ProgressCategory, CategorySummary>;
}

const CATEGORY_META: Record<ProgressCategory, { label: string; color: string; icon: string }> = {
  cwc: { label: 'CWC / Civil', color: '#F59E0B', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  optical: { label: 'Optical', color: '#10B981', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  activation: { label: 'Activation', color: '#3B82F6', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  maintenance: { label: 'Maintenance', color: '#F97316', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
};

const CATEGORIES: ProgressCategory[] = ['cwc', 'optical', 'activation', 'maintenance'];

export function ProgressSummaryCards({ summary }: ProgressSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {CATEGORIES.map((cat) => {
        const meta = CATEGORY_META[cat];
        const data = summary[cat];
        const pctWidth = Math.min(data.pct, 100);

        return (
          <div
            key={cat}
            className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${meta.color}20` }}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke={meta.color}
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={meta.icon} />
                </svg>
              </div>
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                {meta.label}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold" style={{ color: meta.color }}>
                  {data.pct}%
                </span>
                <span className="text-xs text-[var(--ff-text-secondary)]">
                  {data.actual}/{data.target}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-[var(--ff-bg-secondary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pctWidth}%`, backgroundColor: meta.color }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
