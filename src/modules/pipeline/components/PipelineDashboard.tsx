/**
 * Pipeline Dashboard Component
 * Main view for pipeline projects with stats and list
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FolderKanban,
  Plus,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  TrendingUp,
  Building2,
  RefreshCw,
} from 'lucide-react';
import type {
  PipelineDashboardStats,
  PipelineProjectSummary,
  PipelineStatus,
  Priority,
} from '../types';
import { AlertsDashboard } from './AlertsDashboard';
import { SmartsheetSyncPanel } from './SmartsheetSyncPanel';
import { useAuth } from '@/contexts/AuthContext';

// Status badge colors
const STATUS_COLORS: Record<PipelineStatus, { bg: string; text: string; label: string }> = {
  new: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'New' },
  qualification: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', label: 'Qualification' },
  approvals_in_progress: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', label: 'Approvals In Progress' },
  approvals_complete: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Approvals Complete' },
  po_pending: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', label: 'PO Pending' },
  ready_to_plan: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', label: 'Ready to Plan' },
  planned: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300', label: 'Planned' },
  on_hold: { bg: 'bg-gray-100 dark:bg-gray-700/30', text: 'text-gray-700 dark:text-gray-300', label: 'On Hold' },
  cancelled: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Cancelled' },
  lost: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Lost' },
};

const PRIORITY_COLORS: Record<Priority, { bg: string; text: string }> = {
  low: { bg: 'bg-gray-100 dark:bg-gray-700/30', text: 'text-gray-600 dark:text-gray-400' },
  medium: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400' },
  high: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-600 dark:text-orange-400' },
  critical: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400' },
};

export function PipelineDashboard() {
  const [stats, setStats] = useState<PipelineDashboardStats | null>(null);
  const [projects, setProjects] = useState<PipelineProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | ''>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // RBAC: Check if user is super_admin for Smartsheet sync access
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  useEffect(() => {
    loadData();
  }, [search, statusFilter, page]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load stats
      const statsRes = await fetch('/api/pipeline/dashboard');
      const statsData = await statsRes.json();
      if (statsData.success) {
        setStats(statsData.data);
      }

      // Load projects
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (search) params.set('search', search);
      if (statusFilter) params.set('pipeline_status', statusFilter);

      const projectsRes = await fetch(`/api/pipeline/projects?${params}`);
      const projectsData = await projectsRes.json();
      if (projectsData.success) {
        setProjects(projectsData.data.projects);
        setTotalPages(projectsData.data.totalPages);
      }
    } catch (error) {
      console.error('Failed to load pipeline data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <FolderKanban className="w-7 h-7 text-[var(--ff-accent)]" />
              Project Pipeline
            </h1>
            <p className="text-[var(--ff-text-secondary)] mt-1">
              Track potential projects through approval stages
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Smartsheet Sync - Super Admin Only */}
            {isSuperAdmin && (
              <SmartsheetSyncPanel compact onSyncComplete={loadData} />
            )}
            <button
              onClick={loadData}
              className="p-2 rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <Link
              href="/pipeline/new"
              className="flex items-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] transition-colors"
            >
              <Plus className="w-5 h-5" />
              New Project
            </Link>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Total Pipeline</p>
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {stats.total_projects}
                  </p>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <FolderKanban className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <p className="text-xs text-[var(--ff-text-secondary)] mt-2">
                {formatCurrency(stats.total_estimated_value)} total value
              </p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Ready to Plan</p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {stats.projects_ready_to_plan}
                  </p>
                </div>
                <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                  <CheckCircle className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <p className="text-xs text-[var(--ff-text-secondary)] mt-2">
                All approvals complete + PO received
              </p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Awaiting PO</p>
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {stats.projects_awaiting_po}
                  </p>
                </div>
                <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                  <FileText className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <p className="text-xs text-[var(--ff-text-secondary)] mt-2">
                Approvals complete, waiting for PO
              </p>
            </div>

            <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">Expiring Soon</p>
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {stats.approvals_expiring_soon}
                  </p>
                </div>
                <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
                </div>
              </div>
              <p className="text-xs text-[var(--ff-text-secondary)] mt-2">
                Approvals expiring within 30 days
              </p>
            </div>
          </div>
        )}

        {/* Alerts Widget */}
        <div className="mb-8">
          <AlertsDashboard compact />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[var(--ff-text-secondary)]" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as PipelineStatus | '');
                setPage(1);
              }}
              className="px-3 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)]"
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_COLORS).map(([status, { label }]) => (
                <option key={status} value={status}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Projects Table */}
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow border border-[var(--ff-border-light)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--ff-bg-tertiary)]">
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                  Approvals
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                  Value
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="px-4 py-4">
                      <div className="h-6 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
                    </td>
                  </tr>
                ))
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[var(--ff-text-secondary)]">
                    No projects found. Create a new project to get started.
                  </td>
                </tr>
              ) : (
                projects.map((project) => {
                  const statusStyle = STATUS_COLORS[project.pipeline_status];
                  const priorityStyle = PRIORITY_COLORS[project.priority];
                  const approvalPercent =
                    project.total_required_approvals > 0
                      ? Math.round(
                          (project.completed_approvals / project.total_required_approvals) * 100
                        )
                      : 0;

                  return (
                    <tr
                      key={project.id}
                      className="hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                    >
                      <td className="px-4 py-4">
                        <Link
                          href={`/pipeline/${project.id}`}
                          className="font-medium text-[var(--ff-text-primary)] hover:text-[var(--ff-accent)]"
                        >
                          {project.project_name}
                        </Link>
                        <p className="text-xs text-[var(--ff-text-secondary)]">
                          {project.project_code}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[var(--ff-text-primary)]">
                          {project.client_name || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[var(--ff-text-primary)]">
                          {[project.municipality, project.province]
                            .filter(Boolean)
                            .join(', ') || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                        >
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[100px]">
                            <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                              <div
                                className={`h-full ${
                                  project.expired_approvals > 0
                                    ? 'bg-red-500'
                                    : approvalPercent === 100
                                    ? 'bg-green-500'
                                    : 'bg-blue-500'
                                }`}
                                style={{ width: `${approvalPercent}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-xs text-[var(--ff-text-secondary)]">
                            {project.completed_approvals}/{project.total_required_approvals}
                          </span>
                          {project.expired_approvals > 0 && (
                            <AlertTriangle className="w-4 h-4 text-red-500" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[var(--ff-text-primary)]">
                          {project.estimated_value
                            ? formatCurrency(project.estimated_value)
                            : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          href={`/pipeline/${project.id}`}
                          className="text-[var(--ff-accent)] hover:text-[var(--ff-accent-hover)] text-sm font-medium"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-[var(--ff-border-light)] flex items-center justify-between">
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 border border-[var(--ff-border-light)] rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-tertiary)]"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 border border-[var(--ff-border-light)] rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--ff-bg-tertiary)]"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PipelineDashboard;
