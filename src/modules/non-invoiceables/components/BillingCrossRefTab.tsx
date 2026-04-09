'use client';

/** BillingCrossRefTab — Weekly billing deductions cross-referenced against existing tickets. */

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type NonInvoiceableCategory,
} from '@/modules/non-invoiceables/types';

type ActionFilter = 'all' | 'actioned' | 'missed' | 'actioned_late';

interface BillingWeek {
  id: number;
  week_ending: string;
  project: string;
}

interface CrossRefRow {
  dr_number: string;
  note_type: string;       // 'note1' … 'note5'
  category: NonInvoiceableCategory;
  action_status: 'actioned' | 'missed' | 'actioned_late';
  ticket_uid: string | null;
  oes_status: 'Active' | 'Inactive' | null;
  signal_dbm: number | null;
  has_dr: boolean;
}

interface CrossRefSummary {
  actioned: number;
  missed: number;
  coverage_rate: number;
}

interface CrossRefResponse {
  week: BillingWeek | null;
  summary: CrossRefSummary;
  rows: CrossRefRow[];
  prev_week_id: number | null;
  next_week_id: number | null;
}

interface BillingCrossRefTabProps {
  project?: string;
}

const NOTE_BADGE: Record<string, string> = {
  note1: 'bg-orange-500/15 text-orange-400',
  note2: 'bg-blue-500/15 text-blue-400',
  note3: 'bg-yellow-500/15 text-yellow-400',
  note4: 'bg-red-500/15 text-red-400',
  note5: 'bg-purple-500/15 text-purple-400',
};

const NOTE_LABEL: Record<string, string> = {
  note1: 'N1', note2: 'N2', note3: 'N3', note4: 'N4', note5: 'N5',
};

const FILTER_OPTIONS: { value: ActionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'actioned', label: 'Actioned' },
  { value: 'missed', label: 'Missed' },
  { value: 'actioned_late', label: 'Late' },
];

const DASH = <span className="text-gray-600">—</span>;

const covColor = (r: number) => r >= 80 ? 'text-green-400' : r >= 50 ? 'text-amber-400' : 'text-red-400';

const ACTION_BADGE: Record<string, { icon: string; label: string; cls: string }> = {
  actioned:      { icon: '✓', label: 'Actioned', cls: 'bg-green-500/15 text-green-400' },
  actioned_late: { icon: '⏱', label: 'Late',     cls: 'bg-amber-500/15 text-amber-400' },
  missed:        { icon: '✕', label: 'Missed',   cls: 'bg-red-500/15 text-red-400' },
};

