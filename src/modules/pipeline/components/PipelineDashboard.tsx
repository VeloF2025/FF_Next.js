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
  FileText,
  RefreshCw,
  LayoutGrid,
  List,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import { PipelineKanban } from './PipelineKanban';
import type {
  PipelineDashboardStats,
  PipelineProjectSummary,
  PipelineStatus,
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
  on_hold: { bg: 'bg-secondary/30', text: 'text-muted-foreground', label: 'On Hold' },
  cancelled: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Cancelled' },
  lost: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Lost' },
};


type ViewMode = 'table' | 'kanban';

export function PipelineDashboard() {
  const [stats, setStats] = useState<PipelineDashboardStats | null>(null);
  const [projects, setProjects] = useState<PipelineProjectSummary[]>([]);
  const [allProjects, setAllProjects] = useState<PipelineProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | ''>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  // export state removed — export button is commented out

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

      // Load projects for table view (paginated)
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

      // Load all projects for Kanban view (no pagination)
      const allProjectsRes = await fetch('/api/pipeline/projects?limit=500');
      const allProjectsData = await allProjectsRes.json();
      if (allProjectsData.success) {
        setAllProjects(allProjectsData.data.projects);
      }
    } catch (error) {
      log.error('Failed to load pipeline data', { error }, 'PipelineDashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (projectId: string, newStatus: PipelineStatus) => {
    try {
      const response = await fetch(`/api/pipeline/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline_status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      // Refresh data after successful update
      loadData();
    } catch (error) {
      log.error('Failed to update project status', { error, projectId, newStatus }, 'PipelineDashboard');
      // Revert will happen via loadData refresh
      loadData();
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
    <div className="space-y-6">
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
            {/* View Toggle */}
            <div className="flex items-center border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('table')}
                className={`p-2 transition-colors ${
                  viewMode === 'table'
                    ? 'bg-[var(--ff-accent)] text-white'
                    : 'hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
                }`}
                title="Table View"
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('kanban')}
                className={`p-2 transition-colors ${
                  viewMode === 'kanban'
                    ? 'bg-[var(--ff-accent)] text-white'
                    : 'hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
                }`}
                title="Kanban View"
              >
                <LayoutGrid className="w-5 h-5" />
              </button>
            </div>
            {/* Smartsheet Sync - Super Admin Only */}
            {isSuperAdmin && (
              <SmartsheetSyncPanel compact onSyncComplete={loadData} />
            )}
            {/* <button
              onClick={handleExport}
              disabled={exporting}
              className="p-2 rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50"
              title="Export to Excel"
            >
              <Download className={`w-5 h-5 ${exporting ? 'animate-pulse' : ''}`} />
            </button> */}
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
          <div className="mb-8">
            <StatsGrid
              columns={4}
              cards={[
                {
                  title: 'Total Pipeline',
                  value: stats.total_projects,
                  icon: FolderKanban,
                  color: '#3B82F6',
                  subtitle: `${formatCurrency(stats.total_estimated_value)} total value`,
                },
                {
                  title: 'Ready to Plan',
                  value: stats.projects_ready_to_plan,
                  icon: CheckCircle,
                  color: '#10B981',
                  subtitle: 'All approvals complete + PO received',
                },
                {
                  title: 'Awaiting PO',
                  value: stats.projects_awaiting_po,
                  icon: FileText,
                  color: '#D97706',
                  subtitle: 'Approvals complete, waiting for PO',
                },
                {
                  title: 'Expiring Soon',
                  value: stats.approvals_expiring_soon,
                  icon: AlertTriangle,
                  color: '#EF4444',
                  subtitle: 'Approvals expiring within 30 days',
                },
              ]}
            />
          </div>
        )}

        {/* Alerts Widget */}
        <div className="mb-8">
          <AlertsDashboard compact />
        </div>

        {/* Kanban View */}
        {viewMode === 'kanban' && (
          <PipelineKanban
            projects={allProjects}
            onStatusChange={handleStatusChange}
            loading={loading}
          />
        )}

        {/* Table View */}
        {viewMode === 'table' && (
          <>
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
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Project
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Location
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Approvals
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
                  Value
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide">
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
          </>
        )}
    </div>
  );
}

export default PipelineDashboard;
