'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useDeliveryTree } from '../useDeliveryTree';
import type { DeliveryTreeFilters } from '../useDeliveryTree';
import type { DeliveryTreeProject } from '../types';
import { DeliveryTreeFilter } from './DeliveryTreeFilter';
import { DeliveryTreeTable } from './DeliveryTreeTable';
import { projectKey, zoneKey } from '../treeKeys';

interface ProjectOption { id: string; name: string; }

const INITIAL_FILTERS: DeliveryTreeFilters = { projectId: '', opticalSubmittedOnly: false };

function allKeys(projects: DeliveryTreeProject[]): Set<string> {
  const keys = new Set<string>();
  for (const project of projects) {
    keys.add(projectKey(project.id));
    for (const zone of project.zones) keys.add(zoneKey(project.id, zone.zone_no));
  }
  return keys;
}

/**
 * QA Centre delivery tree — Project → Zone → PON build status.
 *
 * Read-only: zone status comes from active FAC + CAC certificates, PON status
 * from the recorded port submission. Nothing on this page writes.
 */
export function DeliveryTreePage() {
  const [filters, setFilters] = useState<DeliveryTreeFilters>(INITIAL_FILTERS);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tree = useDeliveryTree(filters);

  const projects = useMemo(() => tree.data?.projects ?? [], [tree.data]);

  // The unfiltered load carries every project, so options accumulate rather
  // than collapsing to the single project the user just selected.
  useEffect(() => {
    if (!tree.data) return;
    setProjectOptions(previous => {
      const known = new Map(previous.map(option => [option.id, option]));
      let added = false;
      for (const project of tree.data?.projects ?? []) {
        if (!known.has(project.id)) {
          known.set(project.id, { id: project.id, name: project.name });
          added = true;
        }
      }
      if (!added) return previous;
      return [...known.values()].sort((left, right) => left.name.localeCompare(right.name));
    });
  }, [tree.data]);

  const toggle = useCallback((key: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">QA Centre</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Delivery status by project, zone and PON.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded(allKeys(projects))}
            className="rounded-md border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--hover-bg)]"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setExpanded(new Set())}
            className="rounded-md border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--hover-bg)]"
          >
            Collapse all
          </button>
          <button
            type="button"
            disabled={tree.loading}
            onClick={() => void tree.refresh()}
            className="flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--ff-text-primary)] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${tree.loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {tree.loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <DeliveryTreeFilter filters={filters} projects={projectOptions} onChange={setFilters} />

      {tree.error && (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          {tree.error}
          <button type="button" onClick={() => void tree.refresh()} className="ml-3 underline">Retry</button>
        </div>
      )}

      {tree.loading && !tree.data ? (
        <div className="py-16"><LoadingSpinner label="Loading delivery tree" /></div>
      ) : projects.length > 0 ? (
        <DeliveryTreeTable projects={projects} expanded={expanded} onToggle={toggle} />
      ) : !tree.error ? (
        <p className="py-16 text-center text-[var(--ff-text-secondary)]">
          No PONs match the current filters.
        </p>
      ) : null}
    </div>
  );
}
