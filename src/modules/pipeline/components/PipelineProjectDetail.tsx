/**
 * Pipeline Project Detail Component
 * Shows project details and approval gates
 */

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types/auth.types';
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  MapPin,
  User,
  Phone,
  Mail,
  DollarSign,
  Edit,
  Trash2,
  Plus,
  RefreshCw,
  XCircle,
  ChevronRight,
  FileSignature,
  Trees,
  Upload,
  ExternalLink,
  Save,
  Loader2,
  Shield,
} from 'lucide-react';
import type {
  PipelineProjectWithRelations,
  PipelineProjectApprovalWithType,
  PipelineStatus,
  ApprovalStatus,
  LeaseStatus,
  CessionStatus,
} from '../types';
import { ApprovalDetailDrawer } from './ApprovalDetailDrawer';
import { ProjectDocumentManager } from './ProjectDocumentManager';

const STATUS_LABELS: Record<PipelineStatus, string> = {
  new: 'New',
  qualification: 'Qualification',
  approvals_in_progress: 'Approvals In Progress',
  approvals_complete: 'Approvals Complete',
  po_pending: 'PO Pending',
  ready_to_plan: 'Ready to Plan',
  planned: 'Planned',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
  lost: 'Lost',
};

const APPROVAL_STATUS_COLORS: Record<
  ApprovalStatus,
  { bg: string; text: string; icon: React.ReactNode }
> = {
  not_started: {
    bg: 'bg-gray-100 dark:bg-gray-700/30',
    text: 'text-gray-600 dark:text-gray-400',
    icon: <Clock className="w-5 h-5" />,
  },
  preparing: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-600 dark:text-blue-400',
    icon: <Clock className="w-5 h-5" />,
  },
  internal_review: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-600 dark:text-purple-400',
    icon: <User className="w-5 h-5" />,
  },
  submitted: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-600 dark:text-yellow-400',
    icon: <FileText className="w-5 h-5" />,
  },
  in_review: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    text: 'text-yellow-600 dark:text-yellow-400',
    icon: <Clock className="w-5 h-5" />,
  },
  additional_info_required: {
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-600 dark:text-orange-400',
    icon: <AlertTriangle className="w-5 h-5" />,
  },
  approved: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-600 dark:text-green-400',
    icon: <CheckCircle className="w-5 h-5" />,
  },
  conditionally_approved: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-600 dark:text-green-400',
    icon: <CheckCircle className="w-5 h-5" />,
  },
  rejected: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-600 dark:text-red-400',
    icon: <XCircle className="w-5 h-5" />,
  },
  expired: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-600 dark:text-red-400',
    icon: <AlertTriangle className="w-5 h-5" />,
  },
  renewed: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-600 dark:text-green-400',
    icon: <RefreshCw className="w-5 h-5" />,
  },
  withdrawn: {
    bg: 'bg-gray-100 dark:bg-gray-700/30',
    text: 'text-gray-600 dark:text-gray-400',
    icon: <XCircle className="w-5 h-5" />,
  },
};

