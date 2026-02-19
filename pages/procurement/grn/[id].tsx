// WORKING: Goods Receipt Note Detail Page
// PRD-050 Phase 2: Core Procurement - GRN
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout';
import { ProcurementTabs } from '@/modules/procurement/components/ProcurementTabs';
import {
  PackageCheck,
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Truck,
  Building2,
  FileText,
  Package,
  Loader2,
} from 'lucide-react';
import type { GoodsReceiptNote, GRNStatus, InspectionStatus } from '@/types/procurement/grn.types';
import { log } from '@/lib/logger';
import { GRNAssetRegistration } from '@/modules/procurement/components/GRNAssetRegistration';
import { ProcurementDocumentPanel } from '@/modules/procurement/documents';

const statusConfig: Record<GRNStatus, { label: string; color: string; bgColor: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'text-gray-400', bgColor: 'bg-gray-500/20', icon: Clock },
  receiving: { label: 'Receiving', color: 'text-blue-400', bgColor: 'bg-blue-500/20', icon: Package },
  inspecting: { label: 'Inspecting', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', icon: AlertCircle },
  completed: { label: 'Completed', color: 'text-green-400', bgColor: 'bg-green-500/20', icon: CheckCircle },
  partial: { label: 'Partial', color: 'text-orange-400', bgColor: 'bg-orange-500/20', icon: Clock },
  rejected: { label: 'Rejected', color: 'text-red-400', bgColor: 'bg-red-500/20', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-gray-300', bgColor: 'bg-gray-500/20', icon: XCircle },
};

const inspectionStatusConfig: Record<InspectionStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-400' },
  passed: { label: 'Passed', color: 'text-green-400' },
  failed: { label: 'Failed', color: 'text-red-400' },
  partial: { label: 'Partial', color: 'text-orange-400' },
};

