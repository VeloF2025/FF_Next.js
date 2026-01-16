// WORKING: Pending Approvals page
// PRD-050 Phase 2: Core Procurement - Approval Workflow UI
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  ClipboardCheck,
  Search,
  Filter,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronRight,
  FileText,
  ShoppingCart,
  Package,
  AlertTriangle,
  Loader2,
  Check,
  X,
} from 'lucide-react';
import type { MyApprovalTask, WorkflowType, PendingApprovalsCount } from '@/types/procurement/approval.types';
import { log } from '@/lib/logger';

const documentTypeConfig: Record<WorkflowType, { label: string; color: string; icon: typeof FileText }> = {
  purchase_requisition: { label: 'Requisition', color: 'bg-blue-500/20 text-blue-400', icon: FileText },
  purchase_order: { label: 'Purchase Order', color: 'bg-green-500/20 text-green-400', icon: ShoppingCart },
  boq: { label: 'BOQ', color: 'bg-purple-500/20 text-purple-400', icon: FileText },
  rfq: { label: 'RFQ', color: 'bg-orange-500/20 text-orange-400', icon: FileText },
  goods_receipt: { label: 'Goods Receipt', color: 'bg-teal-500/20 text-teal-400', icon: Package },
  supplier_registration: { label: 'Supplier', color: 'bg-indigo-500/20 text-indigo-400', icon: FileText },
  payment_request: { label: 'Payment', color: 'bg-emerald-500/20 text-emerald-400', icon: FileText },
};

