import React, { useState } from 'react';
import { X, Plus, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';

interface RFQInvitation {
  id: string;
  rfqNumber: string;
  title: string;
  description: string;
  dueDate: string;
  status: 'pending' | 'submitted' | 'awarded' | 'rejected';
  projectName: string;
  estimatedValue: number;
  urgency: 'low' | 'medium' | 'high';
  items?: RFQItem[];
}

interface RFQItem {
  id: string;
  itemCode: string;
  itemName: string;
  description: string;
  quantity: number;
  unit: string;
  specifications?: string;
}

interface QuoteLineItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  deliveryTime: number; // in days
  notes?: string;
}

interface QuoteSubmission {
  rfqId: string;
  supplierId: string;
  totalAmount: number;
  currency: string;
  validityPeriod: number; // in days
  paymentTerms: string;
  deliveryTerms: string;
  deliveryLocation: string;
  estimatedDeliveryDate: string;
  lineItems: QuoteLineItem[];
  additionalNotes?: string;
  attachments?: File[];
  warranties?: string;
  certifications?: string[];
}

interface QuoteSubmissionModalProps {
  rfq: RFQInvitation | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (quote: QuoteSubmission) => Promise<void>;
}

const QuoteSubmissionModal: React.FC<QuoteSubmissionModalProps> = ({
  rfq,
  isOpen,
  onClose,
  onSubmit
}) => {
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<QuoteSubmission>>({
    currency: 'ZAR',
    validityPeriod: 30,
    paymentTerms: '30 days net',
    deliveryTerms: 'Ex Works',
    lineItems: []
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize line items from RFQ items
  React.useEffect(() => {
    if (rfq?.items && formData.lineItems?.length === 0) {
      const initialLineItems: QuoteLineItem[] = rfq.items.map(item => ({
        itemId: item.id,
        itemCode: item.itemCode,
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: 0,
        totalPrice: 0,
        deliveryTime: 7,
        notes: ''
      }));
      setFormData(prev => ({ ...prev, lineItems: initialLineItems }));
    }
  }, [rfq, formData.lineItems?.length]);

  const updateLineItem = (index: number, field: keyof QuoteLineItem, value: any) => {
    const newLineItems = [...(formData.lineItems || [])];
    newLineItems[index] = { ...newLineItems[index], [field]: value };
    
    // Calculate total price for the line item
    if (field === 'unitPrice' || field === 'quantity') {
      newLineItems[index].totalPrice = newLineItems[index].unitPrice * newLineItems[index].quantity;
    }

    setFormData(prev => ({ ...prev, lineItems: newLineItems }));
    
    // Calculate total amount
    const totalAmount = newLineItems.reduce((sum, item) => sum + item.totalPrice, 0);
    setFormData(prev => ({ ...prev, totalAmount }));
  };

  const addLineItem = () => {
    const newItem: QuoteLineItem = {
      itemId: `custom-${Date.now()}`,
      itemCode: '',
      itemName: '',
      quantity: 1,
      unit: 'each',
      unitPrice: 0,
      totalPrice: 0,
      deliveryTime: 7
    };
    setFormData(prev => ({
      ...prev,
      lineItems: [...(prev.lineItems || []), newItem]
    }));
  };

  const removeLineItem = (index: number) => {
    const newLineItems = (formData.lineItems || []).filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, lineItems: newLineItems }));
    
    // Recalculate total
    const totalAmount = newLineItems.reduce((sum, item) => sum + item.totalPrice, 0);
    setFormData(prev => ({ ...prev, totalAmount }));
  };

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (step === 1) {
      // Validate line items
      if (!formData.lineItems || formData.lineItems.length === 0) {
        newErrors.lineItems = 'At least one line item is required';
      } else {
        formData.lineItems.forEach((item, index) => {
          if (!item.unitPrice || item.unitPrice <= 0) {
            newErrors[`unitPrice_${index}`] = 'Unit price is required';
          }
          if (!item.deliveryTime || item.deliveryTime <= 0) {
            newErrors[`deliveryTime_${index}`] = 'Delivery time is required';
          }
        });
      }
    }
    
    if (step === 2) {
      // Validate quote details
      if (!formData.validityPeriod || formData.validityPeriod <= 0) {
        newErrors.validityPeriod = 'Validity period is required';
      }
      if (!formData.paymentTerms) {
        newErrors.paymentTerms = 'Payment terms are required';
      }
      if (!formData.deliveryTerms) {
        newErrors.deliveryTerms = 'Delivery terms are required';
      }
      if (!formData.estimatedDeliveryDate) {
        newErrors.estimatedDeliveryDate = 'Estimated delivery date is required';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep) || !rfq) return;
    
    setLoading(true);
    try {
      const quoteSubmission: QuoteSubmission = {
        ...formData,
        rfqId: rfq.id,
        supplierId: 'current-supplier-id', // Would come from session
      } as QuoteSubmission;
      
      await onSubmit(quoteSubmission);
      onClose();
    } catch (error) {
      log.error('Failed to submit quote:', { data: error }, 'QuoteSubmissionModal');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !rfq) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Submit Quote - {rfq.rfqNumber}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">{rfq.title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:bg-gray-800 rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-4">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    step <= currentStep
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {step}
                </div>
                <span
                  className={`ml-2 text-sm ${
                    step <= currentStep ? 'text-blue-600' : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {step === 1 && 'Line Items'}
                  {step === 2 && 'Quote Details'}
                  {step === 3 && 'Review & Submit'}
                </span>
                {step < 3 && <div className="w-8 h-0.5 bg-gray-200 dark:bg-gray-700 ml-4" />}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Quote Line Items</h3>
                <VelocityButton onClick={addLineItem} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </VelocityButton>
              </div>

              {errors.lineItems && (
                <div className="flex items-center space-x-2 text-red-600 text-sm">
                  <AlertCircle className="h-4 w-4" />
                  <span>{errors.lineItems}</span>
                </div>
              )}

              <div className="space-y-4">
                {(formData.lineItems || []).map((item, index) => (
                  <GlassCard key={`${item.itemId}-${index}`}>
                    <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Item Code
                        </label>
                        <input
                          type="text"
                          value={item.itemCode}
                          onChange={(e) => updateLineItem(index, 'itemCode', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          readOnly={!!rfq.items}
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Item Name
                        </label>
                        <input
                          type="text"
                          value={item.itemName}
                          onChange={(e) => updateLineItem(index, 'itemName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          readOnly={!!rfq.items}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Quantity
                        </label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(index, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          readOnly={!!rfq.items}
                        />
                      </div>
                      <div className="flex items-end">
                        {!rfq.items && (
                          <button
                            onClick={() => removeLineItem(index)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Unit Price (ZAR)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateLineItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            errors[`unitPrice_${index}`] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                          }`}
                        />
                        {errors[`unitPrice_${index}`] && (
                          <p className="text-red-600 text-xs mt-1">{errors[`unitPrice_${index}`]}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Total Price
                        </label>
                        <input
                          type="text"
                          value={`R${item.totalPrice.toLocaleString()}`}
                          readOnly
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Delivery Time (days)
                        </label>
                        <input
                          type="number"
                          value={item.deliveryTime}
                          onChange={(e) => updateLineItem(index, 'deliveryTime', parseInt(e.target.value) || 0)}
                          className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                            errors[`deliveryTime_${index}`] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                          }`}
                        />
                        {errors[`deliveryTime_${index}`] && (
                          <p className="text-red-600 text-xs mt-1">{errors[`deliveryTime_${index}`]}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Unit
                        </label>
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateLineItem(index, 'unit', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          readOnly={!!rfq.items}
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Notes
                      </label>
                      <textarea
                        value={item.notes || ''}
                        onChange={(e) => updateLineItem(index, 'notes', e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Optional notes for this item..."
                      />
                    </div>
                  </GlassCard>
                ))}
              </div>

              {/* Quote Total */}
              <GlassCard className="bg-blue-50 border-blue-200">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">Quote Total:</span>
                  <span className="text-2xl font-bold text-blue-600">
                    R{(formData.totalAmount || 0).toLocaleString()}
                  </span>
                </div>
              </GlassCard>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Quote Details</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Validity Period (days)
                  </label>
                  <input
                    type="number"
                    value={formData.validityPeriod}
                    onChange={(e) => setFormData(prev => ({ ...prev, validityPeriod: parseInt(e.target.value) || 30 }))}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      errors.validityPeriod ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {errors.validityPeriod && (
                    <p className="text-red-600 text-xs mt-1">{errors.validityPeriod}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Payment Terms
                  </label>
                  <select
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData(prev => ({ ...prev, paymentTerms: e.target.value }))}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      errors.paymentTerms ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Delivery Terms
                  </label>
                  <select
                    value={formData.deliveryTerms}
                    onChange={(e) => setFormData(prev => ({ ...prev, deliveryTerms: e.target.value }))}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      errors.deliveryTerms ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Estimated Delivery Date
                  </label>
                  <input
                    type="date"
                    value={formData.estimatedDeliveryDate}
                    onChange={(e) => setFormData(prev => ({ ...prev, estimatedDeliveryDate: e.target.value }))}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      errors.estimatedDeliveryDate ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {errors.estimatedDeliveryDate && (
                    <p className="text-red-600 text-xs mt-1">{errors.estimatedDeliveryDate}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Delivery Location
                </label>
                <input
                  type="text"
                  value={formData.deliveryLocation || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, deliveryLocation: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Delivery address or location..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Warranties
                </label>
                <textarea
                  value={formData.warranties || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, warranties: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Warranty terms and conditions..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Additional Notes
                </label>
                <textarea
                  value={formData.additionalNotes || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, additionalNotes: e.target.value }))}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Any additional information or terms..."
                />
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Review & Submit</h3>

              {/* Quote Summary */}
              <GlassCard>
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Quote Summary</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Total Amount:</span>
                    <p className="font-semibold text-lg">R{(formData.totalAmount || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Valid Until:</span>
                    <p className="font-medium">
                      {formData.validityPeriod} days from submission
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Payment Terms:</span>
                    <p className="font-medium">{formData.paymentTerms}</p>
                  </div>
                  <div>
                    <span className="text-gray-600 dark:text-gray-400">Delivery:</span>
                    <p className="font-medium">{formData.estimatedDeliveryDate}</p>
                  </div>
                </div>
              </GlassCard>

              {/* Line Items Summary */}
              <GlassCard>
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Line Items ({(formData.lineItems || []).length})</h4>
                <div className="space-y-3">
                  {(formData.lineItems || []).map((item, index) => (
                    <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                      <div>
                        <p className="font-medium">{item.itemName} ({item.itemCode})</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {item.quantity} {item.unit} @ R{item.unitPrice.toLocaleString()} each
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">R{item.totalPrice.toLocaleString()}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{item.deliveryTime} days</p>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>

              {/* Confirmation */}
              <div className="flex items-center space-x-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <CheckCircle className="h-5 w-5 text-blue-600" />
                <span className="text-sm text-blue-800">
                  By submitting this quote, you confirm that all information is accurate and you agree to the terms specified.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <div>
            {currentStep > 1 && (
              <VelocityButton
                variant="outline"
                onClick={() => setCurrentStep(currentStep - 1)}
              >
                Back
              </VelocityButton>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <VelocityButton variant="outline" onClick={onClose}>
              Cancel
            </VelocityButton>
            {currentStep < 3 ? (
              <VelocityButton onClick={handleNext}>
                Next
              </VelocityButton>
            ) : (
              <VelocityButton
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Submitting...
                  </>
                ) : (
                  'Submit Quote'
                )}
              </VelocityButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuoteSubmissionModal;