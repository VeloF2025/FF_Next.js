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
import { ChevronRight, ChevronDown, Save, Loader2, CheckCircle2, AlertCircle, Plus, X, ArrowRight, Trash2, BookMarked } from 'lucide-react';
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

function KpiCard({ label, value, sub, valueClass = 'text-foreground' }: KpiCardProps) {
  // Create aria-label with full semantic meaning: "Total Homes: 1,234"
  const ariaLabel = `${label}: ${value}${sub ? ` — ${sub}` : ''}`;
  
  return (
    <div className="rounded-lg border border-gray-700 bg-card px-5 py-4 min-w-[160px]" role="region" aria-label={ariaLabel}>
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${valueClass}`} aria-hidden="false">{value}</p>
      {sub && <p className="text-xs text-muted-foreground/70 mt-0.5" aria-hidden="true">{sub}</p>}
    </div>
  );
}

// ─── Projects grid (fully self-contained — own state, own KPI tiles) ──────────

interface ProjectsGridProps {
  initialProjects: ConduitProject[];
  tableLabel: string;
  defaultStatus: 'prospective' | 'executable' | 'wip';
  promoteLabel?: string;        // e.g. "→ Executable"
  promoteToStatus?: 'prospective' | 'executable' | 'wip';
  onProjectPromoted?: (project: ConduitProject) => void;
  demoteLabel?: string;
  demoteToStatus?: 'prospective' | 'executable';
  onProjectDemoted?: (project: ConduitProject) => void;
  showAddButton?: boolean;
  showDeleteButton?: boolean;
  showBaselineButton?: boolean;
  onBaselineSaved?: () => void;
}

function ProjectsGrid({
  initialProjects, tableLabel, defaultStatus,
  promoteLabel, promoteToStatus, onProjectPromoted,
  demoteLabel, demoteToStatus, onProjectDemoted,
  showAddButton = true,
  showDeleteButton = false,
  showBaselineButton = false,
  onBaselineSaved,
}: ProjectsGridProps) {
  const [projects, setProjects] = useState<ConduitProject[]>(initialProjects);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<Record<string, boolean>>({});

  const promoteProject = async (project: ConduitProject) => {
    if (!promoteToStatus) return;
    setPromoting(prev => ({ ...prev, [project.id]: true }));
    try {
      const res = await fetch(`/api/conduit/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: promoteToStatus }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { data } = await res.json() as { data: ConduitProject };
      // Remove from this section
      setProjects(prev => prev.filter(p => p.id !== project.id));
      // Notify parent to add to next section
      onProjectPromoted?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promote failed');
    } finally {
      setPromoting(prev => ({ ...prev, [project.id]: false }));
    }
  };

  const demoteProject = async (project: ConduitProject) => {
    if (!demoteToStatus) return;
    setPromoting(prev => ({ ...prev, [project.id]: true }));
    try {
      const res = await fetch(`/api/conduit/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: demoteToStatus }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { data } = await res.json() as { data: ConduitProject };
      setProjects(prev => prev.filter(p => p.id !== project.id));
      onProjectDemoted?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move back failed');
    } finally {
      setPromoting(prev => ({ ...prev, [project.id]: false }));
    }
  };

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
        body: JSON.stringify({ name: addForm.name.trim(), po_count: poCount, build_duration_months: 12, inputs_json: defaultInputs, status: defaultStatus }),
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

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null); // project id pending confirm
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  const deleteProject = async (project: ConduitProject) => {
    setDeleting(prev => ({ ...prev, [project.id]: true }));
    try {
      const res = await fetch(`/api/conduit/projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setProjects(prev => prev.filter(p => p.id !== project.id));
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(prev => ({ ...prev, [project.id]: false }));
    }
  };

  const [baselining, setBaselining] = useState<Record<string, boolean>>({});
  const [baselined, setBaselined] = useState<Record<string, boolean>>({});

  const saveBaseline = async (project: ConduitProject) => {
    setBaselining(prev => ({ ...prev, [project.id]: true }));
    try {
      const calc = calcConduit(project);
      const dateStr = new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
      const label = `${project.name} — ${dateStr}`;
      const res = await fetch('/api/conduit/baselines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          project_name: project.name,
          label,
          inputs_snapshot: project.inputs_json,
          calc_snapshot: calc,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBaselined(prev => ({ ...prev, [project.id]: true }));
      setTimeout(() => setBaselined(prev => ({ ...prev, [project.id]: false })), 2500);
      onBaselineSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Baseline save failed');
    } finally {
      setBaselining(prev => ({ ...prev, [project.id]: false }));
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
  const th = 'px-3 py-2.5 text-xs font-bold text-foreground uppercase tracking-wide';

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
        <div 
          className="flex items-center gap-2 text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2 text-sm"
          role="alert"
          aria-live="polite"
          aria-atomic="true"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <KpiCard label="Total Homes" value={fNum(totals.po_count)} sub={`${projects.length} projects`} />
        <KpiCard label="FC Activations" value={fNum(totals.fc_activation)} sub="forecasted connected homes" />
        <KpiCard label="Total Revenue" value={fZAR(totals.revenue)} sub="forecasted revenue" />
        <KpiCard label="Total COS" value={fZAR(totals.cos_total)} sub="forecasted cost of sales" />
        <KpiCard 
          label="Total Profit" 
          value={fZAR(totals.profit)} 
          sub="forecasted profit" 
          valueClass={totals.profit < 0 ? 'text-red-400' : 'text-emerald-400'} 
        />
        <KpiCard 
          label="Portfolio GP%" 
          value={fPct(totalGP)} 
          sub="forecasted gross profit"
          valueClass={totalGP >= 0.30 ? 'text-emerald-400' : totalGP >= 0.10 ? 'text-amber-400' : 'text-red-400'} 
        />
      </div>

      {/* Add Project button + inline form */}
      {showAddButton && !showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
        >
          <Plus className="w-4 h-4" />
          Add Project
        </button>
      )}
      {showAddButton && showAddForm && (
        <div className="rounded-lg border border-gray-600 bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">New Project</h3>
            <button onClick={() => { setShowAddForm(false); setAddError(null); }} className="text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-teal-500 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2 flex flex-col gap-1">
              <label htmlFor="add-project-name" className="text-xs text-muted-foreground font-medium">Project Name</label>
              <input
                id="add-project-name"
                type="text"
                value={addForm.name}
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="e.g. Mamelodi POP 2"
                autoFocus
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="add-project-po-count" className="text-xs text-muted-foreground font-medium">PO Count</label>
              <input
                id="add-project-po-count"
                type="text"
                inputMode="numeric"
                value={addForm.po_count}
                onChange={e => setAddForm(f => ({ ...f, po_count: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="e.g. 12000"
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="add-project-rate" className="text-xs text-muted-foreground font-medium">Rate (R)</label>
              <input
                id="add-project-rate"
                type="text"
                inputMode="numeric"
                value={addForm.rate}
                onChange={e => setAddForm(f => ({ ...f, rate: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="2700"
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="add-project-uptake" className="text-xs text-muted-foreground font-medium">Uptake %</label>
              <input
                id="add-project-uptake"
                type="text"
                inputMode="numeric"
                value={addForm.uptake}
                onChange={e => setAddForm(f => ({ ...f, uptake: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && submitAdd()}
                placeholder="60"
                className="bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-teal-500 focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
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
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {adding ? 'Adding…' : 'Add Project'}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setAddError(null); }}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 rounded"
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
            <tr className="bg-card">
              <th className={th} style={{ width: 32 }} scope="col" aria-label="Expand row"></th>
              <th className={`${th} text-left`} style={{ minWidth: 200 }} scope="col">{tableLabel}</th>
              <th className={`${th} text-right`} style={{ minWidth: 90 }} scope="col">PO Count</th>
              <th className={`${th} text-right`} style={{ minWidth: 80 }} scope="col">Rate</th>
              <th className={`${th} text-right`} style={{ minWidth: 80 }} scope="col">Uptake</th>
              <th className={`${th} text-right`} style={{ minWidth: 110 }} scope="col">FC Activations</th>
              <th className={`${th} text-right`} style={{ minWidth: 120 }} scope="col">Revenue</th>
              <th className={`${th} text-right`} style={{ minWidth: 120 }} scope="col">COS Total</th>
              <th className={`${th} text-right`} style={{ minWidth: 120 }} scope="col">Profit</th>
              <th className={`${th} text-right`} style={{ minWidth: 70 }} scope="col">GP%</th>
              <th className={`${th} text-right`} style={{ minWidth: 100 }} scope="col">Cost/Home</th>
              <th className={`${th} text-right`} style={{ minWidth: 60 }} scope="col">Build Duration</th>
              <th className={th} style={{ minWidth: 200 }} scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, i) => {
              const calc = calcConduit(project);
              const isExpanded = expanded.has(project.id);
              const isSaving = saving[project.id] ?? false;
              const justSaved = saved[project.id] ?? false;
              const rowBg = i % 2 === 0 ? 'bg-gray-950/40' : 'bg-gray-900/40';
              return [
                <tr key={project.id} className={`${rowBg} hover:bg-gray-700/30 transition-colors`}>
                  <td
                    role="button"
                    tabIndex={0}
                    className="px-2 py-2 text-center cursor-pointer text-muted-foreground hover:text-foreground border border-gray-700"
                    onClick={() => toggleExpand(project.id)}
                    aria-label={isExpanded ? `Collapse ${project.name} details` : `Expand ${project.name} details`}
                    aria-expanded={isExpanded}
                    aria-controls={`detail-${project.id}`}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpand(project.id);
                      }
                    }}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}
                  </td>
                  <td className="px-3 py-2 text-sm font-medium text-foreground border border-gray-700 cursor-pointer hover:text-white" onClick={() => toggleExpand(project.id)}>{project.name}</td>
                  <td className="px-3 py-2 text-sm text-right bg-gray-800/40 border border-gray-700 text-foreground tabular-nums">{fNum(project.po_count)}</td>
                  <EditableCell value={project.inputs_json.rate} onCommit={v => updateInputs(project.id, 'rate', v)} />
                  <EditableCell value={project.inputs_json.uptake} type="percent" onCommit={v => updateInputs(project.id, 'uptake', v)} />
                  <ReadCell value={calc.fc_activation} format="num" />
                  <ReadCell value={calc.revenue} />
                  <ReadCell value={calc.cos_total} />
                  <ReadCell value={calc.profit} />
                  <ReadCell value={calc.gross_profit_pct} format="pct" />
                  <ReadCell value={calc.cost_per_home} />
                  <td className="px-2 py-2 text-right text-sm tabular-nums text-foreground border border-gray-700 bg-gray-900">{project.build_duration_months}</td>
                  <td className="px-2 py-2 text-center border border-gray-700 bg-gray-900">
                    <div className="flex items-center gap-1 justify-center whitespace-nowrap">
                      {showBaselineButton && (
                        <button
                          onClick={() => saveBaseline(project)}
                          disabled={baselining[project.id]}
                          title="Save to Baseline"
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-indigo-800 hover:bg-indigo-700 text-indigo-200 disabled:opacity-40 transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
                        >
                          {baselining[project.id]
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : baselined[project.id]
                            ? <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                            : <BookMarked className="w-3 h-3" />}
                          {baselining[project.id] ? 'Saving…' : baselined[project.id] ? 'Saved!' : 'Baseline'}
                        </button>
                      )}
                      <button onClick={() => saveProject(project)} disabled={isSaving || project.is_baseline_locked} className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-teal-500 outline-none">
                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : justSaved ? <CheckCircle2 className="w-3 h-3 text-emerald-300" /> : <Save className="w-3 h-3" />}
                        {isSaving ? 'Saving' : justSaved ? 'Saved' : 'Save'}
                      </button>
                      {demoteToStatus && demoteLabel && (
                        <button
                          onClick={() => demoteProject(project)}
                          disabled={promoting[project.id]}
                          title={demoteLabel}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-gray-500 outline-none"
                        >
                          {promoting[project.id]
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <ArrowRight className="w-3 h-3 rotate-180" />}
                          {promoting[project.id] ? '…' : demoteLabel}
                        </button>
                      )}
                      {promoteToStatus && promoteLabel && (
                        <button
                          onClick={() => promoteProject(project)}
                          disabled={promoting[project.id]}
                          title={promoteLabel}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-700 hover:bg-indigo-700 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
                        >
                          {promoting[project.id]
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <ArrowRight className="w-3 h-3" />}
                          {promoting[project.id] ? '…' : promoteLabel}
                        </button>
                      )}
                      {showDeleteButton && (
                        confirmDelete === project.id ? (
                          <span className="flex items-center gap-1">
                            <span className="text-xs text-red-400 whitespace-nowrap">Sure?</span>
                            <button
                              onClick={() => deleteProject(project)}
                              disabled={deleting[project.id]}
                              className="px-2 py-1 rounded text-xs font-medium bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-red-500 outline-none"
                            >
                              {deleting[project.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes'}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-gray-500 outline-none"
                            >No</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(project.id)}
                            title="Delete project"
                            className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors focus-visible:ring-2 focus-visible:ring-red-500 outline-none"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>,
                isExpanded ? (
                  <tr key={`${project.id}-detail`} id={`detail-${project.id}`}>
                    <td colSpan={TOTAL_COLS} className="p-0 border border-gray-600 max-w-0 overflow-hidden">
                      <ProjectDetailPanel project={project} onProjectUpdate={updated => setProjects(prev => prev.map(p => p.id === updated.id ? updated : p))} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="bg-card">
              <td colSpan={2} className="px-3 py-2.5 text-sm font-bold text-foreground">TOTAL</td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-foreground tabular-nums">{fNum(totals.po_count)}</td>
              <td colSpan={2}></td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-foreground tabular-nums">{fNum(totals.fc_activation)}</td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-foreground tabular-nums">{fZAR(totals.revenue)}</td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-foreground tabular-nums">{fZAR(totals.cos_total)}</td>
              <td className={`px-3 py-2.5 text-sm text-right font-bold tabular-nums ${totals.profit < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fZAR(totals.profit)}</td>
              <td className={`px-3 py-2.5 text-sm text-right font-bold tabular-nums ${totalGP < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{fPct(totalGP)}</td>
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
  prospectiveProjects: ConduitProject[];
  executableProjects:  ConduitProject[];
  wipProjects:         ConduitProject[];
  onBaselineSaved?: () => void;
}

export function PortfolioTable({ prospectiveProjects, executableProjects, wipProjects, onBaselineSaved }: PortfolioTableProps) {
  const [prospective, setProspective] = useState<ConduitProject[]>(prospectiveProjects);
  const [executable,  setExecutable]  = useState<ConduitProject[]>(executableProjects);
  const [wip,         setWip]         = useState<ConduitProject[]>(wipProjects);

  return (
    <div className="space-y-10">

      {/* ── Prospective ──────────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-widest border border-purple-500 text-purple-400 px-3 py-1 rounded">
            Prospective
          </span>
          <div className="flex-1 border-t border-gray-700" />
        </div>
        <ProjectsGrid
          initialProjects={prospective}
          tableLabel="Project Scope — Prospective"
          defaultStatus="prospective"
          promoteLabel="→ Executable"
          promoteToStatus="executable"
          onProjectPromoted={p => setExecutable(prev => [...prev, p])}
          showDeleteButton
          showAddButton
        />
      </div>

      {/* ── Forecasted — Executable ───────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-widest border border-teal-500 text-teal-400 px-3 py-1 rounded">
            Forecasted — Executable
          </span>
          <div className="flex-1 border-t border-gray-700" />
        </div>
        <ProjectsGrid
          initialProjects={executable}
          tableLabel="Project Scope — Executable"
          defaultStatus="executable"
          promoteLabel="→ WIP"
          promoteToStatus="wip"
          onProjectPromoted={p => setWip(prev => [...prev, p])}
          demoteLabel="← Prospective"
          demoteToStatus="prospective"
          onProjectDemoted={p => setProspective(prev => [...prev, p])}
          showBaselineButton
          onBaselineSaved={onBaselineSaved}
          showAddButton
        />
      </div>

      {/* ── Work in Progress ─────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-widest border border-orange-500 text-orange-400 px-3 py-1 rounded">
            Work in Progress
          </span>
          <div className="flex-1 border-t border-gray-700" />
        </div>
        {wip.length > 0 ? (
          <ProjectsGrid
            initialProjects={wip}
            tableLabel="Project Scope — WIP"
            defaultStatus="wip"
            showAddButton={false}
          />
        ) : (
          <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-8 text-center text-gray-500">
            <p className="text-sm">No projects in progress yet — promote from Executable using the → WIP button.</p>
          </div>
        )}
      </div>



    </div>
  );
}
