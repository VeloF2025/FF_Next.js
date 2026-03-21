/**
 * PortfolioTable — v3 Portfolio with expandable drill-down.
 *
 * Editable inline: Rate, Uptake %, Build Duration
 * Full COS inputs editable via expanded detail panel
 * Read-only summary: PO Count, FC Activations, Revenue, COS Total, Profit, GP%, Cost/Home
 * Cost/Home = COS Total ÷ FC Activations (connected homes, not passed)
 * Expand: click row or chevron => ProjectDetailPanel inline
 */
'use client';

import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Save, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ConduitProject, ConduitProjectInputs } from '../types';
import { calcConduit } from '../hooks/useConduitCalc';
import { ProjectDetailPanel } from './ProjectDetailPanel';
import { EditableCell, ReadCell, fZAR, fPct, fNum } from './conduit-cells';
import { log } from '@/lib/logger';

// ─── Main component ──────────────────────────────────────────────────────────

interface PortfolioTableProps {
  initialProjects: ConduitProject[];
}

export function PortfolioTable({ initialProjects }: PortfolioTableProps) {
  const [projects, setProjects] = useState<ConduitProject[]>(initialProjects);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

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

  const TOTAL_COLS = 13; // chevron + name + PO + rate + uptake + 5 calc + duration + save
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
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-700 shadow-sm">
        <table className="min-w-max w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              <th className={th} style={{ width: 32 }}></th>
              <th className={`${th} text-left`} style={{ minWidth: 200 }}>
                Project Scope \u2014 Executable
              </th>
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
                <tr
                  key={project.id}
                  style={{ backgroundColor: rowBg }}
                  className="hover:bg-gray-700/30 transition-colors"
                >
                  {/* Chevron */}
                  <td
                    className="px-2 py-2 text-center cursor-pointer text-gray-400 hover:text-white border border-gray-700"
                    onClick={() => toggleExpand(project.id)}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 inline" />
                      : <ChevronRight className="w-4 h-4 inline" />
                    }
                  </td>
                  {/* Project name — read-only, click to expand */}
                  <td
                    className="px-3 py-2 text-sm font-medium text-gray-200 border border-gray-700 cursor-pointer hover:text-white"
                    onClick={() => toggleExpand(project.id)}
                  >
                    {project.name}
                  </td>
                  {/* PO Count — read-only */}
                  <td className="px-3 py-2 text-sm text-right bg-gray-800/40 border border-gray-700 text-gray-300 tabular-nums">
                    {fNum(project.po_count)}
                  </td>
                  {/* Rate — editable */}
                  <EditableCell
                    value={project.inputs_json.rate}
                    onCommit={v => updateInputs(project.id, 'rate', v)}
                  />
                  {/* Uptake — editable */}
                  <EditableCell
                    value={project.inputs_json.uptake}
                    type="percent"
                    onCommit={v => updateInputs(project.id, 'uptake', v)}
                  />
                  {/* Calculated read-only */}
                  <ReadCell value={calc.fc_activation} format="num" />
                  <ReadCell value={calc.revenue} />
                  <ReadCell value={calc.cos_total} />
                  <ReadCell value={calc.profit} />
                  <ReadCell value={calc.gross_profit_pct} format="pct" />
                  <ReadCell value={calc.cost_per_home} />
                  {/* Build Duration — editable */}
                  <EditableCell
                    value={project.build_duration_months}
                    onCommit={v => updateDuration(project.id, v)}
                  />
                  {/* Save */}
                  <td className="px-2 py-2 text-center border border-gray-700 bg-gray-900">
                    <button
                      onClick={() => saveProject(project)}
                      disabled={isSaving || project.is_baseline_locked}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-40 transition-colors mx-auto"
                    >
                      {isSaving
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : justSaved
                        ? <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                        : <Save className="w-3 h-3" />
                      }
                      {isSaving ? 'Saving' : justSaved ? 'Saved' : 'Save'}
                    </button>
                  </td>
                </tr>,

                // Expansion row — passes full project so detail panel can edit all COS inputs
                isExpanded
                  ? (
                    <tr key={`${project.id}-detail`}>
                      <td colSpan={TOTAL_COLS} className="p-0 border border-gray-600">
                        <ProjectDetailPanel
                          project={project}
                          onProjectUpdate={updated => {
                            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
                          }}
                        />
                      </td>
                    </tr>
                  )
                  : null,
              ];
            })}
          </tbody>

          {/* Totals footer */}
          <tfoot>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              <td colSpan={2} className="px-3 py-2.5 text-sm font-bold text-white">
                TOTAL
              </td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">
                {fNum(totals.po_count)}
              </td>
              <td colSpan={2}></td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">
                {fNum(totals.fc_activation)}
              </td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">
                {fZAR(totals.revenue)}
              </td>
              <td className="px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums">
                {fZAR(totals.cos_total)}
              </td>
              <td
                className={`px-3 py-2.5 text-sm text-right font-bold tabular-nums ${
                  totals.profit < 0 ? 'text-red-300' : 'text-emerald-300'
                }`}
              >
                {fZAR(totals.profit)}
              </td>
              <td
                className={`px-3 py-2.5 text-sm text-right font-bold tabular-nums ${
                  totalGP < 0 ? 'text-red-300' : 'text-emerald-300'
                }`}
              >
                {fPct(totalGP)}
              </td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Click Rate, Uptake %, or Build Duration to edit. Click a row or chevron to drill down.
      </p>
    </div>
  );
}
