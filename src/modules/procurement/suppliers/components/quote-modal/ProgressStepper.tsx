import React from 'react';

interface ProgressStepperProps {
  currentStep: number;
  totalSteps: number;
}

const stepLabels = ['Line Items', 'Quote Details', 'Review & Submit'];

export const ProgressStepper: React.FC<ProgressStepperProps> = ({ currentStep, totalSteps }) => {
  return (
    <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center space-x-4">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((step) => (
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
              {stepLabels[step - 1]}
            </span>
            {step < totalSteps && <div className="w-8 h-0.5 bg-gray-200 dark:bg-gray-700 ml-4" />}
          </div>
        ))}
      </div>
    </div>
  );
};
