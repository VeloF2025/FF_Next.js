/**
 * WeeklySummaryTab
 * Shows top-level billing metrics + a table of all ft_weekly_billing rows.
 * Metrics are anchored to the latest week per project (display-only snapshots —
 * never summed across weeks per the critical rules).
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3, Clock, CheckCircle, AlertCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import type { FtWeeklyBilling } from '@/modules/data-sync/types';

interface BillableProjectOption {
  id: string;
  name: string;
}

interface BillingStatusMetrics {
  currentlyExcluded: number;    // DISTINCT dr_number from latest week's ft_billing_deductions
  ppOutstanding: number;        // pre-provisioned DRs not yet resolved
  recoveredThisMonth: number;   // deductions reversed in current calendar month
}

const STATUS_BADGE: Record<FtWeeklyBilling['reconciliation_status'], string> = {
  pending:    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  reconciled: 'bg-green-500/10 text-green-400 border-green-500/20',
  disputed:   'bg-red-500/10 text-red-400 border-red-500/20',
};

// 🟢 WORKING: Weekly summary with metric cards + filterable table
export function WeeklySummaryTab() {
  const [projectFilter, setProjectFilter] = useState<string>('All');
  const [rows, setRows] = useState<FtWeeklyBilling[]>([]);
  const [metrics, setMetrics] = useState<BillingStatusMetrics | null>(null);
  const [projectOptions, setProjectOptions] = useState<BillableProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Expanded weeks by week_ending ISO date. Empty set = all collapsed. */
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  const toggleWeek = (weekEnding: string) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekEnding)) {
        next.delete(weekEnding);
      } else {
        next.add(weekEnding);
      }
      return next;
    });
  };

  // Lazy-load billable project list for the filter dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/billing/projects');
        if (!res.ok) return;
        const data: Record<string, unknown> = await res.json();
        const payload = (data.data ?? data) as { projects?: BillableProjectOption[] };
        if (!cancelled && Array.isArray(payload.projects)) {
          setProjectOptions(payload.projects);
        }
      } catch {
        /* silent — dropdown just won't list extras */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch data ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (projectFilter !== 'All') params.set('project', projectFilter);

        const statusParams = new URLSearchParams();
        if (projectFilter !== 'All') statusParams.set('project', projectFilter);

        const [weeklyRes, statusRes] = await Promise.all([
          fetch(`/api/billing/weekly?${params.toString()}`),
          fetch(`/api/billing/status?${statusParams.toString()}`),
        ]);

        if (!weeklyRes.ok) throw new Error('Failed to load weekly records');
        if (!statusRes.ok) throw new Error('Failed to load billing status');

        const weeklyData = await weeklyRes.json();
        const statusData = await statusRes.json();

        if (!cancelled) {
          setRows(weeklyData.data ?? []);
          const totals = statusData.data?.totals;
          setMetrics(totals ? {
            currentlyExcluded: totals.currently_excluded ?? 0,
            ppOutstanding: totals.pp_outstanding ?? 0,
            recoveredThisMonth: totals.recovered_this_month ?? 0,
          } : null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [projectFilter]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const formatCurrency = (val: number | null) =>
    val == null
      ? '—'
      : `R ${val.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  // Group rows by week_ending so we can render per-week totals underneath
  // the per-project rows for that week.
  const weekGroups = useMemo(() => {
    const map = new Map<string, FtWeeklyBilling[]>();
    for (const r of rows) {
      const arr = map.get(r.week_ending) ?? [];
      arr.push(r);
      map.set(r.week_ending, arr);
    }
    // Sort weeks descending so newest appears first
    return [...map.entries()].sort((a, b) =>
      a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0,
    );
  }, [rows]);

  const sumField = (items: FtWeeklyBilling[], key: keyof FtWeeklyBilling): number =>
    items.reduce((acc, r) => acc + (Number(r[key] ?? 0) || 0), 0);

  const sumInvoice = (items: FtWeeklyBilling[]): number | null => {
    let total = 0;
    let anyValue = false;
    for (const r of items) {
      if (r.invoice_total != null) {
        total += Number(r.invoice_total);
        anyValue = true;
      }
    }
    return anyValue ? total : null;
  };

  // "Currently Excluded" KPI — derived from the latest week's rows so it
  // matches the week-totals row in the table below. Excludes pre-provisions
  // (those are a separate withhold category, not a deduction).
  const latestWeekRows = weekGroups[0]?.[1] ?? [];
  const currentlyExcludedFromRows =
    sumField(latestWeekRows, 'ft_note1_count') +
    sumField(latestWeekRows, 'ft_note2_count') +
    sumField(latestWeekRows, 'ft_note4_count') +
    sumField(latestWeekRows, 'ft_note5_count');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Metric Cards — display-only snapshots from latest week */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-xs font-medium text-red-400 uppercase tracking-wide">
              Currently Excluded
            </span>
          </div>
          <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
            {loading ? (
              <InlineSpinner size="md" />
            ) : (
              currentlyExcludedFromRows.toLocaleString()
            )}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            N1 + N2 + N4 + N5 across latest week
          </p>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-400 uppercase tracking-wide">
              PP Outstanding
            </span>
          </div>
          <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
            {loading ? (
              <InlineSpinner size="md" />
            ) : (
              (metrics?.ppOutstanding ?? '—')
            )}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Pre-provisioned, not yet resolved</p>
        </div>

        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-green-400 uppercase tracking-wide">
              Recovered This Month
            </span>
          </div>
          <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
            {loading ? (
              <InlineSpinner size="md" />
            ) : (
              (metrics?.recoveredThisMonth ?? '—')
            )}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Deductions reversed in current month</p>
        </div>
      </div>

      {/* Project filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-[var(--ff-text-secondary)]">Project:</label>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
        >
          <option value="All">All</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-3">
          <InlineSpinner size="md" />
          <span className="text-[var(--ff-text-secondary)]">Loading…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BarChart3 className="w-10 h-10 mb-3 opacity-30 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">No billing records found</p>
        </div>
      ) : (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">Week Ending</th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">Project</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">FT ONTs</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">Claimable</th>
                  <th
                    className="px-3 py-3 text-right text-xs font-medium text-orange-300 uppercase tracking-wide"
                    title="Note 1: Lower than -26dB threshold"
                  >
                    N1 -26dB
                  </th>
                  <th
                    className="px-3 py-3 text-right text-xs font-medium text-blue-300 uppercase tracking-wide"
                    title="Note 2: No entry/submission on Field App"
                  >
                    N2 NoApp
                  </th>
                  <th
                    className="px-3 py-3 text-right text-xs font-medium text-red-300 uppercase tracking-wide"
                    title="Note 4: Inaccurate — Drop# & ONT SN does not match to OLT"
                  >
                    N4 SN≠Drop
                  </th>
                  <th
                    className="px-3 py-3 text-right text-xs font-medium text-purple-300 uppercase tracking-wide"
                    title="Note 5: Fiber Break / Device Not Active"
                  >
                    N5 Offline
                  </th>
                  <th
                    className="px-3 py-3 text-right text-xs font-medium text-cyan-300 uppercase tracking-wide"
                    title="Pre-provisioned ONTs (20% withheld)"
                  >
                    Pre-Prov
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">FT Paid</th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">Invoice Total</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {weekGroups.map(([weekEnding, weekRows]) => {
                  const isExpanded = expandedWeeks.has(weekEnding);
                  return (
                    <React.Fragment key={weekEnding}>
                      {/* Week total row — always rendered, clickable to expand */}
                      <tr
                        className="bg-[var(--ff-bg-tertiary)] font-semibold cursor-pointer hover:bg-[var(--ff-bg-secondary)] transition-colors"
                        onClick={() => toggleWeek(weekEnding)}
                        aria-expanded={isExpanded}
                      >
                        <td className="px-3 py-2.5 text-[var(--ff-text-primary)] whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
                            )}
                            {formatDate(weekEnding)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--ff-text-secondary)] italic">
                          Week total ({weekRows.length} project{weekRows.length === 1 ? '' : 's'})
                        </td>
                        <td className="px-3 py-2.5 text-right text-[var(--ff-text-primary)] tabular-nums">
                          {sumField(weekRows, 'ft_total_onts').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[var(--ff-text-primary)] tabular-nums">
                          {sumField(weekRows, 'ft_claimable').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-orange-300 tabular-nums">
                          {sumField(weekRows, 'ft_note1_count').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-blue-300 tabular-nums">
                          {sumField(weekRows, 'ft_note2_count').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-red-300 tabular-nums">
                          {sumField(weekRows, 'ft_note4_count').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-purple-300 tabular-nums">
                          {sumField(weekRows, 'ft_note5_count').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-cyan-300 tabular-nums">
                          {sumField(weekRows, 'ft_pre_provisions_count').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[var(--ff-text-secondary)] tabular-nums">
                          {sumField(weekRows, 'ft_total_claimable').toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[var(--ff-text-primary)] tabular-nums">
                          {formatCurrency(sumInvoice(weekRows))}
                        </td>
                        <td className="px-3 py-2.5" />
                      </tr>

                      {/* Per-project breakdown — only rendered when expanded */}
                      {isExpanded && weekRows.map((row) => (
                        <tr
                          key={row.id}
                          className="bg-[var(--ff-bg-secondary)]/50 hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                        >
                          <td className="px-3 py-3 text-[var(--ff-text-tertiary)] whitespace-nowrap pl-10">
                            {formatDate(row.week_ending)}
                          </td>
                          <td className="px-3 py-3 text-[var(--ff-text-secondary)] whitespace-nowrap">
                            {row.project}
                          </td>
                          <td className="px-3 py-3 text-right text-[var(--ff-text-primary)] tabular-nums">
                            {row.ft_total_onts.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-[var(--ff-text-primary)] tabular-nums">
                            {row.ft_claimable.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-orange-300 tabular-nums">
                            {row.ft_note1_count.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-blue-300 tabular-nums">
                            {row.ft_note2_count.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-red-300 tabular-nums">
                            {row.ft_note4_count.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-purple-300 tabular-nums">
                            {row.ft_note5_count.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-cyan-300 tabular-nums">
                            {row.ft_pre_provisions_count.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-[var(--ff-text-secondary)] tabular-nums">
                            {row.ft_total_claimable.toLocaleString()}
                          </td>
                          <td className="px-3 py-3 text-right text-[var(--ff-text-primary)] tabular-nums">
                            {formatCurrency(row.invoice_total)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[row.reconciliation_status]}`}
                            >
                              {row.reconciliation_status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
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
