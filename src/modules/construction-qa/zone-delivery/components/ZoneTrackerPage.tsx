'use client';

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useZoneDeliveryTracker } from '../hooks/useZoneDeliveryTracker';
import { ZoneTrackerOverviewTable } from './ZoneTrackerOverviewTable';
import { ZoneTrackerPonTable } from './ZoneTrackerPonTable';

type Tab = 'overview' | 'pons';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'pons', label: 'PONs' },
];

export function ZoneTrackerPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [projectId, setProjectId] = useState('');
  const [submittedOnly, setSubmittedOnly] = useState(false);
  const tracker = useZoneDeliveryTracker(projectId || undefined);

  // Built from the rows themselves so the filter can only ever offer sites that
  // are actually present — there is no separate project list to fall out of step.
  const projects = useMemo(() => {
    const known = new Map<string, string>();
    for (const zone of tracker.data?.zones ?? []) known.set(zone.projectId, zone.projectName);
    return [...known.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [tracker.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Delivery tracker</h1>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            PON submissions and zone handovers, by site.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {tracker.lastUpdated && (
            <span className="text-xs text-[var(--ff-text-secondary)]">
              Updated: {tracker.lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            disabled={tracker.refreshing}
            onClick={() => void tracker.refresh()}
            className="flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--ff-text-primary)] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${tracker.refreshing ? 'animate-spin' : ''}`} />
            {tracker.refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Tracker views" className="flex gap-1 rounded-md border border-[var(--border-color)] p-1">
          {tabs.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded px-3 py-1.5 text-sm ${
                tab === item.id
                  ? 'bg-[var(--hover-bg)] font-medium text-[var(--ff-text-primary)]'
                  : 'text-[var(--ff-text-secondary)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="text-sm text-[var(--ff-text-secondary)]">
          <span className="sr-only">Site</span>
          <select
            value={projectId}
            onChange={event => setProjectId(event.target.value)}
            className="rounded border border-[var(--border-color)] bg-transparent px-3 py-2 text-sm text-[var(--ff-text-primary)]"
          >
            <option value="">All sites</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
      </div>

      {tracker.error && (
        <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {tracker.error}
          <button type="button" onClick={() => void tracker.refresh()} className="ml-3 underline">Retry</button>
        </div>
      )}

      {tracker.loading && !tracker.data ? (
        <div className="py-16"><LoadingSpinner label="Loading delivery tracker" /></div>
      ) : tracker.data ? (
        tab === 'overview' ? (
          <ZoneTrackerOverviewTable rows={tracker.data.zones} />
        ) : (
          <ZoneTrackerPonTable
            rows={tracker.data.pons}
            submittedOnly={submittedOnly}
            onSubmittedOnlyChange={setSubmittedOnly}
          />
        )
      ) : null}
    </div>
  );
}
