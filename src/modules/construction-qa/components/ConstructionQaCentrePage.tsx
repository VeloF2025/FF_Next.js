/**
 * Construction QA Centre Page
 * Main dashboard for civil, optical, and splicing quality assurance.
 *
 * Layout: Stats cards + discipline tabs + filter bar + feature data grid
 * Pattern: Follows Activate QA Centre and QField QA Dashboard conventions
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  HardHat,
  Cable,
  CircleDot,
  Search,
  Filter,
  Download,
} from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import { log } from '@/lib/logger';

type Discipline = 'civil' | 'optical' | 'splicing';
type WorkflowStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'rework_needed' | 'escalated';

interface FeatureRow {
  id: string;
  feature_id: string;
  feature_type: string;
  discipline: Discipline;
  zone_no: number | null;
  pon_no: number | null;
  photo_count: number;
  vlm_confidence: number | null;
  vlm_status: string;
  workflow_status: WorkflowStatus;
  qa_decision: string | null;
  priority: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string;
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  rework_needed: number;
  escalated: number;
}

interface Filters {
  projectId: string;
  discipline: Discipline;
  zoneNo: string;
  ponNo: string;
  workflowStatus: string;
  priority: string;
  search: string;
  page: number;
  pageSize: number;
}

const DISCIPLINE_TABS: { key: Discipline; label: string; icon: typeof HardHat }[] = [
  { key: 'civil', label: 'Poles (Civil)', icon: HardHat },
  { key: 'optical', label: 'Cable Spans (Optical)', icon: Cable },
  { key: 'splicing', label: 'Dome Joints (Splicing)', icon: CircleDot },
];

export function ConstructionQaCentrePage() {
  const router = useRouter();

  // State
  const [filters, setFilters] = useState<Filters>({
    projectId: '',
    discipline: 'civil',
    zoneNo: '',
    ponNo: '',
    workflowStatus: '',
    priority: '',
    search: '',
    page: 1,
    pageSize: 50,
  });
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0, pending: 0, approved: 0, rejected: 0, rework_needed: 0, escalated: 0,
  });
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch projects list
  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch('/api/construction-qa/features?action=projects', {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setProjects(data.data?.projects || []);
        }
      } catch (err) {
        log.error('Failed to load projects', { module: 'construction-qa', error: (err as Error).message }, 'construction-qa');
      }
    }
    loadProjects();
  }, []);

  // Fetch features and stats
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.projectId) params.set('projectId', filters.projectId);
      params.set('discipline', filters.discipline);
      if (filters.zoneNo) params.set('zoneNo', filters.zoneNo);
      if (filters.ponNo) params.set('ponNo', filters.ponNo);
      if (filters.workflowStatus) params.set('workflowStatus', filters.workflowStatus);
      if (filters.priority) params.set('priority', filters.priority);
      if (filters.search) params.set('search', filters.search);
      params.set('page', String(filters.page));
      params.set('pageSize', String(filters.pageSize));

      const res = await fetch(`/api/construction-qa/features?${params.toString()}`, {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setFeatures(data.data?.features || []);
        setStats(data.data?.stats || { total: 0, pending: 0, approved: 0, rejected: 0, rework_needed: 0, escalated: 0 });
        setTotalCount(data.data?.pagination?.total || 0);
        setTotalPages(data.data?.pagination?.totalPages || 0);
        setLastRefresh(new Date());
      }
    } catch (err) {
      log.error('Failed to fetch features', { module: 'construction-qa', error: (err as Error).message }, 'construction-qa');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Stats cards
  const statCards: EnhancedStatCardProps[] = useMemo(() => [
    {
      title: 'Total Features',
      subtitle: 'All features',
      value: stats.total,
      description: `Total ${filters.discipline} features across all projects`,
      icon: HardHat,
      color: '#3b82f6',
    },
    {
      title: 'Pending',
      subtitle: 'Awaiting review',
      value: stats.pending,
      description: 'Features pending QA review',
      icon: Clock,
      color: '#f59e0b',
    },
    {
      title: 'Approved',
      subtitle: 'QA passed',
      value: stats.approved,
      description: 'Features approved after review',
      icon: CheckCircle,
      color: '#22c55e',
    },
    {
      title: 'Rejected',
      subtitle: 'QA failed',
      value: stats.rejected,
      description: 'Features rejected — need retake',
      icon: XCircle,
      color: '#ef4444',
    },
    {
      title: 'Rework',
      subtitle: 'Sent back',
      value: stats.rework_needed,
      description: 'Features sent back for rework',
      icon: AlertTriangle,
      color: '#f97316',
    },
  ], [stats, filters.discipline]);

  const handleRowClick = (feature: FeatureRow) => {
    router.push(`/construction-qa/${feature.id}`);
  };

  const updateFilter = (key: keyof Filters, value: string | number) => {
    setFilters(prev => ({ ...prev, [key]: value, page: key === 'page' ? value as number : 1 }));
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400',
      in_review: 'bg-blue-500/20 text-blue-400',
      approved: 'bg-green-500/20 text-green-400',
      rejected: 'bg-red-500/20 text-red-400',
      rework_needed: 'bg-orange-500/20 text-orange-400',
      escalated: 'bg-purple-500/20 text-purple-400',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-gray-500/20 text-gray-400'}`}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  const confidenceBadge = (confidence: number | null) => {
    if (confidence === null) return <span className="text-gray-500 text-xs">—</span>;
    const pct = Math.round(confidence * 100);
    const color = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400';
    return <span className={`text-xs font-mono font-medium ${color}`}>{pct}%</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Construction QA Centre</h1>
          <p className="text-sm text-gray-400 mt-1">
            Civil, optical, and splicing quality assurance
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-500">
              Last updated: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm text-gray-300 hover:bg-[var(--hover-bg)] transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <StatsGrid cards={statCards} columns={5} />

      {/* Discipline Tabs */}
      <div className="flex gap-1 bg-[var(--card-bg)] p-1 rounded-lg border border-[var(--border-color)]">
        {DISCIPLINE_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = filters.discipline === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => updateFilter('discipline', tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-[var(--hover-bg)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Project Selector */}
        <select
          value={filters.projectId}
          onChange={e => updateFilter('projectId', e.target.value)}
          className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-gray-300"
        >
          <option value="">All Projects</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by feature ID, pole number..."
            value={filters.search}
            onChange={e => updateFilter('search', e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm text-gray-300 placeholder-gray-500"
          />
        </div>

        {/* Status Filter */}
        <select
          value={filters.workflowStatus}
          onChange={e => updateFilter('workflowStatus', e.target.value)}
          className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-gray-300"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_review">In Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="rework_needed">Rework Needed</option>
          <option value="escalated">Escalated</option>
        </select>

        {/* Priority Filter */}
        <select
          value={filters.priority}
          onChange={e => updateFilter('priority', e.target.value)}
          className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm text-gray-300"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Results Count */}
      <div className="text-sm text-gray-400">
        {totalCount} features total
        {totalPages > 1 && ` \u2022 Page ${filters.page} of ${totalPages}`}
      </div>

      {/* Data Grid */}
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border-color)]">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Feature</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Zone</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">PON</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Photos</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">AI Score</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
              <th className="text-center px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Decision</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Assigned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {loading && features.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading features...
                </td>
              </tr>
            ) : features.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                  No features found. Select a project or adjust filters.
                </td>
              </tr>
            ) : (
              features.map(f => (
                <tr
                  key={f.id}
                  onClick={() => handleRowClick(f)}
                  className="cursor-pointer hover:bg-[var(--hover-bg)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white text-sm">{f.feature_id}</div>
                    <div className="text-xs text-gray-500">{f.project_name}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {f.zone_no !== null ? `Z${f.zone_no}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {f.pon_no !== null ? `P${f.pon_no}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-300">
                    {f.photo_count}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {confidenceBadge(f.vlm_confidence)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {statusBadge(f.workflow_status)}
                  </td>
                  <td className="px-4 py-3 text-center text-sm">
                    {f.qa_decision ? (
                      <span className={`font-medium ${
                        f.qa_decision === 'PASS' ? 'text-green-400' :
                        f.qa_decision === 'FAIL' ? 'text-red-400' : 'text-orange-400'
                      }`}>
                        {f.qa_decision}
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {f.assigned_to || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={filters.page <= 1}
            onClick={() => updateFilter('page', filters.page - 1)}
            className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm text-gray-300 hover:bg-[var(--hover-bg)] disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-400">
            Page {filters.page} of {totalPages}
          </span>
          <button
            disabled={filters.page >= totalPages}
            onClick={() => updateFilter('page', filters.page + 1)}
            className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm text-gray-300 hover:bg-[var(--hover-bg)] disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
