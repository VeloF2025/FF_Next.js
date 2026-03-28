'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  column: string;
  values: string[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

export function ColumnFilter({ column, values, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = values.filter((v) => v.toLowerCase().includes(search.toLowerCase()));
  const isActive = selected.size > 0;

  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  function selectAll() {
    onChange(new Set());
  }

  function clearAll() {
    onChange(new Set(values));
  }

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`ml-1 p-0.5 rounded transition-colors ${
          isActive
            ? 'text-blue-400 bg-blue-900/40'
            : 'text-slate-500 hover:text-slate-300'
        }`}
        title={`Filter ${column}`}
      >
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 z-50 mt-1 w-52 bg-slate-800 border border-slate-600 rounded-lg shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-slate-700">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex gap-2 px-2 py-1.5 border-b border-slate-700">
            <button
              onClick={selectAll}
              className="text-[10px] text-blue-400 hover:text-blue-300"
            >
              All
            </button>
            <span className="text-slate-600">·</span>
            <button
              onClick={clearAll}
              className="text-[10px] text-slate-400 hover:text-slate-300"
            >
              Clear
            </button>
            {isActive && (
              <span className="text-[10px] text-blue-400 ml-auto">
                {selected.size} hidden
              </span>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500 italic">
                No values
              </div>
            )}
            {filtered.map((v) => (
              <label
                key={v}
                className="flex items-center gap-2 px-3 py-1 hover:bg-slate-700/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={!selected.has(v)}
                  onChange={() => toggle(v)}
                  className="w-3 h-3 accent-blue-500"
                />
                <span className="text-xs text-slate-300 truncate">
                  {v || '(blank)'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