function Badge({ status }: { status: string }) {
  const b = ACTION_BADGE[status] ?? ACTION_BADGE.missed!;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${b.cls}`}><span aria-hidden="true">{b.icon}</span> {b.label}</span>;
}

function KpiCard({ label, value, cls, sub }: { label: string; value: string | number; cls?: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[140px] rounded-lg bg-[#161b22] border border-gray-700 px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${cls ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function Row({ row: r }: { row: CrossRefRow }) {
  const nc = NOTE_BADGE[r.note_type] ?? 'bg-gray-500/15 text-gray-400';
  const sigC = r.signal_dbm != null && r.signal_dbm < -26 ? 'text-red-400' : 'text-gray-300';
  const oesC = r.oes_status === 'Active' ? 'text-green-400' : r.oes_status === 'Inactive' ? 'text-red-400' : '';
  return (
    <tr className="border-b border-gray-800 hover:bg-[#161b22]">
      <td className="px-3 py-2 font-mono text-white whitespace-nowrap text-sm">{r.dr_number}</td>
      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${nc}`}>{NOTE_LABEL[r.note_type] ?? r.note_type}</span></td>
      <td className="px-3 py-2 hidden sm:table-cell"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[r.category]}`}>{CATEGORY_LABELS[r.category]}</span></td>
      <td className="px-3 py-2"><Badge status={r.action_status} /></td>
      <td className="px-3 py-2 hidden md:table-cell">{r.ticket_uid ? <a href={`/noc/tickets/${r.ticket_uid}`} className="text-blue-400 hover:underline font-mono text-xs">{r.ticket_uid}</a> : DASH}</td>
      <td className="px-3 py-2 hidden lg:table-cell">{r.oes_status ? <span className={`text-xs font-medium ${oesC}`}>{r.oes_status}</span> : DASH}</td>
      <td className="px-3 py-2 hidden lg:table-cell">{r.signal_dbm != null ? <span className={`text-xs tabular-nums ${sigC}`}>{r.signal_dbm} dBm</span> : DASH}</td>
      <td className="px-3 py-2 text-center">{r.has_dr ? <span className="text-green-400 text-sm">✓</span> : <span className="text-red-400 text-sm">✕</span>}</td>
    </tr>
  );
}

export function BillingCrossRefTab({ project }: BillingCrossRefTabProps) {
  const [data, setData] = useState<CrossRefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekId, setWeekId] = useState<number | null>(null);
  const [filter, setFilter] = useState<ActionFilter>('all');

  const fetchData = useCallback(async (id: number | null, controller: AbortController) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      if (id != null) params.set('billing_week_id', String(id));

      const res = await fetch(
        `/api/activate/non-invoiceables/billing-crossref?${params}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      const json = await res.json() as CrossRefResponse;
      setData(json);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : 'Failed to load billing cross-reference';
      log.error('BillingCrossRefTab: fetch failed', { error: msg, weekId: id });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchData(weekId, controller);
    return () => controller.abort();
  }, [weekId, fetchData]);

  const filteredRows = (data?.rows ?? []).filter(
    (r) => filter === 'all' || r.action_status === filter,
  );

  const weekLabel = data?.week
    ? `Week ending ${data.week.week_ending}`
    : 'Latest week';

  return (
    <div className="space-y-4">
      {/* Week navigator */}
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setWeekId(data?.prev_week_id ?? null)}
          disabled={loading || !data?.prev_week_id}
          aria-label="Previous week"
        >
          ← Prev
        </Button>
        <span className="text-sm text-gray-300 font-medium min-w-[200px] text-center">
          {loading ? <InlineSpinner className="inline-block text-gray-400" /> : weekLabel}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setWeekId(data?.next_week_id ?? null)}
          disabled={loading || !data?.next_week_id}
          aria-label="Next week"
        >
          Next →
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* KPI cards */}
      {data && (
        <div className="flex flex-wrap gap-3">
          <KpiCard
            label="Actioned Before Billing"
            value={data.summary.actioned}
            cls="text-green-400"
            sub="had a ticket at billing time"
          />
          <KpiCard
            label="Missed"
            value={data.summary.missed}
            cls="text-red-400"
            sub="no ticket at billing time"
          />
          <KpiCard
            label="Coverage Rate"
            value={`${data.summary.coverage_rate.toFixed(1)}%`}
            cls={covColor(data.summary.coverage_rate)}
            sub="actioned / total deductions"
          />
        </div>
      )}

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === opt.value
                ? 'bg-blue-600 text-white'
                : 'bg-[#161b22] border border-gray-700 text-gray-400 hover:text-white'
            }`}
            aria-pressed={filter === opt.value}
          >
            {opt.label}
            {opt.value !== 'all' && data && (
              <span className="ml-1 opacity-70">
                ({(data.rows).filter((r) => r.action_status === opt.value).length})
              </span>
            )}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500 self-center">
          {filteredRows.length} row{filteredRows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Deductions table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-gray-700 bg-[#161b22]">
              <th className="px-3 py-2 font-medium text-gray-400">DR #</th>
              <th className="px-3 py-2 font-medium text-gray-400">Note</th>
              <th className="px-3 py-2 font-medium text-gray-400 hidden sm:table-cell">Category</th>
              <th className="px-3 py-2 font-medium text-gray-400">Action Status</th>
              <th className="px-3 py-2 font-medium text-gray-400 hidden md:table-cell">Ticket</th>
              <th className="px-3 py-2 font-medium text-gray-400 hidden lg:table-cell">OES Status</th>
              <th className="px-3 py-2 font-medium text-gray-400 hidden lg:table-cell">Signal</th>
              <th className="px-3 py-2 font-medium text-gray-400 text-center">Has DR</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center">
                  <InlineSpinner className="inline-block text-gray-400" />
                  <span className="ml-2 text-gray-500 text-sm">Loading…</span>
                </td>
              </tr>
            )}
            {!loading && filteredRows.length === 0 && data && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500 text-sm">
                  No deductions match the selected filter.
                </td>
              </tr>
            )}
            {filteredRows.map((row) => (
              <Row key={`${row.dr_number}-${row.note_type}`} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
