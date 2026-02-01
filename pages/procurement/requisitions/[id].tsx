// WORKING: Requisition Detail page with status actions
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  FileInput,
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Send,
  Edit,
  Trash2,
  RotateCcw,
  FileText,
  ShoppingCart,
  Plus,
  User,
  Calendar,
  Building,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import type {
  RequisitionStatus,
  RequisitionUrgency,
} from '@/types/procurement/requisition.types';
import { log } from '@/lib/logger';

// Types for detail page
interface RequisitionItem {
  id: string;
  lineNumber: number;
  itemDescription: string;
  quantity: number;
  uom: string;
  estimatedUnitPrice: number | null;
  lineTotal: number;
  suggestedSupplierId: number | null;
  suggestedSupplierName: string | null;
  notes: string | null;
}

interface HistoryEvent {
  id: string;
  action: 'created' | 'submitted' | 'approved' | 'rejected' | 'modified';
  userId: string;
  userName: string;
  timestamp: string;
  notes: string | null;
}

interface RequisitionDetail {
  id: string;
  requisitionNumber: string;
  status: RequisitionStatus;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  department: string | null;
  requiredDate: string | null;
  urgency: RequisitionUrgency;
  notes: string | null;
  estimatedTotal: number;
  itemCount: number;
  requestedBy: string;
  requestedByName: string;
  requestedDate: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedDate: string | null;
  approvalNotes: string | null;
  items: RequisitionItem[];
  history: HistoryEvent[];
  createdAt: string;
  updatedAt: string;
}

const statusConfig: Record<RequisitionStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-500/20 text-blue-400', icon: Send },
  pending_approval: { label: 'Pending Approval', color: 'bg-yellow-500/20 text-yellow-400', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-500/20 text-red-400', icon: XCircle },
  ordered: { label: 'Ordered', color: 'bg-purple-500/20 text-purple-400', icon: ShoppingCart },
  partially_ordered: { label: 'Partially Ordered', color: 'bg-indigo-500/20 text-indigo-400', icon: Clock },
  closed: { label: 'Closed', color: 'bg-gray-500/20 text-gray-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-300', icon: XCircle },
};

