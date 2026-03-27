'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
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
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
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
    const a = document.createElement('a');
    a.href = `/api/tracker/export/pon/${projectId}`;
    a.download = `pon-tracker-${projectName ?? projectId}.xlsx`;
    a.click();
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
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
        if (!ws) { setError('Empty workbook'); return; }
        const rowData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        const labelToKey: Record<string, string> = {};
        for (const [k, label] of Object.entries(COL_LABELS)) labelToKey[label] = k;
        const imported: PonRow[] = rowData.map((r) => {
          const row = emptyRow();
          for (const [header, val] of Object.entries(r)) {
            const k = labelToKey[header] ?? header.toLowerCase().replace(/\s+/g, '_');
            if (k === 'cwc_qa' || k === 'atp_qa') {
              (row as unknown as Record<string, unknown>)[k] = val === true || val === 1 || val === 'TRUE' || val === 'true';
            } else if (['zone_no','hld_pon','z_pon','scope_poles','scope_drops','poles_planted','sign_ups','homes_po','homes_recon','activated','available'].includes(k)) {
              (row as unknown as Record<string, unknown>)[k] = val === '' ? null : Number(val);
            } else {
              (row as unknown as Record<string, unknown>)[k] = val === '' ? null : val;
            }
          }
          return row;
        });
        setRows(imported);
        setEditMode(true);
        setError(null);
      } catch (err) {
        log.error('Import failed', { err }, 'tracker');
        setError('Failed to parse file — check format');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {!editMode ? (
          <button onClick={() => setEditMode(true)} className="px-3 py-1.5 rounded text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white transition-colors">
            Edit
          </button>
        ) : (
          <>
            <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 rounded text-xs font-semibold bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setRows(saved); setEditMode(false); }} className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-colors">
              Cancel
            </button>
          </>
        )}
        <button onClick={() => { if (!editMode) setEditMode(true); setRows((p) => [...p, emptyRow()]); }} className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-colors">
          + Add Row
        </button>
        <button onClick={handleExport} className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-colors">
          Export Excel
        </button>
        <button onClick={handleImportClick} className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white transition-colors">
          Import Excel
        </button>
        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
        {Object.values(filters).some((s) => s.size > 0) && (
          <button onClick={() => setFilters({})} className="px-3 py-1.5 rounded text-xs font-semibold bg-amber-700 hover:bg-amber-600 text-white transition-colors">
            Clear Filters
          </button>
        )}
        {lastSaved && <span className="text-xs text-slate-500 ml-2">Saved {new Date(lastSaved).toLocaleTimeString()}</span>}
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-slate-500">Loading…</div>
      ) : (
        <PonTrackerTable rows={rows} editMode={editMode} onChange={setRows} filters={filters} onFiltersChange={setFilters} />
      )}
    </div>
  );
}
