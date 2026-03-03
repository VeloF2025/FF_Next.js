/**
 * Field Ops Dashboard Page
 *
 * Landing page replacing the flat feature list.
 * Shows project cards with QA progress, plus global search.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';
import type { ProjectDashboardRow } from '../../types/dashboard.types';
import { ProjectQaCard } from './ProjectQaCard';
import { GlobalSearchBar } from '../shared/GlobalSearchBar';

export function FieldOpsDashboardPage() {
  const [projects, setProjects] = useState<ProjectDashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/construction-qa/project-dashboard', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data.data?.projects || []);
        setLastRefresh(new Date());
      }
    } catch (err) {
      log.error('Failed to fetch dashboard', { error: (err as Error).message }, 'construction-qa');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const totalFeatures = projects.reduce((sum, p) => sum + p.total_features, 0);
  const totalApproved = projects.reduce(
    (sum, p) => sum + p.civil.approved + p.optical.approved + p.splicing.approved,
    0,
  );

  return (
    <div className="space-y-6">
      {/* Header row: search + refresh */}
      <div className="flex items-center gap-4">
        <GlobalSearchBar />
        <div className="flex items-center gap-3 ml-auto">
          {lastRefresh && (
            <span className="text-xs text-gray-500">
              Updated: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm text-gray-300 hover:bg-[var(--hover-bg)] transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="flex items-center gap-6 text-sm text-gray-400">
        <span>{projects.length} projects</span>
        <span>{totalFeatures.toLocaleString()} total features</span>
        <span>
          {totalApproved.toLocaleString()} approved
          ({totalFeatures > 0 ? Math.round((totalApproved / totalFeatures) * 100) : 0}%)
        </span>
      </div>

      {/* Project cards grid */}
      {loading && projects.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <RefreshCw className="w-6 h-6 animate-spin mr-2" />
          Loading projects...
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          No projects with QA features found.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => (
            <ProjectQaCard key={project.project_id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
