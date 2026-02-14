// ============= PO Create Modal Component =============

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { VelocityButton } from '../../../../../components/ui';
import { poService } from '../../../../../services/procurement/poService';
import { ProgressStepper } from './ProgressStepper';
import { BasicInfoStep } from './BasicInfoStep';
import { LineItemsStep } from './LineItemsStep';
import { ReviewStep } from './ReviewStep';
import { usePOForm } from './usePOForm';
import type { POCreateModalProps } from './types';

export const POCreateModal: React.FC<POCreateModalProps> = ({
  onClose,
  onCreated,
  rfqId,
  quoteId,
  projectId
}) => {
  const [step, setStep] = useState(1);

  const {
    formData,
    loading,
    error,
    totals,
    setLoading,
    setError,
    updateFormData,
    addItem,
    updateItem,
    removeItem,
    validateForm,
    prepareSubmission
  } = usePOForm({ rfqId, quoteId, projectId });

  const handleSubmit = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const createRequest = prepareSubmission();
      await poService.createPO(createRequest);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-2xl w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Create Purchase Order</h2>
            <div className="mt-2">
              <ProgressStepper currentStep={step} totalSteps={3} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-muted-foreground p-2"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {step === 1 && (
            <BasicInfoStep
              formData={formData}
              updateFormData={updateFormData}
            />
          )}

          {step === 2 && (
            <LineItemsStep
              formData={formData}
              totals={totals}
              addItem={addItem}
              updateItem={updateItem}
              removeItem={removeItem}
            />
          )}

          {step === 3 && (
            <ReviewStep
              formData={formData}
              totals={totals}
              updateFormData={updateFormData}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-background">
          <div>
            {step > 1 && (
              <VelocityButton
                variant="outline"
                onClick={() => setStep(step - 1)}
                disabled={loading}
              >
                Previous
              </VelocityButton>
            )}
          </div>

          <div className="flex space-x-3">
            <VelocityButton
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </VelocityButton>

            {step < 3 ? (
              <VelocityButton
                onClick={() => setStep(step + 1)}
                disabled={loading}
              >
                Next
              </VelocityButton>
            ) : (
              <VelocityButton
                onClick={handleSubmit}
                loading={loading}
                disabled={loading}
              >
                Create Purchase Order
              </VelocityButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
