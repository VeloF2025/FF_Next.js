/**
 * SelectListAdmin — Manage conduit select list values (Responsible, Status).
 *
 * Uses GET ?full=true to obtain entries with real database IDs.
 * Add and delete operations update state optimistically with server sync.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectListEntry {
  id: string;
  list_name: string;
  value: string;
  sort_order: number;
}

type ListName = 'Responsible' | 'Status';

// ─── Single list column ───────────────────────────────────────────────────────

function SingleList({
  listName,
  entries,
  onDelete,
  onAdd,
}: {
  listName: ListName;
  entries: SelectListEntry[];
  onDelete: (id: string) => void;
  onAdd: (listName: ListName, value: string) => Promise<void>;
}) {
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const v = newValue.trim();
    if (!v) return;
    setAdding(true);
    try {
      await onAdd(listName, v);
      setNewValue('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex-1 rounded-lg border border-gray-700 overflow-hidden">
      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">{listName}</span>
      </div>

      <div className="divide-y divide-gray-800 min-h-[60px]">
        {entries.map(entry => (
          <div
            key={entry.id}
            className="flex items-center justify-between px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800/50"
          >
            <span>{entry.value}</span>
            <button
              onClick={() => onDelete(entry.id)}
              className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-gray-700 transition-colors"
              title={`Delete "${entry.value}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-600 italic">No values yet</div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-t border-gray-700">
        <input
          type="text"
          value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
          placeholder="Add value…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white outline-none focus:border-teal-500 transition-colors"
        />
        <button
          onClick={() => void handleAdd()}
          disabled={adding || !newValue.trim()}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-40 transition-colors"
        >
          {adding ? <InlineSpinner size="sm" /> : <Plus className="w-3 h-3" />}
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SelectListAdmin() {
  const [entries, setEntries] = useState<SelectListEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // Use ?full=true to get real database IDs alongside values
      const res = await fetch('/api/conduit/selectlists?full=true');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const { data } = await res.json() as { data: SelectListEntry[] };
      setEntries(data ?? []);
    } catch (err) {
      log.error('SelectListAdmin load failed', { err: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    // Optimistic remove
    setEntries(prev => prev.filter(e => e.id !== id));
    try {
      const res = await fetch(`/api/conduit/selectlists/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        log.error('SelectListAdmin delete failed', { id, status: res.status });
        void load(); // Reload to restore actual state
      }
    } catch (err) {
      log.error('SelectListAdmin delete error', { err: String(err) });
      void load();
    }
  }, [load]);

  const handleAdd = useCallback(async (listName: ListName, value: string) => {
    try {
      const res = await fetch('/api/conduit/selectlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_name: listName, value }),
      });
      if (!res.ok) throw new Error(`Failed to add: ${res.status}`);
      const { data } = await res.json() as { data: SelectListEntry };
      setEntries(prev => [...prev, data]);
    } catch (err) {
      log.error('SelectListAdmin add failed', { listName, value, err: String(err) });
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-gray-500 text-sm justify-center">
        <InlineSpinner size="sm" />
        Loading…
      </div>
    );
  }

  const responsibleEntries = entries.filter(e => e.list_name === 'Responsible');
  const statusEntries = entries.filter(e => e.list_name === 'Status');

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-sm font-semibold text-gray-300">Select List Values</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Manage dropdown values used across milestones. Changes take effect immediately.
        </p>
      </div>

      <div className="flex gap-4">
        <SingleList
          listName="Responsible"
          entries={responsibleEntries}
          onDelete={handleDelete}
          onAdd={handleAdd}
        />
        <SingleList
          listName="Status"
          entries={statusEntries}
          onDelete={handleDelete}
          onAdd={handleAdd}
        />
      </div>
    </div>
  );
}
