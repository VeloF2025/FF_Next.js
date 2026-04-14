'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { MasterTrackerTable, MASTER_COLS } from './MasterTrackerTable';
import { emptyMasterRow } from '../types/master-tracker.types';
import type { MasterRow } from '../types/master-tracker.types';
import { log } from '@/lib/logger';

interface Props {
  projectId: string;
}

export function MasterTrackerPage({ projectId }: Props) {
  const [rows, setRows] = useState<MasterRow[]>([]);
  const [saved, setSaved] = useState<MasterRow[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectLists, setSelectLists] = useState<Record<string, string[]>>({});
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const importRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [rowsRes, listsRes] = await Promise.all([
        fetch(`/api/tracker/master/${projectId}`),
        fetch('/api/tracker/selectlists'),
      ]);
      if (!rowsRes.ok) throw new Error('Failed to load');
      const rowsJson = (await rowsRes.json()) as { data?: MasterRow[] };
      const listsJson = listsRes.ok ? (await listsRes.json()) as { data?: Record<string, string[]> } : { data: {} };
      // Add inline PoleScope values (not in DB selectlist)
      const lists = { ...(listsJson.data ?? {}), PoleScope: ['PLANNED', 'WIP', 'Done'] };
      setSelectLists(lists);
      const data = rowsJson.data ?? [];
      setRows(data);
      setSaved(data);
    } catch (err) {
      log.error('MasterTrackerPage: fetch failed', { err, projectId }, 'tracker');
      setError('Failed to load tracker data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/tracker/master/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaved(rows);
      setLastSaved(new Date().toISOString());
      setEditMode(false);
    } catch (err) {
      log.error('MasterTrackerPage: save failed', { err, projectId }, 'tracker');
      setError('Save failed — try again');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setRows(saved);
    setEditMode(false);
    setError(null);
  }

  function handleAddRow() {
    if (!editMode) setEditMode(true);
    setRows((prev) => [...prev, emptyMasterRow(projectId)]);
  }

  function handleDeleteRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function exportCsv() {
    const a = document.createElement('a');
    a.href = `/api/tracker/export/master/${projectId}`;
    a.download = `master-tracker-${projectId}.xlsx`;
    a.click();
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
        if (!ws) return;
        const rowData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        const labelToKey: Record<string, keyof MasterRow> = {};
        MASTER_COLS.forEach((c) => { labelToKey[c.label] = c.key; });
        const imported: MasterRow[] = rowData.map((r) => {
          const row = emptyMasterRow(projectId);
          for (const [header, val] of Object.entries(r)) {
            const key = labelToKey[header];
            if (key) (row as unknown as Record<string, unknown>)[key] = val === '' ? null : val;
          }
          return row;
        });
        setRows((prev) => [...prev, ...imported]);
        if (!editMode) setEditMode(true);
      } catch (err) {
        void err;
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
          <Button variant="primary" size="sm" onClick={() => setEditMode(true)}>
            Edit
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </>
        )}
        <Button variant="secondary" size="sm" onClick={handleAddRow}>
          + Add Row
        </Button>
        <Button variant="secondary" size="sm" onClick={exportCsv}>
          Export Excel
        </Button>
        <Button variant="secondary" size="sm" onClick={() => importRef.current?.click()}>
          Import Excel
        </Button>
        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
        {Object.values(filters).some((s) => s.size > 0) && (
          <Button variant="secondary" size="sm" onClick={() => setFilters({})}>
            Clear Filters
          </Button>
        )}
        {lastSaved && <span className="text-xs text-slate-500 ml-2">Saved {new Date(lastSaved).toLocaleTimeString()}</span>}
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-slate-500">Loading…</div>
      ) : (
        <MasterTrackerTable
          rows={rows}
          editMode={editMode}
          selectLists={selectLists}
          onChange={setRows}
          onDeleteRow={handleDeleteRow}
          filters={filters}
          onFiltersChange={setFilters}
        />
      )}
    </div>
  );
}