export default function GRNDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  const [grn, setGrn] = useState<GoodsReceiptNote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!id) return;

    const fetchGRN = async () => {
      try {
        setIsLoading(true);
        // Note: We'll need to add the [id].ts API endpoint
        const response = await fetch(`/api/procurement/grn/${id}`);
        const data = await response.json();

        if (data.success) {
          setGrn(data.data);
        } else {
          setError(data.error?.message || 'Failed to fetch GRN');
        }
      } catch (err) {
        log.error('Failed to fetch GRN', err);
        setError('Failed to load goods receipt note');
      } finally {
        setIsLoading(false);
      }
    };

    fetchGRN();
  }, [id]);

  const handleConfirmGRN = async () => {
    if (!grn || !id) return;

    const confirmed = window.confirm(
      `Are you sure you want to confirm GRN ${grn.grnNumber}?\n\nThis will:\n• Update stock quantities\n• Create a stock movement record\n• Mark the GRN as received`
    );

    if (!confirmed) return;

    setIsConfirming(true);
    try {
      const response = await fetch('/api/procurement/grn-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grnId: id }),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state to reflect new status
        setGrn(prev => prev ? { ...prev, status: 'completed' as GRNStatus } : null);
        alert(`GRN confirmed successfully!\n\nItems processed: ${data.data.summary.itemsProcessed}\nTotal quantity received: ${data.data.summary.totalQuantityReceived}`);
      } else {
        alert(`Failed to confirm GRN: ${data.error?.message || 'Unknown error'}`);
      }
    } catch (err) {
      log.error('Failed to confirm GRN', err);
      alert('Failed to confirm GRN. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)] flex items-center justify-center">
          <div className="flex items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
            <span className="text-[var(--ff-text-secondary)]">Loading...</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !grn) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-[var(--ff-bg-primary)]">
          {/* Header */}
          <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
            <div className="px-6 py-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.back()}
                  className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                </button>
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <PackageCheck className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                    GRN Not Found
                  </h1>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <p className="text-[var(--ff-text-secondary)]">{error || 'GRN not found'}</p>
            <button
              onClick={() => router.push('/procurement/grn')}
              className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
            >
              Back to GRN List
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const status = statusConfig[grn.status];
  const StatusIcon = status.icon;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        {/* Header */}
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => router.push('/procurement/grn')}
                  className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg transition-colors"
                >
                  <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                </button>
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <PackageCheck className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-xl font-semibold text-[var(--ff-text-primary)]">
                      {grn.grnNumber}
                    </h1>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </span>
                    {grn.hasDiscrepancy && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                        <AlertCircle className="h-3 w-3" />
                        Discrepancy
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Received {formatDate(grn.deliveryDate)}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {(grn.status === 'draft' || grn.status === 'receiving') && (
                  <button
                    onClick={handleConfirmGRN}
                    disabled={isConfirming}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isConfirming ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Confirming...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        Confirm Receipt
                      </>
                    )}
                  </button>
                )}
                {grn.status === 'completed' && (
                  <span className="px-4 py-2 bg-green-500/20 text-green-400 rounded-lg flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Completed
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6 border-t border-[var(--ff-border-light)]">
            <ProcurementTabs activeTab="grn" categoriesOnly />
          </div>
        </div>

        {/* Content */}
        <div className="p-6 max-w-5xl mx-auto">
          <div className="grid grid-cols-3 gap-6">
            {/* Main Info */}
            <div className="col-span-2 space-y-6">
              {/* Purchase Order Link */}
              {grn.purchaseOrderNumber && (
                <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)] mb-2">
                    <FileText className="h-4 w-4" />
                    Source Purchase Order
                  </div>
                  <button
                    onClick={() => router.push(`/procurement/purchase-orders/${grn.purchaseOrderId}`)}
                    className="text-emerald-400 hover:text-emerald-300 font-medium"
                  >
                    {grn.purchaseOrderNumber}
                  </button>
                </div>
              )}

              {/* Items */}
              <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-4">
                  Items Received ({grn.totalItems})
                </h3>

                {grn.items && grn.items.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-[var(--ff-border-light)]">
                          <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                            Item
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                            Expected
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                            Received
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                            Rejected
                          </th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                            Accepted
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ff-border-light)]">
                        {grn.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-3">
                              <div>
                                <div className="font-medium text-[var(--ff-text-primary)]">
                                  {item.itemDescription}
                                </div>
                                {item.itemCode && (
                                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                                    {item.itemCode}
                                  </div>
                                )}
                                {item.lotNumber && (
                                  <div className="text-xs text-[var(--ff-text-tertiary)]">
                                    Lot: {item.lotNumber}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right text-[var(--ff-text-secondary)]">
                              {item.quantityExpected ?? '-'} {item.uom}
                            </td>
                            <td className="px-3 py-3 text-right text-[var(--ff-text-primary)]">
                              {item.quantityReceived} {item.uom}
                            </td>
                            <td className="px-3 py-3 text-right text-red-400">
                              {item.quantityRejected > 0 ? item.quantityRejected : '-'}
                            </td>
                            <td className="px-3 py-3 text-right text-green-400">
                              {item.quantityAccepted}
                            </td>
                            <td className="px-3 py-3">
                              {item.inspectionStatus ? (
                                <span className={`text-sm ${inspectionStatusConfig[item.inspectionStatus].color}`}>
                                  {inspectionStatusConfig[item.inspectionStatus].label}
                                </span>
                              ) : (
                                <span className="text-sm text-[var(--ff-text-tertiary)]">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[var(--ff-text-tertiary)] text-sm">No items recorded</p>
                )}

                {/* Totals */}
                <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
                  <div className="flex justify-end gap-6 text-sm">
                    <div className="text-[var(--ff-text-secondary)]">
                      Total Received:{' '}
                      <span className="font-medium text-[var(--ff-text-primary)]">
                        {grn.totalQuantityReceived}
                      </span>
                    </div>
                    <div className="text-[var(--ff-text-secondary)]">
                      Total Rejected:{' '}
                      <span className="font-medium text-red-400">
                        {grn.totalQuantityRejected}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Asset Registration Panel - shown when GRN is completed */}
              {grn.status === 'completed' && id && typeof id === 'string' && (
                <GRNAssetRegistration
                  grnId={id}
                  onComplete={() => {
                    // Refresh GRN data after asset registration
                    fetch(`/api/procurement/grn/${id}`)
                      .then(res => res.json())
                      .then(data => {
                        if (data.success) setGrn(data.data);
                      });
                  }}
                />
              )}

              {/* Discrepancy Notes */}
              {grn.hasDiscrepancy && grn.discrepancyNotes && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <h3 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Discrepancy Notes
                  </h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{grn.discrepancyNotes}</p>
                  {grn.discrepancyResolved && (
                    <p className="text-xs text-green-400 mt-2">
                      Resolved by {grn.discrepancyResolvedBy} on {formatDate(grn.discrepancyResolvedAt)}
                    </p>
                  )}
                </div>
              )}

              {/* Notes */}
              {grn.notes && (
                <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2">Notes</h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{grn.notes}</p>
                </div>
              )}

              {/* Documents */}
              {id && typeof id === 'string' && (
                <ProcurementDocumentPanel
                  entityType="goods_receipt_note"
                  entityId={id}
                  allowedTypes={[
                    { value: 'delivery_note', label: 'Delivery Note' },
                    { value: 'grv', label: 'GRV (Goods Return)' },
                    { value: 'receipt', label: 'Receipt' },
                    { value: 'image', label: 'Photo/Image' },
                    { value: 'other', label: 'Other' },
                  ]}
                />
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Delivery Details */}
              <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-4">
                  Delivery Details
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Supplier</div>
                      <div className="text-sm text-[var(--ff-text-primary)]">
                        {grn.supplierName || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-[var(--ff-text-tertiary)]" />
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Warehouse</div>
                      <div className="text-sm text-[var(--ff-text-primary)]">
                        {grn.warehouseName || 'Unknown'}
                      </div>
                    </div>
                  </div>
                  {grn.deliveryNoteNumber && (
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Delivery Note #</div>
                      <div className="text-sm text-[var(--ff-text-primary)]">
                        {grn.deliveryNoteNumber}
                      </div>
                    </div>
                  )}
                  {grn.carrier && (
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Carrier</div>
                      <div className="text-sm text-[var(--ff-text-primary)]">{grn.carrier}</div>
                    </div>
                  )}
                  {grn.vehicleNumber && (
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Vehicle</div>
                      <div className="text-sm text-[var(--ff-text-primary)]">{grn.vehicleNumber}</div>
                    </div>
                  )}
                  {grn.receivingBay && (
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Receiving Bay</div>
                      <div className="text-sm text-[var(--ff-text-primary)]">{grn.receivingBay}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Inspection */}
              {grn.inspectionRequired && (
                <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                  <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-4">
                    Inspection
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Status</div>
                      <div className={`text-sm font-medium ${
                        grn.inspectionStatus ? inspectionStatusConfig[grn.inspectionStatus].color : 'text-yellow-400'
                      }`}>
                        {grn.inspectionStatus ? inspectionStatusConfig[grn.inspectionStatus].label : 'Pending'}
                      </div>
                    </div>
                    {grn.inspectedBy && (
                      <div>
                        <div className="text-xs text-[var(--ff-text-tertiary)]">Inspected By</div>
                        <div className="text-sm text-[var(--ff-text-primary)]">{grn.inspectedBy}</div>
                      </div>
                    )}
                    {grn.inspectedAt && (
                      <div>
                        <div className="text-xs text-[var(--ff-text-tertiary)]">Inspected At</div>
                        <div className="text-sm text-[var(--ff-text-primary)]">
                          {formatDate(grn.inspectedAt)}
                        </div>
                      </div>
                    )}
                    {grn.inspectionNotes && (
                      <div>
                        <div className="text-xs text-[var(--ff-text-tertiary)]">Notes</div>
                        <div className="text-sm text-[var(--ff-text-secondary)]">
                          {grn.inspectionNotes}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Personnel */}
              <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
                <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-4">
                  Personnel
                </h3>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">Received By</div>
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      {grn.receivedByName || grn.receivedBy}
                    </div>
                  </div>
                  {grn.verifiedBy && (
                    <div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">Verified By</div>
                      <div className="text-sm text-[var(--ff-text-primary)]">{grn.verifiedBy}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">Created</div>
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      {formatDate(grn.createdAt)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">Last Updated</div>
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      {formatDate(grn.updatedAt)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
