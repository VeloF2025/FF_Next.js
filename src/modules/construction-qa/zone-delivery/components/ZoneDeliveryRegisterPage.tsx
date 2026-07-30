'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useZoneDeliveryRegister } from '../hooks/useZoneDeliveryRegister';
import type { ZoneRegisterFilters } from '../types/zoneDelivery.types';
import { ZoneDeliveryFilters } from './ZoneDeliveryFilters';
import { ZoneDeliverySummary } from './ZoneDeliverySummary';
import { ZoneDeliveryTable } from './ZoneDeliveryTable';

interface ProjectOption { id: string; name: string; }

export function ZoneDeliveryRegisterPage() {
  const [filters, setFilters] = useState<ZoneRegisterFilters>({});
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const register = useZoneDeliveryRegister(filters);

  useEffect(() => {
    if (!register.data) return;
    setProjects(previous => {
      const known = new Map(previous.map(project => [project.id, project]));
      register.data?.rows.forEach(row => known.set(row.projectId, { id: row.projectId, name: row.projectName }));
      const next = [...known.values()].sort((left, right) => left.name.localeCompare(right.name));
      return next.length === previous.length && next.every((project, index) => project === previous[index]) ? previous : next;
    });
  }, [register.data]);

  const rows = register.data?.rows ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">Zone delivery register</h1><p className="text-sm text-[var(--ff-text-secondary)]">Operational delivery status by zone.</p></div>
        <div className="flex items-center gap-3">
          {register.lastUpdated && <span className="text-xs text-[var(--ff-text-secondary)]">Updated: {register.lastUpdated.toLocaleTimeString()}</span>}
          <button type="button" disabled={register.refreshing} onClick={() => void register.refresh()} className="flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--ff-text-primary)] disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${register.refreshing ? 'animate-spin' : ''}`} />{register.refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </div>
      <ZoneDeliveryFilters filters={filters} projects={projects} onChange={setFilters} />
      {register.error && <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{register.error}<button type="button" onClick={() => void register.refresh()} className="ml-3 underline">Retry</button></div>}
      {register.loading && !register.data ? <div className="py-16"><LoadingSpinner label="Loading zone delivery register" /></div> : register.data ? <><ZoneDeliverySummary summary={register.data.summary} />{rows.length ? <ZoneDeliveryTable rows={rows} /> : <p className="py-16 text-center text-[var(--ff-text-secondary)]">No zones match the current filters.</p>}</> : null}
    </div>
  );
}
