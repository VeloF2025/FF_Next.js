/**
 * WeeklySummaryTab
 * Shows top-level billing metrics + a table of all ft_weekly_billing rows.
 * Metrics are anchored to the latest week per project (display-only snapshots —
 * never summed across weeks per the critical rules).
 */

'use client';

import React, { useState, useEffect } from 'react';
import { BarChart3, Clock, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import type { FtWeeklyBilling } from '@/modules/data-sync/types';

type Project = 'All' | 'Lawley' | 'Mohadin' | 'Mamelodi';

const PROJECTS: Project[] = ['All', 'Lawley', 'Mohadin', 'Mamelodi'];

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
  const [projectFilter, setProjectFilter] = useState<Project>('All');
  const [rows, setRows] = useState<FtWeeklyBilling[]>([]);
  const [metrics, setMetrics] = useState<BillingStatusMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch data ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (projectFilter !== 'All') params.set('project', projectFilter);

        const [weeklyRes, statusRes] = await Promise.all([
          fetch(`/api/billing/weekly?${params.toString()}`),
          fetch('/api/billing/status'),
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
              <Loader2 className="w-6 h-6 animate-spin inline text-[var(--ff-text-tertiary)]" />
            ) : (
              (metrics?.currentlyExcluded ?? '—')
            )}
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Distinct DRs in latest week&apos;s deductions
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
              <Loader2 className="w-6 h-6 animate-spin inline text-[var(--ff-text-tertiary)]" />
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
              <Loader2 className="w-6 h-6 animate-spin inline text-[var(--ff-text-tertiary)]" />
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
          onChange={(e) => setProjectFilter(e.target.value as Project)}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
        >
          {PROJECTS.map((p) => (
            <option key={p} value={p}>
              {p}
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
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Week Ending
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Project
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    FT ONTs
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    FT Claimable
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    FT Paid
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Invoice Total
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    <td className="px-4 py-3 text-[var(--ff-text-primary)] font-medium">
                      {formatDate(row.week_ending)}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                      {row.project}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ff-text-primary)] tabular-nums">
                      {row.ft_total_onts.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ff-text-primary)] tabular-nums">
                      {row.ft_claimable.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)] tabular-nums">
                      {row.ft_total_claimable.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ff-text-primary)] tabular-nums">
                      {formatCurrency(row.invoice_total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[row.reconciliation_status]}`}
                      >
                        {row.reconciliation_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
