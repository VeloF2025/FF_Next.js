/**
 * Project Wayleaves Tab
 * Displays wayleave approvals for a project with status tracking, expiry alerts, and management
 * Supports multiple pipeline links with primary link selection
 */

import { useState } from 'react';
import useSWR from 'swr';
import {
  FileCheck,
  Plus,
  AlertTriangle,
  CheckCircle,
  Clock,
  ChevronRight,
  Building,
  Phone,
  Mail,
  Calendar,
  ExternalLink,
  RefreshCw,
  Link2,
  Star,
  Trash2,
  MapPin,
  Info,
  Loader2,
} from 'lucide-react';
import { log } from '@/lib/logger';
import type { PipelineProjectApprovalWithType } from '@/modules/pipeline/types';
import { LinkPipelineModal } from './LinkPipelineModal';

interface ProjectWayleavesTabProps {
  projectId: string;
  projectName?: string;
}

interface WayleavesResponse {
  approvals: PipelineProjectApprovalWithType[];
  pipeline_project_id: string | null;
  status: {
    total: number;
    approved: number;
    pending: number;
    expiring_count: number;
    expired_count: number;
    progress: number;
  };
  expiring_alerts: Array<{
    id: string;
    name: string;
    expiry_date: string;
    days_until: number;
  }>;
  message?: string;
}

interface PipelineLink {
  id: string;
  project_id: string;
  pipeline_project_id: string;
  is_primary: boolean;
  link_type: 'transition' | 'manual';
  link_order: number;
  linked_at: string;
  linked_by: string | null;
  notes: string | null;
  pipeline_project_name: string;
  pipeline_status: string;
  pipeline_area: string | null;
  pipeline_municipality: string | null;
  approval_count: number;
  approved_count: number;
}

