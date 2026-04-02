/**
 * DRPaymentStatusTab
 * DR deduction lifecycle view — shows all DRs ever deducted by FiberTime,
 * whether they're currently excluded or recovered (paid when resolved).
 *
 * Uses GET /api/billing/dr-history for the lifecycle data.
 *
 * CRITICAL: Metrics anchored to latest week per project — never summed across weeks.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, Loader2, Search, CheckCircle, XCircle } from 'lucide-react';

type Project = 'All' | 'Lawley' | 'Mohadin' | 'Mamelodi';
type StatusFilter = 'all' | 'excluded' | 'recovered';
type NoteFilter = 'all' | 'note1' | 'note2' | 'note3' | 'note4' | 'note5';

const PROJECTS: Project[] = ['All', 'Lawley', 'Mohadin', 'Mamelodi'];

const NOTE_LABELS: Record<string, string> = {
  note1: 'Low Signal',
  note2: 'No Field App',
  note3: 'Degraded',
  note4: 'Serial Mismatch',
  note5: 'Offline',
};

const NOTE_BADGE: Record<string, string> = {
  note1: 'bg-orange-500/10 text-orange-400',
  note2: 'bg-blue-500/10 text-blue-400',
  note3: 'bg-yellow-500/10 text-yellow-400',
  note4: 'bg-red-500/10 text-red-400',
  note5: 'bg-purple-500/10 text-purple-400',
};

const NOTE_TIPS: Record<string, string> = {
  note1: 'FT Note 1: Below -26dB threshold',
  note2: 'FT Note 2: No DR submission on field app',
  note3: 'FT Note 3: Signal degraded >2dB vs budget',
  note4: 'FT Note 4: Drop# / ONT serial mismatch',
  note5: 'FT Note 5: Device not active / fiber break',
};

interface DRHistoryRow {
  dr_number: string;
  project: string;
  first_excluded: string;
  last_excluded: string;
  weeks_excluded: number;
  note_types: string[];
  current_status: 'excluded' | 'recovered';
  activation_date: string | null;
  oes_status: string | null;
  signal_dbm: number | null;
  has_dr_record: boolean;
  dr_review_status: string | null;
}

interface Summary {
  total_unique: number;
  still_excluded: number;
  recovered: number;
}

export function DRPaymentStatusTab() {
  const [project, setProject] = useState<Project>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<DRHistoryRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (project !== 'All') params.set('project', project);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (noteFilter !== 'all') params.set('note', noteFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/billing/dr-history?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load DR history');

      const data = await res.json();
      setRows(data.data?.rows ?? []);
      setTotal(data.data?.total ?? 0);
      setSummary(data.data?.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [project, statusFilter, noteFilter, search]);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className={`rounded-xl p-5 border cursor-pointer transition-colors ${
              statusFilter === 'all'
                ? 'bg-[var(--ff-bg-secondary)] border-[var(--ff-accent)]'
                : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] hover:border-[var(--ff-accent)]'
            }`}
            onClick={() => setStatusFilter('all')}
          >
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
              <span className="text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Total Unique DRs</span>
            </div>
            <p className="text-3xl font-bold text-[var(--ff-text-primary)]">{summary.total_unique}</p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Ever deducted{project !== 'All' ? ` for ${project}` : ' across all projects'}
            </p>
          </div>

          <div
            className={`rounded-xl p-5 border cursor-pointer transition-colors ${
              statusFilter === 'excluded'
                ? 'bg-red-500/5 border-red-500/30'
                : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] hover:border-red-500/30'
            }`}
            onClick={() => setStatusFilter(statusFilter === 'excluded' ? 'all' : 'excluded')}
          >
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs font-medium text-red-400 uppercase">Still Excluded</span>
            </div>
            <p className="text-3xl font-bold text-red-400">{summary.still_excluded}</p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              R{(summary.still_excluded * 2700).toLocaleString()} at risk
            </p>
          </div>

          <div
            className={`rounded-xl p-5 border cursor-pointer transition-colors ${
              statusFilter === 'recovered'
                ? 'bg-green-500/5 border-green-500/30'
                : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)] hover:border-green-500/30'
            }`}
            onClick={() => setStatusFilter(statusFilter === 'recovered' ? 'all' : 'recovered')}
          >
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-xs font-medium text-green-400 uppercase">Recovered</span>
            </div>
            <p className="text-3xl font-bold text-green-400">{summary.recovered}</p>
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">Fixed and back in paid pool</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={project}
          onChange={(e) => setProject(e.target.value as Project)}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)]"
        >
          {PROJECTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          value={noteFilter}
          onChange={(e) => setNoteFilter(e.target.value as NoteFilter)}
          className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)]"
        >
          <option value="all">All Types</option>
          <option value="note3">Degraded</option>
          <option value="note1">Low Signal</option>
          <option value="note2">No Field App</option>
          <option value="note5">Offline</option>
          <option value="note4">Serial Mismatch</option>
        </select>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search DR number..."
            className="w-full pl-9 pr-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]"
          />
        </div>

        <span className="text-xs text-[var(--ff-text-tertiary)]">{total} results</span>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && rows.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">DR Number</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Deduction Types</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Weeks Excluded</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">First Excluded</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Last Excluded</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Our Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {rows.map((r) => (
                  <tr key={r.dr_number} className="hover:bg-[var(--ff-bg-tertiary)] transition-colors">
                    <td className="px-4 py-3 font-mono text-[var(--ff-text-primary)]">{r.dr_number}</td>
                    <td className="px-4 py-3 text-center">
                      {r.current_status === 'excluded' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                          Excluded
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                          Recovered
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-wrap gap-1 justify-center">
                        {r.note_types.map((n) => (
                          <span
                            key={n}
                            title={NOTE_TIPS[n]}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-help ${NOTE_BADGE[n] || ''}`}
                          >
                            {NOTE_LABELS[n] || n}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${r.weeks_excluded >= 5 ? 'text-red-400' : r.weeks_excluded >= 3 ? 'text-amber-400' : 'text-[var(--ff-text-primary)]'}`}>
                        {r.weeks_excluded}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-xs">{r.first_excluded}</td>
                    <td className="px-4 py-3 text-[var(--ff-text-secondary)] text-xs">{r.last_excluded}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.oes_status === 'Active' && (
                          <span
                            title={`Activated ${r.activation_date ?? ''}, signal: ${r.signal_dbm ?? '?'} dBm`}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-help text-green-400 bg-green-500/10"
                          >
                            OES Active
                          </span>
                        )}
                        {r.has_dr_record && (
                          <span
                            title={`Review: ${r.dr_review_status ?? 'pending'}`}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium cursor-help text-blue-400 bg-blue-500/10"
                          >
                            DR Exists
                          </span>
                        )}
                        {!r.oes_status && !r.has_dr_record && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-gray-400 bg-gray-500/10">
                            Not found
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No deduction history found{project !== 'All' ? ` for ${project}` : ''}</p>
        </div>
      )}
    </div>
  );
}
