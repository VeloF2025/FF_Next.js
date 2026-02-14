import React from 'react';

interface ProgressStepperProps {
  currentStep: number;
  totalSteps: number;
}

const stepLabels = ['Line Items', 'Quote Details', 'Review & Submit'];

export const ProgressStepper: React.FC<ProgressStepperProps> = ({ currentStep, totalSteps }) => {
  return (
    <div className="px-6 py-4 border-b border-border">
      <div className="flex items-center space-x-4">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
          <div key={step} className="flex items-center">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full ${
                step <= currentStep
                  ? 'bg-blue-600 text-white'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {step}
            </div>
            <span
              className={`ml-2 text-sm ${
                step <= currentStep ? 'text-blue-600' : 'text-muted-foreground'
              }`}
            >
              {stepLabels[step - 1]}
            </span>
            {step < totalSteps && <div className="w-8 h-0.5 bg-secondary ml-4" />}
          </div>
        ))}
      </div>
    </div>
  );
};
