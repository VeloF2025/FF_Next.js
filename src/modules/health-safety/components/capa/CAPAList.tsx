/**
 * CAPA List - Filterable list of corrective actions
 */

import React, { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Clock, CheckCircle, Filter } from 'lucide-react';
import { CAPAStatusBadge, CAPASeverityBadge } from './CAPAStatusBadge';
import type { CAPAStatus } from '@/modules/health-safety/types/capa.types';

const fetcher = (url: string) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });

interface CAPAListProps {
  projectId?: string;
  contractorId?: string;
  onSelectCAPA?: (capaId: string) => void;
}

export function CAPAList({ projectId, contractorId, onSelectCAPA }: CAPAListProps) {
  const [statusFilter, setStatusFilter] = useState<CAPAStatus | ''>('');

  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (contractorId) params.set('contractor_id', contractorId);
  if (statusFilter) params.set('status', statusFilter);
  params.set('limit', '100');

  const { data, error, isLoading } = useSWR(
    `/api/health-safety/capa?${params}`,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true, errorRetryCount: 3 }
  );

  const capas = data?.data?.capas || [];
  const stats = data?.data?.stats || {};

  // No early error return — SWR SSR without auth cookies gives false errors.
  // The list below handles empty state gracefully.

  return (
    <div className="space-y-4">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Open" value={stats.open || 0} icon={<AlertTriangle aria-hidden="true" className="w-4 h-4" />} color="blue" />
        <StatCard label="In Progress" value={stats.in_progress || 0} icon={<Clock aria-hidden="true" className="w-4 h-4" />} color="amber" />
        <StatCard label="Overdue" value={stats.overdue || 0} icon={<AlertTriangle aria-hidden="true" className="w-4 h-4" />} color="red" />
        <StatCard label="Closed" value={stats.closed || 0} icon={<CheckCircle aria-hidden="true" className="w-4 h-4" />} color="green" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter aria-hidden="true" className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
        <label htmlFor="status-filter" className="sr-only">Filter by status</label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CAPAStatus | '')}
          className="px-3 py-1.5 text-sm bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="verification">Verification</option>
          <option value="overdue">Overdue</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-8 text-[var(--ff-text-tertiary)]">Loading...</div>
      ) : capas.length === 0 ? (
        <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
          No corrective actions found
        </div>
      ) : (
        <div className="space-y-2">
          {capas.map((capa: any) => (
            <button
              key={capa.id}
              type="button"
              aria-label={`View CAPA: ${capa.title}`}
              onClick={() => onSelectCAPA?.(capa.id)}
              className="w-full text-left p-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] hover:border-[var(--ff-primary-500)] transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--ff-text-primary)] truncate">
                    {capa.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[var(--ff-text-tertiary)]">
                    <span>{capa.source_type}</span>
                    {capa.project_name && <span>· {capa.project_name}</span>}
                    {capa.assigned_to_name && <span>· {capa.assigned_to_name}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <CAPAStatusBadge status={capa.is_overdue && capa.status !== 'closed' ? 'overdue' : capa.status} />
                  <CAPASeverityBadge severity={capa.severity} />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-[var(--ff-text-tertiary)]">
                <span>Due: {new Date(capa.due_date).toLocaleDateString()}</span>
                <span>Created: {new Date(capa.created_at).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    green: 'text-green-400',
  };

  return (
    <div className="p-3 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
      <div className="flex items-center gap-2">
        <span className={colorMap[color]}>{icon}</span>
        <span className="text-xs text-[var(--ff-text-tertiary)]">{label}</span>
      </div>
      <p className="text-xl font-bold text-[var(--ff-text-primary)] mt-1">{value}</p>
    </div>
  );
}
