import React from 'react';
import { CheckCircle } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import type { QuoteFormData } from './types';

interface ReviewStepProps {
  formData: QuoteFormData;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({ formData }) => {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-foreground">Review & Submit</h3>

      {/* Quote Summary */}
      <GlassCard>
        <h4 className="font-semibold text-foreground mb-4">Quote Summary</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Total Amount:</span>
            <p className="font-semibold text-lg">R{(formData.totalAmount || 0).toLocaleString()}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Valid Until:</span>
            <p className="font-medium">
              {formData.validityPeriod} days from submission
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Payment Terms:</span>
            <p className="font-medium">{formData.paymentTerms}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Delivery:</span>
            <p className="font-medium">{formData.estimatedDeliveryDate}</p>
          </div>
        </div>
      </GlassCard>

      {/* Line Items Summary */}
      <GlassCard>
        <h4 className="font-semibold text-foreground mb-4">Line Items ({(formData.lineItems || []).length})</h4>
        <div className="space-y-3">
          {(formData.lineItems || []).map((item, index) => (
            <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
              <div>
                <p className="font-medium">{item.itemName} ({item.itemCode})</p>
                <p className="text-sm text-muted-foreground">
                  {item.quantity} {item.unit} @ R{item.unitPrice.toLocaleString()} each
                </p>
              </div>
              <p className="font-semibold">R{item.totalPrice.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Confirmation */}
      <GlassCard className="bg-green-50 border-green-200">
        <div className="flex items-start space-x-3">
          <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
          <div>
            <p className="font-medium text-green-900">Ready to Submit</p>
            <p className="text-sm text-green-700 mt-1">
              Please review all information carefully. Once submitted, this quote will be sent to the procurement team for evaluation.
            </p>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};
