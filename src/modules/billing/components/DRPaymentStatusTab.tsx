/**
 * DRPaymentStatusTab
 * Shows deductions from the latest billing week per project.
 * Fetches GET /api/billing/weekly?project=X to get latest week ID,
 * then GET /api/billing/reconcile?id=<id> for the deduction detail.
 *
 * CRITICAL: Metrics are anchored to latest week per project — never summed
 * across weeks. Currently excluded = DISTINCT dr_number from latest week's
 * ft_billing_deductions only.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, Loader2, Search } from 'lucide-react';
import type { FtBillingDeduction } from '@/modules/data-sync/types';

type Project = 'Lawley' | 'Mohadin' | 'Mamelodi';
type PaymentStatusFilter = 'all' | 'note1' | 'note2' | 'note3' | 'note4' | 'note5';

const PROJECTS: Project[] = ['Lawley', 'Mohadin', 'Mamelodi'];

const NOTE_BADGE: Record<FtBillingDeduction['deduction_note'], string> = {
  note1: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  note2: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  note3: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  note4: 'bg-red-500/10 text-red-400 border-red-500/20',
  note5: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

const NOTE_LABELS: Record<FtBillingDeduction['deduction_note'], string> = {
  note1: 'Low Signal',
  note2: 'No Field App',
  note3: 'Degraded',
  note4: 'Serial Mismatch',
  note5: 'Offline',
};

const NOTE_TIPS: Record<FtBillingDeduction['deduction_note'], string> = {
  note1: 'FT Note 1: Below -26dB threshold',
  note2: 'FT Note 2: No DR submission on field app',
  note3: 'FT Note 3: Signal degraded >2dB vs budget',
  note4: 'FT Note 4: Drop# / ONT serial mismatch',
  note5: 'FT Note 5: Device not active / fiber break',
};

// 🟢 WORKING: DR deduction list for the latest billing week per project
export function DRPaymentStatusTab() {
  const [project, setProject] = useState<Project>('Lawley');
  const [noteFilter, setNoteFilter] = useState<PaymentStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [deductions, setDeductions] = useState<FtBillingDeduction[]>([]);
  const [latestWeekEnding, setLatestWeekEnding] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load latest week then its deductions ─────────────────────────────────

  const loadDeductions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDeductions([]);
    setLatestWeekEnding(null);

    try {
      // Step 1: get latest week for the selected project
      const weeklyRes = await fetch(
        `/api/billing/weekly?project=${encodeURIComponent(project)}&limit=1`
      );
      if (!weeklyRes.ok) throw new Error('Failed to load weekly billing records');

      const weeklyData = await weeklyRes.json();
      const rows: Array<{ id: string; week_ending: string }> = weeklyData.data ?? [];

      if (rows.length === 0) {
        setLoading(false);
        return;
      }

      const firstRow = rows[0];
      if (!firstRow) {
        setLoading(false);
        return;
      }
      const latestId = firstRow.id;
      setLatestWeekEnding(firstRow.week_ending);

      // Step 2: get deductions for that week
      const deductRes = await fetch(
        `/api/billing/reconcile?id=${encodeURIComponent(latestId)}`
      );
      if (!deductRes.ok) throw new Error('Failed to load deduction detail');

      const deductData = await deductRes.json();
      setDeductions(deductData.data?.deductions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    loadDeductions();
  }, [loadDeductions]);

  // ── Filtered view ────────────────────────────────────────────────────────

  const filtered = deductions.filter((d) => {
    const matchesNote =
      noteFilter === 'all' || d.deduction_note === noteFilter;
    const matchesSearch =
      !search ||
      d.dr_number.toLowerCase().includes(search.toLowerCase()) ||
      (d.serial_number ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (d.team ?? '').toLowerCase().includes(search.toLowerCase());
    return matchesNote && matchesSearch;
  });

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Project */}
        <select
          value={project}
          onChange={(e) => setProject(e.target.value as Project)}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
        >
          {PROJECTS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {/* Note type */}
        <select
          value={noteFilter}
          onChange={(e) => setNoteFilter(e.target.value as PaymentStatusFilter)}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
        >
          <option value="all">All Notes</option>
          <option value="note1">Low Signal</option>
          <option value="note2">No Field App</option>
          <option value="note3">Degraded</option>
          <option value="note4">Serial Mismatch</option>
          <option value="note5">Offline</option>
        </select>

        {/* DR / serial search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search DR, serial, team…"
            className="w-full pl-9 pr-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
          />
        </div>
      </div>

      {/* Context */}
      {latestWeekEnding && !loading && (
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          Showing deductions from latest week ending{' '}
          <span className="font-medium text-[var(--ff-text-secondary)]">
            {formatDate(latestWeekEnding)}
          </span>{' '}
          · {project} · {filtered.length} of {deductions.length} shown
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
          <span className="text-[var(--ff-text-secondary)]">Loading…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && deductions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CreditCard className="w-10 h-10 mb-3 opacity-30 text-[var(--ff-text-tertiary)]" />
          <p className="text-[var(--ff-text-secondary)]">
            No deductions found for the latest {project} billing week
          </p>
        </div>
      )}

      {/* Deductions Table */}
      {!loading && filtered.length > 0 && (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    DR Number
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Note Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Serial
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Team
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {filtered.map((d) => (
                  <tr
                    key={d.id}
                    className="hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[var(--ff-text-primary)]">
                      {d.dr_number}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        title={NOTE_TIPS[d.deduction_note]}
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border cursor-help ${NOTE_BADGE[d.deduction_note]}`}
                      >
                        {NOTE_LABELS[d.deduction_note]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--ff-text-secondary)] text-xs">
                      {d.serial_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                      {d.team ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-xs max-w-xs truncate">
                      {d.deduction_reason ?? '—'}
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