const urgencyConfig: Record<RequisitionUrgency, { label: string; color: string; bgColor: string }> = {
  low: { label: 'Low', color: 'text-gray-400', bgColor: 'bg-gray-500/20' },
  normal: { label: 'Normal', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  high: { label: 'High', color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  critical: { label: 'Critical', color: 'text-red-400', bgColor: 'bg-red-500/20' },
};

const historyConfig: Record<string, { label: string; color: string; icon: typeof Plus }> = {
  created: { label: 'Created', color: 'text-gray-400', icon: Plus },
  submitted: { label: 'Submitted', color: 'text-blue-400', icon: Send },
  approved: { label: 'Approved', color: 'text-green-400', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'text-red-400', icon: XCircle },
  modified: { label: 'Modified', color: 'text-yellow-400', icon: Edit },
};

type TabId = 'details' | 'items' | 'history';

export default function RequisitionDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [requisition, setRequisition] = useState<RequisitionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Convert to PO modal state
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; companyName: string }[]>([]);
  const [convertForm, setConvertForm] = useState({
    supplierId: '',
    deliveryAddress: '',
    expectedDeliveryDate: '',
    paymentTerms: 'Net 30',
    notes: '',
  });
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  // TODO: Get from auth context
  const currentUserId = 'current-user';
  const isCreator = requisition?.requestedBy === currentUserId;
  const isApprover = true; // TODO: Check user permissions

  useEffect(() => {
    if (id) {
      fetchRequisition();
    }
  }, [id]);

  // Fetch suppliers for conversion
  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const response = await fetch('/api/suppliers?page=1&pageSize=100');
        const data = await response.json();
        if (data.success && data.data) {
          setSuppliers(data.data);
        }
      } catch (err) {
        log.error('Failed to fetch suppliers', err);
      }
    };
    fetchSuppliers();
  }, []);

  const fetchRequisition = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/procurement/requisitions/${id}`);
      const data = await response.json();

      if (data.success) {
        setRequisition(data.data);
      } else if (response.status === 404) {
        setError('Requisition not found');
      } else {
        setError(data.error?.message || 'Failed to fetch requisition');
      }
    } catch (err) {
      log.error('Failed to fetch requisition', err);
      setError('Failed to load requisition');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (action: string) => {
    if (!requisition) return;

    try {
      setActionLoading(action);

      if (action === 'edit') {
        router.push(`/procurement/requisitions/${id}/edit`);
        return;
      }

      if (action === 'convert_po') {
        setShowConvertModal(true);
        setActionLoading(null);
        return;
      }

      if (action === 'convert_rfq') {
        router.push(`/procurement/rfq/new?requisitionId=${id}`);
        return;
      }

      if (action === 'delete') {
        if (!confirm('Are you sure you want to delete this requisition?')) {
          setActionLoading(null);
          return;
        }
      }

      const response = await fetch(`/api/procurement/requisitions/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();

      if (data.success) {
        if (action === 'delete') {
          router.push('/procurement/requisitions');
        } else {
          fetchRequisition();
        }
      } else {
        setError(data.error?.message || `Failed to ${action} requisition`);
      }
    } catch (err) {
      log.error(`Failed to ${action} requisition`, err);
      setError(`Failed to ${action} requisition`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleConvertToPO = async () => {
    if (!convertForm.supplierId || !convertForm.deliveryAddress) {
      setConvertError('Supplier and delivery address are required');
      return;
    }

    try {
      setConvertLoading(true);
      setConvertError(null);

      const response = await fetch(`/api/procurement/requisitions/${id}/convert-to-po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: parseInt(convertForm.supplierId, 10),
          deliveryAddress: convertForm.deliveryAddress,
          expectedDeliveryDate: convertForm.expectedDeliveryDate || null,
          paymentTerms: convertForm.paymentTerms,
          notes: convertForm.notes,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setShowConvertModal(false);
        // Navigate to the new PO
        router.push(`/procurement/purchase-orders/${data.data.purchaseOrder.id}`);
      } else {
        setConvertError(data.error?.message || 'Failed to convert to PO');
      }
    } catch (err) {
      log.error('Failed to convert to PO', err);
      setConvertError('Failed to convert to PO');
    } finally {
      setConvertLoading(false);
    }
  };

  const getAvailableActions = () => {
    if (!requisition) return [];

    const actions: { id: string; label: string; icon: typeof Edit; color: string; danger?: boolean }[] = [];

    switch (requisition.status) {
      case 'draft':
        actions.push(
          { id: 'edit', label: 'Edit', icon: Edit, color: 'bg-blue-600 hover:bg-blue-700' },
          { id: 'submit', label: 'Submit', icon: Send, color: 'bg-green-600 hover:bg-green-700' },
          { id: 'delete', label: 'Delete', icon: Trash2, color: 'bg-red-600 hover:bg-red-700', danger: true }
        );
        break;
      case 'submitted':
        if (isCreator) {
          actions.push({ id: 'recall', label: 'Recall', icon: RotateCcw, color: 'bg-yellow-600 hover:bg-yellow-700' });
        }
        break;
      case 'pending_approval':
        if (isApprover) {
          actions.push(
            { id: 'approve', label: 'Approve', icon: CheckCircle, color: 'bg-green-600 hover:bg-green-700' },
            { id: 'reject', label: 'Reject', icon: XCircle, color: 'bg-red-600 hover:bg-red-700' }
          );
        }
        break;
      case 'approved':
        actions.push(
          { id: 'convert_po', label: 'Create PO', icon: ShoppingCart, color: 'bg-purple-600 hover:bg-purple-700' },
          { id: 'convert_rfq', label: 'Create RFQ', icon: FileText, color: 'bg-indigo-600 hover:bg-indigo-700' }
        );
        break;
      case 'rejected':
        if (isCreator) {
          actions.push({ id: 'edit', label: 'Edit & Resubmit', icon: Edit, color: 'bg-blue-600 hover:bg-blue-700' });
        }
        break;
    }

    return actions;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const tabs = [
    { id: 'details' as TabId, label: 'Details' },
    { id: 'items' as TabId, label: `Items (${requisition?.itemCount || 0})` },
    { id: 'history' as TabId, label: 'History' },
  ];

  const actions = getAvailableActions();
  const StatusIcon = requisition ? statusConfig[requisition.status].icon : Clock;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.back()}
                  className="p-2 rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
                >
                  <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                </button>
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <FileInput className="h-6 w-6 text-purple-400" />
                </div>
                <div>
                  {isLoading ? (
                    <div className="h-6 w-48 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
                  ) : requisition ? (
                    <>
                      <div className="flex items-center gap-3">
                        <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                          {requisition.requisitionNumber}
                        </h1>
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig[requisition.status].color}`}
                        >
                          <StatusIcon className="h-3 w-3" />
                          {statusConfig[requisition.status].label}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--ff-text-secondary)]">
                        Created by {requisition.requestedByName} on {formatDate(requisition.requestedDate)}
                      </p>
                    </>
                  ) : (
                    <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                      Requisition Not Found
                    </h1>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              {actions.length > 0 && (
                <div className="flex items-center gap-2">
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleAction(action.id)}
                      disabled={actionLoading !== null}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 ${action.color}`}
                    >
                      {actionLoading === action.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      ) : (
                        <action.icon className="h-4 w-4" />
                      )}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="requisitions" categoriesOnly />
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
              <p className="text-red-400 text-lg">{error}</p>
              <button
                onClick={fetchRequisition}
                className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Retry
              </button>
            </div>
          ) : requisition ? (
            <>
              {/* Tab Navigation */}
              <div className="mb-6 flex gap-1 bg-[var(--ff-bg-secondary)] p-1 rounded-lg w-fit">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-purple-600 text-white'
                        : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {activeTab === 'details' && (
                <div className="grid grid-cols-2 gap-6">
                  {/* Project Info */}
                  <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <FolderOpen className="h-5 w-5 text-purple-400" />
                      <h3 className="font-medium text-[var(--ff-text-primary)]">Project</h3>
                    </div>
                    {requisition.projectName ? (
                      <div>
                        <p className="text-[var(--ff-text-primary)] font-medium">{requisition.projectName}</p>
                        {requisition.projectCode && (
                          <p className="text-sm text-[var(--ff-text-secondary)]">{requisition.projectCode}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[var(--ff-text-tertiary)]">No project assigned</p>
                    )}
                  </div>

                  {/* Request Info */}
                  <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Building className="h-5 w-5 text-purple-400" />
                      <h3 className="font-medium text-[var(--ff-text-primary)]">Request Details</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-[var(--ff-text-secondary)]">Department</span>
                        <span className="text-[var(--ff-text-primary)]">{requisition.department || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--ff-text-secondary)]">Required By</span>
                        <span className="text-[var(--ff-text-primary)]">{formatDate(requisition.requiredDate)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--ff-text-secondary)]">Urgency</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${urgencyConfig[requisition.urgency].bgColor} ${urgencyConfig[requisition.urgency].color}`}>
                          {urgencyConfig[requisition.urgency].label}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Requester Info */}
                  <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <User className="h-5 w-5 text-purple-400" />
                      <h3 className="font-medium text-[var(--ff-text-primary)]">Requested By</h3>
                    </div>
                    <p className="text-[var(--ff-text-primary)] font-medium">{requisition.requestedByName}</p>
                    <p className="text-sm text-[var(--ff-text-secondary)]">{formatDate(requisition.requestedDate)}</p>
                  </div>

                  {/* Summary */}
                  <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <Calendar className="h-5 w-5 text-purple-400" />
                      <h3 className="font-medium text-[var(--ff-text-primary)]">Summary</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-[var(--ff-text-secondary)]">Total Items</span>
                        <span className="text-[var(--ff-text-primary)]">{requisition.itemCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--ff-text-secondary)]">Estimated Total</span>
                        <span className="text-[var(--ff-text-primary)] font-semibold">
                          {formatCurrency(requisition.estimatedTotal)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  {requisition.notes && (
                    <div className="col-span-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                      <h3 className="font-medium text-[var(--ff-text-primary)] mb-2">Notes</h3>
                      <p className="text-[var(--ff-text-secondary)]">{requisition.notes}</p>
                    </div>
                  )}

                  {/* Approval Info */}
                  {requisition.approvedByName && (
                    <div className="col-span-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-4">
                        {requisition.status === 'approved' ? (
                          <CheckCircle className="h-5 w-5 text-green-400" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-400" />
                        )}
                        <h3 className="font-medium text-[var(--ff-text-primary)]">
                          {requisition.status === 'approved' ? 'Approved' : 'Rejected'} By
                        </h3>
                      </div>
                      <p className="text-[var(--ff-text-primary)] font-medium">{requisition.approvedByName}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">{formatDate(requisition.approvedDate)}</p>
                      {requisition.approvalNotes && (
                        <p className="mt-2 text-[var(--ff-text-secondary)] italic">&quot;{requisition.approvalNotes}&quot;</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'items' && (
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[var(--ff-border-light)]">
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide w-12">
                          #
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                          Description
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide w-24">
                          Qty
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide w-24">
                          UOM
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide w-32">
                          Unit Price
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide w-32">
                          Line Total
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] tracking-wide">
                          Supplier
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ff-border-light)]">
                      {requisition.items.map((item, index) => (
                        <tr key={item.id} className="hover:bg-[var(--ff-bg-hover)]">
                          <td className="px-4 py-3 text-[var(--ff-text-tertiary)]">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-[var(--ff-text-primary)]">{item.itemDescription}</p>
                            {item.notes && (
                              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{item.notes}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--ff-text-primary)]">
                            {item.quantity}
                          </td>
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                            {item.uom}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)]">
                            {item.estimatedUnitPrice ? formatCurrency(item.estimatedUnitPrice) : '-'}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--ff-text-primary)] font-medium">
                            {item.lineTotal > 0 ? formatCurrency(item.lineTotal) : '-'}
                          </td>
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)]">
                            {item.suggestedSupplierName || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                        <td colSpan={5} className="px-4 py-3 text-right font-medium text-[var(--ff-text-primary)]">
                          Total ({requisition.itemCount} items)
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-[var(--ff-text-primary)]">
                          {formatCurrency(requisition.estimatedTotal)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
                  <div className="space-y-6">
                    {requisition.history
                      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                      .map((event, index) => {
                        const config = historyConfig[event.action];
                        const EventIcon = config?.icon || Clock;

                        return (
                          <div key={event.id} className="flex gap-4">
                            <div className="relative">
                              <div className={`p-2 rounded-full ${config?.color || 'text-gray-400'} bg-[var(--ff-bg-tertiary)]`}>
                                <EventIcon className="h-4 w-4" />
                              </div>
                              {index < requisition.history.length - 1 && (
                                <div className="absolute top-10 left-1/2 -translate-x-1/2 w-0.5 h-full bg-[var(--ff-border-light)]" />
                              )}
                            </div>
                            <div className="flex-1 pb-6">
                              <div className="flex items-center gap-2">
                                <span className={`font-medium ${config?.color || 'text-[var(--ff-text-primary)]'}`}>
                                  {config?.label || event.action}
                                </span>
                                <span className="text-[var(--ff-text-tertiary)]">by</span>
                                <span className="text-[var(--ff-text-primary)]">{event.userName}</span>
                              </div>
                              <p className="text-sm text-[var(--ff-text-tertiary)]">
                                {formatDateTime(event.timestamp)}
                              </p>
                              {event.notes && (
                                <p className="mt-2 text-[var(--ff-text-secondary)] italic">
                                  &quot;{event.notes}&quot;
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Convert to PO Modal */}
        {showConvertModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6 max-w-lg w-full mx-4">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                Convert to Purchase Order
              </h3>
              <p className="text-sm text-[var(--ff-text-secondary)] mb-6">
                Create a Purchase Order from this requisition. All items will be included.
              </p>

              {convertError && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {convertError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Supplier <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={convertForm.supplierId}
                    onChange={(e) => setConvertForm({ ...convertForm, supplierId: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.companyName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Delivery Address <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={convertForm.deliveryAddress}
                    onChange={(e) => setConvertForm({ ...convertForm, deliveryAddress: e.target.value })}
                    rows={3}
                    placeholder="Enter delivery address (minimum 10 characters)"
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                      Expected Delivery Date
                    </label>
                    <input
                      type="date"
                      value={convertForm.expectedDeliveryDate}
                      onChange={(e) => setConvertForm({ ...convertForm, expectedDeliveryDate: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                      Payment Terms
                    </label>
                    <select
                      value={convertForm.paymentTerms}
                      onChange={(e) => setConvertForm({ ...convertForm, paymentTerms: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    >
                      <option value="COD">COD</option>
                      <option value="Net 7">Net 7</option>
                      <option value="Net 14">Net 14</option>
                      <option value="Net 30">Net 30</option>
                      <option value="Net 45">Net 45</option>
                      <option value="Net 60">Net 60</option>
                      <option value="Prepaid">Prepaid</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-[var(--ff-text-secondary)] mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    value={convertForm.notes}
                    onChange={(e) => setConvertForm({ ...convertForm, notes: e.target.value })}
                    rows={2}
                    placeholder="Any additional notes for the PO"
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowConvertModal(false);
                    setConvertError(null);
                  }}
                  disabled={convertLoading}
                  className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConvertToPO}
                  disabled={convertLoading || !convertForm.supplierId || convertForm.deliveryAddress.length < 10}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {convertLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-4 w-4" />
                  )}
                  Create Purchase Order
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
