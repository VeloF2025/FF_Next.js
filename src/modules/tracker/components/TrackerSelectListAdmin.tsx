'use client';

import { useEffect, useState, useCallback } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { log } from '@/lib/logger';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface SelectListEntry {
  id: string;
  list_name: string;
  value: string;
  sort_order: number;
}

type ListName = 'Contractor' | 'PoleType' | 'PoleRouteType' | 'CWCStatus' | 'ActivationTeam' | 'OpticalType' | 'OpticalSplitter' | 'TestingStatus' | 'PonStatus';

const LIST_NAMES: ListName[] = [
  'Contractor',
  'PoleType',
  'PoleRouteType',
  'CWCStatus',
  'ActivationTeam',
  'OpticalType',
  'OpticalSplitter',
  'TestingStatus',
  'PonStatus',
];

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
    <div className="flex-1 rounded-lg border border-slate-700 overflow-hidden">
      <div className="px-3 py-2 bg-slate-800 border-b border-slate-700">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{listName}</span>
      </div>

      <div className="divide-y divide-slate-800 min-h-[60px]">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700/50"
          >
            <span>{entry.value}</span>
            <button
              onClick={() => onDelete(entry.id)}
              className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-slate-700 transition-colors"
              title={`Delete "${entry.value}"`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="px-3 py-3 text-xs text-slate-600 italic">No values yet</div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-t border-slate-700">
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd();
          }}
          placeholder="Add value…"
          className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-400 transition-colors"
        />
        <button
          onClick={() => void handleAdd()}
          disabled={adding || !newValue.trim()}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition-colors"
        >
          {adding ? <InlineSpinner size="sm" /> : <Plus className="w-3 h-3" />}
          Add
        </button>
      </div>
    </div>
  );
}

export function TrackerSelectListAdmin() {
  const [entries, setEntries] = useState<SelectListEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tracker/selectlists?full=true');
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const { data } = (await res.json()) as { data: SelectListEntry[] };
      setEntries(data ?? []);
    } catch (err) {
      log.error('TrackerSelectListAdmin load failed', { err: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = useCallback(
    async (id: string) => {
      // Optimistic remove
      setEntries((prev) => prev.filter((e) => e.id !== id));
      try {
        const res = await fetch(`/api/tracker/selectlists/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          log.error('TrackerSelectListAdmin delete failed', { id, status: res.status });
          void load(); // Reload to restore actual state
        }
      } catch (err) {
        log.error('TrackerSelectListAdmin delete error', { err: String(err) });
        void load();
      }
    },
    [load]
  );

  const handleAdd = useCallback(async (listName: ListName, value: string) => {
    try {
      const res = await fetch('/api/tracker/selectlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_name: listName, value }),
      });
      if (!res.ok) throw new Error(`Failed to add: ${res.status}`);
      const { data } = (await res.json()) as { data: SelectListEntry };
      setEntries((prev) => [...prev, data]);
    } catch (err) {
      log.error('TrackerSelectListAdmin add failed', { listName, value, err: String(err) });
    }
  }, []);

  if (loading) {
    return <div className="py-16 text-center text-slate-500">Loading…</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {LIST_NAMES.map((listName) => (
        <SingleList
          key={listName}
          listName={listName}
          entries={entries.filter((e) => e.list_name === listName)}
          onDelete={handleDelete}
          onAdd={handleAdd}
        />
      ))}
    </div>
  );
}
