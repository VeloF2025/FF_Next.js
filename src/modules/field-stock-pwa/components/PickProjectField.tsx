'use client';

/**
 * PickProjectField — optional project selector on the issue sign-and-submit step.
 *
 * Loads active projects from /api/my/stores/projects and renders a labelled
 * <select>. The chosen projectId is threaded into the picking body so the
 * server stamps stock_pickings.project_id (Accountability per-project breakdown).
 *
 * Optional by design: "No project" is a valid choice — not every field issue
 * maps to a project, and blocking issuance on it would be a regression.
 * Theme: dark, matching the rest of the /my/stores issue wizard.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchProjects } from '@/modules/field-stock-pwa/api';
import type { PwaProjectSummary } from '@/modules/field-stock-pwa/api';

export interface PickProjectFieldProps {
  value: string | null;
  onChange: (projectId: string | null) => void;
}

export function PickProjectField({ value, onChange }: PickProjectFieldProps) {
  const [projects, setProjects] = useState<PwaProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load projects');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-1.5">
      <label htmlFor="stores-project" className="text-sm font-medium text-neutral-300">
        Project <span className="ml-1 text-xs text-neutral-600 font-normal">(optional)</span>
      </label>
      {loading ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-neutral-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading projects…
        </div>
      ) : (
        <select
          id="stores-project"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded-lg bg-neutral-900 border border-neutral-700 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-neutral-500"
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.code ? ` (${p.code})` : ''}
            </option>
          ))}
        </select>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
