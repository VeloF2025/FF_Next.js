/**
 * Approval Detail Drawer Component
 * Shows approval details and allows workflow actions
 * NOW WITH INLINE EDITING FOR APPROVAL DETAILS
 */

import { useState } from 'react';
import {
  X,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  User,
  Building2,
  Phone,
  Mail,
  MapPin,
  Send,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Pencil,
  Save,
  Calendar,
  DollarSign,
} from 'lucide-react';
import type {
  PipelineProjectApprovalWithType,
  ApprovalStatus,
  InternalApprovalStatus,
  ServiceAuthority,
} from '../types';
import { DocumentManager } from './DocumentManager';
import { AuthorityPicker } from './AuthorityPicker';

interface ApprovalDetailDrawerProps {
  approval: PipelineProjectApprovalWithType;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  currentUserId?: string;
  currentUserRole?: 'pm' | 'ops' | 'admin' | 'viewer';
}

const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; color: string; bgColor: string }
> = {
  not_started: { label: 'Not Started', color: 'text-muted-foreground', bgColor: 'bg-secondary' },
  preparing: { label: 'Preparing', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  internal_review: { label: 'Internal Review', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  submitted: { label: 'Submitted', color: 'text-purple-600', bgColor: 'bg-purple-100' },
  in_review: { label: 'Under Review', color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
  additional_info_required: { label: 'Additional Info Required', color: 'text-orange-600', bgColor: 'bg-orange-100' },
  approved: { label: 'Approved', color: 'text-green-600', bgColor: 'bg-green-100' },
  rejected: { label: 'Rejected', color: 'text-red-600', bgColor: 'bg-red-100' },
  conditionally_approved: { label: 'Conditionally Approved', color: 'text-amber-600', bgColor: 'bg-amber-100' },
  expired: { label: 'Expired', color: 'text-red-600', bgColor: 'bg-red-100' },
  renewed: { label: 'Renewed', color: 'text-green-600', bgColor: 'bg-green-100' },
  withdrawn: { label: 'Withdrawn', color: 'text-muted-foreground', bgColor: 'bg-secondary' },
};

const INTERNAL_STATUS_CONFIG: Record<
  InternalApprovalStatus,
  { label: string; color: string; bgColor: string }
> = {
  pending: { label: 'Pending PM Approval', color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
  pm_approved: { label: 'PM Approved', color: 'text-blue-600', bgColor: 'bg-blue-100' },
  ops_approved: { label: 'Ops Approved', color: 'text-green-600', bgColor: 'bg-green-100' },
  rejected: { label: 'Rejected', color: 'text-red-600', bgColor: 'bg-red-100' },
};

type EditSection = 'timeline' | 'references' | 'financial' | 'details' | 'followup' | null;

interface TimelineEditData {
  application_date: string;
  issue_date: string;
  expiry_date: string;
  approval_date: string;
}

interface ReferencesEditData {
  application_reference: string;
  approval_reference: string;
}

interface FinancialEditData {
  application_fee: string;
  fee_paid: boolean;
  fee_paid_date: string;
  fee_receipt_reference: string;
}

interface DetailsEditData {
  conditions: string;
  coverage_description: string;
  notes: string;
}

interface FollowupEditData {
  next_followup_date: string;
  followup_notes: string;
}

function formatDate(date: string | null | undefined): string {
  if (!date) return '-';
  return new Date(date).toISOString().split('T')[0] ?? '-';
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ApprovalDetailDrawer({
  approval,
  isOpen,
  onClose,
  onUpdate,
  currentUserId,
  currentUserRole = 'viewer',
}: ApprovalDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [togglingRequired, setTogglingRequired] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showAuthorityPicker, setShowAuthorityPicker] = useState(false);
  const [savingAuthority, setSavingAuthority] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline editing state
  const [editingSection, setEditingSection] = useState<EditSection>(null);
  const [timelineData, setTimelineData] = useState<TimelineEditData>({
    application_date: approval.application_date || '',
    issue_date: approval.issue_date || '',
    expiry_date: approval.expiry_date || '',
    approval_date: approval.approval_date || '',
  });
  const [referencesData, setReferencesData] = useState<ReferencesEditData>({
    application_reference: approval.application_reference || '',
    approval_reference: approval.approval_reference || '',
  });
  const [financialData, setFinancialData] = useState<FinancialEditData>({
    application_fee: approval.application_fee?.toString() || '',
    fee_paid: approval.fee_paid || false,
    fee_paid_date: approval.fee_paid_date || '',
    fee_receipt_reference: approval.fee_receipt_reference || '',
  });
  const [detailsData, setDetailsData] = useState<DetailsEditData>({
    conditions: approval.conditions || '',
    coverage_description: approval.coverage_description || '',
    notes: approval.notes || '',
  });
  const [followupData, setFollowupData] = useState<FollowupEditData>({
    next_followup_date: approval.next_followup_date || '',
    followup_notes: approval.followup_notes || '',
  });

  // Form state for submission
  const [submitData, setSubmitData] = useState({
    application_date: new Date().toISOString().split('T')[0],
    application_reference: '',
    application_fee: '',
    notes: '',
  });

  // Form state for approval
  const [approveData, setApproveData] = useState({
    approval_date: new Date().toISOString().split('T')[0],
    approval_reference: '',
    issue_date: '',
    expiry_date: '',
    conditions: '',
    notes: '',
  });

  // Form state for rejection
  const [rejectData, setRejectData] = useState({
    rejection_reason: '',
    notes: '',
  });

  if (!isOpen) return null;

  const statusConfig = STATUS_CONFIG[approval.status];
  const internalStatusConfig = approval.internal_status
    ? INTERNAL_STATUS_CONFIG[approval.internal_status]
    : null;

  // Determine what actions are available
  const canPmApprove =
    (currentUserRole === 'pm' || currentUserRole === 'admin') &&
    approval.internal_status === 'pending';
  const canOpsApprove =
    (currentUserRole === 'ops' || currentUserRole === 'admin') &&
    approval.internal_status === 'pm_approved';
  const canSubmit =
    approval.status === 'not_started' &&
    approval.internal_status === 'ops_approved';
  const canMarkApproved =
    (currentUserRole === 'admin' || currentUserRole === 'ops') &&
    ['submitted', 'in_review', 'additional_info_required'].includes(approval.status);
  const canMarkRejected =
    (currentUserRole === 'admin' || currentUserRole === 'ops') &&
    ['submitted', 'in_review', 'additional_info_required'].includes(approval.status);

  const hasActions = canPmApprove || canOpsApprove || canSubmit || canMarkApproved || canMarkRejected;
  const canEdit = ['admin', 'pm', 'ops'].includes(currentUserRole);

  // Reset edit data when starting to edit a section
  function startEdit(section: EditSection) {
    if (section === 'timeline') {
      setTimelineData({
        application_date: approval.application_date || '',
        issue_date: approval.issue_date || '',
        expiry_date: approval.expiry_date || '',
        approval_date: approval.approval_date || '',
      });
    } else if (section === 'references') {
      setReferencesData({
        application_reference: approval.application_reference || '',
        approval_reference: approval.approval_reference || '',
      });
    } else if (section === 'financial') {
      setFinancialData({
        application_fee: approval.application_fee?.toString() || '',
        fee_paid: approval.fee_paid || false,
        fee_paid_date: approval.fee_paid_date || '',
        fee_receipt_reference: approval.fee_receipt_reference || '',
      });
    } else if (section === 'details') {
      setDetailsData({
        conditions: approval.conditions || '',
        coverage_description: approval.coverage_description || '',
        notes: approval.notes || '',
      });
    } else if (section === 'followup') {
      setFollowupData({
        next_followup_date: approval.next_followup_date || '',
        followup_notes: approval.followup_notes || '',
      });
    }
    setEditingSection(section);
  }

  function cancelEdit() {
    setEditingSection(null);
    setError(null);
  }

  async function saveEdit() {
    setLoading(true);
    setError(null);
    try {
      const updateData: any = { updated_by: currentUserId };

      if (editingSection === 'timeline') {
        updateData.application_date = timelineData.application_date || null;
        updateData.issue_date = timelineData.issue_date || null;
        updateData.expiry_date = timelineData.expiry_date || null;
        updateData.approval_date = timelineData.approval_date || null;
      } else if (editingSection === 'references') {
        updateData.application_reference = referencesData.application_reference || null;
        updateData.approval_reference = referencesData.approval_reference || null;
      } else if (editingSection === 'financial') {
        updateData.application_fee = financialData.application_fee
          ? parseFloat(financialData.application_fee)
          : null;
        updateData.fee_paid = financialData.fee_paid;
        updateData.fee_paid_date = financialData.fee_paid_date || null;
        updateData.fee_receipt_reference = financialData.fee_receipt_reference || null;
      } else if (editingSection === 'details') {
        updateData.conditions = detailsData.conditions || null;
        updateData.coverage_description = detailsData.coverage_description || null;
        updateData.notes = detailsData.notes || null;
      } else if (editingSection === 'followup') {
        updateData.next_followup_date = followupData.next_followup_date || null;
        updateData.followup_notes = followupData.followup_notes || null;
      }

      const response = await fetch(`/api/pipeline/approvals/${approval.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update approval');
      }

      onUpdate();
      setEditingSection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleInternalApprove(action: 'pm_approve' | 'ops_approve' | 'reject') {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/pipeline/approvals/${approval.id}/internal-approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          approved_by: currentUserId,
          notes: action === 'reject' ? rejectData.rejection_reason : '',
          rejection_reason: action === 'reject' ? rejectData.rejection_reason : undefined,
        }),
      });
      if (!response.ok) throw new Error('Failed to update approval');
      onUpdate();
      setShowRejectForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitApplication() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/pipeline/approvals/${approval.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          application_date: submitData.application_date,
          application_reference: submitData.application_reference || undefined,
          application_fee: submitData.application_fee
            ? parseFloat(submitData.application_fee)
            : undefined,
          notes: submitData.notes || undefined,
          updated_by: currentUserId,
        }),
      });
      if (!response.ok) throw new Error('Failed to submit application');
      onUpdate();
      setShowSubmitForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkApproved() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/pipeline/approvals/${approval.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_date: approveData.approval_date,
          approval_reference: approveData.approval_reference,
          issue_date: approveData.issue_date || undefined,
          expiry_date: approveData.expiry_date || undefined,
          conditions: approveData.conditions || undefined,
          notes: approveData.notes || undefined,
          updated_by: currentUserId,
        }),
      });
      if (!response.ok) throw new Error('Failed to mark as approved');
      onUpdate();
      setShowApproveForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkRejected() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/pipeline/approvals/${approval.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rejection_date: new Date().toISOString().split('T')[0],
          rejection_reason: rejectData.rejection_reason,
          notes: rejectData.notes || undefined,
          updated_by: currentUserId,
        }),
      });
      if (!response.ok) throw new Error('Failed to mark as rejected');
      onUpdate();
      setShowRejectForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleAuthoritySelect(authority: ServiceAuthority | null) {
    if (!authority) {
      setShowAuthorityPicker(false);
      return;
    }

    setSavingAuthority(true);
    setError(null);
    try {
      const response = await fetch(`/api/pipeline/approvals/${approval.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_authority_id: authority.id,
          authority_name: authority.authority_name,
          authority_contact_name: authority.contact_name,
          authority_contact_email: authority.contact_email,
          authority_contact_phone: authority.contact_phone,
          authority_address: authority.physical_address,
          updated_by: currentUserId,
        }),
      });
      if (!response.ok) throw new Error('Failed to update authority');
      onUpdate();
      setShowAuthorityPicker(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save authority');
    } finally {
      setSavingAuthority(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative w-full max-w-lg bg-[var(--ff-bg-primary)] shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[var(--ff-bg-primary)] border-b border-[var(--ff-border-light)] p-4 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                {approval.approval_type_name}
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {approval.approval_type_category}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--ff-bg-secondary)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[var(--ff-text-secondary)]" />
            </button>
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-2 mt-3">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${statusConfig.bgColor} ${statusConfig.color}`}
            >
              {statusConfig.label}
            </span>
            {internalStatusConfig && (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${internalStatusConfig.bgColor} ${internalStatusConfig.color}`}
              >
                {internalStatusConfig.label}
              </span>
            )}
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setTogglingRequired(true);
                try {
                  const res = await fetch(`/api/pipeline/approvals/${approval.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ is_required: !approval.is_required }),
                  });
                  if (res.ok) onUpdate();
                } finally {
                  setTogglingRequired(false);
                }
              }}
              disabled={togglingRequired}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium cursor-pointer transition-colors ${
                approval.is_required
                  ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/80"
              } disabled:opacity-50`}
              title={approval.is_required ? "Click to mark as optional" : "Click to mark as required"}
            >
              {togglingRequired ? "..." : approval.is_required ? "Required" : "Optional"}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* WORKFLOW ACTIONS - PROMINENT PLACEMENT (top, always visible) */}
          {hasActions && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-300 dark:border-blue-700 rounded-lg p-4">
              {/* Internal Approval Workflow */}
              {(canPmApprove || canOpsApprove) && !showRejectForm && (
                <div>
                  <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Internal Approval Required
                  </h3>
                  {canPmApprove && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleInternalApprove('pm_approve')}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                      >
                        <CheckCircle className="w-5 h-5" />
                        PM Approve
                      </button>
                      <button
                        onClick={() => setShowRejectForm(true)}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
                      >
                        <XCircle className="w-5 h-5" />
                        Reject
                      </button>
                    </div>
                  )}
                  {canOpsApprove && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleInternalApprove('ops_approve')}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                      >
                        <CheckCircle className="w-5 h-5" />
                        Ops Approve
                      </button>
                      <button
                        onClick={() => setShowRejectForm(true)}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
                      >
                        <XCircle className="w-5 h-5" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Submit to Authority Action */}
              {canSubmit && !showSubmitForm && (
                <button
                  onClick={() => setShowSubmitForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium"
                >
                  <Send className="w-5 h-5" />
                  Submit to Authority
                </button>
              )}

              {/* Submit Form */}
              {showSubmitForm && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-300">
                    Submit Application
                  </h3>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Application Date *
                    </label>
                    <input
                      type="date"
                      value={submitData.application_date}
                      onChange={(e) =>
                        setSubmitData({ ...submitData, application_date: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Reference Number
                    </label>
                    <input
                      type="text"
                      value={submitData.application_reference}
                      onChange={(e) =>
                        setSubmitData({ ...submitData, application_reference: e.target.value })
                      }
                      placeholder="e.g., APP-2024-001"
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Application Fee
                    </label>
                    <input
                      type="number"
                      value={submitData.application_fee}
                      onChange={(e) =>
                        setSubmitData({ ...submitData, application_fee: e.target.value })
                      }
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Notes
                    </label>
                    <textarea
                      value={submitData.notes}
                      onChange={(e) =>
                        setSubmitData({ ...submitData, notes: e.target.value })
                      }
                      rows={3}
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSubmitApplication}
                      disabled={loading || !submitData.application_date}
                      className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                    >
                      {loading ? 'Submitting...' : 'Submit'}
                    </button>
                    <button
                      onClick={() => setShowSubmitForm(false)}
                      disabled={loading}
                      className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Mark Approved/Rejected Actions */}
              {(canMarkApproved || canMarkRejected) && !showApproveForm && !showRejectForm && (
                <div className="flex gap-2">
                  {canMarkApproved && (
                    <button
                      onClick={() => setShowApproveForm(true)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                    >
                      <CheckCircle className="w-5 h-5" />
                      Mark Approved
                    </button>
                  )}
                  {canMarkRejected && (
                    <button
                      onClick={() => setShowRejectForm(true)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                    >
                      <XCircle className="w-5 h-5" />
                      Mark Rejected
                    </button>
                  )}
                </div>
              )}

              {/* Approve Form */}
              {showApproveForm && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-green-900 dark:text-green-300">
                    Record Approval
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        Approval Date *
                      </label>
                      <input
                        type="date"
                        value={approveData.approval_date}
                        onChange={(e) =>
                          setApproveData({ ...approveData, approval_date: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-[var(--ff-bg-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        Reference *
                      </label>
                      <input
                        type="text"
                        value={approveData.approval_reference}
                        onChange={(e) =>
                          setApproveData({ ...approveData, approval_reference: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-[var(--ff-bg-primary)]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        Issue Date
                      </label>
                      <input
                        type="date"
                        value={approveData.issue_date}
                        onChange={(e) =>
                          setApproveData({ ...approveData, issue_date: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-[var(--ff-bg-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        Expiry Date
                      </label>
                      <input
                        type="date"
                        value={approveData.expiry_date}
                        onChange={(e) =>
                          setApproveData({ ...approveData, expiry_date: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-[var(--ff-bg-primary)]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Conditions
                    </label>
                    <textarea
                      value={approveData.conditions}
                      onChange={(e) =>
                        setApproveData({ ...approveData, conditions: e.target.value })
                      }
                      rows={2}
                      placeholder="Any conditions attached to the approval..."
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleMarkApproved}
                      disabled={loading || !approveData.approval_date || !approveData.approval_reference}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Confirm Approval'}
                    </button>
                    <button
                      onClick={() => setShowApproveForm(false)}
                      disabled={loading}
                      className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Reject Form */}
              {showRejectForm && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-red-900 dark:text-red-300">
                    Record Rejection
                  </h3>
                  <div>
                    <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                      Rejection Reason *
                    </label>
                    <textarea
                      value={rejectData.rejection_reason}
                      onChange={(e) =>
                        setRejectData({ ...rejectData, rejection_reason: e.target.value })
                      }
                      rows={3}
                      placeholder="Reason for rejection..."
                      className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={
                        canPmApprove || canOpsApprove
                          ? () => handleInternalApprove('reject')
                          : handleMarkRejected
                      }
                      disabled={loading || !rejectData.rejection_reason}
                      className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      {loading ? 'Saving...' : 'Confirm Rejection'}
                    </button>
                    <button
                      onClick={() => setShowRejectForm(false)}
                      disabled={loading}
                      className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Documents Section */}
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Documents
            </h3>
            <DocumentManager
              approvalId={approval.id}
              currentUserId={currentUserId}
              readonly={currentUserRole === 'viewer'}
              onDocumentChange={onUpdate}
            />
          </div>

          {/* Authority Information */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Authority Information
              </h3>
              {currentUserRole !== 'viewer' && !showAuthorityPicker && (
                <button
                  onClick={() => setShowAuthorityPicker(true)}
                  className="text-xs text-[var(--ff-accent)] hover:text-[var(--ff-accent-hover)]"
                >
                  {approval.authority_name ? 'Change' : 'Select Authority'}
                </button>
              )}
            </div>

            {showAuthorityPicker ? (
              <div className="space-y-3">
                <AuthorityPicker
                  approvalTypeId={approval.approval_type_id}
                  approvalTypeName={approval.approval_type_name}
                  value={null}
                  onChange={handleAuthoritySelect}
                  disabled={savingAuthority}
                  allowCreate={currentUserRole === 'admin'}
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowAuthorityPicker(false)}
                    disabled={savingAuthority}
                    className="px-3 py-1 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-3">
                {approval.authority_name ? (
                  <>
                    <p className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {approval.authority_name}
                    </p>
                    {approval.authority_contact_name && (
                      <p className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-2">
                        <User className="w-4 h-4" />
                        {approval.authority_contact_name}
                      </p>
                    )}
                    {approval.authority_contact_email && (
                      <p className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        {approval.authority_contact_email}
                      </p>
                    )}
                    {approval.authority_contact_phone && (
                      <p className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        {approval.authority_contact_phone}
                      </p>
                    )}
                    {approval.authority_address && (
                      <p className="text-sm text-[var(--ff-text-secondary)] flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        {approval.authority_address}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[var(--ff-text-tertiary)] italic">
                    No authority information recorded
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Timeline Section (EDITABLE) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Timeline
              </h3>
              {canEdit && editingSection !== 'timeline' && (
                <button
                  onClick={() => startEdit('timeline')}
                  className="p-1 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors"
                  title="Edit timeline"
                >
                  <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                </button>
              )}
            </div>
            
            {editingSection === 'timeline' ? (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                      Application Date
                    </label>
                    <input
                      type="date"
                      value={timelineData.application_date}
                      onChange={(e) => setTimelineData({ ...timelineData, application_date: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                      Issue Date
                    </label>
                    <input
                      type="date"
                      value={timelineData.issue_date}
                      onChange={(e) => setTimelineData({ ...timelineData, issue_date: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                      Expiry Date
                    </label>
                    <input
                      type="date"
                      value={timelineData.expiry_date}
                      onChange={(e) => setTimelineData({ ...timelineData, expiry_date: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                      Approval Date
                    </label>
                    <input
                      type="date"
                      value={timelineData.approval_date}
                      onChange={(e) => setTimelineData({ ...timelineData, approval_date: e.target.value })}
                      className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveEdit}
                    disabled={loading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Application Date</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(approval.application_date)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Issue Date</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(approval.issue_date)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Expiry Date</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(approval.expiry_date)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Approval Date</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(approval.approval_date)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* References Section (EDITABLE) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                <FileText className="w-4 h-4" />
                References
              </h3>
              {canEdit && editingSection !== 'references' && (
                <button
                  onClick={() => startEdit('references')}
                  className="p-1 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors"
                  title="Edit references"
                >
                  <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                </button>
              )}
            </div>

            {editingSection === 'references' ? (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Application Reference
                  </label>
                  <input
                    type="text"
                    value={referencesData.application_reference}
                    onChange={(e) => setReferencesData({ ...referencesData, application_reference: e.target.value })}
                    placeholder="e.g., APP-2024-001"
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Approval Reference
                  </label>
                  <input
                    type="text"
                    value={referencesData.approval_reference}
                    onChange={(e) => setReferencesData({ ...referencesData, approval_reference: e.target.value })}
                    placeholder="e.g., APR-2024-001"
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveEdit}
                    disabled={loading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Application Reference</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {approval.application_reference || '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Approval Reference</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {approval.approval_reference || '-'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Financial Section (EDITABLE) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Financial
              </h3>
              {canEdit && editingSection !== 'financial' && (
                <button
                  onClick={() => startEdit('financial')}
                  className="p-1 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors"
                  title="Edit financial details"
                >
                  <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                </button>
              )}
            </div>

            {editingSection === 'financial' ? (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Application Fee (R)
                  </label>
                  <input
                    type="number"
                    value={financialData.application_fee}
                    onChange={(e) => setFinancialData({ ...financialData, application_fee: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="fee_paid"
                    checked={financialData.fee_paid}
                    onChange={(e) => setFinancialData({ ...financialData, fee_paid: e.target.checked })}
                    className="w-4 h-4 rounded border-[var(--ff-border-light)]"
                  />
                  <label htmlFor="fee_paid" className="text-sm text-[var(--ff-text-secondary)]">
                    Fee Paid
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Fee Paid Date
                  </label>
                  <input
                    type="date"
                    value={financialData.fee_paid_date}
                    onChange={(e) => setFinancialData({ ...financialData, fee_paid_date: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Fee Receipt Reference
                  </label>
                  <input
                    type="text"
                    value={financialData.fee_receipt_reference}
                    onChange={(e) => setFinancialData({ ...financialData, fee_receipt_reference: e.target.value })}
                    placeholder="e.g., RCP-2024-001"
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveEdit}
                    disabled={loading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Application Fee</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatCurrency(approval.application_fee)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Fee Paid</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {approval.fee_paid ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Paid Date</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(approval.fee_paid_date)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Receipt Reference</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {approval.fee_receipt_reference || '-'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Details Section (EDITABLE) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Details
              </h3>
              {canEdit && editingSection !== 'details' && (
                <button
                  onClick={() => startEdit('details')}
                  className="p-1 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors"
                  title="Edit details"
                >
                  <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                </button>
              )}
            </div>

            {editingSection === 'details' ? (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Conditions
                  </label>
                  <textarea
                    value={detailsData.conditions}
                    onChange={(e) => setDetailsData({ ...detailsData, conditions: e.target.value })}
                    rows={3}
                    placeholder="Any conditions attached to the approval..."
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Coverage Description
                  </label>
                  <textarea
                    value={detailsData.coverage_description}
                    onChange={(e) => setDetailsData({ ...detailsData, coverage_description: e.target.value })}
                    rows={2}
                    placeholder="Description of what the approval covers..."
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Notes
                  </label>
                  <textarea
                    value={detailsData.notes}
                    onChange={(e) => setDetailsData({ ...detailsData, notes: e.target.value })}
                    rows={3}
                    placeholder="General notes about this approval..."
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveEdit}
                    disabled={loading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-3">
                {approval.conditions && (
                  <div>
                    <span className="text-xs font-medium text-[var(--ff-text-secondary)]">Conditions</span>
                    <p className="text-sm text-[var(--ff-text-primary)] mt-1 whitespace-pre-wrap">
                      {approval.conditions}
                    </p>
                  </div>
                )}
                {approval.coverage_description && (
                  <div>
                    <span className="text-xs font-medium text-[var(--ff-text-secondary)]">Coverage</span>
                    <p className="text-sm text-[var(--ff-text-primary)] mt-1 whitespace-pre-wrap">
                      {approval.coverage_description}
                    </p>
                  </div>
                )}
                {approval.notes && (
                  <div>
                    <span className="text-xs font-medium text-[var(--ff-text-secondary)]">Notes</span>
                    <p className="text-sm text-[var(--ff-text-primary)] mt-1 whitespace-pre-wrap">
                      {approval.notes}
                    </p>
                  </div>
                )}
                {!approval.conditions && !approval.coverage_description && !approval.notes && (
                  <p className="text-sm text-[var(--ff-text-tertiary)] italic">
                    No additional details recorded
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Follow-up Section (EDITABLE) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-[var(--ff-text-primary)] flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Follow-up
              </h3>
              {canEdit && editingSection !== 'followup' && (
                <button
                  onClick={() => startEdit('followup')}
                  className="p-1 hover:bg-[var(--ff-bg-secondary)] rounded transition-colors"
                  title="Edit follow-up"
                >
                  <Pencil className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                </button>
              )}
            </div>

            {editingSection === 'followup' ? (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Next Follow-up Date
                  </label>
                  <input
                    type="date"
                    value={followupData.next_followup_date}
                    onChange={(e) => setFollowupData({ ...followupData, next_followup_date: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ff-text-secondary)] mb-1">
                    Follow-up Notes
                  </label>
                  <textarea
                    value={followupData.followup_notes}
                    onChange={(e) => setFollowupData({ ...followupData, followup_notes: e.target.value })}
                    rows={3}
                    placeholder="Notes about follow-up actions..."
                    className="w-full px-3 py-2 text-sm border border-[var(--ff-border-light)] rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-primary)]"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={saveEdit}
                    disabled={loading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm border border-[var(--ff-border-light)] rounded hover:bg-[var(--ff-bg-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Next Follow-up</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(approval.next_followup_date)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Last Follow-up</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(approval.last_followup_date)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-[var(--ff-text-secondary)]">Follow-up Count</span>
                  <span className="text-sm text-[var(--ff-text-primary)]">
                    {approval.followup_count || 0}
                  </span>
                </div>
                {approval.followup_notes && (
                  <div className="pt-2 border-t border-[var(--ff-border-light)]">
                    <span className="text-xs font-medium text-[var(--ff-text-secondary)]">Notes</span>
                    <p className="text-sm text-[var(--ff-text-primary)] mt-1 whitespace-pre-wrap">
                      {approval.followup_notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ApprovalDetailDrawer;
