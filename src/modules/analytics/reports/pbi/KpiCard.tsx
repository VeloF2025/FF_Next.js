/**
 * KpiCard + KpiRow — PBI-style headline KPI cards.
 * Green up-arrow for positive, red down-arrow for negative.
 */
'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PBI } from './pbiTheme';

export interface KpiCardProps {
  label: string;
  value: string;
  trend?: 'positive' | 'negative' | 'neutral';
  sub?: string;
}

export function KpiCard({ label, value, trend = 'neutral', sub }: KpiCardProps) {
  const TrendIcon = trend === 'positive' ? TrendingUp : trend === 'negative' ? TrendingDown : Minus;
  const trendColor = trend === 'positive' ? PBI.positive : trend === 'negative' ? PBI.negative : '#6B7280';

  return (
    <div
      className="flex flex-col gap-1 rounded-lg px-4 py-3 min-w-[140px]"
      style={{ backgroundColor: PBI.surface, border: `1px solid ${PBI.border}` }}
    >
      <span className="text-xs font-medium uppercase tracking-wider" style={{ color: PBI.textMuted }}>
        {label}
      </span>
      <div className="flex items-end gap-2">
        <span className="text-xl font-bold leading-none" style={{ color: PBI.textPrimary }}>
          {value}
        </span>
        <TrendIcon className="w-4 h-4 mb-0.5 flex-shrink-0" style={{ color: trendColor }} />
      </div>
      {sub && <span className="text-xs" style={{ color: PBI.textMuted }}>{sub}</span>}
    </div>
  );
}

export function KpiRow({ cards }: { cards: KpiCardProps[] }) {
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {cards.map((c) => <KpiCard key={c.label} {...c} />)}
    </div>
  );
}
