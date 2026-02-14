import React, { useState } from 'react';
import { X } from 'lucide-react';
import { VelocityButton } from '@/components/ui/VelocityButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import { ProgressStepper } from './ProgressStepper';
import { LineItemsStep } from './LineItemsStep';
import { QuoteDetailsStep } from './QuoteDetailsStep';
import { ReviewStep } from './ReviewStep';
import { useQuoteForm } from './useQuoteForm';
import type { RFQInvitation, QuoteSubmission } from './types';

interface QuoteSubmissionModalProps {
  rfq: RFQInvitation | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (quote: QuoteSubmission) => Promise<void>;
}

export const QuoteSubmissionModal: React.FC<QuoteSubmissionModalProps> = ({
  rfq,
  isOpen,
  onClose,
  onSubmit
}) => {
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  const {
    formData,
    errors,
    updateLineItem,
    addLineItem,
    removeLineItem,
    validateStep,
    updateFormData
  } = useQuoteForm(rfq);

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep(currentStep - 1);
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              Submit Quote - {rfq.rfqNumber}
            </h2>
            <p className="text-sm text-muted-foreground">{rfq.title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <ProgressStepper currentStep={currentStep} totalSteps={3} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentStep === 1 && (
            <LineItemsStep
              lineItems={formData.lineItems || []}
              errors={errors}
              rfq={rfq}
              totalAmount={formData.totalAmount || 0}
              onUpdateItem={updateLineItem}
              onAddItem={addLineItem}
              onRemoveItem={removeLineItem}
            />
          )}
          {currentStep === 2 && (
            <QuoteDetailsStep
              formData={formData}
              errors={errors}
              onUpdate={updateFormData}
            />
          )}
          {currentStep === 3 && (
            <ReviewStep formData={formData} />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-border">
          <div>
            {currentStep > 1 && (
              <VelocityButton variant="outline" onClick={handleBack}>
                Back
              </VelocityButton>
            )}
          </div>
          <div className="flex space-x-3">
            <VelocityButton variant="outline" onClick={onClose}>
              Cancel
            </VelocityButton>
            {currentStep < 3 ? (
              <VelocityButton onClick={handleNext}>
                Next
              </VelocityButton>
            ) : (
              <VelocityButton onClick={handleSubmit} disabled={loading}>
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
