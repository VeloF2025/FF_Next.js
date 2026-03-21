/**
 * PortfolioTable — Inline-editable project summary table.
 *
 * Editable cells (white bg): Name, PO Count, Rate, Uptake %, Build Duration, Start Date
 * Calculated cells (pale green): FC Activation, Revenue, COS Total, Profit, GP%, Cost/Home
 *
 * Click any editable cell → edit in place → blur → instant recalculate.
 * [Save] button persists all changes to the API.
 */

'use client';

import { useState, useRef, useCallback } from 'react';
import { Save, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ConduitProject, ConduitProjectInputs } from '../types';
import { calcConduit } from '../hooks/useConduitCalc';

// ─── Formatting helpers ────────────────────────────────────────────────────

function fZAR(v: number): string {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(Math.round(v));
  const s = abs.toLocaleString('en-ZA').replace(/,/g, '\u00a0');
  return `${v < 0 ? '-' : ''}R\u00a0${s}`;
}

function fPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fNum(v: number): string {
  return Math.round(v).toLocaleString('en-ZA').replace(/,/g, '\u00a0');
}

// ─── Editable cell ────────────────────────────────────────────────────────

interface EditableCellProps {
  value: string | number;
  onCommit: (val: string) => void;
  type?: 'text' | 'number' | 'date' | 'percent';
  align?: 'left' | 'right';
  disabled?: boolean;
}

function EditableCell({ value, onCommit, type = 'number', align = 'right', disabled = false }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = type === 'percent'
    ? `${(Number(value) * 100).toFixed(1)}%`
    : type === 'number'
    ? fNum(Number(value))
    : String(value ?? '');

  const startEdit = () => {
    if (disabled) return;
    const raw = type === 'percent' ? String(Number(value) * 100) : String(value ?? '');
    setDraft(raw);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    setEditing(false);
    if (draft === String(value)) return;
    const committed = type === 'percent' ? String(Number(draft) / 100) : draft;
    onCommit(committed);
  };

  const tdClass = `px-3 py-2 text-sm ${align === 'right' ? 'text-right' : 'text-left'} bg-white border border-gray-200 cursor-text hover:bg-blue-50 transition-colors`;

  if (editing) {
    return (
      <td className={tdClass} style={{ minWidth: 80 }}>
        <input
          ref={inputRef}
          type={type === 'percent' ? 'number' : type}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="w-full bg-transparent outline-none text-sm text-right font-medium text-gray-900"
          step={type === 'percent' ? '0.1' : undefined}
        />
      </td>
    );
  }

  return (
    <td className={tdClass} onClick={startEdit}>
      <span className="font-medium text-gray-900">{displayValue}</span>
    </td>
  );
}

// ─── Calculated cell ──────────────────────────────────────────────────────