export function PipelineProjectDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { currentUser } = useAuth();

  const [project, setProject] = useState<PipelineProjectWithRelations | null>(null);
  const [approvals, setApprovals] = useState<PipelineProjectApprovalWithType[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<{
    complete: boolean;
    total: number;
    approved: number;
    pending: string[];
    expired: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedApproval, setSelectedApproval] = useState<PipelineProjectApprovalWithType | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savingLegalDocs, setSavingLegalDocs] = useState(false);
  const [legalDocsChanged, setLegalDocsChanged] = useState(false);
  const [legalDocs, setLegalDocs] = useState({
    is_rural: false,
    lease_agreement_status: 'not_started' as LeaseStatus,
    lease_agreement_date: '',
    lease_agreement_document_url: '',
    cession_status: 'not_started' as CessionStatus,
    cession_date: '',
    cession_document_url: '',
  });

  // Map auth role to drawer role
  const drawerUserRole = useMemo((): 'pm' | 'ops' | 'admin' | 'viewer' => {
    if (!currentUser) return 'viewer';
    switch (currentUser.role) {
      case UserRole.SUPER_ADMIN:
      case UserRole.ADMIN:
        return 'admin';
      case UserRole.PROJECT_MANAGER:
        return 'pm';
      case UserRole.SITE_SUPERVISOR:
        // Site supervisor acts as operations for approval workflow
        return 'ops';
      default:
        return 'viewer';
    }
  }, [currentUser]);

  // Split approvals into compulsory and other
  const { compulsoryApprovals, otherApprovals } = useMemo(() => {
    const isRural = legalDocs.is_rural || project?.is_rural || false;

    const compulsory: PipelineProjectApprovalWithType[] = [];
    const other: PipelineProjectApprovalWithType[] = [];

    for (const approval of approvals) {
      // Check if this is a conditional approval
      const conditionType = approval.approval_type_condition_type;

      // Skip rural-only approvals if not rural
      if (conditionType === 'rural_only' && !isRural) {
        // Still show it but mark as not applicable
        other.push(approval);
        continue;
      }

      // Skip urban-only approvals if rural
      if (conditionType === 'urban_only' && isRural) {
        other.push(approval);
        continue;
      }

      if (approval.approval_type_is_compulsory) {
        compulsory.push(approval);
      } else {
        other.push(approval);
      }
    }

    return { compulsoryApprovals: compulsory, otherApprovals: other };
  }, [approvals, legalDocs.is_rural, project?.is_rural]);

  const handleApprovalClick = (approval: PipelineProjectApprovalWithType) => {
    setSelectedApproval(approval);
    setDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setSelectedApproval(null);
  };

  const handleApprovalUpdate = () => {
    // Reload data after approval update
    loadProject();
  };

  // Initialize legal docs when project loads
  useEffect(() => {
    if (project) {
      setLegalDocs({
        is_rural: project.is_rural || false,
        lease_agreement_status: project.lease_agreement_status || 'not_started',
        lease_agreement_date: project.lease_agreement_date || '',
        lease_agreement_document_url: project.lease_agreement_document_url || '',
        cession_status: project.cession_status || 'not_started',
        cession_date: project.cession_date || '',
        cession_document_url: project.cession_document_url || '',
      });
      setLegalDocsChanged(false);
    }
  }, [project]);

  const handleLegalDocChange = <K extends keyof typeof legalDocs>(
    key: K,
    value: typeof legalDocs[K]
  ) => {
    setLegalDocs((prev) => ({ ...prev, [key]: value }));
    setLegalDocsChanged(true);
  };

  const saveLegalDocs = async () => {
    if (!id) return;
    setSavingLegalDocs(true);
    try {
      const response = await fetch(`/api/pipeline/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_rural: legalDocs.is_rural,
          lease_agreement_status: legalDocs.lease_agreement_status,
          lease_agreement_date: legalDocs.lease_agreement_date || null,
          lease_agreement_document_url: legalDocs.lease_agreement_document_url || null,
          cession_status: legalDocs.cession_status,
          cession_date: legalDocs.cession_date || null,
          cession_document_url: legalDocs.cession_document_url || null,
        }),
      });
      if (!response.ok) throw new Error('Failed to save');
      setLegalDocsChanged(false);
      loadProject();
    } catch (err) {
      console.error('Failed to save legal docs:', err);
    } finally {
      setSavingLegalDocs(false);
    }
  };

  useEffect(() => {
    if (id) {
      loadProject();
    }
  }, [id]);

  const loadProject = async () => {
    setLoading(true);
    try {
      // Load project
      const projectRes = await fetch(`/api/pipeline/projects/${id}`);
      const projectData = await projectRes.json();
      if (projectData.success) {
        setProject(projectData.data);
      }

      // Load approvals
      const approvalsRes = await fetch(`/api/pipeline/projects/${id}/approvals`);
      const approvalsData = await approvalsRes.json();
      if (approvalsData.success) {
        setApprovals(approvalsData.data.approvals);
        setApprovalStatus(approvalsData.data.status);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return '-';
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (date: string | null) => {
    if (!date) return '-';
    // Standard YYYY-MM-DD format
    return new Date(date).toISOString().split('T')[0];
  };

  const getDaysUntilExpiry = (expiryDate: string | null) => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const today = new Date();
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-48 mb-8 animate-pulse"></div>
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
            <div className="space-y-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-6 bg-[var(--ff-bg-tertiary)] rounded animate-pulse"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6">
        <div className="max-w-5xl mx-auto text-center py-12">
          <p className="text-[var(--ff-text-secondary)]">Project not found</p>
          <Link href="/pipeline" className="text-[var(--ff-accent)] mt-4 inline-block">
            Back to Pipeline
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/pipeline"
            className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {project.project_name}
            </h1>
            <p className="text-[var(--ff-text-secondary)]">{project.project_code}</p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              project.pipeline_status === 'ready_to_plan'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : project.pipeline_status === 'approvals_complete'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
            }`}
          >
            {STATUS_LABELS[project.pipeline_status]}
          </span>
        </div>

        {/* Approval Progress */}
        {approvalStatus && (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)] mb-6">
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
              Approval Progress
            </h2>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="h-3 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      approvalStatus.expired.length > 0
                        ? 'bg-red-500'
                        : approvalStatus.complete
                        ? 'bg-green-500'
                        : 'bg-blue-500'
                    }`}
                    style={{
                      width: `${
                        approvalStatus.total > 0
                          ? (approvalStatus.approved / approvalStatus.total) * 100
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
              <span className="text-lg font-bold text-[var(--ff-text-primary)]">
                {approvalStatus.approved} / {approvalStatus.total}
              </span>
            </div>

            {approvalStatus.pending.length > 0 && (
              <p className="text-sm text-[var(--ff-text-secondary)]">
                <span className="font-medium">Pending:</span> {approvalStatus.pending.join(', ')}
              </p>
            )}
            {approvalStatus.expired.length > 0 && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                <span className="font-medium">Expired:</span> {approvalStatus.expired.join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - Approvals */}
          <div className="lg:col-span-2 space-y-6">
            {approvals.length === 0 ? (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-8 border border-[var(--ff-border-light)] text-center">
                <p className="text-[var(--ff-text-secondary)]">No approvals configured yet</p>
                <button className="mt-4 flex items-center gap-1 mx-auto text-sm text-[var(--ff-accent)] hover:text-[var(--ff-accent-hover)]">
                  <Plus className="w-4 h-4" />
                  Add Approval
                </button>
              </div>
            ) : (
              <>
                {/* Compulsory Approvals */}
                {compulsoryApprovals.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                        <Shield className="w-5 h-5 text-red-500" />
                        Compulsory Approvals ({compulsoryApprovals.length})
                      </h2>
                    </div>
                    <div className="space-y-3">
                      {compulsoryApprovals.map((approval) => {
                        const statusStyle = APPROVAL_STATUS_COLORS[approval.status];
                        const daysUntilExpiry = getDaysUntilExpiry(approval.expiry_date);
                        const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
                        const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry >= 0;
                        const isRuralOnly = approval.approval_type_condition_type === 'rural_only';

                        return (
                          <div
                            key={approval.id}
                            onClick={() => handleApprovalClick(approval)}
                            className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] hover:border-[var(--ff-accent)] transition-colors cursor-pointer"
                          >
                            <div className="flex items-start gap-4">
                              <div className={`p-2 rounded-lg ${statusStyle.bg}`}>
                                <span className={statusStyle.text}>{statusStyle.icon}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-medium text-[var(--ff-text-primary)]">
                                      {approval.approval_type_name}
                                    </h3>
                                    {isRuralOnly && (
                                      <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded flex items-center gap-1">
                                        <Trees className="w-3 h-3" />
                                        Rural
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                                  >
                                    {approval.status.replace(/_/g, ' ')}
                                  </span>
                                </div>
                                <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                                  {approval.authority_name || 'No authority specified'}
                                </p>

                                {/* Internal Approval Status */}
                                {approval.internal_status !== 'ops_approved' && (
                                  <div className="mt-2 text-xs">
                                    <span className="text-[var(--ff-text-secondary)]">Internal: </span>
                                    <span
                                      className={
                                        approval.internal_status === 'pending'
                                          ? 'text-yellow-600 dark:text-yellow-400'
                                          : approval.internal_status === 'pm_approved'
                                          ? 'text-blue-600 dark:text-blue-400'
                                          : approval.internal_status === 'rejected'
                                          ? 'text-red-600 dark:text-red-400'
                                          : 'text-green-600 dark:text-green-400'
                                      }
                                    >
                                      {approval.internal_status.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                )}

                                {/* Expiry Warning */}
                                {approval.expiry_date && (
                                  <div className="mt-2 flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                                    <span
                                      className={`text-sm ${
                                        isExpired
                                          ? 'text-red-600 dark:text-red-400 font-medium'
                                          : isExpiringSoon
                                          ? 'text-yellow-600 dark:text-yellow-400'
                                          : 'text-[var(--ff-text-secondary)]'
                                      }`}
                                    >
                                      {isExpired
                                        ? `Expired ${Math.abs(daysUntilExpiry!)} days ago`
                                        : `Expires ${formatDate(approval.expiry_date)}`}
                                      {isExpiringSoon && !isExpired && ` (${daysUntilExpiry} days)`}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <ChevronRight className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Other Approvals */}
                {otherApprovals.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                        Other Approvals ({otherApprovals.length})
                      </h2>
                      <button className="flex items-center gap-1 text-sm text-[var(--ff-accent)] hover:text-[var(--ff-accent-hover)]">
                        <Plus className="w-4 h-4" />
                        Add
                      </button>
                    </div>
                    <div className="space-y-3">
                      {otherApprovals.map((approval) => {
                        const statusStyle = APPROVAL_STATUS_COLORS[approval.status];
                        const daysUntilExpiry = getDaysUntilExpiry(approval.expiry_date);
                        const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0;
                        const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry >= 0;
                        const isConditional = approval.approval_type_condition_type !== null;
                        const isRural = legalDocs.is_rural || project?.is_rural || false;
                        const isNotApplicable =
                          (approval.approval_type_condition_type === 'rural_only' && !isRural) ||
                          (approval.approval_type_condition_type === 'urban_only' && isRural);

                        return (
                          <div
                            key={approval.id}
                            onClick={() => handleApprovalClick(approval)}
                            className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] hover:border-[var(--ff-accent)] transition-colors cursor-pointer ${
                              isNotApplicable ? 'opacity-50' : ''
                            }`}
                          >
                            <div className="flex items-start gap-4">
                              <div className={`p-2 rounded-lg ${statusStyle.bg}`}>
                                <span className={statusStyle.text}>{statusStyle.icon}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-medium text-[var(--ff-text-primary)]">
                                      {approval.approval_type_name}
                                    </h3>
                                    {isNotApplicable && (
                                      <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-400 rounded">
                                        N/A
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}
                                  >
                                    {isNotApplicable ? 'Not Applicable' : approval.status.replace(/_/g, ' ')}
                                  </span>
                                </div>
                                <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                                  {approval.authority_name || 'No authority specified'}
                                </p>

                                {/* Internal Approval Status */}
                                {!isNotApplicable && approval.internal_status !== 'ops_approved' && (
                                  <div className="mt-2 text-xs">
                                    <span className="text-[var(--ff-text-secondary)]">Internal: </span>
                                    <span
                                      className={
                                        approval.internal_status === 'pending'
                                          ? 'text-yellow-600 dark:text-yellow-400'
                                          : approval.internal_status === 'pm_approved'
                                          ? 'text-blue-600 dark:text-blue-400'
                                          : approval.internal_status === 'rejected'
                                          ? 'text-red-600 dark:text-red-400'
                                          : 'text-green-600 dark:text-green-400'
                                      }
                                    >
                                      {approval.internal_status.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                )}

                                {/* Expiry Warning */}
                                {!isNotApplicable && approval.expiry_date && (
                                  <div className="mt-2 flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                                    <span
                                      className={`text-sm ${
                                        isExpired
                                          ? 'text-red-600 dark:text-red-400 font-medium'
                                          : isExpiringSoon
                                          ? 'text-yellow-600 dark:text-yellow-400'
                                          : 'text-[var(--ff-text-secondary)]'
                                      }`}
                                    >
                                      {isExpired
                                        ? `Expired ${Math.abs(daysUntilExpiry!)} days ago`
                                        : `Expires ${formatDate(approval.expiry_date)}`}
                                      {isExpiringSoon && !isExpired && ` (${daysUntilExpiry} days)`}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <ChevronRight className="w-5 h-5 text-[var(--ff-text-secondary)]" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sidebar - Project Details */}
          <div className="space-y-4">
            {/* Project Info */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <h3 className="font-semibold text-[var(--ff-text-primary)] mb-4">Project Details</h3>
              <div className="space-y-3 text-sm">
                {project.client_name && (
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                    <span className="text-[var(--ff-text-primary)]">{project.client_name}</span>
                  </div>
                )}
                {(project.municipality || project.province) && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                    <span className="text-[var(--ff-text-primary)]">
                      {[project.municipality, project.province].filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                {project.project_manager_name && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                    <span className="text-[var(--ff-text-primary)]">
                      {project.project_manager_name}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                  <span className="text-[var(--ff-text-primary)]">
                    {formatCurrency(project.estimated_value)}
                  </span>
                </div>
              </div>
            </div>

            {/* Legal Documents */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--ff-text-primary)] flex items-center gap-2">
                  <FileSignature className="w-4 h-4" />
                  Legal Documents
                </h3>
                {legalDocsChanged && (
                  <button
                    onClick={saveLegalDocs}
                    disabled={savingLegalDocs}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--ff-accent)] text-white rounded hover:bg-[var(--ff-accent-hover)] disabled:opacity-50"
                  >
                    {savingLegalDocs ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3" />
                    )}
                    Save
                  </button>
                )}
              </div>

              <div className="space-y-4">
                {/* Rural Project Toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={legalDocs.is_rural}
                    onChange={(e) => handleLegalDocChange('is_rural', e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--ff-border-light)] text-[var(--ff-accent)] focus:ring-[var(--ff-accent)]"
                  />
                  <span className="flex items-center gap-2 text-sm text-[var(--ff-text-primary)]">
                    <Trees className="w-4 h-4 text-green-600" />
                    Rural Project
                  </span>
                </label>
                {legalDocs.is_rural && (
                  <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Tribal Authority approval required
                  </p>
                )}

                {/* Lease Agreement */}
                <div className="pt-3 border-t border-[var(--ff-border-light)]">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                    Lease Agreement
                  </p>
                  <div className="space-y-2">
                    <select
                      value={legalDocs.lease_agreement_status}
                      onChange={(e) =>
                        handleLegalDocChange('lease_agreement_status', e.target.value as LeaseStatus)
                      }
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]"
                    >
                      <option value="not_started">Not Started</option>
                      <option value="in_progress">In Progress</option>
                      <option value="signed">Signed</option>
                      <option value="received">Received</option>
                    </select>
                    <input
                      type="date"
                      value={legalDocs.lease_agreement_date}
                      onChange={(e) => handleLegalDocChange('lease_agreement_date', e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]"
                      placeholder="Date"
                    />
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={legalDocs.lease_agreement_document_url}
                        onChange={(e) =>
                          handleLegalDocChange('lease_agreement_document_url', e.target.value)
                        }
                        placeholder="Document URL"
                        className="flex-1 px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]"
                      />
                      {legalDocs.lease_agreement_document_url && (
                        <a
                          href={legalDocs.lease_agreement_document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1.5 border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-tertiary)]"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cession */}
                <div className="pt-3 border-t border-[var(--ff-border-light)]">
                  <p className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">
                    Cession
                  </p>
                  <div className="space-y-2">
                    <select
                      value={legalDocs.cession_status}
                      onChange={(e) =>
                        handleLegalDocChange('cession_status', e.target.value as CessionStatus)
                      }
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]"
                    >
                      <option value="not_started">Not Started</option>
                      <option value="signed">Signed</option>
                      <option value="received">Received</option>
                    </select>
                    <input
                      type="date"
                      value={legalDocs.cession_date}
                      onChange={(e) => handleLegalDocChange('cession_date', e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]"
                      placeholder="Date"
                    />
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={legalDocs.cession_document_url}
                        onChange={(e) =>
                          handleLegalDocChange('cession_document_url', e.target.value)
                        }
                        placeholder="Document URL"
                        className="flex-1 px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--ff-accent)]"
                      />
                      {legalDocs.cession_document_url && (
                        <a
                          href={legalDocs.cession_document_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1.5 border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-tertiary)]"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Client Contact */}
            {(project.client_contact_name ||
              project.client_contact_email ||
              project.client_contact_phone) && (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
                <h3 className="font-semibold text-[var(--ff-text-primary)] mb-4">Client Contact</h3>
                <div className="space-y-2 text-sm">
                  {project.client_contact_name && (
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                      <span className="text-[var(--ff-text-primary)]">
                        {project.client_contact_name}
                      </span>
                    </div>
                  )}
                  {project.client_contact_email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                      <a
                        href={`mailto:${project.client_contact_email}`}
                        className="text-[var(--ff-accent)] hover:underline"
                      >
                        {project.client_contact_email}
                      </a>
                    </div>
                  )}
                  {project.client_contact_phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                      <a
                        href={`tel:${project.client_contact_phone}`}
                        className="text-[var(--ff-accent)] hover:underline"
                      >
                        {project.client_contact_phone}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PO Info */}
            {project.po_number && (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
                <h3 className="font-semibold text-[var(--ff-text-primary)] mb-4">
                  Purchase Order
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ff-text-secondary)]">PO Number</span>
                    <span className="text-[var(--ff-text-primary)] font-medium">
                      {project.po_number}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ff-text-secondary)]">PO Date</span>
                    <span className="text-[var(--ff-text-primary)]">
                      {formatDate(project.po_date)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ff-text-secondary)]">PO Value</span>
                    <span className="text-[var(--ff-text-primary)] font-medium">
                      {formatCurrency(project.po_value)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
              <h3 className="font-semibold text-[var(--ff-text-primary)] mb-4">Actions</h3>
              <div className="space-y-2">
                <button className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors text-sm">
                  <Edit className="w-4 h-4" />
                  Edit Project
                </button>
                {!project.po_number && approvalStatus?.complete && (
                  <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--ff-accent)] text-white rounded-lg hover:bg-[var(--ff-accent-hover)] transition-colors text-sm">
                    <FileText className="w-4 h-4" />
                    Receive PO
                  </button>
                )}
                {project.pipeline_status === 'ready_to_plan' && (
                  <button className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm">
                    <CheckCircle className="w-4 h-4" />
                    Transition to Planned
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Documents Section */}
        <div className="mt-6">
          <ProjectDocumentManager
            projectId={id as string}
            projectName={project.project_name}
            currentUserId={currentUser?.id}
            readonly={false}
          />
        </div>
      </div>

      {/* Approval Detail Drawer */}
      {selectedApproval && (
        <ApprovalDetailDrawer
          approval={selectedApproval}
          isOpen={drawerOpen}
          onClose={handleDrawerClose}
          onUpdate={handleApprovalUpdate}
          currentUserId={currentUser?.id}
          currentUserRole={drawerUserRole}
        />
      )}
    </div>
  );
}

export default PipelineProjectDetail;
