/**
 * PipelineProjectSearch
 * Debounced search input with dropdown for navigating between pipeline projects.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Search } from 'lucide-react';
import type { PipelineProjectSummary, PipelineStatus } from '../types';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

const STATUS_LABELS: Record<PipelineStatus, string> = {
  new: 'New',
  qualification: 'Qualification',
  approvals_in_progress: 'Approvals In Progress',
  approvals_complete: 'Approvals Complete',
  po_pending: 'PO Pending',
  ready_to_plan: 'Ready to Plan',
  planned: 'Planned',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
  lost: 'Lost',
};

interface Props {
  currentProjectId: string;
}

export function PipelineProjectSearch({ currentProjectId }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PipelineProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchResults = useCallback(async (search: string) => {
    if (!search.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/pipeline/projects?search=${encodeURIComponent(search)}&limit=8`,
        { credentials: 'include' }
      );
      if (!res.ok) return;
      const json = await res.json();
      const projects: PipelineProjectSummary[] = json.data?.projects ?? json.projects ?? [];
      setResults(projects);
      setIsOpen(projects.length > 0);
      setHighlightIndex(-1);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(value), 300);
  };

  const navigateTo = (id: string) => {
    if (id === currentProjectId) return;
    setIsOpen(false);
    setQuery('');
    router.push(`/projects/pipeline/${id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightIndex >= 0 && results[highlightIndex]) {
      e.preventDefault();
      navigateTo(results[highlightIndex].id);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  // Close on outside click
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Cleanup debounce
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-secondary)]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          placeholder="Search pipeline projects..."
          className="w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        {loading && (
          <InlineSpinner size="sm" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ff-text-secondary)]" />
        )}
      </div>

      {isOpen && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] shadow-lg max-h-80 overflow-y-auto">
          {results.map((p, i) => {
            const isCurrent = p.id === currentProjectId;
            return (
              <li
                key={p.id}
                onMouseEnter={() => setHighlightIndex(i)}
                onClick={() => navigateTo(p.id)}
                className={`px-3 py-2 cursor-pointer text-sm ${
                  isCurrent ? 'opacity-50 cursor-default' : ''
                } ${
                  i === highlightIndex
                    ? 'bg-[var(--ff-bg-tertiary)]'
                    : 'hover:bg-[var(--ff-bg-tertiary)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-[var(--ff-text-primary)] truncate block">
                      {p.project_name}
                      {p.project_code && (
                        <span className="text-[var(--ff-text-secondary)] font-normal ml-1">
                          ({p.project_code})
                        </span>
                      )}
                    </span>
                    {(p.municipality || p.client_name) && (
                      <span className="text-xs text-[var(--ff-text-secondary)] truncate block">
                        {[p.municipality, p.client_name].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isCurrent && (
                      <span className="text-xs text-[var(--ff-text-secondary)]">(current)</span>
                    )}
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] whitespace-nowrap">
                      {STATUS_LABELS[p.pipeline_status] ?? p.pipeline_status}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
