// ============= Progress Stepper Component =============

import React from 'react';

interface ProgressStepperProps {
  currentStep: number;
  totalSteps: number;
}

export const ProgressStepper: React.FC<ProgressStepperProps> = ({
  currentStep,
  totalSteps
}) => {
  return (
    <div className="flex items-center space-x-2">
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((stepNum) => (
        <div key={stepNum} className="flex items-center">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            currentStep >= stepNum
              ? 'bg-blue-600 text-white'
              : 'bg-secondary text-muted-foreground'
          }`}>
            {stepNum}
          </div>
          {stepNum < totalSteps && (
            <div className={`w-12 h-0.5 ml-2 ${
              currentStep > stepNum ? 'bg-blue-600' : 'bg-secondary'
            }`} />
          )}
        </div>
      ))}
    </div>
  );
};
