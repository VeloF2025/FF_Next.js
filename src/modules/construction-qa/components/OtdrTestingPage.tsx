/**
 * OTDR Testing Page
 *
 * Displays EXFO Exchange test results synced into FibreFlow.
 * Features: Stats cards, filters, results table, sync trigger.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Radio,
  Search,
  Cpu,
  Activity,
  Users,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { log } from '@/lib/logger';

// =============================================================================
// Types
// =============================================================================

interface TestResult {
  id: string;
  exfo_result_id: string;
  exfo_workspace_id: string;
  test_type: string;
  test_name: string;
  job_name: string | null;
  global_verdict: string | null;
  test_date_time: string | null;
  parsed_project: string | null;
  parsed_pole: string | null;
  parsed_cabinet: string | null;
  parsed_port: string | null;
  parsed_link: string | null;
  parsed_fiber: string | null;
  unit_a_serial: string | null;
  unit_a_model: string | null;
  unit_b_serial: string | null;
  unit_b_model: string | null;
  operator_a: string | null;
  cable_id: string | null;
  fiber_id: string | null;
  location_a: string | null;
  location_b: string | null;
  project_id: string | null;
  asset_id: string | null;
  attachments_count: number;
  project_name?: string;
  asset_name?: string;
}

interface Stats {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  olts_count: number;
  iolm_count: number;
  unique_equipment: number;
  unique_operators: number;
}

interface ProjectOption {
  code: string;
  project_id: string | null;
  project_name: string | null;
  result_count: number;
}

// =============================================================================
// Component
// =============================================================================

interface OtdrTestingPageProps {
  /** Pre-filter to a specific project when rendered from project detail page */
  projectId?: string;
}

