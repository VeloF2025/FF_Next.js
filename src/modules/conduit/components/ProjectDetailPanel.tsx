/**
 * ProjectDetailPanel — Per-project inputs + monthly forecast.
 *
 * Section 1: COS Input Editor
 *   - Scope quantities (poles, stringing, PON)
 *   - Unit costs (all-in per unit)
 *   - Monthly opex (× build duration)
 *   - Lump costs (ad hoc, sub-contractor)
 *   - Live COS summary as you type
 *
 * Section 2: Monthly Forecast (computed from saved inputs)
 *   - Rollout plan
 *   - COS categories
 *   - Revenue forecast
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Save, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { log } from '@/lib/logger';
import type { ConduitProject, ConduitProjectInputs } from '../types';
import { calcConduit } from '../hooks/useConduitCalc';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ForecastRow {
  label: string;
  values: (number | null)[];
  isTotal?: boolean;
}

interface ProjectDetailData {
  months: string[];
  rolloutPlan: ForecastRow[];
  cosCategories: ForecastRow[];
  revenueForecast: ForecastRow[];
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function fZAR(v: number | null): string {
  if (v === null || v === 0) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

function fInt(v: number | null): string {
  if (v === null || v === 0) return '—';
  return Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

function fZARShort(v: number): string {
  if (!isFinite(v) || v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R ${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `R ${(v / 1_000).toFixed(0)}K`;
  return `R ${Math.round(v).toLocaleString()}`;
}

// ─── Forecast sub-table ─────────────────────────────────────────────────────

function ForecastTable({
  title,
  months,
  rows,
  format,
}: {
  title: string;
  months: string[];
  rows: ForecastRow[];
  format: 'int' | 'zar';
}) {
  const fmt = (v: number | null) => (format === 'zar' ? fZAR(v) : fInt(v));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse min-w-max">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className="px-3 py-2 text-left text-white font-bold whitespace-nowrap" style={{ minWidth: 180 }}>
              {title}
            </th>
            {months.map(m => (
              <th key={m} className="px-2 py-2 text-right text-white font-semibold whitespace-nowrap" style={{ minWidth: 90 }}>
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.label}
              style={row.isTotal ? { backgroundColor: '#1a3a4a' } : undefined}
              className={!row.isTotal ? (i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60') : ''}
            >
              <td className={`px-3 py-1.5 whitespace-nowrap ${row.isTotal ? 'font-bold text-white' : 'text-gray-300'}`}>
                {row.label}
              </td>
              {row.values.map((v, j) => (
                <td
                  key={j}
                  className={`px-2 py-1.5 text-right tabular-nums ${
                    row.isTotal
                      ? 'font-bold text-white'
                      : typeof v === 'number' && v < 0
                      ? 'text-red-400'
                      : 'text-gray-300'
                  }`}
                >
                  {fmt(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Input field ─────────────────────────────────────────────────────────────

function InputField({
  label,
  value,
  onChange,
  prefix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  // Sync when value changes externally
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 focus-within:border-teal-500 transition-colors">
        {prefix && <span className="text-xs text-gray-500 select-none">{prefix}</span>}
        <input
          type="number"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft);
            if (!isNaN(n)) onChange(n);
            else setDraft(String(value));
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const n = Number(draft);
              if (!isNaN(n)) onChange(n);
            }
          }}
          className="bg-transparent outline-none text-sm text-white w-full tabular-nums"
          min={0}
        />
      </div>
      {hint && <span className="text-xs text-gray-600">{hint}</span>}
    </div>
  );
}

// ─── Input section ───────────────────────────────────────────────────────────

function InputSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
      <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wide">{title}</h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {children}
      </div>
    </div>
  );
}

// ─── COS Summary bar ─────────────────────────────────────────────────────────

function CosSummaryBar({ project }: { project: ConduitProject }) {
  const c = calcConduit(project);
  const items = [
    { label: 'Revenue',    value: c.revenue,        color: 'text-teal-400' },
    { label: 'COS Civil',  value: c.cos_civil,       color: 'text-gray-300' },
    { label: 'COS Act.',   value: c.cos_activation,  color: 'text-gray-300' },
    { label: 'COS Monthly',value: c.cos_monthly,     color: 'text-gray-300' },
    { label: 'COS Lump',   value: c.cos_lump,        color: 'text-gray-300' },

    { label: 'COS Total',  value: c.cos_total,       color: 'text-amber-400' },
    { label: 'Profit',     value: c.profit,          color: c.profit >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'GP%',        value: null,  gp: c.gross_profit_pct, color: c.gross_profit_pct >= 0.30 ? 'text-emerald-400' : c.gross_profit_pct >= 0.10 ? 'text-amber-400' : 'text-red-400' },
    { label: 'Cost/Home',  value: c.cost_per_home,   color: 'text-gray-300' },
  ];

  return (
    <div className="flex flex-wrap gap-3 p-3 bg-gray-900 rounded-lg border border-gray-700">
      {items.map(item => (
        <div key={item.label} className="flex flex-col min-w-[90px]">
          <span className="text-xs text-gray-500">{item.label}</span>
          <span className={`text-sm font-bold tabular-nums ${item.color}`}>
            {item.gp !== undefined
              ? `${(item.gp * 100).toFixed(1)}%`
              : fZARShort(item.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  project: ConduitProject;
  onProjectUpdate?: (updated: ConduitProject) => void;
}

export function ProjectDetailPanel({ project: initialProject, onProjectUpdate }: Props) {
  const [project, setProject] = useState<ConduitProject>(initialProject);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [forecastData, setForecastData] = useState<ProjectDetailData | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastOpen, setForecastOpen] = useState(false);

  // Keep in sync if parent re-renders
  useEffect(() => {
    setProject(initialProject);
  }, [initialProject.id]);

  const inp = project.inputs_json;

  // ── Input updaters ──────────────────────────────────────────────────────
  const setScope = useCallback((field: keyof typeof inp.scope, v: number) => {
    setProject(p => ({ ...p, inputs_json: { ...p.inputs_json, scope: { ...p.inputs_json.scope, [field]: v } } }));
    setSaved(false);
  }, []);

  const setServiceRate = useCallback((field: keyof typeof inp.service_rates, v: number) => {
    setProject(p => ({ ...p, inputs_json: { ...p.inputs_json, service_rates: { ...p.inputs_json.service_rates, [field]: v } } }));
    setSaved(false);
  }, []);

  const setLumpCost = useCallback((field: keyof typeof inp.lump_costs, v: number) => {
    setProject(p => ({ ...p, inputs_json: { ...p.inputs_json, lump_costs: { ...p.inputs_json.lump_costs, [field]: v } } }));
    setSaved(false);
  }, []);

  const setMaterialRate = useCallback((field: keyof typeof inp.material_rates, v: number) => {
    setProject(p => ({ ...p, inputs_json: { ...p.inputs_json, material_rates: { ...p.inputs_json.material_rates, [field]: v } } }));
    setSaved(false);
  }, []);

  const setMonthlyOpex = useCallback((field: keyof typeof inp.monthly_opex, v: number) => {
    setProject(p => ({ ...p, inputs_json: { ...p.inputs_json, monthly_opex: { ...p.inputs_json.monthly_opex, [field]: v } } }));
    setSaved(false);
  }, []);



  // ── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/conduit/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: project.name,
          po_count: project.po_count,
          start_date: project.start_date,
          build_duration_months: project.build_duration_months,
          inputs_json: project.inputs_json,
          version_label: `Save ${new Date().toLocaleString('en-ZA')}`,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { data } = (await res.json()) as { data: ConduitProject };
      setProject(data);
      onProjectUpdate?.(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Refresh forecast after save
      if (forecastOpen) loadForecast();
    } catch (err) {
      log.error('ProjectDetailPanel save failed', { id: project.id, err: String(err) });
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Forecast ─────────────────────────────────────────────────────────────
  const loadForecast = useCallback(() => {
    setForecastLoading(true);
    fetch(`/api/conduit/projects/${project.id}/detail`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(({ data: d }: { data: ProjectDetailData }) => setForecastData(d))
      .catch((err: unknown) => log.error('forecast fetch failed', { err: String(err) }))
      .finally(() => setForecastLoading(false));
  }, [project.id]);

  const toggleForecast = () => {
    if (!forecastOpen && !forecastData) loadForecast();
    setForecastOpen(v => !v);
  };

  const dur = project.build_duration_months;

  return (
    <div className="space-y-4 p-4 bg-gray-900/80 border-t border-gray-700">

      {/* ── COS Summary bar ────────────────────────────────────────────── */}
      <CosSummaryBar project={project} />

      {/* ── Input sections ─────────────────────────────────────────────── */}
      <div className="space-y-3">

        {/* Scope */}
        <InputSection title="Scope — Quantities to Build">
          <InputField label="Poles" value={inp.scope.poles}       onChange={v => setScope('poles', v)}       hint="count" />
          <InputField label="Stringing (m)" value={inp.scope.stringing_m} onChange={v => setScope('stringing_m', v)} hint="total meters" />
          <InputField label="PON Count" value={inp.scope.pon} onChange={v => setScope('pon', v)}         hint="count" />
        </InputSection>

        {/* Service Rates */}
        <InputSection title="COS — Service Rates (labour / installation per unit)">
          <InputField label="Permissions / Pole"  value={inp.service_rates.permissions_per_pole} onChange={v => setServiceRate('permissions_per_pole', v)} prefix="R" />
          <InputField label="Pole Plant / Each"   value={inp.service_rates.pole_plant_each}      onChange={v => setServiceRate('pole_plant_each', v)}      prefix="R" />
          <InputField label="Stringing / Meter"   value={inp.service_rates.stringing_per_m}      onChange={v => setServiceRate('stringing_per_m', v)}      prefix="R" />
          <InputField label="Optical / PON"       value={inp.service_rates.optical_per_pon}      onChange={v => setServiceRate('optical_per_pon', v)}      prefix="R" />
          <InputField label="Activation / Each"   value={inp.service_rates.activation_each}      onChange={v => setServiceRate('activation_each', v)}      prefix="R" />
          <InputField label="Wayleave Incentive"  value={inp.service_rates.wayleave_incentive}   onChange={v => setServiceRate('wayleave_incentive', v)}   prefix="R" hint="per pole" />
        </InputSection>

        {/* Material Rates */}
        <InputSection title="COS — Materials Rate (supply / stock per unit)">
          <InputField label="Pole"        value={inp.material_rates.pole}       onChange={v => setMaterialRate('pole', v)}       prefix="R" hint="per pole" />
          <InputField label="Cable"       value={inp.material_rates.cable_per_m} onChange={v => setMaterialRate('cable_per_m', v)} prefix="R" hint="per meter" />
          <InputField label="Optical"     value={inp.material_rates.optical}    onChange={v => setMaterialRate('optical', v)}    prefix="R" hint="per PON" />
          <InputField label="Activations" value={inp.material_rates.activation} onChange={v => setMaterialRate('activation', v)} prefix="R" hint="ONT per home" />
        </InputSection>

        {/* Lump Costs */}
        <InputSection title="Lump Costs — Project Totals">
          <InputField label="Wayleave Cost" value={inp.lump_costs.wayleave_cost} onChange={v => setLumpCost('wayleave_cost', v)} prefix="R" hint="project total" />
        </InputSection>

        {/* Monthly opex */}
        <InputSection title={`Capitalized OPEX — per month × ${dur} months build`}>
          <InputField label="Casuals / mo"   value={inp.monthly_opex.casuals}   onChange={v => setMonthlyOpex('casuals', v)}   prefix="R" />
          <InputField label="Fuel / mo"      value={inp.monthly_opex.fuel}      onChange={v => setMonthlyOpex('fuel', v)}      prefix="R" />
          <InputField label="Overheads / mo" value={inp.monthly_opex.overheads} onChange={v => setMonthlyOpex('overheads', v)} prefix="R" />
          <InputField label="Sales / mo"     value={inp.monthly_opex.sales}     onChange={v => setMonthlyOpex('sales', v)}     prefix="R" />
          <InputField label="Ad Hoc / mo"    value={inp.monthly_opex.ad_hoc}    onChange={v => setMonthlyOpex('ad_hoc', v)}    prefix="R" hint="contingency / variable" />
        </InputSection>



      </div>

      {/* ── Save bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-colors"
        >
          {saving ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
          ) : saved ? (
            <><CheckCircle2 className="w-4 h-4 text-emerald-300" />Saved</>
          ) : (
            <><Save className="w-4 h-4" />Save {project.name}</>
          )}
        </button>
        {saveError && (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <AlertCircle className="w-4 h-4" />{saveError}
          </span>
        )}
        <span className="text-xs text-gray-500">
          Changes are live in the summary table immediately. Save to persist.
        </span>
      </div>

      {/* ── Monthly Forecast (collapsible) ────────────────────────────── */}
      <div className="rounded-lg border border-gray-700 overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-700 transition-colors text-sm font-semibold text-white"
          onClick={toggleForecast}
        >
          <span>Monthly Forecast</span>
          {forecastLoading
            ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            : forecastOpen
            ? <ChevronDown className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>

        {forecastOpen && forecastData && (
          <div className="space-y-4 p-4 bg-gray-900">
            <ForecastTable title="Rollout Plan" months={forecastData.months} rows={forecastData.rolloutPlan} format="int" />
            <ForecastTable title="COS Category — Forecast" months={forecastData.months} rows={forecastData.cosCategories} format="zar" />
            <ForecastTable title="Revenue — Forecast" months={forecastData.months} rows={forecastData.revenueForecast} format="zar" />
          </div>
        )}
      </div>

    </div>
  );
}
