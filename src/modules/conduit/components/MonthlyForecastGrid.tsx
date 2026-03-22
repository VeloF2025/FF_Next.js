/**
 * MonthlyForecastGrid — Interactive PM rollout plan + auto-calculated COS/Revenue.
 *
 * PM enters physical quantities per month (Poles, Stringing, PON, Activations).
 * COS is auto-derived from those quantities × the rates stored in inputs_json.
 * OPEX rows show defaults from monthly_opex inputs; PM can override any month.
 * Summary bar is NOT affected — this is a separate planning tool.
 */
'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import type { ConduitProject, MonthlyPlanEntry, ConduitActual } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mkLabel(start: string | null, i: number): string {
  const base = start ? new Date(start) : new Date();
  const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
  return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
}

function blank(): MonthlyPlanEntry {
  return { poles: 0, stringing_m: 0, pon: 0, activations: 0,
           opex_casuals: null, opex_fuel: null, opex_overheads: null,
           opex_sales: null, opex_ad_hoc: null };
}

function normPlan(p: MonthlyPlanEntry[] | undefined, dur: number): MonthlyPlanEntry[] {
  const src = p ?? [];
  if (src.length === dur) return src;
  if (src.length > dur) return src.slice(0, dur);
  return [...src, ...Array.from({ length: dur - src.length }, blank)];
}

const fR = (v: number) =>
  v === 0 ? '—' : `R\u00a0${Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0')}`;

const fN = (v: number) =>
  v === 0 ? '' : Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');

// ─── Rollout input cell ───────────────────────────────────────────────────────

function RolloutCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  return (
    <input
      type="text"
      inputMode="numeric"
      value={focused ? draft : (value === 0 ? '' : fN(value))}
      placeholder="—"
      onChange={e => setDraft(e.target.value)}
      onFocus={e => { setFocused(true); setDraft(String(value)); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => {
        const n = Number(draft.replace(/[\s\u00a0,]/g, ''));
        onChange(!isNaN(n) && n >= 0 ? n : value);
        setFocused(false);
      }}
      onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="w-full text-center text-xs text-white outline-none bg-transparent focus:bg-gray-700 focus:rounded placeholder-gray-700 tabular-nums py-0.5 px-1"
    />
  );
}

// ─── OPEX override cell ───────────────────────────────────────────────────────

