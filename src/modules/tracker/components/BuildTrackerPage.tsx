'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import type { BuildRow } from '../types';
import { log } from '@/lib/logger';

const STAGE_COLORS: Record<string, string> = {
  not_started: 'bg-slate-600',
  permissions: 'bg-amber-500',
  poles: 'bg-orange-500',
  cwc: 'bg-yellow-500',
  optical: 'bg-cyan-500',
  atp: 'bg-blue-500',
  activation: 'bg-violet-500',
  maintenance: 'bg-pink-500',
  complete: 'bg-green-500',
};

const STAGE_LABELS: Record<string, string> = {
  not_started: 'Not Started', permissions: 'Permissions', poles: 'Poles',
  cwc: 'CWC', optical: 'Optical', atp: 'ATP',
  activation: 'Activation', maintenance: 'Maintenance', complete: 'Complete',
};

function StageBar({ complete, total, stage }: { complete: number; total: number; stage: string }) {
  if (total === 0) return <span className="text-slate-600 text-xs">—</span>;
  const pct = Math.round((complete / total) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full ${STAGE_COLORS[stage] ?? 'bg-slate-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 whitespace-nowrap">{complete}/{total}</span>
    </div>
  );
}

export function BuildTrackerPage({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<BuildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracker/build/${projectId}`);
      if (!res.ok) throw new Error('Failed to load');
      const json = (await res.json()) as { data?: BuildRow[] };
      setRows(json.data ?? []);
    } catch (err) {
      log.error('BuildTrackerPage: fetch failed', { err, projectId }, 'tracker');
      setError('Failed to load build tracker data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function saveOverride(ponStageId: string, field: string, value: string) {
    try {
      const res = await fetch(`/api/tracker/build/${projectId}/overrides`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pon_stage_id: ponStageId, field, value: value || null }),
      });
      if (!res.ok) throw new Error('Save failed');
      setRows((prev) => prev.map((r) =>
        r.id === ponStageId ? { ...r, pm_blockage: value || null } : r
      ));
    } catch (err) {
      log.error('BuildTrackerPage: override save failed', { err, ponStageId, field }, 'tracker');
    }
    setEditingCell(null);
  }

  if (loading) return <div className="py-16 text-center text-slate-500">Loading build tracker…</div>;
  if (error) return <div className="py-16 text-center text-red-400">{error}</div>;
  if (rows.length === 0) return (
    <div className="py-16 text-center text-slate-500">No PON data found — field systems have not synced yet.</div>
  );

  return (
    <div className="overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
        <span className="text-sm text-slate-400">{rows.length} PONs · Click blockage cell to edit</span>
        <button onClick={() => void fetchData()} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-800/80 text-slate-300 text-xs">
            <th className="px-3 py-2.5 text-left font-medium sticky left-0 bg-slate-800 z-10 w-16">Zone</th>
            <th className="px-3 py-2.5 text-left font-medium w-20">PON</th>
            <th className="px-3 py-2.5 text-left font-medium w-28">OLT Port</th>
            <th className="px-3 py-2.5 text-left font-medium w-28">Stage</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Permissions</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Poles</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">CWC</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Optical</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">ATP</th>
            <th className="px-3 py-2.5 text-left font-medium w-36">Activation</th>
            <th className="px-3 py-2.5 text-right font-medium w-24">String (m)</th>
            <th className="px-3 py-2.5 text-right font-medium w-20">Sign-ups</th>
            <th className="px-3 py-2.5 text-left font-medium w-48">Blockage</th>
            <th className="px-3 py-2.5 text-left font-medium w-32">Last Sync</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const blockage = row.pm_blockage ?? row.auto_blockage;
            const isEditing = editingCell?.id === row.id && editingCell.field === 'blockage';
            return (
              <tr key={row.id} className={`border-t border-slate-700/40 hover:bg-slate-800/40 ${i % 2 !== 0 ? 'bg-slate-800/20' : ''}`}>
                <td className="px-3 py-2 sticky left-0 bg-inherit font-medium text-slate-200 text-sm">{row.zone_no}</td>
                <td className="px-3 py-2 text-slate-300">{row.hld_pon ?? row.pon_no}</td>
                <td className="px-3 py-2 text-slate-400 font-mono text-xs">{row.olt_port ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white" style={{ background: 'rgba(0,0,0,0.3)' }}>
                    {row.overall_stage === 'complete' ? <CheckCircle2 className="w-3 h-3" /> : row.overall_stage === 'not_started' ? <Circle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {STAGE_LABELS[row.overall_stage] ?? row.overall_stage}
                  </span>
                </td>
                <td className="px-3 py-2"><StageBar complete={row.permissions_approved} total={row.permissions_total} stage="permissions" /></td>
                <td className="px-3 py-2"><StageBar complete={row.poles_planted} total={row.poles_total} stage="poles" /></td>
                <td className="px-3 py-2"><StageBar complete={row.cwc_complete} total={row.cwc_total} stage="cwc" /></td>
                <td className="px-3 py-2"><StageBar complete={row.optical_complete} total={row.optical_total} stage="optical" /></td>
                <td className="px-3 py-2"><StageBar complete={row.atp_passed} total={row.atp_total} stage="atp" /></td>
                <td className="px-3 py-2"><StageBar complete={row.activation_complete} total={row.activation_total} stage="activation" /></td>
                <td className="px-3 py-2 text-right text-slate-400 text-xs">{row.scope_string != null ? `${row.scope_string}m` : '—'}</td>
                <td className="px-3 py-2 text-right text-slate-400 text-xs">{row.sign_ups ?? '—'}</td>
                <td className="px-3 py-2">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => void saveOverride(row.id, 'blockage', editValue)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveOverride(row.id, 'blockage', editValue);
                        if (e.key === 'Escape') setEditingCell(null);
                      }}
                      className="w-full bg-slate-700 border border-blue-500 rounded px-2 py-1 text-xs text-slate-100 outline-none"
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingCell({ id: row.id, field: 'blockage' }); setEditValue(blockage ?? ''); }}
                      className={`cursor-text block min-h-[1.5rem] rounded px-1 hover:bg-slate-700/60 text-xs ${blockage ? 'text-amber-400' : 'text-slate-600'}`}
                    >
                      {blockage ?? 'Click to add…'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {row.last_synced_at ? new Date(row.last_synced_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' }) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
