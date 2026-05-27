/**
 * Lightweight typeahead for the review filter.
 *
 * Generic over the search endpoint — passes `?search=<q>` and expects
 * `{ success: true, data: <list> }`. Caller maps the row shape into
 * `{ id, primary, secondary? }` via `mapRow`.
 *
 * Three states:
 *   1. Nothing selected → search input + dropdown of matches.
 *   2. Selected → name pill + clear (×).
 *
 * Keyboard: ↑/↓ navigate matches, Enter selects, Esc closes.
 *
 * Caller is responsible for stable identity of the selected id.
 * Selection is fire-and-forget — the parent owns state.
 */

import React from 'react';
import { Search, X, Loader2 } from 'lucide-react';

export interface EntityHit {
  id: string;
  primary: string;
  secondary?: string;
}

interface Props {
  /**
   * Endpoint that accepts `?search=<q>` and returns
   * `{ success: true, data: ROW[] }`.
   */
  searchUrl: string;
  /** Map a backend row into the display shape. */
  mapRow: (row: unknown) => EntityHit | null;
  selectedId: string;
  /** Optional pre-resolved label for the selected id (so the chip
   *  doesn't show a UUID after page reload before search completes). */
  selectedLabel?: string | null;
  onChange: (id: string, label: string | null) => void;
  placeholder: string;
  label: string;
  minChars?: number;
}

export function EntitySearch({
  searchUrl,
  mapRow,
  selectedId,
  selectedLabel,
  onChange,
  placeholder,
  label,
  minChars = 2,
}: Props) {
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<EntityHit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  // Stable ids so screen readers can announce the listbox + active
  // descendant. React.useId is stable across renders + SSR.
  const reactId = React.useId();
  const listboxId = `${reactId}-listbox`;
  const optionId = (i: number) => `${reactId}-option-${i}`;
  const containerRef = React.useRef<HTMLLabelElement>(null);

  // Close dropdown on outside click.
  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced fetch.
  React.useEffect(() => {
    if (selectedId) return;
    const trimmed = query.trim();
    if (trimmed.length < minChars) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Spinner state lives inside the timer callback so a fast pick or
    // unmount during the debounce window can't strand `loading=true`.
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await fetch(`${searchUrl}${searchUrl.includes('?') ? '&' : '?'}search=${encodeURIComponent(trimmed)}`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setHits([]);
          return;
        }
        const rows = Array.isArray(json.data) ? json.data : [];
        const mapped = rows
          .map((r: unknown) => mapRow(r))
          .filter((h: EntityHit | null): h is EntityHit => h !== null)
          .slice(0, 10);
        setHits(mapped);
        setActiveIdx(0);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setLoading(false);
    };
  }, [query, searchUrl, selectedId, mapRow, minChars]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = hits[activeIdx];
      if (hit) {
        e.preventDefault();
        select(hit);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const select = (hit: EntityHit) => {
    onChange(hit.id, hit.primary);
    setQuery('');
    setHits([]);
    setOpen(false);
  };

  const clear = () => {
    onChange('', null);
    setQuery('');
  };

  if (selectedId) {
    return (
      <label className="block">
        <span className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">{label}</span>
        <div className="flex items-center gap-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 px-3 py-2">
          <span className="flex-1 truncate" title={selectedLabel ?? selectedId}>
            {selectedLabel ?? selectedId}
          </span>
          <button
            type="button"
            onClick={clear}
            aria-label={`Clear ${label}`}
            className="text-neutral-400 hover:text-neutral-100 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </label>
    );
  }

  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Tab-out: outside-mousedown handler doesn't fire on Tab, so close
    // the dropdown explicitly when focus leaves the whole field.
    // relatedTarget is null when blur is mouse-driven into another tab
    // / window — treat that as a close as well (mousedown handles
    // intra-page outside clicks already).
    const next = e.relatedTarget as Node | null;
    if (!next || !containerRef.current?.contains(next)) {
      setOpen(false);
    }
  };

  const dropdownOpen = open && hits.length > 0;
  const showNoMatches =
    open && !loading && query.trim().length >= minChars && hits.length === 0;

  return (
    <label className="block relative" ref={containerRef}>
      <span className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">{label}</span>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
        <input
          type="text"
          role="combobox"
          aria-expanded={dropdownOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={dropdownOpen ? optionId(activeIdx) : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKey}
          placeholder={placeholder}
          className="w-full rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-100 pl-8 pr-8 py-2"
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 animate-spin" />
        )}
      </div>

      {dropdownOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-800 shadow-xl"
        >
          {hits.map((hit, i) => (
            <li
              key={hit.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                select(hit);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`px-3 py-2 cursor-pointer text-sm ${
                i === activeIdx ? 'bg-blue-600/30 text-blue-100' : 'text-neutral-200 hover:bg-neutral-700'
              }`}
            >
              <div className="font-medium truncate">{hit.primary}</div>
              {hit.secondary && (
                <div className="text-xs text-neutral-400 truncate">{hit.secondary}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showNoMatches && (
        <div
          role="status"
          aria-live="polite"
          className="absolute z-30 mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-neutral-400 shadow-xl"
        >
          No matches.
        </div>
      )}
    </label>
  );
}