interface LinksResponse {
  links: PipelineLink[];
  primary_link_id: string | null;
  count: number;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

function getStatusConfig(status: string) {
  switch (status) {
    case 'approved':
    case 'renewed':
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Approved', icon: CheckCircle };
    case 'conditionally_approved':
      return { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Conditional', icon: CheckCircle };
    case 'submitted':
    case 'in_review':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: 'In Progress', icon: Clock };
    case 'rejected':
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Rejected', icon: AlertTriangle };
    case 'expired':
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Expired', icon: AlertTriangle };
    case 'not_started':
    case 'preparing':
    default:
      return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', label: 'Pending', icon: Clock };
  }
}

const pipelineStatusLabels: Record<string, string> = {
  lead: 'Lead',
  qualifying: 'Qualifying',
  planning: 'Planning',
  ready_to_plan: 'Ready to Plan',
  planned: 'Planned',
  on_hold: 'On Hold',
  lost: 'Lost',
};

const pipelineStatusColors: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  qualifying: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  planning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  ready_to_plan: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  planned: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  on_hold: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  lost: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getDaysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function ProjectWayleavesTab({ projectId, projectName = 'Project' }: ProjectWayleavesTabProps) {
  const [selectedApproval, setSelectedApproval] = useState<PipelineProjectApprovalWithType | null>(null);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Fetch pipeline links
  const { data: linksData, mutate: mutateLinks } = useSWR<{ data: LinksResponse }>(
    `/api/projects/${projectId}/pipeline-links`,
    fetcher
  );

  const links = linksData?.data?.links || [];
  const primaryLink = links.find(l => l.is_primary) || links[0];

  // Fetch wayleaves from primary link
  const { data, error, isLoading, mutate } = useSWR<{ data: WayleavesResponse }>(
    `/api/projects/${projectId}/wayleaves`,
    fetcher
  );

  const wayleavesData = data?.data;
  const approvals = wayleavesData?.approvals || [];
  const status = wayleavesData?.status;
  const expiringAlerts = wayleavesData?.expiring_alerts || [];
  const hasPipelineLink = links.length > 0 || Boolean(wayleavesData?.pipeline_project_id);

  const handleSetPrimary = async (linkId: string) => {
    setActionInProgress(linkId);
    try {
      const response = await fetch(`/api/projects/${projectId}/pipeline-links/${linkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_primary: true }),
      });

      if (response.ok) {
        await mutateLinks();
        await mutate();
      }
    } catch (err) {
      log.error('Failed to set primary link', { err }, 'ProjectWayleavesTab');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUnlink = async (linkId: string) => {
    if (!window.confirm('Are you sure you want to unlink this pipeline area?')) return;

    setActionInProgress(linkId);
    try {
      const response = await fetch(`/api/projects/${projectId}/pipeline-links/${linkId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await mutateLinks();
        await mutate();
      }
    } catch (err) {
      log.error('Failed to unlink pipeline', { err }, 'ProjectWayleavesTab');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleLinkCreated = async () => {
    await mutateLinks();
    await mutate();
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 bg-[var(--ff-bg-secondary)] rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-40 bg-[var(--ff-bg-secondary)] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    log.error('Failed to load wayleaves', { error, projectId }, 'ProjectWayleavesTab');
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-500" />
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">Failed to Load Wayleaves</h3>
        <p className="text-[var(--ff-text-secondary)] mb-4">Unable to fetch wayleave data for this project.</p>
        <button
          onClick={() => mutate()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  // No pipeline link - show setup option with ability to link
  if (!hasPipelineLink) {
    return (
      <div className="space-y-6">
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
          <FileCheck className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
            No Pipeline Link
          </h3>
          <p className="text-[var(--ff-text-secondary)] mb-6 max-w-md mx-auto">
            This project is not linked to any pipeline area. Link it to an existing pipeline project
            to enable wayleave tracking, or create a new project in the pipeline module.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setIsLinkModalOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              <Link2 className="w-5 h-5" />
              Link Pipeline Area
            </button>
            <a
              href="/pipeline"
              className="inline-flex items-center gap-2 px-6 py-3 border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg"
            >
              <ExternalLink className="w-5 h-5" />
              Go to Pipeline
            </a>
          </div>
        </div>

        <LinkPipelineModal
          projectId={projectId}
          projectName={projectName}
          isOpen={isLinkModalOpen}
          onClose={() => setIsLinkModalOpen(false)}
          onLinkCreated={handleLinkCreated}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Linked Pipeline Areas Section */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <Link2 className="w-4 h-4 text-blue-500" />
            Linked Pipeline Areas
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]">
              {links.length}
            </span>
          </h3>
          <button
            onClick={() => setIsLinkModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            Link Area
          </button>
        </div>

        {links.length === 0 ? (
          <div className="text-center py-4 text-[var(--ff-text-secondary)]">
            No pipeline areas linked yet
          </div>
        ) : (
          <div className="space-y-2">
            {links.map(link => (
              <div
                key={link.id}
                className={`p-3 rounded-lg border ${
                  link.is_primary
                    ? 'border-blue-500/50 bg-blue-50/50 dark:bg-blue-900/10'
                    : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {link.is_primary && (
                        <Star className="w-4 h-4 text-amber-500 flex-shrink-0" fill="currentColor" />
                      )}
                      <span className="font-medium text-[var(--ff-text-primary)] truncate">
                        {link.pipeline_project_name}
                      </span>
                      {link.is_primary && (
                        <span className="text-xs text-blue-600 dark:text-blue-400">(Primary)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--ff-text-secondary)]">
                      {(link.pipeline_area || link.pipeline_municipality) && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {[link.pipeline_area, link.pipeline_municipality].filter(Boolean).join(', ')}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          pipelineStatusColors[link.pipeline_status] || pipelineStatusColors.lead
                        }`}
                      >
                        {pipelineStatusLabels[link.pipeline_status] || link.pipeline_status}
                      </span>
                      {link.approval_count > 0 && (
                        <span className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          {link.approved_count}/{link.approval_count} Approvals
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <a
                      href={`/pipeline/${link.pipeline_project_id}`}
                      className="p-1.5 text-[var(--ff-text-secondary)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                      title="View Pipeline"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    {!link.is_primary && (
                      <button
                        onClick={() => handleSetPrimary(link.id)}
                        disabled={actionInProgress === link.id}
                        className="p-1.5 text-[var(--ff-text-secondary)] hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors disabled:opacity-50"
                        title="Set as Primary"
                      >
                        {actionInProgress === link.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Star className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => handleUnlink(link.id)}
                      disabled={actionInProgress === link.id}
                      className="p-1.5 text-[var(--ff-text-secondary)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                      title="Unlink"
                    >
                      {actionInProgress === link.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {links.length > 1 && (
          <div className="mt-3 flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Primary link determines which approvals are shown below. Click the star icon to change primary.</span>
          </div>
        )}
      </div>

      {/* Progress Header */}
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-blue-500" />
            Wayleaves & Approvals
            {primaryLink && (
              <span className="text-sm font-normal text-[var(--ff-text-secondary)]">
                from {primaryLink.pipeline_project_name}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => mutate()}
              className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <a
              href={`/pipeline/${wayleavesData?.pipeline_project_id}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
            >
              <Plus className="w-4 h-4" />
              Manage in Pipeline
            </a>
          </div>
        </div>

        {/* Progress Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-3 rounded-lg bg-[var(--ff-bg-secondary)]">
            <p className="text-sm text-[var(--ff-text-secondary)]">Total</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{status?.total || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
            <p className="text-sm text-green-600 dark:text-green-400">Approved</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{status?.approved || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20">
            <p className="text-sm text-amber-600 dark:text-amber-400">Pending</p>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{status?.pending || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20">
            <p className="text-sm text-orange-600 dark:text-orange-400">Expiring</p>
            <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{status?.expiring_count || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--ff-bg-secondary)]">
            <p className="text-sm text-[var(--ff-text-secondary)]">Progress</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{status?.progress || 0}%</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
              style={{ width: `${status?.progress || 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Expiring Alerts */}
      {expiringAlerts.length > 0 && (
        <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <h4 className="font-medium text-orange-700 dark:text-orange-300">Expiring Soon</h4>
          </div>
          <div className="space-y-2">
            {expiringAlerts.map(alert => (
              <div
                key={alert.id}
                className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded-lg"
              >
                <span className="text-sm text-[var(--ff-text-primary)]">{alert.name}</span>
                <span className="text-sm text-orange-600 dark:text-orange-400">
                  Expires in {alert.days_until} days ({formatDate(alert.expiry_date)})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Approval Cards Grid */}
      {approvals.length === 0 ? (
        <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
          <FileCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Wayleaves Yet</h3>
          <p className="text-[var(--ff-text-secondary)]">
            No wayleave approvals have been added to the linked pipeline project yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {approvals.map(approval => {
            const statusConfig = getStatusConfig(approval.status);
            const StatusIcon = statusConfig.icon;
            const daysUntil = getDaysUntilExpiry(approval.expiry_date);
            const isExpiringSoon = daysUntil !== null && daysUntil > 0 && daysUntil <= 90;
            const isExpired = daysUntil !== null && daysUntil <= 0;

            return (
              <div
                key={approval.id}
                className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden hover:border-blue-500/50 transition-colors cursor-pointer"
                onClick={() => setSelectedApproval(approval)}
              >
                {/* Header */}
                <div className={`px-4 py-3 ${statusConfig.bg}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${statusConfig.text}`}>
                      {approval.approval_type_name}
                    </span>
                    <StatusIcon className={`w-4 h-4 ${statusConfig.text}`} />
                  </div>
                </div>

                {/* Body */}
                <div className="p-4 space-y-3">
                  {/* Status Badge */}
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusConfig.bg} ${statusConfig.text}`}>
                      {statusConfig.label}
                    </span>
                    {approval.approval_type_is_compulsory && (
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                        Required
                      </span>
                    )}
                  </div>

                  {/* Authority */}
                  {approval.authority_name && (
                    <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
                      <Building className="w-4 h-4" />
                      <span className="truncate">{approval.authority_name}</span>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="space-y-1">
                    {approval.approval_date && (
                      <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span>Approved: {formatDate(approval.approval_date)}</span>
                      </div>
                    )}
                    {approval.expiry_date && (
                      <div className={`flex items-center gap-2 text-sm ${
                        isExpired ? 'text-red-600 dark:text-red-400' :
                        isExpiringSoon ? 'text-orange-600 dark:text-orange-400' :
                        'text-[var(--ff-text-secondary)]'
                      }`}>
                        <Calendar className="w-4 h-4" />
                        <span>
                          Expires: {formatDate(approval.expiry_date)}
                          {isExpired && ' (Expired!)'}
                          {isExpiringSoon && !isExpired && ` (${daysUntil} days)`}
                        </span>
                      </div>
                    )}
                    {approval.application_date && !approval.approval_date && (
                      <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
                        <Clock className="w-4 h-4" />
                        <span>Submitted: {formatDate(approval.application_date)}</span>
                      </div>
                    )}
                  </div>

                  {/* View Details Link */}
                  <div className="flex items-center justify-end pt-2 text-sm text-blue-600 dark:text-blue-400">
                    <span className="flex items-center gap-1">
                      View Details <ChevronRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Drawer */}
      {selectedApproval && (
        <ApprovalDetailDrawer
          approval={selectedApproval}
          pipelineProjectId={wayleavesData?.pipeline_project_id || ''}
          onClose={() => setSelectedApproval(null)}
        />
      )}

      {/* Link Pipeline Modal */}
      <LinkPipelineModal
        projectId={projectId}
        projectName={projectName}
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        onLinkCreated={handleLinkCreated}
      />
    </div>
  );
}

// Detail Drawer Component
interface ApprovalDetailDrawerProps {
  approval: PipelineProjectApprovalWithType;
  pipelineProjectId: string;
  onClose: () => void;
}

function ApprovalDetailDrawer({ approval, pipelineProjectId, onClose }: ApprovalDetailDrawerProps) {
  const statusConfig = getStatusConfig(approval.status);
  const daysUntil = getDaysUntilExpiry(approval.expiry_date);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-[var(--ff-card-bg)] shadow-xl overflow-y-auto">
        {/* Header */}
        <div className={`px-6 py-4 ${statusConfig.bg} border-b border-[var(--ff-border-light)]`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-lg font-semibold ${statusConfig.text}`}>
              {approval.approval_type_name}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-black/10 rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusConfig.bg} ${statusConfig.text} border border-current/20`}>
              {statusConfig.label}
            </span>
            {approval.approval_type_is_compulsory && (
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                Required
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Authority Information */}
          <section>
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">Authority</h3>
            <div className="space-y-3">
              {approval.authority_name && (
                <div className="flex items-center gap-3">
                  <Building className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                  <span className="text-[var(--ff-text-primary)]">{approval.authority_name}</span>
                </div>
              )}
              {approval.authority_contact_name && (
                <div className="flex items-center gap-3">
                  <span className="w-5 h-5 text-center text-[var(--ff-text-secondary)]">👤</span>
                  <span className="text-[var(--ff-text-primary)]">{approval.authority_contact_name}</span>
                </div>
              )}
              {approval.authority_contact_email && (
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                  <a href={`mailto:${approval.authority_contact_email}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {approval.authority_contact_email}
                  </a>
                </div>
              )}
              {approval.authority_contact_phone && (
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                  <a href={`tel:${approval.authority_contact_phone}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {approval.authority_contact_phone}
                  </a>
                </div>
              )}
              {!approval.authority_name && !approval.authority_contact_name && (
                <p className="text-[var(--ff-text-secondary)] italic">No authority information</p>
              )}
            </div>
          </section>

          {/* Timeline */}
          <section>
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">Timeline</h3>
            <div className="space-y-3">
              {approval.application_date && (
                <div className="flex justify-between">
                  <span className="text-[var(--ff-text-secondary)]">Application Submitted</span>
                  <span className="text-[var(--ff-text-primary)]">{formatDate(approval.application_date)}</span>
                </div>
              )}
              {approval.approval_date && (
                <div className="flex justify-between">
                  <span className="text-[var(--ff-text-secondary)]">Approved</span>
                  <span className="text-green-600 dark:text-green-400">{formatDate(approval.approval_date)}</span>
                </div>
              )}
              {approval.issue_date && (
                <div className="flex justify-between">
                  <span className="text-[var(--ff-text-secondary)]">Issued</span>
                  <span className="text-[var(--ff-text-primary)]">{formatDate(approval.issue_date)}</span>
                </div>
              )}
              {approval.expiry_date && (
                <div className="flex justify-between">
                  <span className="text-[var(--ff-text-secondary)]">Expires</span>
                  <span className={
                    daysUntil !== null && daysUntil <= 0 ? 'text-red-600 dark:text-red-400' :
                    daysUntil !== null && daysUntil <= 90 ? 'text-orange-600 dark:text-orange-400' :
                    'text-[var(--ff-text-primary)]'
                  }>
                    {formatDate(approval.expiry_date)}
                    {daysUntil !== null && (
                      <span className="ml-2 text-sm">
                        ({daysUntil <= 0 ? 'Expired' : `${daysUntil} days`})
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* References */}
          {(approval.application_reference || approval.approval_reference) && (
            <section>
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">References</h3>
              <div className="space-y-3">
                {approval.application_reference && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Application Ref</span>
                    <span className="text-[var(--ff-text-primary)] font-mono">{approval.application_reference}</span>
                  </div>
                )}
                {approval.approval_reference && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Approval Ref</span>
                    <span className="text-[var(--ff-text-primary)] font-mono">{approval.approval_reference}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Conditions */}
          {approval.conditions && (
            <section>
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">Conditions</h3>
              <p className="text-[var(--ff-text-primary)] whitespace-pre-wrap">{approval.conditions}</p>
            </section>
          )}

          {/* Notes */}
          {approval.notes && (
            <section>
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">Notes</h3>
              <p className="text-[var(--ff-text-primary)] whitespace-pre-wrap">{approval.notes}</p>
            </section>
          )}

          {/* Documents */}
          {(approval.application_document_url || approval.approval_document_url) && (
            <section>
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-3">Documents</h3>
              <div className="space-y-2">
                {approval.application_document_url && (
                  <a
                    href={approval.application_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    <FileCheck className="w-5 h-5 text-blue-500" />
                    <span className="text-[var(--ff-text-primary)]">Application Document</span>
                    <ExternalLink className="w-4 h-4 ml-auto text-[var(--ff-text-secondary)]" />
                  </a>
                )}
                {approval.approval_document_url && (
                  <a
                    href={approval.approval_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 bg-[var(--ff-bg-secondary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
                  >
                    <FileCheck className="w-5 h-5 text-green-500" />
                    <span className="text-[var(--ff-text-primary)]">Approval Certificate</span>
                    <ExternalLink className="w-4 h-4 ml-auto text-[var(--ff-text-secondary)]" />
                  </a>
                )}
              </div>
            </section>
          )}

          {/* Edit Link */}
          <div className="pt-4 border-t border-[var(--ff-border-light)]">
            <a
              href={`/pipeline/${pipelineProjectId}`}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Edit in Pipeline
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectWayleavesTab;