export default function ApprovalsPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<MyApprovalTask[]>([]);
  const [summary, setSummary] = useState<PendingApprovalsCount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<WorkflowType | 'all'>('all');

  // Action states
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    fetchPendingApprovals();
  }, []);

  const fetchPendingApprovals = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/procurement/approvals/pending');
      const data = await response.json();

      if (data.success) {
        setTasks(data.data.tasks || []);
        setSummary(data.data.summary || null);
      } else {
        setError(data.error?.message || 'Failed to fetch pending approvals');
      }
    } catch (err) {
      log.error('Failed to fetch pending approvals', err);
      setError('Failed to load pending approvals');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (taskId: string) => {
    setActioningId(taskId);
    try {
      const response = await fetch(`/api/procurement/approvals/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: '' }),
      });
      const data = await response.json();

      if (data.success) {
        // Remove from list
        setTasks(tasks.filter((t) => t.id !== taskId));
        if (summary) {
          setSummary({ ...summary, total: summary.total - 1 });
        }
      } else {
        setError(data.error?.message || 'Failed to approve');
      }
    } catch (err) {
      log.error('Failed to approve', err);
      setError('Failed to approve');
    } finally {
      setActioningId(null);
    }
  };

  const handleReject = async (taskId: string) => {
    if (!rejectReason.trim()) {
      return;
    }

    setActioningId(taskId);
    try {
      const response = await fetch(`/api/procurement/approvals/${taskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const data = await response.json();

      if (data.success) {
        setTasks(tasks.filter((t) => t.id !== taskId));
        if (summary) {
          setSummary({ ...summary, total: summary.total - 1 });
        }
        setShowRejectModal(null);
        setRejectReason('');
      } else {
        setError(data.error?.message || 'Failed to reject');
      }
    } catch (err) {
      log.error('Failed to reject', err);
      setError('Failed to reject');
    } finally {
      setActioningId(null);
    }
  };

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch =
      task.documentNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.requestedByName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.workflowName?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || task.documentType === typeFilter;
    return matchesSearch && matchesType;
  });

  const formatCurrency = (value: number | undefined) => {
    if (value === undefined) return '-';
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const getDocumentLink = (task: MyApprovalTask) => {
    switch (task.documentType) {
      case 'purchase_requisition':
        return `/procurement/requisitions/${task.documentId}`;
      case 'purchase_order':
        return `/procurement/purchase-orders/${task.documentId}`;
      case 'goods_receipt':
        return `/procurement/grn/${task.documentId}`;
      default:
        return '#';
    }
  };

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-default)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <ClipboardCheck className="h-6 w-6 text-amber-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    Pending Approvals
                  </h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Review and approve procurement requests
                  </p>
                </div>
              </div>
              {summary && summary.overdue > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 rounded-lg">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">
                    {summary.overdue} overdue
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-t border-[var(--ff-border-default)]">
            <ProcurementTabs activeTab="overview" />
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Stats */}
          <div className="mb-6 grid grid-cols-4 gap-4">
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Total Pending</span>
                <span className="text-2xl font-semibold text-[var(--ff-text-primary)]">
                  {summary?.total || 0}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Requisitions</span>
                <span className="px-2 py-0.5 rounded-full text-sm bg-blue-500/20 text-blue-400">
                  {summary?.byType?.purchase_requisition || 0}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Purchase Orders</span>
                <span className="px-2 py-0.5 rounded-full text-sm bg-green-500/20 text-green-400">
                  {summary?.byType?.purchase_order || 0}
                </span>
              </div>
            </div>
            <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--ff-text-secondary)]">Overdue</span>
                <span className="px-2 py-0.5 rounded-full text-sm bg-red-500/20 text-red-400">
                  {summary?.overdue || 0}
                </span>
              </div>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ff-text-tertiary)]" />
              <input
                type="text"
                placeholder="Search by document number, requester..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as WorkflowType | 'all')}
              className="px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="all">All Types</option>
              <option value="purchase_requisition">Requisitions</option>
              <option value="purchase_order">Purchase Orders</option>
              <option value="goods_receipt">Goods Receipts</option>
            </select>
          </div>

          {/* Error display */}
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
              <span className="text-red-400">{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-400 hover:text-red-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
              <p className="text-[var(--ff-text-primary)] font-medium">All caught up!</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                No pending approvals at the moment
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTasks.map((task) => {
                const typeConfig = documentTypeConfig[task.documentType] || {
                  label: task.documentType,
                  color: 'bg-gray-500/20 text-gray-400',
                  icon: FileText,
                };
                const TypeIcon = typeConfig.icon;

                return (
                  <div
                    key={task.id}
                    className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg hover:border-[var(--ff-border-light)] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Document info */}
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`p-2 rounded-lg ${typeConfig.color.split(' ')[0]}`}>
                          <TypeIcon className={`h-5 w-5 ${typeConfig.color.split(' ')[1]}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <button
                              onClick={() => router.push(getDocumentLink(task))}
                              className="font-medium text-[var(--ff-text-primary)] hover:text-amber-400 transition-colors"
                            >
                              {task.documentNumber || `#${task.documentId.slice(0, 8)}`}
                            </button>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeConfig.color}`}>
                              {typeConfig.label}
                            </span>
                            {task.isOverdue && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                                Overdue
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-[var(--ff-text-secondary)]">
                            {task.workflowName} • {task.levelName}
                          </div>
                          <div className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                            Requested by {task.requestedByName || 'Unknown'} on {formatDate(task.requestedAt)}
                          </div>
                          {task.requestNotes && (
                            <div className="text-sm text-[var(--ff-text-tertiary)] mt-2 italic">
                              "{task.requestNotes}"
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Amount and actions */}
                      <div className="flex items-center gap-4">
                        {task.documentAmount !== undefined && (
                          <div className="text-right">
                            <div className="text-lg font-semibold text-[var(--ff-text-primary)]">
                              {formatCurrency(task.documentAmount)}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-2">
                          {task.canApprove && (
                            <button
                              onClick={() => handleApprove(task.id)}
                              disabled={actioningId === task.id}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                              {actioningId === task.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              Approve
                            </button>
                          )}
                          {task.canReject && (
                            <button
                              onClick={() => setShowRejectModal(task.id)}
                              disabled={actioningId === task.id}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                            >
                              <X className="h-4 w-4" />
                              Reject
                            </button>
                          )}
                          <button
                            onClick={() => router.push(getDocumentLink(task))}
                            className="p-1.5 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] rounded transition-colors"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reject Modal */}
        {showRejectModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-default)] rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Reject Approval Request
              </h3>
              <div className="mb-4">
                <label className="block text-sm text-[var(--ff-text-secondary)] mb-2">
                  Reason for rejection <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Please provide a reason for rejection..."
                  className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-default)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowRejectModal(null);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReject(showRejectModal)}
                  disabled={!rejectReason.trim() || actioningId === showRejectModal}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actioningId === showRejectModal ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
