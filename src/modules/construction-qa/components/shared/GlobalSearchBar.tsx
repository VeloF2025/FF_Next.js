/**
 * Global Search Bar for Field Ops
 *
 * Debounced search input with dropdown results.
 * Searches feature_id / pole number across all projects.
 * Click result → navigate to project detail with zone/pon context.
 */

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Search, X, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import type { SearchResult } from '../../types/dashboard.types';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  rework_needed: 'bg-orange-500/20 text-orange-400',
};

export function GlobalSearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/construction-qa/search?q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.data?.results || []);
        setOpen(true);
      }
    } catch (err) {
      log.error('Search failed', { error: (err as Error).message }, 'construction-qa');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 300);
  };

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery('');
    const params = new URLSearchParams();
    if (result.zone_no !== null) params.set('zone', String(result.zone_no));
    if (result.pon_no !== null) params.set('pon', String(result.pon_no));
    params.set('highlight', result.id);
    router.push(`/field-ops/project/${result.project_id}?${params.toString()}`);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search features across all projects..."
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full pl-9 pr-8 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm text-gray-300 placeholder-gray-500"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 animate-spin" />}
        {!loading && query && (
          <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-gray-500 hover:text-gray-300" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-xl max-h-80 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => handleSelect(r)}
              className="w-full px-3 py-2 text-left hover:bg-[var(--hover-bg)] transition-colors flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{r.feature_id}</div>
                <div className="text-xs text-gray-500">
                  {r.project_name}
                  {r.zone_no !== null && ` · Z${r.zone_no}`}
                  {r.pon_no !== null && ` · P${r.pon_no}`}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${STATUS_COLORS[r.workflow_status] || 'bg-gray-500/20 text-gray-400'}`}>
                {r.workflow_status.replace('_', ' ')}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute z-50 top-full mt-1 w-full bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-xl px-3 py-4 text-center text-sm text-gray-500">
          No features found for &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
