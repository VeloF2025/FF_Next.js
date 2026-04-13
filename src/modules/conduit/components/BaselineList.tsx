/**
 * BaselineList — read-only list of saved project baseline snapshots.
 * Newest first. Expandable detail showing all inputs at time of snapshot.
 * Deletion allowed (with confirm).
 */
'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2, BookMarked } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import type { ConduitBaseline } from '../types';
import type { ConduitProjectInputs } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fR = (v: number) =>
  !v ? '—' : `R\u00a0${Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0')}`;
const fN = (v: number) =>
  !v ? '—' : Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
const fPct = (v: number) =>
  !isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;
const fDate = (s: string) =>
  new Date(s).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ─── Input row (read-only) ────────────────────────────────────────────────────

function InputRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-300 tabular-nums">{value}</span>
    </div>
  );
}

function InputGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-3 mb-1">{title}</p>
      {children}
    </div>
  );
}

// ─── Baseline card ────────────────────────────────────────────────────────────

function BaselineCard({ baseline, onDelete }: {
  baseline: ConduitBaseline;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const c = baseline.calc_snapshot;
  const inp = baseline.inputs_snapshot as unknown as ConduitProjectInputs;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/conduit/baselines/${baseline.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      onDelete(baseline.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand toggle */}
        <Button variant="ghost" size="icon" onClick={() => setExpanded(v => !v)}>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </Button>

        {/* Project + label */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{baseline.project_name}</p>
          <p className="text-xs text-gray-500">{baseline.label}</p>
        </div>

        {/* KPIs */}
        <div className="hidden sm:flex items-center gap-6 text-right">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Revenue</p>
            <p className="text-sm font-bold text-teal-400 tabular-nums">{fR(c.revenue)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">COS Total</p>
            <p className="text-sm font-bold text-amber-400 tabular-nums">{fR(c.cos_total)}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">GP%</p>
            <p className={`text-sm font-bold tabular-nums ${c.gross_profit_pct >= 0.3 ? 'text-emerald-400' : c.gross_profit_pct >= 0.1 ? 'text-amber-400' : 'text-red-400'}`}>
              {fPct(c.gross_profit_pct)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">FC Act.</p>
            <p className="text-sm font-bold text-gray-300 tabular-nums">{fN(c.fc_activation)}</p>
          </div>
        </div>

        {/* Date */}
        <p className="text-xs text-gray-600 whitespace-nowrap hidden md:block">{fDate(baseline.created_at)}</p>

        {/* Delete */}
        <div className="flex items-center gap-1 ml-2">
          {confirmDelete ? (
            <>
              <span className="text-xs text-red-400">Sure?</span>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? <InlineSpinner size="sm" /> : 'Yes'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>No</Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete baseline">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-700 px-4 py-3 bg-gray-950">
          <p className="text-[10px] text-gray-600 mb-3">Snapshot captured {fDate(baseline.created_at)} — read-only</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Scope */}
            <div>
              <InputGroup title="Scope">
                <InputRow label="Poles" value={fN(inp?.scope?.poles ?? 0)} />
                <InputRow label="Stringing (m)" value={fN(inp?.scope?.stringing_m ?? 0)} />
                <InputRow label="PON" value={fN(inp?.scope?.pon ?? 0)} />
                <InputRow label="Rate" value={fR(inp?.rate ?? 0)} />
                <InputRow label="Uptake" value={fPct(inp?.uptake ?? 0)} />
              </InputGroup>
            </div>

            {/* Service Rates */}
            <div>
              <InputGroup title="Service Rates">
                <InputRow label="Pole Plant" value={fR(inp?.service_rates?.pole_plant_each ?? 0)} />
                <InputRow label="Permissions" value={fR(inp?.service_rates?.permissions_per_pole ?? 0)} />
                <InputRow label="Stringing /m" value={fR(inp?.service_rates?.stringing_per_m ?? 0)} />
                <InputRow label="Optical /PON" value={fR(inp?.service_rates?.optical_per_pon ?? 0)} />
                <InputRow label="Activation" value={fR(inp?.service_rates?.activation_each ?? 0)} />
                <InputRow label="Wayleave Incent." value={fR(inp?.service_rates?.wayleave_incentive ?? 0)} />
              </InputGroup>
            </div>

            {/* Material + OPEX */}
            <div>
              <InputGroup title="Material Rates">
                <InputRow label="Pole" value={fR(inp?.material_rates?.pole ?? 0)} />
                <InputRow label="Cable /m" value={fR(inp?.material_rates?.cable_per_m ?? 0)} />
                <InputRow label="Optical" value={fR(inp?.material_rates?.optical ?? 0)} />
                <InputRow label="Activation" value={fR(inp?.material_rates?.activation ?? 0)} />
              </InputGroup>
              <InputGroup title="Monthly OPEX">
                <InputRow label="Casuals /mo" value={fR(inp?.monthly_opex?.casuals ?? 0)} />
                <InputRow label="Fuel /mo" value={fR(inp?.monthly_opex?.fuel ?? 0)} />
                <InputRow label="Overheads /mo" value={fR(inp?.monthly_opex?.overheads ?? 0)} />
                <InputRow label="Sales /mo" value={fR(inp?.monthly_opex?.sales ?? 0)} />
                <InputRow label="Ad Hoc /mo" value={fR(inp?.monthly_opex?.ad_hoc ?? 0)} />
              </InputGroup>
            </div>

            {/* Calc totals */}
            <div>
              <InputGroup title="Calculated Totals">
                <InputRow label="FC Activations" value={fN(c.fc_activation)} />
                <InputRow label="Revenue" value={fR(c.revenue)} />
                <InputRow label="COS Services" value={fR(c.cos_services)} />
                <InputRow label="COS Material" value={fR(c.cos_material)} />
                <InputRow label="COS OPEX" value={fR(c.cos_opex)} />
                <InputRow label="COS Lump" value={fR(c.cos_lump)} />
                <InputRow label="COS Total" value={fR(c.cos_total)} />
                <InputRow label="Profit" value={fR(c.profit)} />
                <InputRow label="GP%" value={fPct(c.gross_profit_pct)} />
                <InputRow label="Cost/Home" value={fR(c.cost_per_home)} />
              </InputGroup>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  initialBaselines: ConduitBaseline[];
}

export function BaselineList({ initialBaselines }: Props) {
  const [baselines, setBaselines] = useState<ConduitBaseline[]>(initialBaselines);

  const handleDelete = (id: string) => {
    setBaselines(prev => prev.filter(b => b.id !== id));
  };

  if (baselines.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-12 text-center">
        <BookMarked className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-500 font-medium">No baselines saved yet</p>
        <p className="text-xs text-gray-600 mt-1">Use the 📌 Baseline button on any Executable project to capture a snapshot.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">{baselines.length} baseline{baselines.length !== 1 ? 's' : ''} — newest first — read-only snapshots</p>
      {baselines.map(b => (
        <BaselineCard key={b.id} baseline={b} onDelete={handleDelete} />
      ))}
    </div>
  );
}
