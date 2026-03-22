/**
 * PortfolioTable — v3 Portfolio with KPI tiles + expandable drill-down.
 *
 * KPI tiles live here (client component) so they react to inline edits instantly.
 * Editable inline: Rate, Uptake %, Build Duration
 * Full COS inputs editable via expanded detail panel
 * Read-only summary: PO Count, FC Activations, Revenue, COS Total, Profit, GP%, Cost/Home
 * Cost/Home = COS Total ÷ FC Activations (connected homes, not passed)
 * Expand: click row or chevron => ProjectDetailPanel inline
 */
'use client';

import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Save, Loader2, CheckCircle2, AlertCircle, Plus, X, ArrowRight } from 'lucide-react';
import type { ConduitProject } from '../types';
import { calcConduit } from '../hooks/useConduitCalc';
import { ProjectDetailPanel } from './ProjectDetailPanel';
import { EditableCell, ReadCell, fZAR, fPct, fNum } from './conduit-cells';
import { log } from '@/lib/logger';

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}

function KpiCard({ label, value, sub, valueClass = 'text-white' }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 px-5 py-4 min-w-[160px]">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Projects grid (fully self-contained — own state, own KPI tiles) ──────────

interface ProjectsGridProps {
  initialProjects: ConduitProject[];
  tableLabel: string;
}

function ProjectsGrid({ initialProjects, tableLabel }: ProjectsGridProps) {
  const [projects, setProjects] = useState<ConduitProject[]>(initialProjects);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // ── Add project form ───────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', po_count: '', rate: '2700', uptake: '60' });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const submitAdd = async () => {
    const poCount = Number(addForm.po_count.replace(/[\s,]/g, ''));
    const rate    = Number(addForm.rate.replace(/[\s,]/g, ''));
    const uptake  = Number(addForm.uptake.replace(/[\s,]/g, '')) / 100;

    if (!addForm.name.trim()) { setAddError('Project name is required'); return; }
    if (!poCount || poCount <= 0) { setAddError('PO Count must be greater than 0'); return; }

    setAdding(true);
    setAddError(null);
    try {
      const defaultInputs = {
        rate, uptake,
        scope:         { poles: 0, stringing_m: 0, pon: 0 },
        service_rates: { pole_plant_each: 0, permissions_per_pole: 0, stringing_per_m: 0, optical_per_pon: 0, activation_each: 0, wayleave_incentive: 0 },
        material_rates:{ pole: 0, cable_per_m: 0, optical: 0, activation: 0 },
        monthly_opex:  { casuals: 0, fuel: 0, overheads: 0, sales: 0, ad_hoc: 0 },
        lump_costs:    { wayleave_cost: 0 },
        monthly_plan:  [],
      };

      const res = await fetch('/api/conduit/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addForm.name.trim(), po_count: poCount, build_duration_months: 12, inputs_json: defaultInputs }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { data } = await res.json() as { data: ConduitProject };
      setProjects(prev => [...prev, data]);
      setAddForm({ name: '', po_count: '', rate: '2700', uptake: '60' });
      setShowAddForm(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setAdding(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const updateProject = useCallback(
    (id: string, updater: (p: ConduitProject) => ConduitProject) => {
      setProjects(prev => prev.map(p => (p.id === id ? updater(p) : p)));
      setSaved(prev => ({ ...prev, [id]: false }));
    },
    []
  );

  // Update a top-level scalar field in inputs_json (rate or uptake)
  const updateInputs = (id: string, field: 'rate' | 'uptake', raw: string) => {
    updateProject(id, p => ({
      ...p,
      inputs_json: { ...p.inputs_json, [field]: Number(raw) },
    }));
  };

  const updateDuration = (id: string, raw: string) => {
    updateProject(id, p => ({ ...p, build_duration_months: Number(raw) }));
  };

  const saveProject = async (project: ConduitProject) => {
    setSaving(prev => ({ ...prev, [project.id]: true }));
    setError(null);
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
      setProjects(prev => prev.map(p => (p.id === data.id ? data : p)));
      setSaved(prev => ({ ...prev, [project.id]: true }));
      setTimeout(() => setSaved(prev => ({ ...prev, [project.id]: false })), 2000);
    } catch (err) {
      log.error('PortfolioTable save failed', { id: project.id, err: String(err) });
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(prev => ({ ...prev, [project.id]: false }));
    }
  };

  const TOTAL_COLS = 13;
  const th = 'px-3 py-2.5 text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';

  const totals = projects.reduce(
    (acc, p) => {
      const c = calcConduit(p);
      return {
        po_count: acc.po_count + p.po_count,
        fc_activation: acc.fc_activation + c.fc_activation,
        revenue: acc.revenue + c.revenue,
        cos_total: acc.cos_total + c.cos_total,
        profit: acc.profit + c.profit,
      };
    },
    { po_count: 0, fc_activation: 0, revenue: 0, cos_total: 0, profit: 0 }
  );
  const totalGP = totals.revenue > 0 ? totals.profit / totals.revenue : 0;

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <KpiCard label="Total Homes" value={fNum(totals.po_count)} sub={`${projects.length} projects`} />
        <KpiCard label="FC Activations" value={fNum(totals.fc_activation)} sub="forecasted connected homes" />
        <KpiCard label="Total Revenue" value={fZAR(totals.revenue)} sub="forecasted revenue" />
        <KpiCard label="Total COS" value={fZAR(totals.cos_total)} sub="forecasted cost of sales" />
        <KpiCard label="Total Profit" value={fZAR(totals.profit)} sub="forecasted profit" valueClass={totals.profit < 0 ? 'text-red-400' : 'text-emerald-400'} />
        <KpiCard label="Portfolio GP%" value={fPct(totalGP)} sub="forecasted gross profit"
          valueClass={totalGP >= 0.30 ? 'text-emerald-400' : totalGP >= 0.10 ? 'text-amber-400' : 'text-red-400'} />
      </div>

      {/* Add Project button + inline form */}
      {!showAddForm ? (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 text-gray-300 hover:text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Project
        </button>
      ) : (
        <div className="rounded-lg border border-gray-600 bg-gray-800 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">New Project</h3>
            <button onClick={() => { setShowAddForm(false); setAddError(null); }} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Project Name</label>
              <input
                type="text"
                value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="e.g. Mamelodi POP 2"
                autoFocus
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-teal-500 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">PO Count</label>
              <input
                type="text"
                inputMode="numeric"
                value={addForm.po_count}
                onChange={e => setAddForm(f => ({ ...f, po_count: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="e.g. 12000"
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-teal-500 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Rate (R)</label>
              <input
                type="text"
                inputMode="numeric"
                value={addForm.rate}
                onChange={e => setAddForm(f => ({ ...f, rate: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="2700"
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-teal-500 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Uptake %</label>
              <input
                type="text"
                inputMode="numeric"
                value={addForm.uptake}
                onChange={e => setAddForm(f => ({ ...f, uptake: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="60"
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-teal-500 transition-colors"
              />
            </div>
          </div>

          {addError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />{addError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={submitAdd}
              disabled={adding}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-colors"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {adding ? 'Adding…' : 'Add Project'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setAddError(null); }}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700 shadow-sm">
        <table className="min-w-max w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              <th className={th} style={{ width: 32 }}></th>
              <th className={`${th} text-left`} style={{ minWidth: 200 }}>{tableLabel}</th>
              <th className={`${th} text-right`} style={{ minWidth: 90 }}>PO Count</th>
              <th className={`${th} text-right`} style={{ minWidth: 80 }}>Rate</th>
              <th className={`${th} text-right`} style={{ minWidth: 80 }}>Uptake</th>
              <th className={`${th} text-right`} style={{ minWidth: 110 }}>FC Activations</th>
              <th className={`${th} text-right`} style={{ minWidth: 120 }}>Revenue</th>
              <th className={`${th} text-right`} style={{ minWidth: 120 }}>COS Total</th>
              <th className={`${th} text-right`} style={{ minWidth: 120 }}>Profit</th>
              <th className={`${th} text-right`} style={{ minWidth: 70 }}>GP%</th>
              <th className={`${th} text-right`} style={{ minWidth: 100 }}>Cost/Home</th>
              <th className={`${th} text-right`} style={{ minWidth: 90 }}>Build Duration</th>
              <th className={th} style={{ width: 72 }}></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, i) => {
              const calc = calcConduit(project);
              const isExpanded = expanded.has(project.id);
              const isSaving = saving[project.id] ?? false;
              const justSaved = saved[project.id] ?? false;
              const rowBg = i % 2 === 0 ? '#111827' : '#1f2937';
              return [
                <tr key={project.id} style={{ backgroundColor: rowBg }} className="hover:bg-gray-700/30 transition-colors">
                  <td className="px-2 py-2 text-center cursor-pointer text-gray-400 hover:text-white border border-gray-700" onClick={() => toggleExpand(project.id)}>
                    {isExpanded ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}
                  </td>
                  <td className="px-3 py-2 text-sm font-medium text-gray-200 border border-gray-700 cursor-pointer hover:text-white" onClick={() => toggleExpand(project.id)}>{project.name}</td>
                  <td className="px-3 py-2 text-sm text-right bg-gray-800/40 border border-gray-700 text-gray-300 tabular-nums">{fNum(project.po_count)}</td>
                  <EditableCell value={project.inputs_json.rate} onCommit={v => updateInputs(project.id, 'rate', v)} />
                  <EditableCell value={project.inputs_json.uptake} type="percent" onCommit={v => updateInputs(project.id, 'uptake', v)} />
                  <ReadCell value={calc.fc_activation} format="num" />
                  <ReadCell value={calc.revenue} />
                  <ReadCell value={calc.cos_total} />
                  <ReadCell value={calc.profit} />
                  <ReadCell value={calc.gross_profit_pct} format="pct" />
                  <ReadCell value={calc.cost_per_home} />
                  <td className="px-2 py-2 text-right text-sm tabular-nums text-gray-300 border border-gray-700 bg-gray-900">{project.build_duration_months}</td>
                  <td className="px-2 py-2 text-center border border-gray-700 bg-gray-900">
                    <button onClick={() => saveProject(project)} disabled={isSaving || project.is_baseline_locked} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-40 transition-colors mx-auto">
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : justSaved ? <CheckCircle2 className="w-3 h-3 text-emerald-300" /> : <Save className="w-3 h-3" />}
                      {isSaving ? 'Saving' : justSaved ? 'Saved' : 'Save'}
                    </button>
                  </td>
                </tr>,
                isExpanded ? (
                  <tr key={`${project.id}-detail`}>
                    <td colSpan={TOTAL_COLS} className="p-0 border border-gray-600 max-w-0 overflow-hidden">
                      <ProjectDetailPanel project={project} onProjectUpdate={updated => setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              <td colSpan={2} className="px-3 py-2.5 text-sm font-bold text-white">TOTAL</td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">{fNum(totals.po_count)}</td>
              <td colSpan={2}></td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">{fNum(totals.fc_activation)}</td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">{fZAR(totals.revenue)}</td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">{fZAR(totals.cos_total)}</td>
              <td className={`px-3 py-2.5 text-sm text-right font-bold tabular-nums ${totals.profit < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fZAR(totals.profit)}</td>
              <td className={`px-3 py-2.5 text-sm text-right font-bold tabular-nums ${totalGP < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fPct(totalGP)}</td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-gray-500">Click Rate or Uptake % to edit. Click a row or chevron to drill down.</p>
    </div>
  );
}

// ─── Main wrapper ─────────────────────────────────────────────────────────────

interface PortfolioTableProps {
  initialProjects: ConduitProject[];
}

export function PortfolioTable({ initialProjects }: PortfolioTableProps) {
  const [allProjects, setAllProjects] = useState<ConduitProject[]>(initialProjects);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const prospective = allProjects.filter(p => (p.status ?? 'prospective') === 'prospective');
  const executable  = allProjects.filter(p => p.status === 'executable');
  const actual      = allProjects.filter(p => p.status === 'actual' || p.status === 'wip');

  async function handlePromote(projectId: string) {
    setPromoting(true);
    setPromoteError(null);
    try {
      const res = await fetch(`/api/conduit/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'executable' }),
      });
      if (!res.ok) throw new Error('Failed to promote project');
      setAllProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'executable' as const } : p));
      setShowPromoteModal(false);
    } catch (e) {
      setPromoteError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="space-y-8">

      {/* ── Prospective ──────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-widest border border-purple-500 text-purple-400 px-3 py-1 rounded">
            Prospective
          </span>
          <div className="flex-1 border-t border-gray-700" />
        </div>
        <ProjectsGrid initialProjects={prospective} tableLabel="Project Scope — Prospective" />
      </div>

      {/* ── Forecasted — Executable ───────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-widest border border-teal-500 text-teal-400 px-3 py-1 rounded">
            Forecasted — Executable
          </span>
          <div className="flex-1 border-t border-gray-700" />
          {/* Add Project From Prospective */}
          {prospective.length > 0 && (
            <button
              onClick={() => { setShowPromoteModal(true); setPromoteError(null); }}
              className="flex items-center gap-1.5 text-xs font-semibold text-teal-400 border border-teal-600 hover:bg-teal-900/30 px-3 py-1.5 rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Project From Prospective
            </button>
          )}
        </div>

        {/* Promote modal */}
        {showPromoteModal && (
          <div className="rounded-lg border border-teal-700 bg-gray-900 p-4 space-y-3">
            <p className="text-sm font-semibold text-teal-300">Select a Prospective project to move to Executable:</p>
            {promoteError && <p className="text-xs text-red-400">{promoteError}</p>}
            <div className="space-y-2">
              {prospective.map(p => (
                <button
                  key={p.id}
                  disabled={promoting}
                  onClick={() => handlePromote(p.id)}
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded border border-gray-700 hover:border-teal-500 hover:bg-teal-900/20 text-left transition-colors disabled:opacity-50"
                >
                  <span className="text-sm text-white font-medium">{p.name}</span>
                  <span className="flex items-center gap-1 text-xs text-teal-400">
                    {promoting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                    Move to Executable
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowPromoteModal(false)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {executable.length > 0
          ? <ProjectsGrid initialProjects={executable} tableLabel="Project Scope — Executable" />
          : !showPromoteModal && (
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-8 text-center text-gray-500">
              <p className="text-sm">No executable projects yet — use the button above to add one from Prospective.</p>
            </div>
          )
        }
      </div>

      {/* ── Actual ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pt-2">
          <span className="text-sm font-bold uppercase tracking-widest border border-orange-500 text-orange-400 px-3 py-1 rounded">
            Work in Progress
          </span>
          <div className="flex-1 border-t border-gray-700" />
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-8 text-center text-gray-500">
          <p className="text-sm">Work in Progress — coming soon</p>
        </div>
      </div>

    </div>
  );
}
