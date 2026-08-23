/**
 * Debounced name-search picker for a UUID queue filter (Project / Staff /
 * Manager). Replaces a bare "paste a UUID" text box with the same
 * type-a-name -> pick-a-match pattern `OversightSection.tsx` already uses
 * for its own user search, backed here by whichever `search` function the
 * caller passes in (each field's search source is permission-scoped
 * differently — see `incidentApi.searchProjects`/`searchStaff` — so this
 * component takes the function rather than assuming one).
 *
 * The underlying filter value stays the resource's `id` throughout — a
 * deep link from `MapAttentionPanel` (`?projectId=…&staffId=…`) still sets
 * it directly, and this component resolves that id's display name on
 * mount (via `resolveById`, a dedicated `?id=` lookup — NOT `search`,
 * which matches names/text and never matches a raw UUID) so the picker
 * never regresses to showing a raw UUID once a value is already selected.
 */
import { useEffect, useRef, useState } from 'react';
import type { ActiveUserOption } from './incidentApi';

export interface IncidentIdFilterProps {
  label: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  search: (term: string, signal?: AbortSignal) => Promise<ActiveUserOption[]>;
  resolveById: (id: string, signal?: AbortSignal) => Promise<ActiveUserOption | null>;
}

export function IncidentIdFilter({ label, value, onChange, search, resolveById }: IncidentIdFilterProps) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ActiveUserOption[]>([]);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const lastResolvedFor = useRef<string | undefined>(undefined);

  // Resolve a value that arrived without ever being picked here (a deep link, or the
  // filter surviving a page reload via the URL) to a display name, once per value.
  useEffect(() => {
    if (!value || lastResolvedFor.current === value) return;
    lastResolvedFor.current = value;
    const controller = new AbortController();
    resolveById(value, controller.signal).then((match) => {
      if (match) setResolvedName(match.name);
    }).catch(() => { /* Falls back to showing the raw id below — still a valid, working filter. */ });
    return () => controller.abort();
  }, [value, resolveById]);

  useEffect(() => {
    if (!query.trim()) { setMatches([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void search(query.trim(), controller.signal).then(setMatches).catch(() => setMatches([]));
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, search]);

  function pick(option: ActiveUserOption): void {
    onChange(option.id);
    setResolvedName(option.name);
    lastResolvedFor.current = option.id;
    setQuery(''); setMatches([]);
  }

  if (value) {
    return (
      <span className="text-sm text-[var(--ff-text-secondary)]">
        {label}: <strong className="text-[var(--ff-text-primary)]">{resolvedName ?? value}</strong>{' '}
        <button type="button" onClick={() => { onChange(undefined); setResolvedName(null); lastResolvedFor.current = undefined; }} className="text-xs underline">Clear</button>
      </span>
    );
  }
  return (
    <span className="relative text-sm text-[var(--ff-text-secondary)]">
      <label>{label}
        <input aria-label={`${label} search`} value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a name…" className="ml-2 w-40 rounded border px-2 py-2" />
      </label>
      {matches.length > 0 && (
        <ul className="absolute left-0 top-full z-10 mt-1 max-h-48 w-56 overflow-auto rounded border bg-[var(--ff-bg-primary)] shadow">
          {matches.map((option) => (
            <li key={option.id}>
              <button type="button" onClick={() => pick(option)} className="block w-full px-2 py-1 text-left text-sm hover:bg-[var(--ff-bg-secondary)]">{option.name}</button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
