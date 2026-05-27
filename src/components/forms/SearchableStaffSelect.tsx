/**
 * Searchable single-select for the staff list.
 *
 * Native <select> can't filter by typing, which is unworkable once the org
 * has 80+ staff plus casuals. This component renders a button + dropdown
 * combo with a typeahead input.
 *
 * - Type to filter (matches against fullName + email, case-insensitive).
 * - Arrow keys to navigate, Enter to pick, Esc to close.
 * - Caller passes a pre-sorted `options` array; the component preserves the
 *   given order rather than re-sorting client-side. Most consumers pass
 *   server-sorted lists (last_name ASC, first_name ASC).
 * - Optional `excludeIds` hides already-claimed staff from the candidate
 *   list (e.g. when the same staff has been mapped to a different row in
 *   a multi-row form). The current selection is always kept visible.
 */

import React from 'react';

export interface SearchableStaffOption {
  id: string;
  fullName: string;
  email: string;
  employmentType: 'permanent' | 'casual';
}

export interface SearchableStaffSelectProps {
  value: string | null;
  options: SearchableStaffOption[];
  /** Staff already claimed elsewhere — hidden from the list. */
  excludeIds?: Set<string>;
  onChange: (staffId: string | null) => void;
  /** Visible label when nothing is picked. */
  placeholder?: string;
}

export function SearchableStaffSelect({
  value,
  options,
  excludeIds,
  onChange,
  placeholder = '— pick staff —',
}: SearchableStaffSelectProps) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlightIdx, setHighlightIdx] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selected = value ? options.find((o) => o.id === value) ?? null : null;

  const visibleOptions = React.useMemo(() => {
    if (!excludeIds || excludeIds.size === 0) return options;
    return options.filter((o) => !excludeIds.has(o.id));
  }, [options, excludeIds]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleOptions;
    return visibleOptions.filter(
      (o) =>
        o.fullName.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q)
    );
  }, [visibleOptions, query]);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  React.useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  const commit = (staffId: string | null) => {
    onChange(staffId);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlightIdx];
      if (pick) commit(pick.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="w-full rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-100 px-2 py-1 text-left flex items-center justify-between gap-2"
      >
        <span className={selected ? '' : 'text-neutral-500'}>
          {selected
            ? `${selected.fullName}${
                selected.employmentType === 'casual' ? ' (casual)' : ''
              }`
            : placeholder}
        </span>
        <span className="text-neutral-500">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-md border border-neutral-700 bg-neutral-900 shadow-lg max-h-64 overflow-hidden flex flex-col">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-neutral-800 border-b border-neutral-700 text-xs text-neutral-100 px-2 py-1.5 outline-none"
          />
          <ul className="overflow-y-auto" role="listbox">
            {selected && (
              <li
                role="option"
                aria-selected="false"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(null);
                }}
                className="px-2 py-1 text-[10px] text-red-300 hover:bg-neutral-800 cursor-pointer border-b border-neutral-800"
              >
                Clear selection
              </li>
            )}
            {filtered.length === 0 && (
              <li className="px-2 py-1.5 text-[10px] text-neutral-500">
                {visibleOptions.length === 0
                  ? 'Every staff is already mapped to another row.'
                  : 'No matches.'}
              </li>
            )}
            {filtered.map((s, idx) => (
              <li
                key={s.id}
                role="option"
                aria-selected={s.id === value}
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s.id);
                }}
                className={`px-2 py-1 text-xs cursor-pointer ${
                  idx === highlightIdx ? 'bg-blue-900/50' : 'hover:bg-neutral-800'
                } ${s.id === value ? 'text-emerald-300' : 'text-neutral-100'}`}
              >
                <div>
                  {s.fullName}
                  {s.employmentType === 'casual' && (
                    <span className="ml-1 text-[10px] text-neutral-500">(casual)</span>
                  )}
                </div>
                <div className="text-[10px] text-neutral-500">{s.email}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
