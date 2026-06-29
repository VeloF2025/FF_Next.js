'use client';

/**
 * PipelineProjectPicker — searchable combobox over ALL pipeline projects.
 *
 * Backed by GET /api/pipeline/projects/search (searches name/area/municipality
 * across every pipeline project, not just the handful in the projects table).
 * Used both to pick a project when creating a planning card and to filter the board.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { log } from '@/lib/logger';

export interface PipelineProjectOption {
  id: string;
  project_name: string;
  pipeline_status?: string;
  area?: string | null;
  municipality?: string | null;
  province?: string | null;
  client_name?: string | null;
}

interface Props {
  /** Currently selected project (id + label) or null. */
  value?: { id: string; label: string } | null;
  onSelect: (project: PipelineProjectOption | null) => void;
  placeholder?: string;
  className?: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  qualification: 'Qualification',
  approvals_in_progress: 'Approvals in progress',
  approvals_complete: 'Approvals complete',
  po_pending: 'PO pending',
  ready_to_plan: 'Ready to plan',
  planned: 'Planned',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
  lost: 'Lost',
};

export function PipelineProjectPicker({ value, onSelect, placeholder = 'Search all projects…', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<PipelineProjectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced search whenever the box is open and the query changes
  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/pipeline/projects/search?q=${encodeURIComponent(queryText)}&limit=20`);
        const json = await res.json();
        setResults(json?.data?.projects ?? []);
      } catch (error) {
        log.error('Pipeline project search failed', { data: error }, 'PipelineProjectPicker');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [queryText, open]);

  // Close on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const choose = useCallback((p: PipelineProjectOption) => {
    onSelect(p);
    setOpen(false);
    setQueryText('');
  }, [onSelect]);

  const clear = useCallback(() => {
    onSelect(null);
    setQueryText('');
  }, [onSelect]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {value ? (
        <div className="flex items-center gap-2 px-3 py-2 border rounded-md text-sm bg-[var(--ff-bg-secondary)]">
          <span className="truncate max-w-[220px]" title={value.label}>{value.label}</span>
          <button
            type="button"
            onClick={clear}
            className="ml-auto text-[var(--ff-text-muted)] hover:text-[var(--ff-text-primary)]"
            title="Clear selection"
            aria-label="Clear selected project"
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={queryText}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQueryText(e.target.value); setOpen(true); }}
          className="w-full px-3 py-2 border rounded-md text-sm"
        />
      )}

      {open && !value && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-sm text-[var(--ff-text-muted)]">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--ff-text-muted)]">
              {queryText ? 'No matching projects' : 'Type to search projects'}
            </div>
          ) : (
            results.map((p) => {
              const loc = [p.area, p.municipality, p.province].filter(Boolean).join(', ');
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => choose(p)}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)] last:border-b-0"
                >
                  <div className="text-sm text-[var(--ff-text-primary)] truncate">{p.project_name}</div>
                  <div className="text-[11px] text-[var(--ff-text-muted)] truncate">
                    {p.pipeline_status ? (STATUS_LABELS[p.pipeline_status] ?? p.pipeline_status) : ''}
                    {loc ? ` · ${loc}` : ''}
                    {p.client_name ? ` · ${p.client_name}` : ''}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