function OpexCell({
  override,
  defaultVal,
  onChange,
}: {
  override: number | null;
  defaultVal: number;
  onChange: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const isOverridden = override !== null;
  const displayed = override ?? defaultVal;

  if (editing) {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        autoFocus
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft.replace(/[\s\u00a0,]/g, ''));
          onChange(!isNaN(n) && n >= 0 ? n : null);
          setEditing(false);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { onChange(null); setEditing(false); }
        }}
        className="w-full text-center text-xs text-white bg-gray-700 rounded outline-none tabular-nums py-0.5 px-1"
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center gap-0.5 cursor-pointer group min-h-[20px]"
      onClick={() => { setDraft(String(displayed)); setEditing(true); }}
    >
      <span className={`text-xs tabular-nums ${isOverridden ? 'text-teal-300 font-medium' : 'text-gray-500 italic'}`}>
        {fR(displayed)}
      </span>
      {isOverridden && (
        <button
          onClick={e => { e.stopPropagation(); onChange(null); }}
          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-amber-400 transition-opacity ml-0.5"
          title="Reset to default"
        >
          <RotateCcw className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, cols, color }: { title: string; cols: number; color: string }) {
  return (
    <tr>
      <td
        colSpan={cols + 2}
        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border-b border-gray-700 ${color}`}
      >
        {title}
      </td>
    </tr>
  );
}

// ─── Read-only calc cell ──────────────────────────────────────────────────────

function CalcCell({ value, highlight }: { value: number; highlight?: boolean }) {
  return (
    <td className={`px-1 py-0.5 text-right text-xs tabular-nums whitespace-nowrap
      ${value < 0 ? 'text-red-400' : highlight ? 'text-amber-300' : value === 0 ? 'text-gray-700' : 'text-gray-300'}`}>
      {fR(value)}
    </td>
  );
}

// ─── Scope tracker ────────────────────────────────────────────────────────────

function ScopeTracker({
  plan,
  scope,
  fcActivation,
}: {
  plan: MonthlyPlanEntry[];
  scope: { poles: number; stringing_m: number; pon: number };
  fcActivation: number;
}) {
  const totals = useMemo(() => ({
    poles:       plan.reduce((s, e) => s + e.poles, 0),
    stringing_m: plan.reduce((s, e) => s + e.stringing_m, 0),
    pon:         plan.reduce((s, e) => s + e.pon, 0),
    activations: plan.reduce((s, e) => s + e.activations, 0),
  }), [plan]);

  const rows = [
    { label: 'Poles',        planned: totals.poles,       total: scope.poles,       unit: '' },
    { label: 'Stringing (m)', planned: totals.stringing_m, total: scope.stringing_m, unit: 'm' },
    { label: 'PON',          planned: totals.pon,         total: scope.pon,         unit: '' },
    { label: 'Activations',  planned: totals.activations, total: Math.round(fcActivation), unit: '' },
  ];

  return (
    <div className="mt-2 rounded border border-gray-700 overflow-hidden">
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-gray-800 border-b border-gray-700">
        Scope Tracker — Planned vs. Total Scope
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="px-3 py-1 text-left text-[10px] text-gray-500 font-normal">Item</th>
            <th className="px-2 py-1 text-right text-[10px] text-gray-500 font-normal">Planned Σ</th>
            <th className="px-2 py-1 text-right text-[10px] text-gray-500 font-normal">Scope Total</th>
            <th className="px-2 py-1 text-right text-[10px] text-gray-500 font-normal">Remaining</th>
            <th className="px-2 py-1 text-center text-[10px] text-gray-500 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const remaining = r.total - r.planned;
            const over = r.planned > r.total && r.total > 0;
            const complete = r.planned > 0 && r.planned === r.total;
            return (
              <tr key={r.label} className="border-b border-gray-800 last:border-0">
                <td className="px-3 py-1 text-gray-300">{r.label}</td>
                <td className="px-2 py-1 text-right tabular-nums text-white">{fN(r.planned) || '0'}</td>
                <td className="px-2 py-1 text-right tabular-nums text-gray-400">{fN(r.total) || '0'}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${over ? 'text-red-400 font-bold' : remaining === 0 ? 'text-emerald-400' : 'text-gray-300'}`}>
                  {over ? `+${fN(Math.abs(remaining))}` : fN(remaining) || '0'}
                </td>
                <td className="px-2 py-1 text-center">
                  {over
                    ? <span className="flex items-center justify-center gap-1 text-red-400"><AlertTriangle className="w-3 h-3" />Over</span>
                    : complete
                    ? <span className="flex items-center justify-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" />Done</span>
                    : <span className="text-gray-500">—</span>
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  project: ConduitProject;
  onPlanChange: (plan: MonthlyPlanEntry[]) => void;
}

export function MonthlyForecastGrid({ project, onPlanChange }: Props) {
  const { build_duration_months: dur, start_date, inputs_json: inp } = project;
  const { service_rates: sr, material_rates: mr, monthly_opex: mo, lump_costs: lc } = inp;
  const fc_activation = project.po_count * inp.uptake;
  const isWip = project.status === 'wip';
  const ftName = project.ft_project_name;

  const [plan, setPlan] = useState<MonthlyPlanEntry[]>(() =>
    normPlan(inp.monthly_plan, dur)
  );

  // Sync if project changes (e.g., after save)
  useEffect(() => {
    setPlan(normPlan(inp.monthly_plan, dur));
  }, [project.id, dur]);

  // ── Actuals (WIP only) ────────────────────────────────────────────────────
  const [actuals, setActuals] = useState<ConduitActual[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState<Record<number, boolean>>({});

  // Fetch actuals on mount for WIP projects with a mapping
  useEffect(() => {
    if (!isWip || !ftName) return;
    fetch(`/api/conduit/actuals?project=${encodeURIComponent(ftName)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(({ data }) => setActuals(data ?? []))
      .catch(() => {/* silent — actuals are optional */});
  }, [project.id, ftName, isWip]);

  // Map actuals by month ISO string for O(1) lookup
  const actualsMap = useMemo(() => {
    const m = new Map<string, ConduitActual>();
    actuals.forEach(a => m.set(a.month.slice(0, 7), a));
    return m;
  }, [actuals]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch('/api/conduit/actuals/sync', { method: 'POST' });
      const body = await res.json() as { success?: boolean; upserted?: number; error?: string; projects?: string[] };
      if (!res.ok) throw new Error(body.error ?? 'Sync failed');
      setSyncResult(`Synced ${body.upserted} month entries for: ${(body.projects ?? []).join(', ')}`);
      // Re-fetch actuals for this project
      if (ftName) {
        const r2 = await fetch(`/api/conduit/actuals?project=${encodeURIComponent(ftName)}`);
        if (r2.ok) { const { data } = await r2.json(); setActuals(data ?? []); }
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Get month key from start_date + index
  const getMonthKey = (i: number): string => {
    const base = start_date ? new Date(start_date) : new Date();
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const months = useMemo(() =>
    Array.from({ length: dur }, (_, i) => mkLabel(start_date, i)),
    [dur, start_date]
  );

  // ── Per-month derived calculations ────────────────────────────────────────
  const derived = useMemo(() => {
    let cumActs = 0;
    let cumNet = 0;
    return plan.map(e => {
      const casuals   = e.opex_casuals   ?? mo.casuals;
      const fuel      = e.opex_fuel      ?? mo.fuel;
      const overheads = e.opex_overheads ?? mo.overheads;
      const sales     = e.opex_sales     ?? mo.sales;
      const ad_hoc    = e.opex_ad_hoc    ?? mo.ad_hoc;

      const cos_material = e.poles * mr.pole
        + e.stringing_m * mr.cable_per_m
        + e.pon * mr.optical
        + e.activations * mr.activation;

      const cos_services = e.poles * (sr.pole_plant_each + sr.permissions_per_pole)
        + e.stringing_m * sr.stringing_per_m
        + e.pon * sr.optical_per_pon
        + e.activations * (sr.activation_each + sr.wayleave_incentive);

      const cos_wayleave = dur > 0 ? lc.wayleave_cost / dur : 0;
      const cos_opex     = casuals + fuel + overheads + sales + ad_hoc;
      const cos_total    = cos_material + cos_services + cos_wayleave + cos_opex;

      cumActs += e.activations;
      const revenue = cumActs * inp.rate;
      const gross   = revenue - cos_total;
      cumNet += gross;

      return { casuals, fuel, overheads, sales, ad_hoc,
               cos_material, cos_services, cos_wayleave, cos_opex, cos_total,
               revenue, cumActs, gross, cumNet };
    });
  }, [plan, sr, mr, mo, lc, inp.rate, dur]);

  // ── Column totals ────────────────────────────────────────────────────────
  const T = useMemo(() => ({
    poles:        plan.reduce((s, e) => s + e.poles, 0),
    stringing_m:  plan.reduce((s, e) => s + e.stringing_m, 0),
    pon:          plan.reduce((s, e) => s + e.pon, 0),
    activations:  plan.reduce((s, e) => s + e.activations, 0),
    casuals:      derived.reduce((s, d) => s + d.casuals, 0),
    fuel:         derived.reduce((s, d) => s + d.fuel, 0),
    overheads:    derived.reduce((s, d) => s + d.overheads, 0),
    sales:        derived.reduce((s, d) => s + d.sales, 0),
    ad_hoc:       derived.reduce((s, d) => s + d.ad_hoc, 0),
    cos_material: derived.reduce((s, d) => s + d.cos_material, 0),
    cos_services: derived.reduce((s, d) => s + d.cos_services, 0),
    cos_wayleave: derived.reduce((s, d) => s + d.cos_wayleave, 0),
    cos_opex:     derived.reduce((s, d) => s + d.cos_opex, 0),
    cos_total:    derived.reduce((s, d) => s + d.cos_total, 0),
    revenue:      derived.reduce((s, d) => s + d.revenue, 0),
    gross:        derived.reduce((s, d) => s + d.gross, 0),
  }), [plan, derived]);

  // ── Plan update helpers ──────────────────────────────────────────────────
  const setRollout = useCallback((month: number, field: keyof Pick<MonthlyPlanEntry,'poles'|'stringing_m'|'pon'|'activations'>, v: number) => {
    setPlan(prev => {
      const next = prev.map((e, i) => i === month ? { ...e, [field]: v } : e);
      onPlanChange(next);
      return next;
    });
  }, [onPlanChange]);

  const setOpex = useCallback((month: number, field: keyof Pick<MonthlyPlanEntry,'opex_casuals'|'opex_fuel'|'opex_overheads'|'opex_sales'|'opex_ad_hoc'>, v: number | null) => {
    setPlan(prev => {
      const next = prev.map((e, i) => i === month ? { ...e, [field]: v } : e);
      onPlanChange(next);
      return next;
    });
  }, [onPlanChange]);

  // ── Shared cell styles ───────────────────────────────────────────────────
  const th = 'px-1 py-1 text-[10px] text-gray-500 font-normal whitespace-nowrap text-center border-b border-gray-700 bg-gray-850';
  const tdLabel = 'sticky left-0 z-10 bg-gray-900 px-3 py-0.5 text-xs text-gray-300 whitespace-nowrap border-r border-gray-800';
  const tdTotal = 'px-2 py-0.5 text-right text-xs tabular-nums whitespace-nowrap border-l border-gray-700';

  return (
    <div className="space-y-2 min-w-0 w-full">

      {/* ── WIP Actuals sync bar ─────────────────────────────────────────── */}
      {isWip && (
        <div className="flex items-center gap-3 px-1">
          {ftName ? (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold bg-indigo-800 hover:bg-indigo-700 text-indigo-200 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Sync Actuals from SharePoint'}
              </button>
              {syncResult && <span className="text-xs text-emerald-400">{syncResult}</span>}
              {syncError && <span className="text-xs text-red-400">{syncError}</span>}
              {actuals.length > 0 && !syncResult && (
                <span className="text-xs text-gray-500">{actuals.length} months of actuals loaded</span>
              )}
            </>
          ) : (
            <span className="text-xs text-amber-500">⚠️ No FT project mapping — set ft_project_name to enable actuals sync</span>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-gray-700" style={{ maxWidth: '100%' }}>
        <table className="text-xs border-collapse" style={{ minWidth: `${Math.max(700, dur * 72 + 200)}px` }}>
          <thead>
            <tr>
              <th className={`sticky left-0 z-20 ${th} text-left px-3 w-40`}>Month</th>
              {months.map(m => (
                <th key={m} className={`${th} min-w-[70px]`}>{m}</th>
              ))}
              <th className={`${th} border-l border-gray-700 min-w-[90px]`}>Total</th>
            </tr>
          </thead>
          <tbody>

            {/* ── ROLLOUT PLAN ─────────────────────────────────────────── */}
            <SectionHeader title="Rollout Plan — Forecast" cols={dur} color="text-emerald-400 bg-gray-850" />

            {([
              ['Poles',          'poles'       ],
              ['Stringing (m)',  'stringing_m' ],
              ["Optical / PON's",'pon'         ],
              ['Activations',    'activations' ],
            ] as [string, keyof Pick<MonthlyPlanEntry,'poles'|'stringing_m'|'pon'|'activations'>][]).map(([label, field]) => (
              <tr key={field} className="border-b border-gray-800 hover:bg-gray-800/30">
                <td className={tdLabel}>{label}</td>
                {plan.map((e, m) => (
                  <td key={m} className="px-0.5 py-0.5 text-center">
                    <RolloutCell
                      value={e[field]}
                      onChange={v => setRollout(m, field, v)}
                    />
                  </td>
                ))}
                <td className={`${tdTotal} font-semibold text-gray-200`}>
                  {fN(T[field]) || '—'}
                </td>
              </tr>
            ))}

            {/* ── COS CATEGORIES ───────────────────────────────────────── */}
            <SectionHeader title="COS Category — Forecast" cols={dur} color="text-blue-400 bg-gray-850" />

            {/* OPEX rows — overridable */}
            {([
              ['COS — Ad Hoc',    'opex_ad_hoc',    'ad_hoc',    T.ad_hoc   ],
              ['COS — Casuals',   'opex_casuals',   'casuals',   T.casuals  ],
              ['COS — Fuel',      'opex_fuel',      'fuel',      T.fuel     ],
              ['COS — Overheads', 'opex_overheads', 'overheads', T.overheads],
              ['COS — Sales',     'opex_sales',     'sales',     T.sales    ],
            ] as [string, keyof Pick<MonthlyPlanEntry,'opex_casuals'|'opex_fuel'|'opex_overheads'|'opex_sales'|'opex_ad_hoc'>, keyof typeof T, number][]).map(([label, field, totField, totVal]) => (
              <tr key={field} className="border-b border-gray-800 hover:bg-gray-800/30">
                <td className={tdLabel}>
                  <span>{label}</span>
                  <span className="ml-1 text-[9px] text-gray-600 italic">overridable</span>
                </td>
                {plan.map((e, m) => (
                  <td key={m} className="px-0.5 py-0.5">
                    <OpexCell
                      override={e[field]}
                      defaultVal={(mo as Record<string, number>)[totField.replace('opex_', '')] ?? 0}
                      onChange={v => setOpex(m, field, v)}
                    />
                  </td>
                ))}
                <td className={`${tdTotal} text-gray-400`}>{fR(totVal)}</td>
              </tr>
            ))}

            {/* Calculated COS rows */}
            <tr className="border-b border-gray-800 hover:bg-gray-800/30">
              <td className={tdLabel}>COS — Material</td>
              {derived.map((d, m) => <CalcCell key={m} value={d.cos_material} />)}
              <td className={`${tdTotal} text-gray-400`}>{fR(T.cos_material)}</td>
            </tr>
            <tr className="border-b border-gray-800 hover:bg-gray-800/30">
              <td className={tdLabel}>COS — Services</td>
              {derived.map((d, m) => <CalcCell key={m} value={d.cos_services} />)}
              <td className={`${tdTotal} text-gray-400`}>{fR(T.cos_services)}</td>
            </tr>
            <tr className="border-b border-gray-800 hover:bg-gray-800/30">
              <td className={tdLabel}>COS — Wayleaves</td>
              {derived.map((d, m) => <CalcCell key={m} value={d.cos_wayleave} />)}
              <td className={`${tdTotal} text-gray-400`}>{fR(T.cos_wayleave)}</td>
            </tr>
            <tr className="border-b border-gray-700 font-semibold bg-gray-800/50">
              <td className={`${tdLabel} font-bold text-amber-400`}>Total COS</td>
              {derived.map((d, m) => <CalcCell key={m} value={d.cos_total} highlight />)}
              <td className={`${tdTotal} text-amber-300 font-bold`}>{fR(T.cos_total)}</td>
            </tr>

            {/* ── REVENUE ──────────────────────────────────────────────── */}
            <SectionHeader title="Revenue — Forecast" cols={dur} color="text-teal-400 bg-gray-850" />

            <tr className="border-b border-gray-800 hover:bg-gray-800/30">
              <td className={tdLabel}>Subscription Revenue</td>
              {derived.map((d, m) => <CalcCell key={m} value={d.revenue} />)}
              <td className={`${tdTotal} text-gray-400`}>{fR(T.revenue)}</td>
            </tr>
            <tr className="border-b border-gray-800 hover:bg-gray-800/30">
              <td className={`${tdLabel} text-emerald-400`}>Monthly Gross</td>
              {derived.map((d, m) => (
                <td key={m} className={`px-1 py-0.5 text-right text-xs tabular-nums ${d.gross < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {fR(d.gross)}
                </td>
              ))}
              <td className={`${tdTotal} ${T.gross < 0 ? 'text-red-400' : 'text-emerald-400'} font-bold`}>{fR(T.gross)}</td>
            </tr>
            <tr className="border-b border-gray-700">
              <td className={`${tdLabel} text-teal-300`}>Running Net</td>
              {derived.map((d, m) => (
                <td key={m} className={`px-1 py-0.5 text-right text-xs tabular-nums ${d.cumNet < 0 ? 'text-red-400' : 'text-teal-300'}`}>
                  {fR(d.cumNet)}
                </td>
              ))}
              <td className={`${tdTotal} ${derived.at(-1)?.cumNet ?? 0 < 0 ? 'text-red-400' : 'text-teal-300'} font-bold`}>
                {fR(derived.at(-1)?.cumNet ?? 0)}
              </td>
            </tr>

            {/* ── ACTUALS (WIP only) ───────────────────────────────────── */}
            {isWip && actuals.length > 0 && (<>
              <SectionHeader title="Actuals to Date — From FibreTime" cols={dur} color="text-purple-400 bg-gray-850" />

              {/* Activations: Forecast vs Actual vs Variance */}
              <tr className="border-b border-gray-800">
                <td className={`${tdLabel} text-gray-400`}>
                  <div>Activations</div>
                  <div className="text-[9px] text-gray-600">Forecast / Actual / Var</div>
                </td>
                {plan.map((e, m) => {
                  const key = getMonthKey(m);
                  const act = actualsMap.get(key);
                  const variance = act ? act.activations - e.activations : null;
                  return (
                    <td key={m} className="px-1 py-0.5 text-center text-[10px] tabular-nums border-r border-gray-800">
                      <div className="text-gray-400">{e.activations || '—'}</div>
                      {act && <div className="text-teal-300 font-medium">{act.activations}</div>}
                      {variance !== null && <div className={variance >= 0 ? 'text-emerald-400' : 'text-red-400'}>{variance > 0 ? '+' : ''}{variance}</div>}
                    </td>
                  );
                })}
                <td className={tdTotal}></td>
              </tr>

              {/* COS Actual — total with expandable breakdown */}
              <tr className="border-b border-gray-800">
                <td className={`${tdLabel}`}>
                  <div className="text-purple-300">COS Actual</div>
                  <div className="text-[9px] text-gray-600">Forecast / Actual / Var</div>
                </td>
                {derived.map((d, m) => {
                  const key = getMonthKey(m);
                  const act = actualsMap.get(key);
                  const variance = act ? act.cos_actual - d.cos_total : null;
                  return (
                    <td key={m} className="px-1 py-0.5 text-center text-[10px] tabular-nums border-r border-gray-800">
                      <div className="text-gray-400">{fR(d.cos_total)}</div>
                      {act && <div className="text-purple-300 font-medium">{fR(act.cos_actual)}</div>}
                      {variance !== null && <div className={variance <= 0 ? 'text-emerald-400' : 'text-red-400'}>{variance > 0 ? '+' : ''}{fR(variance)}</div>}
                    </td>
                  );
                })}
                <td className={tdTotal}></td>
              </tr>

              {/* COS Breakdown — expandable */}
              <tr className="border-b border-gray-700">
                <td className={`${tdLabel}`}>
                  <button
                    onClick={() => setBreakdownOpen(v => ({ ...v, 0: !v[0] }))}
                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300"
                  >
                    {breakdownOpen[0] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    Breakdown by category
                  </button>
                </td>
                {plan.map((_, m) => <td key={m} className="border-r border-gray-800" />)}
                <td />
              </tr>

              {breakdownOpen[0] && actuals.some(a => Object.keys(a.cos_breakdown).length > 0) && (
                [...new Set(actuals.flatMap(a => Object.keys(a.cos_breakdown)))].map(cat => (
                  <tr key={cat} className="border-b border-gray-800 bg-gray-950/50">
                    <td className={`${tdLabel} text-[10px] text-gray-500 pl-6`}>{cat}</td>
                    {plan.map((_, m) => {
                      const key = getMonthKey(m);
                      const act = actualsMap.get(key);
                      const val = act?.cos_breakdown[cat] ?? 0;
                      return <td key={m} className="px-1 py-0.5 text-right text-[10px] text-gray-500 tabular-nums border-r border-gray-800">{val ? fR(val) : ''}</td>;
                    })}
                    <td className={tdTotal}></td>
                  </tr>
                ))
              )}
            </>)}

          </tbody>
        </table>
      </div>

      {/* ── Scope Tracker ───────────────────────────────────────────────── */}
      <ScopeTracker plan={plan} scope={inp.scope} fcActivation={fc_activation} />
    </div>
  );
}
