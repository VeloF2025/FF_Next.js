import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { wizardSteps } from './constants';

interface WizardNavigationProps {
  currentStep: number;
  onPrevious: () => void;
  onNext: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  isLastStep: boolean;
}

export function WizardNavigation({
  currentStep,
  onPrevious,
  onNext,
  onSubmit,
  isSubmitting,
  isLastStep
}: WizardNavigationProps) {
  return (
    <div className="flex justify-between items-center pt-6 border-t border-[var(--ff-border-light)]">
      <button
        type="button"
        onClick={onPrevious}
        disabled={currentStep === 0}
        className="flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-md hover:bg-[var(--ff-bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ArrowLeft size={16} className="mr-2" />
        Previous
      </button>

      <div className="text-sm text-[var(--ff-text-secondary)]">
        Step {currentStep + 1} of {wizardSteps.length}
      </div>

      {isLastStep ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting}
          className="flex items-center px-6 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="mr-2 animate-spin" />
              Creating Project...
            </>
          ) : (
            'Create Project'
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={onNext}
          className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
        >
          Next
          <ArrowRight size={16} className="ml-2" />
        </button>
      )}
    </div>
  );
}