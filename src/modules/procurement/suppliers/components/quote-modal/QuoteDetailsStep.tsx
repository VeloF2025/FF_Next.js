import React from 'react';
import type { QuoteFormData } from './types';

interface QuoteDetailsStepProps {
  formData: QuoteFormData;
  errors: Record<string, string>;
  onUpdate: (updates: Partial<QuoteFormData>) => void;
}

export const QuoteDetailsStep: React.FC<QuoteDetailsStepProps> = ({ formData, errors, onUpdate }) => {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-foreground">Quote Details</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Validity Period (days)
          </label>
          <input
            type="number"
            value={formData.validityPeriod}
            onChange={(e) => onUpdate({ validityPeriod: parseInt(e.target.value) || 30 })}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.validityPeriod ? 'border-red-500' : 'border-border'
            }`}
          />
          {errors.validityPeriod && (
            <p className="text-red-600 text-xs mt-1">{errors.validityPeriod}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Payment Terms
          </label>
          <select
            value={formData.paymentTerms}
            onChange={(e) => onUpdate({ paymentTerms: e.target.value })}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.paymentTerms ? 'border-red-500' : 'border-border'
            }`}
          >
            <option value="30 days net">30 days net</option>
            <option value="Payment on delivery">Payment on delivery</option>
            <option value="50% upfront, 50% on delivery">50% upfront, 50% on delivery</option>
            <option value="Payment in advance">Payment in advance</option>
          </select>
          {errors.paymentTerms && (
            <p className="text-red-600 text-xs mt-1">{errors.paymentTerms}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Delivery Terms
          </label>
          <select
            value={formData.deliveryTerms}
            onChange={(e) => onUpdate({ deliveryTerms: e.target.value })}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.deliveryTerms ? 'border-red-500' : 'border-border'
            }`}
          >
            <option value="Ex Works">Ex Works (EXW)</option>
            <option value="Free Carrier">Free Carrier (FCA)</option>
            <option value="Cost and Freight">Cost and Freight (CFR)</option>
            <option value="Delivered Duty Paid">Delivered Duty Paid (DDP)</option>
          </select>
          {errors.deliveryTerms && (
            <p className="text-red-600 text-xs mt-1">{errors.deliveryTerms}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Estimated Delivery Date
          </label>
          <input
            type="date"
            value={formData.estimatedDeliveryDate}
            onChange={(e) => onUpdate({ estimatedDeliveryDate: e.target.value })}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.estimatedDeliveryDate ? 'border-red-500' : 'border-border'
            }`}
          />
          {errors.estimatedDeliveryDate && (
            <p className="text-red-600 text-xs mt-1">{errors.estimatedDeliveryDate}</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          Delivery Location
        </label>
        <input
          type="text"
          value={formData.deliveryLocation || ''}
          onChange={(e) => onUpdate({ deliveryLocation: e.target.value })}
          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Delivery address or location..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          Warranties
        </label>
        <textarea
          value={formData.warranties || ''}
          onChange={(e) => onUpdate({ warranties: e.target.value })}
          rows={3}
          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Warranty terms and conditions..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1">
          Additional Notes
        </label>
        <textarea
          value={formData.additionalNotes || ''}
          onChange={(e) => onUpdate({ additionalNotes: e.target.value })}
          rows={4}
          className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Any additional information or terms..."
        />
      </div>
    </div>
  );
};
