/**
 * Project Maintenance Tab Component
 * Sprint 1: Project Hub Foundation
 *
 * Displays maintenance ticket summary with status breakdown
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { log } from '@/lib/logger';

interface MaintenanceData {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
  active: number;
  avgResolutionHours: number | null;
  minResolutionHours: number | null;
  maxResolutionHours: number | null;
  createdLast30Days: number;
  resolvedLast30Days: number;
  priorityBreakdown: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

interface ProjectMaintenanceTabProps {
  projectId: string;
}

export function ProjectMaintenanceTab({ projectId }: ProjectMaintenanceTabProps) {
  const router = useRouter();
  const [data, setData] = useState<MaintenanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(`/api/projects/${projectId}/maintenance-summary`);
        if (!response.ok) throw new Error('Failed to fetch maintenance data');
        const result = await response.json();
        setData(result.data);
      } catch (err) {
        log.error('Error fetching maintenance', { error: err, projectId });
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [projectId]);

  if (loading) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[var(--ff-bg-secondary)] rounded w-1/4" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-[var(--ff-bg-secondary)] rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-red-500/30 p-6">
        <div className="text-red-400 text-center">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const formatHours = (hours: number | null) => {
    if (hours === null) return 'N/A';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
  };

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatusCard
          label="Open"
          value={data.open}
          color="red"
          onClick={() => router.push(`/noc?project=${projectId}&status=open`)}
        />
        <StatusCard
          label="In Progress"
          value={data.inProgress}
          color="yellow"
          onClick={() => router.push(`/noc?project=${projectId}&status=in_progress`)}
        />
        <StatusCard
          label="Resolved"
          value={data.resolved}
          color="green"
          onClick={() => router.push(`/noc?project=${projectId}&status=resolved`)}
        />
        <StatusCard
          label="Closed"
          value={data.closed}
          color="gray"
          onClick={() => router.push(`/noc?project=${projectId}&status=closed`)}
        />
      </div>

      {/* Resolution Metrics */}
      {data.avgResolutionHours !== null && (
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-4">
            Resolution Metrics
          </h3>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">
                {formatHours(data.avgResolutionHours)}
              </div>
              <div className="text-xs text-[var(--ff-text-secondary)]">Avg Resolution</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">
                {formatHours(data.minResolutionHours)}
              </div>
              <div className="text-xs text-[var(--ff-text-secondary)]">Fastest</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-400">
                {formatHours(data.maxResolutionHours)}
              </div>
              <div className="text-xs text-[var(--ff-text-secondary)]">Slowest</div>
            </div>
          </div>
        </div>
      )}

      {/* Priority Breakdown */}
      {data.active > 0 && (
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-4">
            Active Tickets by Priority
          </h3>
          <div className="space-y-3">
            <PriorityBar
              label="Critical"
              value={data.priorityBreakdown.critical}
              total={data.active}
              color="red"
            />
            <PriorityBar
              label="High"
              value={data.priorityBreakdown.high}
              total={data.active}
              color="orange"
            />
            <PriorityBar
              label="Medium"
              value={data.priorityBreakdown.medium}
              total={data.active}
              color="yellow"
            />
            <PriorityBar
              label="Low"
              value={data.priorityBreakdown.low}
              total={data.active}
              color="blue"
            />
          </div>
        </div>
      )}

      {/* 30-Day Activity */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {data.createdLast30Days}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Created (30 days)</div>
            </div>
          </div>
        </div>
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {data.resolvedLast30Days}
              </div>
              <div className="text-sm text-[var(--ff-text-secondary)]">Resolved (30 days)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Critical Alert */}
      {data.priorityBreakdown.critical > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-[var(--ff-text-primary)]">
              <strong>{data.priorityBreakdown.critical} critical ticket{data.priorityBreakdown.critical > 1 ? 's' : ''}</strong> require immediate attention.
            </div>
            <button
              onClick={() => router.push(`/noc?project=${projectId}&priority=critical`)}
              className="ml-auto px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors"
            >
              View
            </button>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-4">
        <button
          onClick={() => router.push(`/noc/new?project=${projectId}`)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Create Ticket
        </button>
        <button
          onClick={() => router.push(`/noc?project=${projectId}`)}
          className="px-4 py-2 bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg text-sm font-medium transition-colors"
        >
          View All Tickets
        </button>
      </div>

      {/* Empty State */}
      {data.total === 0 && (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
            No Maintenance Tickets
          </h3>
          <p className="text-[var(--ff-text-secondary)] max-w-md mx-auto">
            This project has no maintenance tickets yet. Create one when issues arise.
          </p>
        </div>
      )}
    </div>
  );
}

function StatusCard({ label, value, color, onClick }: {
  label: string;
  value: number;
  color: string;
  onClick: () => void;
}) {
  const colorClasses: Record<string, string> = {
    red: 'bg-red-500/10 border-red-500/30 hover:border-red-500/50',
    yellow: 'bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-500/50',
    green: 'bg-green-500/10 border-green-500/30 hover:border-green-500/50',
    gray: 'bg-gray-500/10 border-gray-500/30 hover:border-gray-500/50',
  };

  const textColorClasses: Record<string, string> = {
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    green: 'text-green-400',
    gray: 'text-gray-400',
  };

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-4 cursor-pointer transition-colors ${colorClasses[color]}`}
    >
      <div className={`text-3xl font-bold ${textColorClasses[color]}`}>{value}</div>
      <div className="text-sm text-[var(--ff-text-secondary)]">{label}</div>
    </div>
  );
}

function PriorityBar({ label, value, total, color }: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  const colorClasses: Record<string, string> = {
    red: 'bg-red-500',
    orange: 'bg-orange-500',
    yellow: 'bg-yellow-500',
    blue: 'bg-blue-500',
  };

  return (
    <div className="flex items-center gap-3">
      <div className="w-16 text-sm text-[var(--ff-text-secondary)]">{label}</div>
      <div className="flex-1 h-2 bg-[var(--ff-bg-secondary)] rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="w-8 text-sm text-[var(--ff-text-primary)] text-right">{value}</div>
    </div>
  );
}

export default ProjectMaintenanceTab;
