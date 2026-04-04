'use client';

/**
 * StaleProjectsWidget
 *
 * Dashboard widget showing active projects with no updates in 7+ days.
 * Amber: 7-14 days stale | Red: 14+ days stale
 *
 * Proposal: 2026-02-19 (Flow) | Greenlit: 2026-02-20 (Jarvis/Hein)
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
interface StaleProject {
  id: string;
  project_name: string;
  project_code: string | null;
  status: string;
  updated_at: string;
  client_name: string | null;
  days_stale: number;
  severity: 'warning' | 'critical';
}

interface StaleProjectsResponse {
  projects: StaleProject[];
  total: number;
  warning_count: number;
  critical_count: number;
  threshold_days: number;
}

const THRESHOLD_DAYS = 7;

function StaleBadge({ days }: { days: number }) {
  const isCritical = days >= 14;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        isCritical
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      )}
    >
      <Clock className="w-3 h-3" />
      {days}d stale
    </span>
  );
}

function StaleProjectRow({ project }: { project: StaleProject }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[var(--ff-border-primary)] last:border-0">
      <div className="flex-1 min-w-0">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm font-medium text-[var(--ff-text-primary)] hover:text-primary-600 truncate flex items-center gap-1 group"
        >
          {project.project_name}
          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>
        {project.client_name && (
          <div className="text-xs text-[var(--ff-text-secondary)] truncate">{project.client_name}</div>
        )}
      </div>
      <div className="ml-3 shrink-0">
        <StaleBadge days={project.days_stale} />
      </div>
    </div>
  );
}

export function StaleProjectsWidget() {
  const [data, setData] = useState<StaleProjectsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchStale = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/stale?days=${THRESHOLD_DAYS}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: StaleProjectsResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stale projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStale();
  }, []);

  // Nothing to show — hide widget
  if (!loading && !error && data?.total === 0) return null;

  const displayProjects = expanded ? (data?.projects ?? []) : (data?.projects ?? []).slice(0, 5);
  const hasMore = (data?.total ?? 0) > 5;

  return (
    <div className="bg-[var(--ff-surface-primary)] rounded-lg border border-[var(--ff-border-primary)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn(
              'w-5 h-5',
              (data?.critical_count ?? 0) > 0 ? 'text-red-500' : 'text-amber-500'
            )}
          />
          <h3 className="text-base font-semibold text-[var(--ff-text-primary)]">
            Stale Projects
          </h3>
          {data && data.total > 0 && (
            <span className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold',
              (data.critical_count ?? 0) > 0
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            )}>
              {data.total}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => { void fetchStale(); }}
          title="Refresh"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Summary badges */}
      {data && data.total > 0 && (
        <div className="flex gap-2 mb-3 text-xs text-[var(--ff-text-secondary)]">
          {data.warning_count > 0 && (
            <span className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full">
              {data.warning_count} warning (7-14d)
            </span>
          )}
          {data.critical_count > 0 && (
            <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full">
              {data.critical_count} critical (14d+)
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 bg-[var(--ff-surface-secondary)] rounded animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-sm text-[var(--ff-text-secondary)] py-4 text-center">
          Unable to load stale projects
        </div>
      )}

      {!loading && !error && data && data.total > 0 && (
        <>
          <div className="divide-y divide-[var(--ff-border-primary)]">
            {displayProjects.map(project => (
              <StaleProjectRow key={project.id} project={project} />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-3 w-full text-xs text-primary-600 hover:text-primary-700 font-medium text-center"
            >
              {expanded ? 'Show less' : `Show ${(data.total - 5)} more`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
