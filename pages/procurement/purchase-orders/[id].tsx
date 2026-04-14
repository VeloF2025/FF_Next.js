// WORKING: Purchase Order Detail page
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  ArrowLeft,
  ShoppingCart,
  Clock,
  CheckCircle,
  XCircle,
  Send,
  Package,
  Truck,
  FileText,
  Edit,
  Trash2,
  Ban,
  PackageCheck,
  Building2,
  MapPin,
  CreditCard,
  AlertCircle,
  Save,
  Paperclip,
} from 'lucide-react';
import { log } from '@/lib/logger';
import { ProcurementDocumentPanel, useProcurementDocuments } from '@/modules/procurement/documents';
import { POItemsTable } from '@/modules/procurement/orders/components/POItemsTable';

// Types
type POStatus = string;

type TabId = 'details' | 'items' | 'receipts' | 'history' | 'documents';

interface POLineItem {
  id: string;
  lineNumber: number;
  description: string;
  itemCode: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  quantityPending: number;
  unitOfMeasure: string;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
  boqUnitRate: number | null;
  boqQuantity: number | null;
  boqMatchSource: 'id' | 'code' | 'description' | null;
}

interface POHistoryEvent {
  id: string;
  action: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface POReceipt {
  id: string;
  grnNumber: string;
  receivedDate: string;
  receivedBy: string;
  totalItems: number;
}

interface PurchaseOrderDetail {
  id: string;
  poNumber: string;
  status: POStatus;
  supplierId: number;
  supplierName: string;
  supplierEmail: string | null;
  supplierPhone: string | null;
  projectId: string | null;
  projectName: string | null;
  deliveryAddress: string;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  paymentTerms: string;
  currency: string;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  odooPoId: number | null;
  sagePoNumber: string | null;
  supplierReference: string | null;
  quoteNumber: string | null;
  quoteAttachmentUrl: string | null;
  quoteAttachmentName: string | null;
  updatedAt: string;
  items: POLineItem[];
  history: POHistoryEvent[];
  receipts: POReceipt[];
  odooDocuments?: {
    id: string;
    name: string;
    type: string;
    odooModel: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    createdAt: string;
  }[];
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  pending_approval: { label: 'Pending Approval', color: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  approved: { label: 'Approved', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  sent: { label: 'Sent', color: 'bg-blue-500/20 text-blue-400', icon: Send },
  acknowledged: { label: 'Acknowledged', color: 'bg-indigo-500/20 text-indigo-400', icon: Package },
  partial_receipt: { label: 'Partial Receipt', color: 'bg-orange-500/20 text-orange-400', icon: Truck },
  partially_received: { label: 'Partial Receipt', color: 'bg-orange-500/20 text-orange-400', icon: Truck },
  received: { label: 'Received', color: 'bg-green-500/20 text-green-400', icon: PackageCheck },
  closed: { label: 'Closed', color: 'bg-gray-500/20 text-gray-400', icon: CheckCircle },
  completed: { label: 'Completed', color: 'bg-green-500/20 text-green-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-300', icon: XCircle },
};

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [actionLoading, setActionLoading] = useState(false);
  const { documents: procDocs } = useProcurementDocuments('purchase_order', id as string | undefined);
  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState({
    orderDate: '',
    expectedDeliveryDate: '',
    deliveryAddress: '',
    paymentTerms: '',
    internalNotes: '',
    sagePoNumber: '',
  });

  useEffect(() => {
    // router.isReady ensures query params are available (hydration complete)
    if (router.isReady) {
      if (id && typeof id === 'string') {
        fetchPurchaseOrder();
      } else {
        // No ID provided - show error state
        setIsLoading(false);
        setError('Purchase order ID is required');
      }
    }
  }, [router.isReady, id]);

  const fetchPurchaseOrder = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/procurement/purchase-orders/${id}`);
      const data = await response.json();

      if (data.success) {
        setPurchaseOrder(data.data);
      } else {
        setError(data.error?.message || 'Failed to fetch purchase order');
      }
    } catch (err) {
      log.error('Failed to fetch purchase order', { error: err });
      setError('Failed to load purchase order');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (action: string, notes?: string) => {
    if (!purchaseOrder) return;

    try {
      setActionLoading(true);
      const response = await fetch(`/api/procurement/purchase-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes }),
      });
      const data = await response.json();

      if (data.success) {
        // Await the refresh to prevent race conditions
        await fetchPurchaseOrder();
      } else {
        setError(data.error?.message || `Failed to ${action}`);
      }
    } catch (err) {
      log.error(`Failed to ${action}`, { error: err });
      setError(`Failed to ${action}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this purchase order? This action cannot be undone.')) {
      return;
    }

    try {
      setActionLoading(true);
      const response = await fetch(`/api/procurement/purchase-orders/${id}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        router.push('/procurement/purchase-orders');
      } else {
        setError(data.error?.message || 'Failed to delete');
      }
    } catch (err) {
      log.error('Failed to delete purchase order', { error: err });
      setError('Failed to delete');
    } finally {
      setActionLoading(false);
    }
  };

  const startEditing = () => {
    if (!purchaseOrder) return;
    setEditFields({
      orderDate: purchaseOrder.orderDate?.split('T')[0] || '',
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate?.split('T')[0] || '',
      deliveryAddress: purchaseOrder.deliveryAddress || '',
      paymentTerms: purchaseOrder.paymentTerms || '',
      internalNotes: purchaseOrder.notes || '',
      sagePoNumber: purchaseOrder.sagePoNumber || '',
    });
    setIsEditing(true);
  };

  const handleSaveFields = async () => {
    if (!purchaseOrder) return;
    try {
      setActionLoading(true);
      const response = await fetch(`/api/procurement/purchase-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_fields',
          fields: {
            orderDate: editFields.orderDate || null,
            expectedDeliveryDate: editFields.expectedDeliveryDate || null,
            deliveryAddress: editFields.deliveryAddress,
            paymentTerms: editFields.paymentTerms,
            internalNotes: editFields.internalNotes,
            sagePoNumber: editFields.sagePoNumber || null,
          },
        }),
      });
      const data = await response.json();
      if (data.success) {
        setIsEditing(false);
        await fetchPurchaseOrder();
      } else {
        setError(data.error?.message || 'Failed to save');
      }
    } catch (err) {
      log.error('Failed to save PO fields', { error: err });
      setError('Failed to save');
    } finally {
      setActionLoading(false);
    }
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

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      created: 'Purchase Order Created',
      submitted: 'Submitted for Approval',
      approved: 'Approved',
      rejected: 'Rejected',
      sent: 'Sent to Supplier',
      acknowledged: 'Acknowledged by Supplier',
      received: 'Goods Received',
      completed: 'Completed',
      cancelled: 'Cancelled',
      edited: 'Edited',
    };
    return labels[action] || action;
  };

  const getItemReceiptStatus = (item: POLineItem) => {
    if (item.quantityReceived === 0) return { label: 'Pending', color: 'text-gray-400' };
    if (item.quantityReceived >= item.quantityOrdered) return { label: 'Complete', color: 'text-green-400' };
    return { label: 'Partial', color: 'text-orange-400' };
  };

  const renderActionButtons = () => {
    if (!purchaseOrder) return null;
    const status = purchaseOrder.status;

    return (
      <div className="flex items-center gap-2">
        {!isEditing && (
          <button
            onClick={startEditing}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 px-3 py-2 border border-orange-500/50 text-orange-400 rounded-lg hover:bg-orange-500/10 transition-colors"
          >
            <Edit className="h-4 w-4" />
            Edit Details
          </button>
        )}
        {isEditing && (
          <>
            <button
              onClick={handleSaveFields}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Save className="h-4 w-4" />
              Save
            </button>
            <button
              onClick={() => setIsEditing(false)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              Cancel
            </button>
          </>
        )}
        {status === 'draft' && (
          <>
            <button
              onClick={() => router.push(`/procurement/purchase-orders/${id}/edit`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              <Edit className="h-4 w-4" />
              Edit
            </button>
            <button
              onClick={() => handleAction('submit')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Send className="h-4 w-4" />
              Submit for Approval
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </>
        )}

        {status === 'pending_approval' && (
          <>
            <button
              onClick={() => handleAction('approve')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <CheckCircle className="h-4 w-4" />
              Approve
            </button>
            <button
              onClick={() => {
                const reason = prompt('Enter rejection reason:');
                if (reason) handleAction('reject', reason);
              }}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <XCircle className="h-4 w-4" />
              Reject
            </button>
          </>
        )}

        {status === 'approved' && (
          <>
            <button
              onClick={() => handleAction('send')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Send className="h-4 w-4" />
              Send to Supplier
            </button>
            <button
              onClick={() => handleAction('cancel')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Ban className="h-4 w-4" />
              Cancel
            </button>
          </>
        )}

        {status === 'sent' && (
          <>
            <button
              onClick={() => handleAction('acknowledge')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Package className="h-4 w-4" />
              Mark Acknowledged
            </button>
            <button
              onClick={() => handleAction('cancel')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Ban className="h-4 w-4" />
              Cancel
            </button>
          </>
        )}

        {status === 'acknowledged' && (
          <>
            <button
              onClick={() => router.push(`/procurement/grn/new?po=${id}`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <PackageCheck className="h-4 w-4" />
              Receive Goods
            </button>
            <button
              onClick={() => handleAction('cancel')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
            >
              <Ban className="h-4 w-4" />
              Cancel
            </button>
          </>
        )}

        {status === 'partial_receipt' && (
          <>
            <button
              onClick={() => router.push(`/procurement/grn/new?po=${id}`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <PackageCheck className="h-4 w-4" />
              Receive More
            </button>
            <button
              onClick={() => handleAction('complete')}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <CheckCircle className="h-4 w-4" />
              Complete
            </button>
          </>
        )}
      </div>
    );
  };

  // Show loading while router initializes or data is being fetched
  if (!router.isReady || isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      </AppLayout>
    );
  }

  if (error || !purchaseOrder) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)] p-6">
          <div className="max-w-2xl mx-auto text-center py-12">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              Purchase Order Not Found
            </h2>
            <p className="text-[var(--ff-text-secondary)] mb-4">
              {error || 'The purchase order you are looking for does not exist.'}
            </p>
            <button
              onClick={() => router.push('/procurement/purchase-orders')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Purchase Orders
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const statusInfo = statusConfig[purchaseOrder.status] || { label: purchaseOrder.status, color: 'bg-gray-500/20 text-gray-400', icon: Clock };
  const StatusIcon = statusInfo.icon;

  const tabs = [
    { id: 'details' as TabId, label: 'Details', icon: FileText },
    { id: 'items' as TabId, label: `Items (${purchaseOrder.items.length})`, icon: Package },
    { id: 'receipts' as TabId, label: `Receipts (${purchaseOrder.receipts.length})`, icon: Truck },
    { id: 'history' as TabId, label: 'History', icon: Clock },
    { id: 'documents' as TabId, label: `Documents${purchaseOrder.odooDocuments?.length ? ` (${purchaseOrder.odooDocuments.length})` : ''}`, icon: FileText },
  ];

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => router.push('/procurement/purchase-orders')}
                  className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                </button>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <ShoppingCart className="h-6 w-6 text-blue-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                        {purchaseOrder.poNumber}
                      </h1>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                        <StatusIcon className="h-3 w-3" />
                        {statusInfo.label}
                      </span>
                    </div>
                    <p className="text-sm text-[var(--ff-text-secondary)]">
                      {purchaseOrder.supplierName}
                      {purchaseOrder.projectName && ` • ${purchaseOrder.projectName}`}
                    </p>
                  </div>
                </div>
                {purchaseOrder.odooPoId && (
                  <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-1.5 text-sm dark:bg-green-900/20">
                    <span className="font-medium text-green-700 dark:text-green-300">
                      Synced
                    </span>
                  </div>
                )}
              </div>
              {renderActionButtons()}
            </div>
          </div>

        </div>

        {/* Content Tabs */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6">
            <nav className="flex space-x-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-3 px-4 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'details' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Supplier Information */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="h-5 w-5 text-blue-400" />
                  <h3 className="font-semibold text-[var(--ff-text-primary)]">Supplier Information</h3>
                </div>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-[var(--ff-text-tertiary)]">Supplier</dt>
                    <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.supplierName}</dd>
                  </div>
                  {purchaseOrder.supplierEmail && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-tertiary)]">Email</dt>
                      <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.supplierEmail}</dd>
                    </div>
                  )}
                  {purchaseOrder.supplierPhone && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-tertiary)]">Phone</dt>
                      <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.supplierPhone}</dd>
                    </div>
                  )}
                  {purchaseOrder.projectName && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-tertiary)]">Project</dt>
                      <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.projectName}</dd>
                    </div>
                  )}
                  {purchaseOrder.supplierReference && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-tertiary)]">Supplier Reference</dt>
                      <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.supplierReference}</dd>
                    </div>
                  )}
                  {(purchaseOrder.sagePoNumber || isEditing) && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-tertiary)]">Sage PO Number</dt>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editFields.sagePoNumber}
                          onChange={(e) => setEditFields({ ...editFields, sagePoNumber: e.target.value })}
                          className="w-full px-2 py-1 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] text-sm"
                          placeholder="Sage PO number"
                        />
                      ) : (
                        <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.sagePoNumber}</dd>
                      )}
                    </div>
                  )}
                  {purchaseOrder.quoteNumber && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-tertiary)]">Quote Number</dt>
                      <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.quoteNumber}</dd>
                    </div>
                  )}
                  {purchaseOrder.quoteAttachmentUrl && (
                    <div>
                      <dt className="text-sm text-[var(--ff-text-tertiary)]">Quote Attachment</dt>
                      <dd>
                        <a
                          href={purchaseOrder.quoteAttachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          <Paperclip className="h-4 w-4" />
                          {purchaseOrder.quoteAttachmentName || 'View Quote'}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Delivery & Dates */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin className="h-5 w-5 text-green-400" />
                  <h3 className="font-semibold text-[var(--ff-text-primary)]">Delivery & Dates</h3>
                </div>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-[var(--ff-text-tertiary)]">Order Date</dt>
                    {isEditing ? (
                      <input
                        type="date"
                        value={editFields.orderDate}
                        onChange={(e) => setEditFields({ ...editFields, orderDate: e.target.value })}
                        className="mt-1 w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    ) : (
                      <dd className="text-[var(--ff-text-primary)]">{formatDate(purchaseOrder.orderDate)}</dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-sm text-[var(--ff-text-tertiary)]">Expected Delivery</dt>
                    {isEditing ? (
                      <input
                        type="date"
                        value={editFields.expectedDeliveryDate}
                        onChange={(e) => setEditFields({ ...editFields, expectedDeliveryDate: e.target.value })}
                        className="mt-1 w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    ) : (
                      <dd className="text-[var(--ff-text-primary)]">{formatDate(purchaseOrder.expectedDeliveryDate)}</dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-sm text-[var(--ff-text-tertiary)]">Delivery Address</dt>
                    {isEditing ? (
                      <textarea
                        value={editFields.deliveryAddress}
                        onChange={(e) => setEditFields({ ...editFields, deliveryAddress: e.target.value })}
                        rows={3}
                        className="mt-1 w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    ) : (
                      <dd className="text-[var(--ff-text-primary)] whitespace-pre-wrap">{purchaseOrder.deliveryAddress || '-'}</dd>
                    )}
                  </div>
                </dl>
              </div>

              {/* Payment Terms */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-5">
                <div className="flex items-center gap-2 mb-4">
                  <CreditCard className="h-5 w-5 text-purple-400" />
                  <h3 className="font-semibold text-[var(--ff-text-primary)]">Payment Terms</h3>
                </div>
                <dl className="space-y-3">
                  <div>
                    <dt className="text-sm text-[var(--ff-text-tertiary)]">Terms</dt>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editFields.paymentTerms}
                        onChange={(e) => setEditFields({ ...editFields, paymentTerms: e.target.value })}
                        className="mt-1 w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    ) : (
                      <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.paymentTerms}</dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-sm text-[var(--ff-text-tertiary)]">Currency</dt>
                    <dd className="text-[var(--ff-text-primary)]">{purchaseOrder.currency}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-[var(--ff-text-tertiary)]">Notes</dt>
                    {isEditing ? (
                      <textarea
                        value={editFields.internalNotes}
                        onChange={(e) => setEditFields({ ...editFields, internalNotes: e.target.value })}
                        rows={3}
                        className="mt-1 w-full px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    ) : (
                      <dd className="text-[var(--ff-text-primary)] whitespace-pre-wrap">{purchaseOrder.notes || '-'}</dd>
                    )}
                  </div>
                </dl>
              </div>

              {/* Summary */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-5">
                <h3 className="font-semibold text-[var(--ff-text-primary)] mb-4">Summary</h3>
                <dl className="space-y-3">
                  <div className="flex justify-between">
                    <dt className="text-[var(--ff-text-secondary)]">Subtotal</dt>
                    <dd className="text-[var(--ff-text-primary)]">{formatCurrency(purchaseOrder.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--ff-text-secondary)]">VAT ({purchaseOrder.taxRate}%)</dt>
                    <dd className="text-[var(--ff-text-primary)]">{formatCurrency(purchaseOrder.taxAmount)}</dd>
                  </div>
                  <div className="flex justify-between pt-3 border-t border-[var(--ff-border-light)]">
                    <dt className="font-semibold text-[var(--ff-text-primary)]">Total</dt>
                    <dd className="font-semibold text-[var(--ff-text-primary)] text-lg">{formatCurrency(purchaseOrder.totalAmount)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          {activeTab === 'items' && (
            <POItemsTable
              poId={purchaseOrder.id}
              items={purchaseOrder.items}
              canEdit={['draft', 'pending_approval'].includes(purchaseOrder.status)}
              onItemsUpdated={fetchPurchaseOrder}
            />
          )}

          {activeTab === 'receipts' && (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
              {purchaseOrder.receipts.length === 0 ? (
                <div className="text-center py-12">
                  <Truck className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
                  <p className="text-[var(--ff-text-secondary)] mb-4">No goods received yet</p>
                  {['approved', 'sent', 'acknowledged', 'partial_receipt'].includes(purchaseOrder.status) && (
                    <button
                      onClick={() => router.push(`/procurement/grn/new?po=${id}`)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      <PackageCheck className="h-4 w-4" />
                      New GRN
                    </button>
                  )}
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--ff-border-light)]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">GRN Number</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Received Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Received By</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Items</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ff-border-light)]">
                    {purchaseOrder.receipts.map((receipt) => (
                      <tr
                        key={receipt.id}
                        onClick={() => router.push(`/procurement/grn/${receipt.id}`)}
                        className="hover:bg-[var(--ff-bg-hover)] cursor-pointer"
                      >
                        <td className="px-4 py-3 text-blue-400 font-medium">{receipt.grnNumber}</td>
                        <td className="px-4 py-3 text-[var(--ff-text-primary)]">{formatDate(receipt.receivedDate)}</td>
                        <td className="px-4 py-3 text-[var(--ff-text-secondary)]">{receipt.receivedBy}</td>
                        <td className="px-4 py-3 text-right text-[var(--ff-text-primary)]">{receipt.totalItems}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
              <div className="space-y-6">
                {purchaseOrder.history.map((event, index) => (
                  <div key={event.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 rounded-full bg-blue-500" />
                      {index < purchaseOrder.history.length - 1 && (
                        <div className="w-0.5 h-full bg-[var(--ff-border-light)] mt-2" />
                      )}
                    </div>
                    <div className="flex-1 pb-6">
                      <p className="font-medium text-[var(--ff-text-primary)]">
                        {getActionLabel(event.action)}
                      </p>
                      {event.notes && (
                        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                          {event.notes}
                        </p>
                      )}
                      <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                        {formatDateTime(event.createdAt)}
                        {event.createdBy && ` by ${event.createdBy}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'documents' && (() => {
            // Document Checklist — resolve each category to { url, name } or null
            const odooDocs = purchaseOrder.odooDocuments || [];

            function resolveDoc(
              procMatch: typeof procDocs[number] | undefined,
              odooMatch: typeof odooDocs[number] | undefined,
              fallbackUrl?: string | null,
              fallbackName?: string | null,
            ): { url: string; name: string } | null {
              if (procMatch) return { url: procMatch.fileUrl, name: procMatch.documentName };
              if (odooMatch) return { url: odooMatch.fileUrl, name: odooMatch.name };
              if (fallbackUrl) return { url: fallbackUrl, name: fallbackName || 'Document' };
              return null;
            }

            const quote = resolveDoc(
              procDocs.find(d => d.documentType === 'quote_pdf'),
              odooDocs.find(d => d.type === 'quote'),
              purchaseOrder.quoteAttachmentUrl,
              purchaseOrder.quoteAttachmentName,
            );
            const poDocument = resolveDoc(
              procDocs.find(d => d.documentType === 'contract'),
              odooDocs.find(d => d.odooModel === 'purchase.order'),
            );
            const grv = resolveDoc(
              procDocs.find(d => d.documentType === 'grv' || d.documentType === 'delivery_note'),
              odooDocs.find(d => d.odooModel === 'stock.picking'),
            );
            const invoice = resolveDoc(
              procDocs.find(d => d.documentType === 'invoice'),
              odooDocs.find(d => d.type === 'invoice' || d.odooModel === 'account.move'),
            );

            const checklistItems = [
              { label: 'Quote', present: !!quote, name: quote?.name, url: quote?.url },
              { label: 'Purchase Order', present: !!poDocument, name: poDocument?.name, url: poDocument?.url },
              { label: 'GRV', present: !!grv, name: grv?.name, url: grv?.url },
              { label: 'Supplier Invoice', present: !!invoice, name: invoice?.name, url: invoice?.url },
            ];
            const completedCount = checklistItems.filter(i => i.present).length;
            const allComplete = completedCount === 4;

            return (
            <div className="space-y-6">
              {/* Document Checklist */}
              <div className={`bg-[var(--ff-bg-secondary)] border rounded-lg p-5 ${allComplete ? 'border-green-500/50' : 'border-[var(--ff-border-light)]'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-400" />
                    <h3 className="font-semibold text-[var(--ff-text-primary)]">Document Checklist</h3>
                  </div>
                  <span className={`text-sm font-medium px-2.5 py-1 rounded-full ${allComplete ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}>
                    {allComplete ? '4/4 Complete' : `${completedCount}/4`}
                  </span>
                </div>
                <div className="space-y-2">
                  {checklistItems.map((item) => (
                    <div key={item.label} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors">
                      {item.present ? (
                        <CheckCircle className="h-5 w-5 text-green-400 shrink-0" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium text-[var(--ff-text-primary)] w-32 shrink-0">
                        {item.label}
                      </span>
                      {item.present && item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-400 hover:text-blue-300 truncate transition-colors"
                        >
                          {item.name}
                        </a>
                      ) : !item.present ? (
                        <span className="text-sm text-red-400/70">Missing — upload required</span>
                      ) : (
                        <span className="text-sm text-[var(--ff-text-secondary)] truncate">{item.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Synced Documents from Odoo */}
              {purchaseOrder.odooDocuments && purchaseOrder.odooDocuments.length > 0 && (
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Paperclip className="h-5 w-5 text-green-400" />
                    <h3 className="font-semibold text-[var(--ff-text-primary)]">Synced Documents</h3>
                    <span className="text-xs text-[var(--ff-text-tertiary)]">({purchaseOrder.odooDocuments.length})</span>
                  </div>
                  <div className="space-y-2">
                    {purchaseOrder.odooDocuments.map((doc) => (
                      <a
                        key={doc.id}
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between p-3 rounded-lg border border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-blue-400" />
                          <div>
                            <p className="text-sm font-medium text-[var(--ff-text-primary)]">{doc.name}</p>
                            <p className="text-xs text-[var(--ff-text-tertiary)]">
                              {doc.type} • {doc.fileSize > 1024 ? `${(doc.fileSize / 1024).toFixed(0)} KB` : `${doc.fileSize} B`}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-[var(--ff-text-tertiary)]">
                          {new Date(doc.createdAt).toLocaleDateString('en-ZA')}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {/* User-uploaded Documents */}
              <ProcurementDocumentPanel
                entityType="purchase_order"
                entityId={purchaseOrder.id}
                allowedTypes={[
                  { value: 'quote_pdf', label: 'Supplier Quote' },
                  { value: 'invoice', label: 'Invoice' },
                  { value: 'grv', label: 'GRV' },
                  { value: 'delivery_note', label: 'Delivery Note' },
                  { value: 'contract', label: 'Contract' },
                  { value: 'other', label: 'Other' },
                ]}
              />
            </div>
            );
          })()}
        </div>
      </div>
    </AppLayout>
  );
}
