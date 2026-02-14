// ============= Review Step Component =============

import React from 'react';
import { GlassCard } from '../../../../../components/ui';
import type { POFormData, POTotals } from './types';
import { mockSuppliers } from './types';

interface ReviewStepProps {
  formData: POFormData;
  totals: POTotals;
  updateFormData: (updates: Partial<POFormData>) => void;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  formData,
  totals,
  updateFormData
}) => {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-foreground">Notes & Review</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Notes (visible to supplier)
          </label>
          <textarea
            value={formData.notes || ''}
            onChange={(e) => updateFormData({ notes: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter any notes for the supplier"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Internal Notes (not visible to supplier)
          </label>
          <textarea
            value={formData.internalNotes || ''}
            onChange={(e) => updateFormData({ internalNotes: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter internal notes"
          />
        </div>
      </div>

      {/* Order Summary */}
      <GlassCard className="p-6 bg-background">
        <h4 className="text-lg font-semibold mb-4">Order Summary</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p><span className="font-medium">Title:</span> {formData.title}</p>
            <p>
              <span className="font-medium">Supplier:</span> {mockSuppliers.find(s => s.id === formData.supplierId)?.name}
            </p>
            <p><span className="font-medium">Order Type:</span> {formData.orderType}</p>
            <p><span className="font-medium">Payment Terms:</span> {formData.paymentTerms}</p>
          </div>
          <div>
            <p><span className="font-medium">Items:</span> {formData.items.length}</p>
            <p>
              <span className="font-medium">Subtotal:</span> {new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(totals.subtotal)}
            </p>
            <p>
              <span className="font-medium">VAT:</span> {new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(totals.taxAmount)}
            </p>
            <p className="text-lg font-semibold">
              <span>Total:</span> {new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(totals.total)}
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};
