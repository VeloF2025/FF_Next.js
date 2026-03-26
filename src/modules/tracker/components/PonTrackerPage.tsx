'use client';

import { useState, useEffect, useCallback } from 'react';
import { PonTrackerTable } from './PonTrackerTable';
import { emptyRow } from '../types';
import type { PonRow } from '../types';
import { log } from '@/lib/logger';

interface Props {
  projectId: string;
}

export function PonTrackerPage({ projectId }: Props) {
  const [rows, setRows] = useState<PonRow[]>([]);
  const [saved, setSaved] = useState<PonRow[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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

  function handleDiscard() {
    setRows(saved);
    setEditMode(false);
  }

  function handleAddRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {rows.length} row{rows.length !== 1 ? 's' : ''} ·{' '}
          {lastSaved ? `Last saved: ${new Date(lastSaved).toLocaleString('en-ZA')}` : 'Never saved'}
        </p>
        <div className="flex gap-2">
          {editMode ? (
            <>
              <button
                onClick={handleAddRow}
                className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
              >
                + Add Row
              </button>
              <button
                onClick={handleDiscard}
                className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save All'}
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded bg-red-900/30 border border-red-700 text-red-400 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-500">Loading…</div>
      ) : (
        <PonTrackerTable rows={rows} editMode={editMode} onChange={setRows} />
      )}
    </div>
  );
}
