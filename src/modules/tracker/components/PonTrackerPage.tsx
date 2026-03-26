'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PonTrackerTable } from './PonTrackerTable';
import { emptyRow } from '../types';
import type { PonRow } from '../types';
import { log } from '@/lib/logger';

interface Props {
  projectId: string;
  projectName?: string;
}

const COLS_ORDER = [
  'zone_no','hld_pon','z_pon','olt_port','scope_poles','scope_drops',
  'pole_permission','poles_planted','cwc_poles_date','cwc_stringing_date',
  'ready_for_optical','cwc_qa','optical_splicing_date','optical_submitted_date',
  'optical_activated_date','atp_qa','sign_ups','homes_po','homes_recon',
  'activated','available','blockage',
] as const;

const COL_LABELS: Record<string, string> = {
  zone_no:'Zone No', hld_pon:'HLD PON', z_pon:'Z-PON', olt_port:'OLT Port',
  scope_poles:'Scope Poles', scope_drops:'Scope Drops', pole_permission:'Pole Permission',
  poles_planted:'Poles Planted', cwc_poles_date:'CWC Poles Date',
  cwc_stringing_date:'CWC Stringing Date', ready_for_optical:'Ready for Optical',
  cwc_qa:'CWC QA', optical_splicing_date:'Opt. Splicing', optical_submitted_date:'Opt. Submitted',
  optical_activated_date:'ATP', atp_qa:'ATP QA', sign_ups:'Sign-ups',
  homes_po:'Homes PO', homes_recon:'Homes Recon', activated:'Activated',
  available:'Available', blockage:'Blockage',
};

export function PonTrackerPage({ projectId, projectName }: Props) {
  const [rows, setRows] = useState<PonRow[]>([]);
  const [saved, setSaved] = useState<PonRow[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tracker/${projectId}`);
      if (!res.ok) throw new Error('Failed to load tracker data');
      const json = (await res.json()) as { data?: { pons?: PonRow[]; lastSavedAt?: string | null } };
      const pons = json.data?.pons ?? [];
      setRows(pons);
      setSaved(pons);
      setLastSaved(json.data?.lastSavedAt ?? null);
    } catch (err) {
      log.error('PonTrackerPage: fetch failed', { err, projectId }, 'tracker');
      setError('Failed to load tracker data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/tracker/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pons: rows }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaved(rows);
      setLastSaved(new Date().toISOString());
      setEditMode(false);
    } catch (err) {
      log.error('PonTrackerPage: save failed', { err, projectId }, 'tracker');
      setError('Save failed — try again');
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const headers = COLS_ORDER.map((k) => COL_LABELS[k] ?? k);
    const csvRows = [
      headers.join(','),
      ...rows.map((r) =>
        COLS_ORDER.map((k) => {
          const v = (r as unknown as Record<string, unknown>)[k];
          const s = v == null ? '' : String(v);
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pon-tracker-${projectName ?? projectId}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    importRef.current?.click();
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) { setError('CSV has no data rows'); return; }
        const headerLine = lines[0] ?? '';
        const headers = headerLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        // Map header labels back to keys
        const labelToKey: Record<string, string> = {};
        for (const [k, label] of Object.entries(COL_LABELS)) labelToKey[label] = k;
        const colKeys = headers.map((h) => labelToKey[h] ?? h.toLowerCase().replace(/\s+/g, '_'));

        const imported: PonRow[] = lines.slice(1).map((line) => {
          const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
          const row = emptyRow();
          colKeys.forEach((k, i) => {
            const v = vals[i] ?? '';
            if (k === 'cwc_qa' || k === 'atp_qa') {
              (row as unknown as Record<string, unknown>)[k] = v === 'true' || v === '1' || v === 'TRUE';
            } else if (['zone_no','hld_pon','z_pon','scope_poles','scope_drops','poles_planted','sign_ups','homes_po','homes_recon','activated','available'].includes(k)) {
              (row as unknown as Record<string, unknown>)[k] = v === '' ? null : Number(v);
            } else {
              (row as unknown as Record<string, unknown>)[k] = v;
            }
          });
          return row;
        });
        setRows(imported);
        setEditMode(true);
        setError(null);
      } catch (err) {
        log.error('Import failed', { err }, 'tracker');
        setError('Failed to parse CSV — check format');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-slate-400">
          {rows.length} row{rows.length !== 1 ? 's' : ''} ·{' '}
          {lastSaved ? `Last saved: ${new Date(lastSaved).toLocaleString('en-ZA')}` : 'Never saved'}
        </p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleExport} className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200">
            ↓ Export CSV
          </button>
          <button onClick={handleImportClick} className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200">
            ↑ Import CSV
          </button>
          <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
          {editMode ? (
            <>
              <button onClick={() => setRows((p) => [...p, emptyRow()])} className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200">
                + Add Row
              </button>
              <button onClick={() => { setRows(saved); setEditMode(false); }} className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200">
                Discard
              </button>
              <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
                {saving ? 'Saving…' : 'Save All'}
              </button>
            </>
          ) : (
            <button onClick={() => setEditMode(true)} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white">
              Edit
            </button>
          )}
        </div>
      </div>

      {error && <div className="px-3 py-2 rounded bg-red-900/30 border border-red-700 text-red-400 text-sm">{error}</div>}

      {loading ? (
        <div className="py-16 text-center text-slate-500">Loading…</div>
      ) : (
        <PonTrackerTable rows={rows} editMode={editMode} onChange={setRows} />
      )}
    </div>
  );
}