function CalcCell({ value, format = 'zar', negative = false }: { value: number; format?: 'zar' | 'pct' | 'num'; negative?: boolean }) {
  const display = format === 'zar' ? fZAR(value) : format === 'pct' ? fPct(value) : fNum(value);
  const color = negative && value < 0 ? 'text-red-600' : negative && value > 0 ? 'text-emerald-700' : 'text-emerald-800';
  return (
    <td className="px-3 py-2 text-sm text-right bg-emerald-50 border border-emerald-100">
      <span className={`font-medium tabular-nums ${color}`}>{display}</span>
    </td>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

interface PortfolioTableProps {
  initialProjects: ConduitProject[];
}

export function PortfolioTable({ initialProjects }: PortfolioTableProps) {
  const [projects, setProjects] = useState<ConduitProject[]>(initialProjects);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // Deep-update a project field
  const updateProject = useCallback((id: string, updater: (p: ConduitProject) => ConduitProject) => {
    setProjects(prev => prev.map(p => p.id === id ? updater(p) : p));
    setSaved(prev => ({ ...prev, [id]: false }));
  }, []);

  const updateTopLevel = (id: string, field: keyof ConduitProject, raw: string) => {
    updateProject(id, p => ({ ...p, [field]: field === 'po_count' || field === 'build_duration_months' ? Number(raw) : raw }));
  };

  const updateInputs = (id: string, field: keyof ConduitProjectInputs, raw: string) => {
    updateProject(id, p => ({
      ...p,
      inputs_json: { ...p.inputs_json, [field]: Number(raw) },
    }));
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
          version_label: `Manual save ${new Date().toLocaleString('en-ZA')}`,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { data } = await res.json() as { data: ConduitProject };
      setProjects(prev => prev.map(p => p.id === data.id ? data : p));
      setSaved(prev => ({ ...prev, [project.id]: true }));
      setTimeout(() => setSaved(prev => ({ ...prev, [project.id]: false })), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(prev => ({ ...prev, [project.id]: false }));
    }
  };

  // Header style
  const thClass = 'px-3 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thRightClass = `${thClass} text-right`;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="min-w-max w-full border-collapse text-sm">
          {/* Column group labels */}
          <thead>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              <th className={thClass} colSpan={6}>INPUTS (editable)</th>
              <th className={`${thClass} text-right`} colSpan={6} style={{ backgroundColor: '#1e5440' }}>
                CALCULATED (live)
              </th>
              <th className={thClass} style={{ width: 80 }}></th>
            </tr>
            <tr style={{ backgroundColor: '#1a3a4a' }}>
              {/* Editable columns */}
              <th className={thClass} style={{ minWidth: 160 }}>Project</th>
              <th className={thRightClass} style={{ minWidth: 90 }}>PO Count</th>
              <th className={thRightClass} style={{ minWidth: 80 }}>Rate (R)</th>
              <th className={thRightClass} style={{ minWidth: 80 }}>Uptake %</th>
              <th className={thRightClass} style={{ minWidth: 100 }}>Build (mo)</th>
              <th className={thRightClass} style={{ minWidth: 120 }}>Start Date</th>
              {/* Calculated columns */}
              <th className={`${thRightClass}`} style={{ backgroundColor: '#1e5440', minWidth: 110 }}>FC Activations</th>
              <th className={`${thRightClass}`} style={{ backgroundColor: '#1e5440', minWidth: 120 }}>Revenue</th>
              <th className={`${thRightClass}`} style={{ backgroundColor: '#1e5440', minWidth: 120 }}>COS Total</th>
              <th className={`${thRightClass}`} style={{ backgroundColor: '#1e5440', minWidth: 120 }}>Profit</th>
              <th className={`${thRightClass}`} style={{ backgroundColor: '#1e5440', minWidth: 80 }}>GP %</th>
              <th className={`${thRightClass}`} style={{ backgroundColor: '#1e5440', minWidth: 110 }}>Cost / Home</th>
              {/* Actions */}
              <th className={thClass} style={{ minWidth: 72 }}></th>
            </tr>
          </thead>

          <tbody>
            {projects.map(project => {
              const calc = calcConduit(project);
              const isSaving = saving[project.id] ?? false;
              const justSaved = saved[project.id] ?? false;
              return (
                <tr key={project.id} className="hover:bg-gray-50/50">
                  {/* Editable cells */}
                  <EditableCell
                    value={project.name}
                    type="text"
                    align="left"
                    onCommit={v => updateTopLevel(project.id, 'name', v)}
                  />
                  <EditableCell
                    value={project.po_count}
                    onCommit={v => updateTopLevel(project.id, 'po_count', v)}
                  />
                  <EditableCell
                    value={project.inputs_json.rate}
                    onCommit={v => updateInputs(project.id, 'rate', v)}
                  />
                  <EditableCell
                    value={project.inputs_json.uptake}
                    type="percent"
                    onCommit={v => updateInputs(project.id, 'uptake', v)}
                  />
                  <EditableCell
                    value={project.build_duration_months}
                    onCommit={v => updateTopLevel(project.id, 'build_duration_months', v)}
                  />
                  <EditableCell
                    value={project.start_date ?? ''}
                    type="date"
                    align="left"
                    onCommit={v => updateTopLevel(project.id, 'start_date', v)}
                  />

                  {/* Calculated cells */}
                  <CalcCell value={calc.fc_activation} format="num" />
                  <CalcCell value={calc.revenue} />
                  <CalcCell value={calc.cos_total} />
                  <CalcCell value={calc.profit} negative />
                  <CalcCell value={calc.gross_profit_pct} format="pct" negative />
                  <CalcCell value={calc.cost_per_home} />

                  {/* Save button */}
                  <td className="px-2 py-2 text-center bg-white border border-gray-200">
                    <button
                      onClick={() => saveProject(project)}
                      disabled={isSaving || project.is_baseline_locked}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-40 transition-colors mx-auto"
                      title={project.is_baseline_locked ? 'Baseline locked' : 'Save changes'}
                    >
                      {isSaving ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : justSaved ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      {isSaving ? 'Saving' : justSaved ? 'Saved' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Totals row */}
          {projects.length > 1 && (() => {
            const totals = projects.reduce((acc, p) => {
              const c = calcConduit(p);
              return {
                po_count: acc.po_count + p.po_count,
                fc_activation: acc.fc_activation + c.fc_activation,
                revenue: acc.revenue + c.revenue,
                cos_total: acc.cos_total + c.cos_total,
                profit: acc.profit + c.profit,
              };
            }, { po_count: 0, fc_activation: 0, revenue: 0, cos_total: 0, profit: 0 });
            const gp_pct = totals.revenue > 0 ? totals.profit / totals.revenue : 0;

            const totalTd = 'px-3 py-2.5 text-sm text-right font-bold text-white tabular-nums';
            return (
              <tfoot>
                <tr style={{ backgroundColor: '#1a3a4a' }}>
                  <td className="px-3 py-2.5 text-sm font-bold text-white" colSpan={2}>TOTAL</td>
                  <td className={totalTd}>{fNum(totals.po_count)}</td>
                  <td colSpan={3}></td>
                  <td className={totalTd}>{fNum(totals.fc_activation)}</td>
                  <td className={totalTd}>{fZAR(totals.revenue)}</td>
                  <td className={totalTd}>{fZAR(totals.cos_total)}</td>
                  <td className={totalTd}>{fZAR(totals.profit)}</td>
                  <td className={totalTd}>{fPct(gp_pct)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Click any white cell to edit. Calculated values update instantly. Press Save to persist.
      </p>
    </div>
  );
}
