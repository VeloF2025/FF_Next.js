'use client';

/**
 * OverviewDashboard — Non-Invoiceable Action Centre summary view.
 * Fetches from GET /api/activate/non-invoiceables/overview and renders
 * category cards, KPI tiles, and a per-project breakdown table.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import {
  CATEGORY_COLORS,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  type NonInvoiceableCategory,
  type NonInvoiceableOverview,
} from '@/modules/non-invoiceables/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_CATEGORIES: NonInvoiceableCategory[] = [
  'pre_provision',
  'serial_mismatch',
  'offline',
  'low_signal',
  'degraded',
  'missing_dr',
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OverviewDashboardProps {
  project?: string;
  onCategoryClick: (category: NonInvoiceableCategory) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns Tailwind text-colour class based on a 0–100 rate. */
function rateColor(rate: number): string {
  if (rate > 80) return 'text-green-400';
  if (rate > 50) return 'text-amber-400';
  return 'text-red-400';
}

/** Extract the border accent colour from a CATEGORY_COLORS string (e.g. text-cyan-400 → border-cyan-400). */
function accentBorder(colorClass: string): string {
  const match = colorClass.match(/text-(\w+-\d+)/);
  return match ? `border-${match[1]}` : 'border-gray-600';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string | number;
  valueClass?: string;
  sub?: string;
}

/** 🟢 WORKING: Single KPI tile. */
function KpiCard({ label, value, valueClass = 'text-white', sub }: KpiCardProps) {
  return (
    <div className="bg-[#161b22] border border-gray-700 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
      <span className={`text-3xl font-bold ${valueClass}`}>{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** 🟢 WORKING: Overview dashboard for the Non-Invoiceable Action Centre. */
export function OverviewDashboard({ project, onCategoryClick }: OverviewDashboardProps) {
  const [overview, setOverview] = useState<NonInvoiceableOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      const res = await fetch(`/api/activate/non-invoiceables/overview?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load overview (${res.status})`);
      }
      const data = (await res.json()) as NonInvoiceableOverview;
      setOverview(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.error('OverviewDashboard: fetch failed', { error: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  // -- Loading --
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-gray-400">
        <InlineSpinner size="md" className="text-gray-400" />
        <span className="text-sm">Loading overview…</span>
      </div>
    );
  }

  // -- Error --
  if (error || !overview) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/30 p-6 text-red-400 text-sm">
        {error ?? 'No overview data available.'}
        <button
          onClick={() => void fetchOverview()}
          className="ml-4 underline hover:text-red-300 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const projectRows = Object.entries(overview.by_project).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* KPI row                                                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Coverage Rate"
          value={`${overview.coverage_rate.toFixed(1)}%`}
          valueClass={rateColor(overview.coverage_rate)}
          sub="Issues with an active ticket"
        />
        <KpiCard
          label="Resolution Rate"
          value={`${overview.resolution_rate.toFixed(1)}%`}
          valueClass={rateColor(overview.resolution_rate)}
          sub="Issues marked resolved"
        />
        <KpiCard
          label="Repeat Offenders"
          value={overview.repeat_offenders}
          valueClass={overview.repeat_offenders > 0 ? 'text-red-400' : 'text-green-400'}
          sub="DRs billed in 2+ distinct weeks"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Category cards — 3 × 2 grid                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ALL_CATEGORIES.map((cat) => {
          const summary = overview.by_category[cat];
          const colorClasses = CATEGORY_COLORS[cat];
          const border = accentBorder(colorClasses);
          const isDegraded = cat === 'degraded';

          return (
            <button
              key={cat}
              onClick={() => onCategoryClick(cat)}
              title={CATEGORY_DESCRIPTIONS[cat]}
              className={`bg-[#161b22] border border-l-4 ${border} border-gray-700 rounded-lg p-4 text-left hover:border-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0d1117] focus:ring-gray-500`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colorClasses}`}>
                  {CATEGORY_LABELS[cat]}
                </span>
                {isDegraded && (
                  <span className="text-xs bg-yellow-500/10 text-yellow-500 border border-yellow-700 px-2 py-0.5 rounded-full shrink-0">
                    Monitor Only
                  </span>
                )}
              </div>

              {/* Total count */}
              <p className="text-2xl font-bold text-white mb-3">
                {summary?.total ?? 0}
                <span className="text-sm font-normal text-gray-400 ml-1">total</span>
              </p>

              {/* Open / Ticketed / Resolved breakdown */}
              <div className="flex gap-3 text-xs">
                <span className="text-gray-400">
                  <span className="text-white font-medium">{summary?.open ?? 0}</span> open
                </span>
                <span className="text-gray-400">
                  <span className="text-blue-400 font-medium">{summary?.ticketed ?? 0}</span> ticketed
                </span>
                <span className="text-gray-400">
                  <span className="text-green-400 font-medium">{summary?.resolved ?? 0}</span> resolved
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Per-project breakdown                                               */}
      {/* ------------------------------------------------------------------ */}
      {projectRows.length > 0 && (
        <div className="bg-[#161b22] border border-gray-700 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">By Project</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="text-left pb-2 pr-4">Project</th>
                  <th className="text-right pb-2 pr-4">Total</th>
                  <th className="text-right pb-2 pr-4">Open</th>
                  <th className="text-right pb-2">Ticketed</th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map(([proj, summary]) => {
                  const pct = summary.total > 0
                    ? Math.round(((summary.total - summary.open) / summary.total) * 100)
                    : 0;
                  return (
                    <tr key={proj} className="border-b border-gray-800 last:border-0">
                      <td className="py-2 pr-4 text-white font-medium truncate max-w-[160px]">
                        {proj}
                      </td>
                      <td className="py-2 pr-4 text-right text-gray-300">{summary.total}</td>
                      <td className="py-2 pr-4 text-right text-gray-300">{summary.open}</td>
                      <td className="py-2 text-right">
                        <span className={rateColor(pct)}>{summary.ticketed}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
