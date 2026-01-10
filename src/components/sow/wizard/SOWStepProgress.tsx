/**
 * SOW Upload Wizard Step Progress Component
 */

import { CheckCircle, ArrowRight } from 'lucide-react';
import { SOWUploadStep } from './SOWWizardTypes';

interface SOWStepProgressProps {
  steps: SOWUploadStep[];
  currentStep: number;
}

export function SOWStepProgress({ steps, currentStep }: SOWStepProgressProps) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
              step.completed
                ? 'bg-green-500 text-white'
                : index === currentStep
                  ? 'bg-blue-500 text-white'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
            }`}>
              {step.completed ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <span className="text-sm">{index + 1}</span>
              )}
            </div>
            <span className={`ml-2 text-sm ${
              step.completed ? 'text-green-600' : index === currentStep ? 'text-blue-600' : 'text-[var(--ff-text-secondary)]'
            }`}>
              {step.title}
            </span>
            {index < steps.length - 1 && (
              <ArrowRight className="w-4 h-4 text-[var(--ff-text-tertiary)] ml-4 mr-4" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}