/**
 * UptakeReport — PON-level activation % vs target for the selected project.
 *
 * Reuses /api/reports/uptake for data and /api/reports/uptake-pdf for PDF
 * download (dark-themed A4 built from the shared ReportTemplate).
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Gauge } from 'lucide-react';
import type { ReportFilters } from '../../types/reporting.types';
import type { UptakePon, UptakeReportPayload } from '../../../../../pages/api/reports/uptake';

interface UptakeReportProps {
  filters: ReportFilters;
  refreshKey: number;
}

interface PonRow {
  pon: string;
  drops: number;
  active: number;
  pct: number;
  status: 'good' | 'warning' | 'bad';
}

const TARGET_FALLBACK = 65;

function statusFor(pct: number, target: number): PonRow['status'] {
  if (pct >= target) return 'good';
  if (pct >= target * 0.8) return 'warning';
  return 'bad';
}

export function UptakeReport({ filters, refreshKey }: UptakeReportProps) {
  const [data, setData] = useState<UptakeReportPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filters.project) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reports/uptake?project=${encodeURIComponent(filters.project!)}`
        );
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData((json.data ?? json) as UptakeReportPayload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load uptake data');
          setData(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filters.project, refreshKey]);

  const { rows, totals } = useMemo(() => {
    const target = data?.targetPct ?? TARGET_FALLBACK;
    const ponRows: PonRow[] = (data?.pons ?? []).map((p: UptakePon) => {
      const pct = p.drops > 0 ? (p.active / p.drops) * 100 : 0;
      return {
        pon: p.pon,
        drops: p.drops,
        active: p.active,
        pct,
        status: statusFor(pct, target),
      };
    });
    ponRows.sort((a, b) => b.pct - a.pct);

    const totalDrops = ponRows.reduce((s, r) => s + r.drops, 0);
    const totalActive = ponRows.reduce((s, r) => s + r.active, 0);
    const uptakePct = totalDrops > 0 ? (totalActive / totalDrops) * 100 : 0;

    return {
      rows: ponRows,
      totals: {
        target,
        totalDrops,
        totalActive,
        remaining: totalDrops - totalActive,
        uptakePct,
        gap: uptakePct - target,
      },
    };
  }, [data]);

  const pdfUrl = filters.project
    ? `/api/reports/uptake-pdf?project=${encodeURIComponent(filters.project)}`
    : '';

  // ── Empty state: no project selected ──
  if (!filters.project) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-muted-foreground">
          <Gauge className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select a specific project to view uptake.</p>
          <p className="text-sm mt-2">Uptake is computed per PON and needs a single project scope.</p>
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-secondary rounded w-1/3"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-secondary rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-secondary rounded"></div>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      </div>
    );
  }

  // ── No data ──
  if (!data || rows.length === 0) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-muted-foreground">
          <Gauge className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No PON data found for {filters.project}.</p>
          <p className="text-sm mt-2">Make sure drops have been imported and PON numbers assigned.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Uptake · {data.projectName}
          </h3>
          <p className="text-sm text-muted-foreground">
            {rows.length} PON{rows.length === 1 ? '' : 's'} · target {totals.target}%
          </p>
        </div>
        <a
          href={pdfUrl}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download PDF
        </a>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Drops"
          value={totals.totalDrops.toLocaleString('en-ZA')}
          subtext={`${rows.length} PONs`}
          color="blue"
        />
        <SummaryCard
          label="Activated"
          value={totals.totalActive.toLocaleString('en-ZA')}
          subtext={`Remaining: ${totals.remaining.toLocaleString('en-ZA')}`}
          color="green"
        />
        <SummaryCard
          label="Uptake %"
          value={`${totals.uptakePct.toFixed(1)}%`}
          subtext={`${totals.gap >= 0 ? '+' : ''}${totals.gap.toFixed(1)} pts vs target`}
          color={totals.uptakePct >= totals.target ? 'green' : totals.uptakePct >= totals.target * 0.8 ? 'orange' : 'red'}
        />
        <SummaryCard
          label="Target"
          value={`${totals.target.toFixed(0)}%`}
          subtext="Project goal"
          color="purple"
        />
      </div>

      {/* Bar chart */}
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-foreground">Uptake per PON</h4>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-3.5 h-0 border-t-[1.5px] border-dashed border-muted-foreground" />
            {totals.target}% target
          </div>
        </div>
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.pon}
              className="grid grid-cols-[90px_1fr_60px] items-center gap-3 text-sm"
            >
              <span className="text-muted-foreground">{r.pon}</span>
              <div className="relative h-5 bg-secondary rounded overflow-visible">
                <div
                  className={`h-full rounded transition-all ${
                    r.status === 'good'
                      ? 'bg-emerald-500'
                      : r.status === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, r.pct))}%` }}
                />
                <div
                  className="absolute -top-0.5 -bottom-0.5 border-l-[1.5px] border-dashed border-muted-foreground"
                  style={{ left: `${totals.target}%` }}
                />
              </div>
              <span className="text-right font-medium text-foreground">
                {r.pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-sm font-semibold text-foreground">PON Status Overview</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground bg-secondary/40">
                <th className="px-4 py-2.5">PON</th>
                <th className="px-4 py-2.5 text-right">Drops</th>
                <th className="px-4 py-2.5 text-right">Active</th>
                <th className="px-4 py-2.5 text-right">Uptake %</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.pon}
                  className={i % 2 === 0 ? 'bg-card' : 'bg-secondary/30'}
                >
                  <td className="px-4 py-2 text-foreground">{r.pon}</td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {r.drops.toLocaleString('en-ZA')}
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">
                    {r.active.toLocaleString('en-ZA')}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-foreground">
                    {r.pct.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

type SummaryColor = 'blue' | 'green' | 'orange' | 'purple' | 'red';

interface SummaryCardProps {
  label: string;
  value: string;
  subtext: string;
  color: SummaryColor;
}

function SummaryCard({ label, value, subtext, color }: SummaryCardProps) {
  const bg: Record<SummaryColor, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    orange: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
    purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800',
    red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  };
  const fg: Record<SummaryColor, string> = {
    blue: 'text-blue-700 dark:text-blue-300',
    green: 'text-green-700 dark:text-green-300',
    orange: 'text-orange-700 dark:text-orange-300',
    purple: 'text-purple-700 dark:text-purple-300',
    red: 'text-red-700 dark:text-red-300',
  };
  return (
    <div className={`rounded-lg border p-4 ${bg[color]}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${fg[color]}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
    </div>
  );
}

function StatusPill({ status }: { status: PonRow['status'] }) {
  const map: Record<PonRow['status'], { label: string; cls: string; dot: string }> = {
    good: {
      label: 'On Track',
      cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      dot: 'bg-emerald-500',
    },
    warning: {
      label: 'At Risk',
      cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
      dot: 'bg-amber-500',
    },
    bad: {
      label: 'Critical',
      cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
      dot: 'bg-rose-500',
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
