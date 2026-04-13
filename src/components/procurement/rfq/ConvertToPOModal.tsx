/**
 * Convert RFQ to Purchase Order Modal
 * Allows selecting supplier and configuring PO details before conversion
 */

import { useState, useEffect } from 'react';
import {
  X,
  Package,
  Building2,
  Truck,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';

interface Supplier {
  id: string | number;
  companyName: string;
  email: string;
  phone?: string;
  status?: string;
}

interface RFQItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  estimatedUnitPrice: number;
}

interface ConvertToPOModalProps {
  isOpen: boolean;
  onClose: () => void;
  rfqId: string;
  rfqNumber: string;
  rfqTitle: string;
  projectId: string;
  suppliers: Supplier[];
  items: RFQItem[];
  totalValue: number;
  onSuccess: (poId: string, poNumber: string) => void;
}

const PAYMENT_TERMS_OPTIONS = [
  { value: 'COD', label: 'Cash on Delivery (COD)' },
  { value: 'Net 7', label: 'Net 7 Days' },
  { value: 'Net 14', label: 'Net 14 Days' },
  { value: 'Net 30', label: 'Net 30 Days' },
  { value: 'Net 45', label: 'Net 45 Days' },
  { value: 'Net 60', label: 'Net 60 Days' },
  { value: 'EOM', label: 'End of Month (EOM)' },
  { value: 'Prepaid', label: 'Prepaid' },
];

export function ConvertToPOModal({
  isOpen,
  onClose,
  rfqId,
  rfqNumber,
  rfqTitle,
  projectId,
  suppliers,
  items,
  totalValue,
  onSuccess,
}: ConvertToPOModalProps) {
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [taxRate, setTaxRate] = useState(15);
  const [internalNotes, setInternalNotes] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedSupplierId(suppliers.length === 1 && suppliers[0] ? String(suppliers[0].id) : '');
      setDeliveryAddress('');
      setExpectedDeliveryDate('');
      setPaymentTerms('Net 30');
      setTaxRate(15);
      setInternalNotes('');
      setError(null);
    }
  }, [isOpen, suppliers]);

  // Calculate totals
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.estimatedUnitPrice, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleConvert = async () => {
    // Validation
    if (!selectedSupplierId) {
      setError('Please select a supplier');
      return;
    }

    if (!deliveryAddress || deliveryAddress.trim().length < 10) {
      setError('Please enter a valid delivery address (at least 10 characters)');
      return;
    }

    setError(null);
    setIsConverting(true);

    try {
      const response = await fetch(`/api/procurement/rfq/${rfqId}/convert-to-po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: selectedSupplierId,
          deliveryAddress,
          expectedDeliveryDate: expectedDeliveryDate || null,
          paymentTerms,
          taxRate,
          internalNotes,
          createdBy: 'System',
        }),
      });

      const data = await response.json();

      if (data.success) {
        notificationService.operationSuccess('created', 'Purchase Order');
        onSuccess(data.data.purchaseOrder.id, data.data.purchaseOrder.poNumber);
        onClose();
      } else {
        setError(data.error?.message || 'Failed to create Purchase Order');
        notificationService.error(data.error?.message || 'Failed to create Purchase Order');
      }
    } catch (err) {
      log.error('Failed to convert RFQ to PO', { err });
      setError('An unexpected error occurred');
      notificationService.operationError('create', err as Error, 'Purchase Order');
    } finally {
      setIsConverting(false);
    }
  };

  if (!isOpen) return null;

  const selectedSupplier = suppliers.find((s) => String(s.id) === selectedSupplierId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden mx-4 sm:mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] flex items-center">
              <Package className="h-5 w-5 mr-2 text-blue-400" />
              Create Purchase Order from RFQ
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              {rfqNumber} - {rfqTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-180px)] space-y-6">
          {/* Error Alert */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Supplier Selection */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              <Building2 className="h-4 w-4" />
              Select Supplier <span className="text-red-400">*</span>
            </label>
            {suppliers.length === 0 ? (
              <p className="text-sm text-[var(--ff-text-tertiary)] p-3 bg-[var(--ff-bg-tertiary)] rounded">
                No suppliers were invited to this RFQ
              </p>
            ) : (
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
              >
                <option value="">Select a supplier...</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={String(supplier.id)}>
                    {supplier.companyName} ({supplier.email})
                  </option>
                ))}
              </select>
            )}
            {selectedSupplier && (
              <div className="mt-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-sm font-medium text-blue-400">{selectedSupplier.companyName}</p>
                <p className="text-xs text-[var(--ff-text-secondary)]">{selectedSupplier.email}</p>
                {selectedSupplier.phone && (
                  <p className="text-xs text-[var(--ff-text-secondary)]">{selectedSupplier.phone}</p>
                )}
              </div>
            )}
          </div>

          {/* Delivery Details */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              <Truck className="h-4 w-4" />
              Delivery Address <span className="text-red-400">*</span>
            </label>
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Enter the full delivery address..."
              rows={3}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Expected Delivery Date */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                <Calendar className="h-4 w-4" />
                Expected Delivery Date
              </label>
              <input
                type="date"
                value={expectedDeliveryDate}
                onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
              />
            </div>

            {/* Payment Terms */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                <CreditCard className="h-4 w-4" />
                Payment Terms
              </label>
              <select
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
              >
                {PAYMENT_TERMS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tax Rate */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              VAT Rate (%)
            </label>
            <input
              type="number"
              value={taxRate}
              onChange={(e) => setTaxRate(Number(e.target.value))}
              min={0}
              max={25}
              className="w-32 px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md"
            />
          </div>

          {/* Internal Notes */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
              <FileText className="h-4 w-4" />
              Internal Notes
            </label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Optional notes for internal reference..."
              rows={2}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-md placeholder:text-[var(--ff-text-tertiary)] resize-none"
            />
          </div>

          {/* Items Summary */}
          <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
            <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">
              Items to be Included ({items.length})
            </h3>
            <div className="max-h-40 overflow-y-auto space-y-2">
              {items.map((item, index) => (
                <div
                  key={item.id || index}
                  className="flex justify-between items-center text-sm py-1 border-b border-[var(--ff-border-light)] last:border-0"
                >
                  <div className="flex-1">
                    <p className="text-[var(--ff-text-primary)]">{item.description}</p>
                    <p className="text-xs text-[var(--ff-text-tertiary)]">
                      {item.quantity} {item.unit} @ {formatCurrency(item.estimatedUnitPrice)}
                    </p>
                  </div>
                  <p className="text-[var(--ff-text-primary)] font-medium">
                    {formatCurrency(item.quantity * item.estimatedUnitPrice)}
                  </p>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)] space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">Subtotal</span>
                <span className="text-[var(--ff-text-primary)]">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--ff-text-secondary)]">VAT ({taxRate}%)</span>
                <span className="text-[var(--ff-text-primary)]">{formatCurrency(taxAmount)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span className="text-[var(--ff-text-primary)]">Total</span>
                <span className="text-blue-400">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
          <Button variant="outline" onClick={onClose} disabled={isConverting}>
            Cancel
          </Button>
          <Button onClick={handleConvert} disabled={isConverting || suppliers.length === 0}>
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating PO...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Create Purchase Order
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
