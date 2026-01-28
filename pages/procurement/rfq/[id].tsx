/**
 * RFQ Detail Page
 * View and manage a specific Request for Quotation
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import {
  ArrowLeft,
  FileText,
  Calendar,
  Users,
  Package,
  MessageSquare,
  Edit2,
  Trash2,
  Send,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
  Building2,
  Mail,
  Phone,
  ShoppingCart,
  ScanLine,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { ConvertToPOModal } from '@/components/procurement/rfq/ConvertToPOModal';
import { QuoteScannerModal } from '@/modules/procurement/quote-scanner';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';

interface RFQItem {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  specifications?: string;
  estimatedUnitPrice: number;
}

interface Supplier {
  id: string;
  companyName: string;
  email: string;
  phone?: string;
  status: string;
}

interface Quote {
  id: string;
  supplierId: string;
  supplierName: string;
  totalAmount: number;
  status: string;
  validUntil?: string;
  submittedAt: string;
  notes?: string;
}

interface RFQDetail {
  id: string;
  rfqNumber: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status: 'draft' | 'open' | 'evaluating' | 'awarded' | 'cancelled';
  createdDate: string;
  dueDate: string;
  items: RFQItem[];
  suppliers: Supplier[];
  quotes: Quote[];
  quotesReceived: number;
  totalValue: number;
  createdBy: string;
  updatedAt: string;
}

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400', icon: Clock },
  open: { label: 'Open', color: 'bg-green-500/20 text-green-400', icon: Send },
  evaluating: { label: 'Evaluating', color: 'bg-yellow-500/20 text-yellow-400', icon: FileText },
  awarded: { label: 'Awarded', color: 'bg-blue-500/20 text-blue-400', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-500/20 text-red-400', icon: XCircle },
};

export default function RFQDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [rfq, setRfq] = useState<RFQDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'items' | 'suppliers' | 'quotes'>('items');
  const [showConvertToPOModal, setShowConvertToPOModal] = useState(false);
  const [showQuoteScanner, setShowQuoteScanner] = useState(false);

  useEffect(() => {
    if (id && typeof id === 'string') {
      fetchRFQ(id);
    }
  }, [id]);

  const fetchRFQ = async (rfqId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`/api/procurement/rfq/${rfqId}`);
      const data = await response.json();

      if (data.success) {
        setRfq(data.data);
      } else {
        setError(data.error?.message || 'Failed to load RFQ');
      }
    } catch (err) {
      log.error('Failed to fetch RFQ', err);
      setError('Failed to load RFQ details');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleDelete = async () => {
    if (!rfq) return;
    if (!confirm('Are you sure you want to delete this RFQ? This action cannot be undone.')) return;

    try {
      const response = await fetch(`/api/procurement/rfq/${rfq.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (data.success) {
        notificationService.success('RFQ deleted successfully');
        router.push('/procurement/rfq');
      } else {
        notificationService.error(data.error?.message || 'Failed to delete RFQ');
      }
    } catch (err) {
      notificationService.error('Failed to delete RFQ');
    }
  };

  const handleIssueRFQ = async () => {
    if (!rfq) return;
    if (!confirm('Issue this RFQ to suppliers? This will change the status to Open.')) return;

    try {
      const response = await fetch(`/api/procurement/rfq/${rfq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      });
      const data = await response.json();

      if (data.success) {
        notificationService.success('RFQ issued successfully');
        setRfq({ ...rfq, status: 'open' });
      } else {
        notificationService.error(data.error?.message || 'Failed to issue RFQ');
      }
    } catch (err) {
      notificationService.error('Failed to issue RFQ');
    }
  };

  const handleCloseRFQ = async () => {
    if (!rfq) return;
    if (!confirm('Close this RFQ for evaluation?')) return;

    try {
      const response = await fetch(`/api/procurement/rfq/${rfq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'evaluating' }),
      });
      const data = await response.json();

      if (data.success) {
        notificationService.success('RFQ closed for evaluation');
        setRfq({ ...rfq, status: 'evaluating' });
      } else {
        notificationService.error(data.error?.message || 'Failed to close RFQ');
      }
    } catch (err) {
      notificationService.error('Failed to close RFQ');
    }
  };

  const handlePOCreated = (poId: string, poNumber: string) => {
    notificationService.success(`Purchase Order ${poNumber} created!`);
    // Update RFQ status to awarded
    if (rfq) {
      setRfq({ ...rfq, status: 'awarded' });
    }
    // Navigate to the new PO
    router.push(`/procurement/purchase-orders/${poId}`);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      </AppLayout>
    );
  }

  if (error || !rfq) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
          <div className="text-center">
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)] mb-2">
              {error || 'RFQ not found'}
            </h2>
            <Button onClick={() => router.push('/procurement/rfq')}>
              Back to RFQ List
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const StatusIcon = statusConfig[rfq.status]?.icon || Clock;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <button
              onClick={() => router.push('/procurement/rfq')}
              className="flex items-center text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to RFQ List
            </button>

            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {rfq.title}
                  </h1>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${statusConfig[rfq.status]?.color}`}>
                    <StatusIcon className="h-4 w-4" />
                    {statusConfig[rfq.status]?.label}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
                  <span className="font-mono">{rfq.rfqNumber}</span>
                  <span>|</span>
                  <span>{rfq.projectName}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => router.push(`/procurement/rfq/${rfq.id}/edit`)}>
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-400 hover:text-red-300">
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Overview Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <Calendar className="h-4 w-4" />
                    <span className="text-xs">Due Date</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {formatDate(rfq.dueDate)}
                  </p>
                </div>
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <Package className="h-4 w-4" />
                    <span className="text-xs">Items</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {rfq.items.length}
                  </p>
                </div>
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <Users className="h-4 w-4" />
                    <span className="text-xs">Suppliers</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {rfq.suppliers.length}
                  </p>
                </div>
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[var(--ff-text-secondary)] mb-1">
                    <MessageSquare className="h-4 w-4" />
                    <span className="text-xs">Quotes</span>
                  </div>
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
                    {rfq.quotesReceived}
                  </p>
                </div>
              </div>

              {/* Description */}
              {rfq.description && (
                <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
                  <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">Description</h3>
                  <p className="text-[var(--ff-text-primary)]">{rfq.description}</p>
                </div>
              )}

              {/* Tabs */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
                <div className="flex border-b border-[var(--ff-border-light)]">
                  {(['items', 'suppliers', 'quotes'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                        activeTab === tab
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                          : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                      }`}
                    >
                      {tab === 'items' && `Items (${rfq.items.length})`}
                      {tab === 'suppliers' && `Suppliers (${rfq.suppliers.length})`}
                      {tab === 'quotes' && `Quotes (${rfq.quotes.length})`}
                    </button>
                  ))}
                </div>

                <div className="p-4">
                  {/* Items Tab */}
                  {activeTab === 'items' && (
                    <div className="space-y-3">
                      {rfq.items.length === 0 ? (
                        <p className="text-center py-8 text-[var(--ff-text-secondary)]">No items added</p>
                      ) : (
                        rfq.items.map((item, index) => (
                          <div key={item.id || index} className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-[var(--ff-text-primary)]">{item.description}</p>
                                {item.specifications && (
                                  <p className="text-sm text-[var(--ff-text-secondary)] mt-1">{item.specifications}</p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-[var(--ff-text-primary)]">
                                  {formatCurrency(item.estimatedUnitPrice * item.quantity)}
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-4 mt-2 text-sm text-[var(--ff-text-tertiary)]">
                              <span>Qty: {item.quantity} {item.unit}</span>
                              <span>Unit Price: {formatCurrency(item.estimatedUnitPrice)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Suppliers Tab */}
                  {activeTab === 'suppliers' && (
                    <div className="space-y-3">
                      {rfq.suppliers.length === 0 ? (
                        <p className="text-center py-8 text-[var(--ff-text-secondary)]">No suppliers invited</p>
                      ) : (
                        rfq.suppliers.map((supplier) => (
                          <div key={supplier.id} className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-blue-500/20 rounded-lg">
                                <Building2 className="h-5 w-5 text-blue-400" />
                              </div>
                              <div>
                                <p className="font-medium text-[var(--ff-text-primary)]">{supplier.companyName}</p>
                                <div className="flex items-center gap-4 text-sm text-[var(--ff-text-secondary)]">
                                  <span className="flex items-center gap-1">
                                    <Mail className="h-3 w-3" />
                                    {supplier.email}
                                  </span>
                                  {supplier.phone && (
                                    <span className="flex items-center gap-1">
                                      <Phone className="h-3 w-3" />
                                      {supplier.phone}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs ${
                              supplier.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                            }`}>
                              {supplier.status}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Quotes Tab */}
                  {activeTab === 'quotes' && (
                    <div className="space-y-3">
                      {/* Scan Quote Button */}
                      <div className="flex justify-end mb-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowQuoteScanner(true)}
                        >
                          <ScanLine className="h-4 w-4 mr-2" />
                          Scan Quote Document
                        </Button>
                      </div>
                      {rfq.quotes.length === 0 ? (
                        <p className="text-center py-8 text-[var(--ff-text-secondary)]">No quotes received yet</p>
                      ) : (
                        rfq.quotes.map((quote) => (
                          <div key={quote.id} className="p-4 bg-[var(--ff-bg-tertiary)] rounded-lg">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-medium text-[var(--ff-text-primary)]">{quote.supplierName}</p>
                                <p className="text-sm text-[var(--ff-text-secondary)]">
                                  Submitted: {formatDate(quote.submittedAt)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold text-[var(--ff-text-primary)]">
                                  {formatCurrency(quote.totalAmount)}
                                </p>
                                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                                  quote.status === 'accepted' ? 'bg-green-500/20 text-green-400' :
                                  quote.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                                  'bg-yellow-500/20 text-yellow-400'
                                }`}>
                                  {quote.status}
                                </span>
                              </div>
                            </div>
                            {quote.notes && (
                              <p className="mt-2 text-sm text-[var(--ff-text-tertiary)]">{quote.notes}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Estimated Total</span>
                    <span className="font-semibold text-[var(--ff-text-primary)]">
                      {formatCurrency(rfq.totalValue)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Created</span>
                    <span className="text-[var(--ff-text-primary)]">{formatDate(rfq.createdDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Created By</span>
                    <span className="text-[var(--ff-text-primary)]">{rfq.createdBy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--ff-text-secondary)]">Last Updated</span>
                    <span className="text-[var(--ff-text-primary)]">{formatDate(rfq.updatedAt)}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Actions</h3>
                <div className="space-y-2">
                  {rfq.status === 'draft' && (
                    <Button className="w-full" onClick={handleIssueRFQ}>
                      <Send className="h-4 w-4 mr-2" />
                      Issue RFQ
                    </Button>
                  )}
                  {rfq.status === 'open' && (
                    <Button className="w-full" onClick={handleCloseRFQ}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Close & Evaluate
                    </Button>
                  )}
                  {(rfq.status === 'evaluating' || rfq.status === 'awarded') && (
                    <Button className="w-full" onClick={() => setShowConvertToPOModal(true)}>
                      <ShoppingCart className="h-4 w-4 mr-2" />
                      Create Purchase Order
                    </Button>
                  )}
                  <Button variant="outline" className="w-full" onClick={() => router.push(`/procurement/rfq/${rfq.id}/edit`)}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit RFQ
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Convert to PO Modal */}
        <ConvertToPOModal
          isOpen={showConvertToPOModal}
          onClose={() => setShowConvertToPOModal(false)}
          rfqId={rfq.id}
          rfqNumber={rfq.rfqNumber}
          rfqTitle={rfq.title}
          projectId={rfq.projectId}
          suppliers={rfq.suppliers.map((s) => ({
            id: s.id,
            companyName: s.companyName,
            email: s.email,
            phone: s.phone,
            status: s.status,
          }))}
          items={rfq.items.map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            estimatedUnitPrice: item.estimatedUnitPrice,
          }))}
          totalValue={rfq.totalValue}
          onSuccess={handlePOCreated}
        />

        {/* Quote Scanner Modal */}
        <QuoteScannerModal
          isOpen={showQuoteScanner}
          onClose={() => setShowQuoteScanner(false)}
          projectId={rfq.projectId}
          rfqId={rfq.id}
          rfqNumber={rfq.rfqNumber}
          rfqItems={rfq.items.map((item) => ({
            id: item.id,
            description: item.description,
            itemCode: undefined,
            quantity: item.quantity,
            unit: item.unit,
          }))}
          onExtractionComplete={(extraction, matching, extractionId) => {
            log.info('Quote extraction complete', { extractionId });
            notificationService.success('Quote scanned successfully! Review the extracted data.');
            // Refresh the page to show updated quotes if any were created
            fetchRFQ(rfq.id);
          }}
        />
      </div>
    </AppLayout>
  );
}
