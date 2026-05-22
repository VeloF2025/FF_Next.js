import { useState, useEffect, useRef } from 'react';
import type { SerialSearchFilters } from '@/types/field-stock';
import type { SerialSearchProps } from './SerialSearch.props';

const DEBOUNCE_MS = 300;

// Mirrors stock_serials.status CHECK constraint exactly.
// Source of truth: docs/superpowers/probes/2026-05-21-wave2-schema-probe.md
const STATUS_OPTIONS = [
  'available',
  'reserved',
  'allocated_to_project',
  'in_transit',
  'issued',
  'installed',
  'activated',
  'faulty',
  'in_repair',
  'returned',
  'scrapped',
] as const;

function toggleStatus(prev: string[] | undefined, value: string): string[] {
  const set = new Set(prev ?? []);
  if (set.has(value)) set.delete(value); else set.add(value);
  return Array.from(set);
}

export function SerialSearch({ initialFilters, onFiltersChange, categories = [] }: SerialSearchProps) {
  const [filters, setFilters] = useState<SerialSearchFilters>(initialFilters);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onFiltersChange(filters), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, onFiltersChange]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        aria-label="Serial or MAC"
        placeholder="Serial number or MAC…"
        value={filters.q ?? ''}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
        className="w-full rounded border px-3 py-2"
      />
      <fieldset className="space-y-1">
        <legend className="text-xs uppercase text-neutral-500">Status</legend>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((s) => (
            <label key={s} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                aria-label={s}
                checked={(filters.status ?? []).includes(s)}
                onChange={() => setFilters((f) => ({ ...f, status: toggleStatus(f.status, s) }))}
              />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        <span className="text-xs uppercase text-neutral-500">Category</span>
        <select
          aria-label="Category"
          value={filters.category ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}
          className="mt-1 block w-full rounded border px-2 py-1"
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    </div>
  );
}