export function OtdrTestingPage({ projectId }: OtdrTestingPageProps = {}) {
  const [results, setResults] = useState<TestResult[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [total, setTotal] = useState(0);

  // Filters
  const [projectFilter, setProjectFilter] = useState(projectId || '');
  const [testTypeFilter, setTestTypeFilter] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Fetch results
  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('pageSize', String(pageSize));
      if (projectFilter) params.append('projectId', projectFilter);
      if (testTypeFilter) params.append('testType', testTypeFilter);
      if (verdictFilter) params.append('verdict', verdictFilter);
      if (searchTerm) params.append('search', searchTerm);

      const res = await fetch(`/api/exfo/results?${params}`, { credentials: 'include' });
      const data = await res.json();

      if (data.success) {
        setResults(data.data.results || []);
        setTotal(data.data.total || 0);
      }
    } catch (err) {
      log.error('Failed to fetch EXFO results', { error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [page, projectFilter, testTypeFilter, verdictFilter, searchTerm]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('action', 'stats');
      if (projectFilter) params.append('projectId', projectFilter);

      const res = await fetch(`/api/exfo/results?${params}`, { credentials: 'include' });
      const data = await res.json();

      if (data.success) {
        setStats(data.data);
      }
    } catch (err) {
      log.error('Failed to fetch EXFO stats', { error: String(err) });
    }
  }, [projectFilter]);

  // Fetch projects
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/exfo/results?action=projects', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setProjects(data.data.projects || []);
      }
    } catch (err) {
      log.error('Failed to fetch EXFO projects', { error: String(err) });
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  useEffect(() => {
    fetchStats();
    fetchProjects();
  }, [fetchStats, fetchProjects]);

  // Trigger sync
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/exfo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fetchDetails: true }),
      });
      const data = await res.json();

      if (data.success) {
        log.info('EXFO sync completed', data.data);
        // Refresh data
        await Promise.all([fetchResults(), fetchStats(), fetchProjects()]);
      }
    } catch (err) {
      log.error('EXFO sync failed', { error: String(err) });
    } finally {
      setSyncing(false);
    }
  };

  // Stats cards
  const statCards: EnhancedStatCardProps[] = stats ? [
    {
      title: 'Total Tests',
      value: Number(stats.total),
      icon: Activity,
      color: 'blue' as const,
    },
    {
      title: 'Passed',
      value: Number(stats.passed),
      icon: CheckCircle,
      color: 'green' as const,
      subtitle: stats.total > 0 ? `${Math.round((Number(stats.passed) / Number(stats.total)) * 100)}%` : undefined,
    },
    {
      title: 'Failed',
      value: Number(stats.failed),
      icon: XCircle,
      color: 'red' as const,
      subtitle: stats.total > 0 ? `${Math.round((Number(stats.failed) / Number(stats.total)) * 100)}%` : undefined,
    },
    {
      title: 'Equipment',
      value: Number(stats.unique_equipment),
      icon: Cpu,
      color: 'purple' as const,
    },
    {
      title: 'OLTS Tests',
      value: Number(stats.olts_count),
      icon: Radio,
      color: 'cyan' as const,
    },
    {
      title: 'Operators',
      value: Number(stats.unique_operators),
      icon: Users,
      color: 'amber' as const,
    },
  ] : [];

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">OTDR Testing</h1>
          <p className="text-sm text-gray-400 mt-1">
            Fiber optic test results from EXFO Exchange
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Stats Grid */}
      {stats && <StatsGrid cards={statCards} columns={3} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search tests, cables, operators..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[180px] bg-gray-800 border-gray-700">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.filter(p => p.project_id).map((p) => (
              <SelectItem key={p.project_id!} value={p.project_id!}>
                {p.project_name || p.code} ({p.result_count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={testTypeFilter} onValueChange={(v) => { setTestTypeFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[140px] bg-gray-800 border-gray-700">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="olts">OLTS</SelectItem>
            <SelectItem value="iolm">iOLM</SelectItem>
          </SelectContent>
        </Select>

        <Select value={verdictFilter} onValueChange={(v) => { setVerdictFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[140px] bg-gray-800 border-gray-700">
            <SelectValue placeholder="All Results" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Results</SelectItem>
            <SelectItem value="Pass">Pass</SelectItem>
            <SelectItem value="Fail">Fail</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Test Name</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Type</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Result</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Date</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Pole</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Cable / Fiber</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Equipment</th>
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Operator</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    <LoadingSpinner size="sm" label="" className="mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    {total === 0
                      ? 'No test results synced yet. Click "Sync Now" to import from EXFO Exchange.'
                      : 'No results match your filters.'}
                  </td>
                </tr>
              ) : (
                results.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="text-white font-medium truncate max-w-[280px]" title={r.test_name}>
                        {r.test_name}
                      </div>
                      {r.job_name && (
                        <div className="text-gray-500 text-xs truncate max-w-[280px]">{r.job_name}</div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        r.test_type === 'olts'
                          ? 'bg-cyan-500/10 text-cyan-400'
                          : 'bg-purple-500/10 text-purple-400'
                      }`}>
                        {r.test_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <VerdictBadge verdict={r.global_verdict} />
                    </td>
                    <td className="py-3 px-4 text-gray-300 whitespace-nowrap">
                      {r.test_date_time
                        ? new Date(r.test_date_time).toLocaleDateString('en-ZA')
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-gray-300">
                      {r.parsed_pole || '—'}
                    </td>
                    <td className="py-3 px-4 text-gray-300">
                      <div>{r.cable_id || r.parsed_link || '—'}</div>
                      {r.fiber_id && <div className="text-xs text-gray-500">{r.fiber_id}</div>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-gray-300 text-xs">
                        {r.unit_a_serial || '—'}
                      </div>
                      {r.unit_a_model && (
                        <div className="text-gray-500 text-xs truncate max-w-[140px]">{r.unit_a_model}</div>
                      )}
                      {r.asset_name && (
                        <div className="text-blue-400 text-xs">{r.asset_name}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-300 text-xs">
                      {r.operator_a || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <span className="text-sm text-gray-400">
              {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded hover:bg-gray-800 disabled:opacity-30 text-gray-400"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-gray-400">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded hover:bg-gray-800 disabled:opacity-30 text-gray-400"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Verdict Badge
// =============================================================================

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (verdict === 'Pass') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400">
        <CheckCircle className="w-3 h-3" /> Pass
      </span>
    );
  }
  if (verdict === 'Fail') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-400">
        <XCircle className="w-3 h-3" /> Fail
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-500/10 text-gray-400">
      —
    </span>
  );
}
