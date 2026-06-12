/**
 * OltReconLedgerTab — per-DR three-way reconciliation ledger (audit rec #3).
 * Reads v_dr_reconciliation_ledger via useReconLedger; puts the WA / OES / 1Map /
 * drops serials side-by-side with the recon_class conflict classification.
 */

'use client';

import { Search, ExternalLink } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { useReconLedger } from '../../../hooks/useReconLedger';
import { RECON_CLASSES, type ReconClass, type ReconLedgerRow } from '../../../types';

const CLASS_META: Record<ReconClass, { label: string; chip: string }> = {
  serial_other_dr: { label: 'Serial Conflict', chip: 'bg-red-500/20 text-red-400' },
  wa_no_oes: { label: 'WA · no OES', chip: 'bg-amber-500/20 text-amber-400' },
  oes_no_1map: { label: 'OES · no 1Map', chip: 'bg-orange-500/20 text-orange-400' },
  deducted_but_active: { label: 'Deducted · Active', chip: 'bg-fuchsia-500/20 text-fuchsia-400' },
  all_agree: { label: 'All Agree', chip: 'bg-emerald-500/20 text-emerald-400' },
  no_evidence: { label: 'No Evidence', chip: 'bg-slate-500/20 text-slate-400' },
};

function Serial({ value, conflict }: { value: string | null; conflict: boolean }) {
  if (!value) return <span className="text-[var(--ff-text-tertiary)]">—</span>;
  return (
    <span className={`font-mono text-xs ${conflict ? 'text-red-300 font-semibold' : 'text-[var(--ff-text-secondary)]'}`}>
      {value}
    </span>
  );
}

function LedgerRow({ row }: { row: ReconLedgerRow }) {
  const conflict = row.recon_class === 'serial_other_dr';
  const meta = CLASS_META[row.recon_class] ?? CLASS_META.no_evidence;
  return (
    <tr className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-surface-hover)]">
      <td className="px-3 py-2 whitespace-nowrap">
        <a
          href={`/activate/data-sync?group=olt&tab=investigate&search=${encodeURIComponent(row.drop_number)}`}
          className="font-mono text-xs text-[var(--ff-accent)] hover:underline inline-flex items-center gap-1"
        >
          {row.drop_number}
          <ExternalLink className="w-3 h-3" />
        </a>
        {row.project && <div className="text-[10px] text-[var(--ff-text-tertiary)] mt-0.5">{row.project}</div>}
      </td>
      <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.chip}`}>{meta.label}</span></td>
      <td className="px-3 py-2"><Serial value={row.wa_serial} conflict={conflict} /></td>
      <td className="px-3 py-2"><Serial value={row.oes_serial} conflict={conflict} /></td>
      <td className="px-3 py-2"><Serial value={row.onemap_serial} conflict={conflict} /></td>
      <td className="px-3 py-2"><Serial value={row.drops_serial} conflict={conflict} /></td>
      <td className="px-3 py-2 text-xs text-[var(--ff-text-secondary)] whitespace-nowrap">
        {row.activation_status || '—'}
        {row.oes_status && row.oes_status !== 'Active' && (
          <span className="ml-1 text-amber-400">({row.oes_status})</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        <span className={row.payment_status === 'deducted' ? 'text-fuchsia-400' : 'text-[var(--ff-text-secondary)]'}>
          {row.payment_status || '—'}
        </span>
        {row.latest_deduction_note && (
          <div className="text-[10px] text-[var(--ff-text-tertiary)] mt-0.5">{row.latest_deduction_note}</div>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-[var(--ff-text-secondary)] whitespace-nowrap">{row.onemap_fix_status || '—'}</td>
    </tr>
  );
}

export function OltReconLedgerTab() {
  const ledger = useReconLedger();
  const counts = new Map(ledger.summary.map((s) => [s.recon_class, s.count]));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Reconciliation Ledger</h2>
        <p className="text-sm text-[var(--ff-text-secondary)]">
          One row per DR: WA / OES / 1Map / drops serials side-by-side with the three-way conflict class.
        </p>
      </div>

      {/* Class filter cards */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => ledger.setReconClass(null)}
          className={`px-3 py-2 rounded-lg border text-sm ${
            ledger.reconClass === null
              ? 'border-[var(--ff-accent)] text-[var(--ff-accent)]'
              : 'border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-[var(--ff-border-medium)]'
          }`}
        >
          All
        </button>
        {RECON_CLASSES.map((c) => {
          const meta = CLASS_META[c];
          const active = ledger.reconClass === c;
          return (
            <button
              key={c}
              onClick={() => ledger.setReconClass(active ? null : c)}
              className={`px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-2 ${
                active
                  ? 'border-[var(--ff-accent)]'
                  : 'border-[var(--ff-border-light)] hover:border-[var(--ff-border-medium)]'
              }`}
            >
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.chip}`}>{meta.label}</span>
              <span className="text-[var(--ff-text-secondary)] tabular-nums">{counts.get(c) ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ff-text-tertiary)]" />
        <input
          type="text"
          value={ledger.search}
          onChange={(e) => ledger.setSearch(e.target.value)}
          placeholder="Search DR number or any serial…"
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--ff-surface)] border border-[var(--ff-border-light)] text-sm text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:border-[var(--ff-accent)]"
        />
      </div>

      {ledger.error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{ledger.error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-[var(--ff-border-light)] rounded-lg">
        <table className="w-full text-left">
          <thead className="bg-[var(--ff-surface)] text-[11px] uppercase tracking-wide text-[var(--ff-text-tertiary)]">
            <tr>
              <th className="px-3 py-2 font-medium">DR</th>
              <th className="px-3 py-2 font-medium">Class</th>
              <th className="px-3 py-2 font-medium">WA</th>
              <th className="px-3 py-2 font-medium">OES</th>
              <th className="px-3 py-2 font-medium">1Map</th>
              <th className="px-3 py-2 font-medium">Drops</th>
              <th className="px-3 py-2 font-medium">Lifecycle</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium">1Map Fix</th>
            </tr>
          </thead>
          <tbody>
            {ledger.isLoading ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center">
                  <InlineSpinner />
                </td>
              </tr>
            ) : ledger.records.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-[var(--ff-text-secondary)]">
                  No DRs match this filter.
                </td>
              </tr>
            ) : (
              ledger.records.map((row) => <LedgerRow key={row.drop_number} row={row} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-[var(--ff-text-secondary)]">
        <span>
          {ledger.total.toLocaleString()} DR{ledger.total === 1 ? '' : 's'} · page {ledger.page} of {ledger.totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => ledger.setPage((p) => Math.max(1, p - 1))}
            disabled={ledger.page <= 1 || ledger.isLoading}
            className="px-3 py-1.5 rounded-lg border border-[var(--ff-border-light)] disabled:opacity-40 hover:border-[var(--ff-border-medium)]"
          >
            Previous
          </button>
          <button
            onClick={() => ledger.setPage((p) => Math.min(ledger.totalPages, p + 1))}
            disabled={ledger.page >= ledger.totalPages || ledger.isLoading}
            className="px-3 py-1.5 rounded-lg border border-[var(--ff-border-light)] disabled:opacity-40 hover:border-[var(--ff-border-medium)]"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
