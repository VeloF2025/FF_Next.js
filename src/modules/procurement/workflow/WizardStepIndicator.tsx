/**
 * WizardStepIndicator — 10-step visual progress bar for the Procurement Workflow Wizard.
 * Pattern based on SOWStepProgress. Responsive: shows labels on nearby steps only;
 * collapses to circles on very narrow viewports.
 */

import { CheckCircle } from 'lucide-react';

// 🟢 WORKING: static metadata for each wizard step
const STEPS: { id: number; label: string }[] = [
  { id: 1, label: 'Requirements' },
  { id: 2, label: 'Strategy' },
  { id: 3, label: 'Submit' },
  { id: 4, label: 'Approval' },
  { id: 5, label: 'Sourcing' },
  { id: 6, label: 'Quote & Award' },
  { id: 7, label: 'Create PO' },
  { id: 8, label: 'Receive Goods' },
  { id: 9, label: 'Payment' },
  { id: 10, label: 'Complete' },
];

export interface WizardStepIndicatorProps {
  currentStep: number;
  completedSteps: Set<number>;
}

/**
 * Returns whether a step's label should be shown.
 * Shows the label for completed, current, and the immediate next step.
 */
function shouldShowLabel(stepId: number, currentStep: number, completedSteps: Set<number>): boolean {
  return completedSteps.has(stepId) || stepId === currentStep || stepId === currentStep + 1;
}

/** Step circle — filled green for completed, blue for current, muted for future. */
function StepCircle({
  stepId,
  isCompleted,
  isCurrent,
}: {
  stepId: number;
  isCompleted: boolean;
  isCurrent: boolean;
}) {
  const baseClasses =
    'flex items-center justify-center w-8 h-8 rounded-full flex-shrink-0 transition-colors duration-200';

  if (isCompleted) {
    return (
      <div className={`${baseClasses} bg-green-500 text-white`} aria-label={`Step ${stepId} completed`}>
        <CheckCircle className="w-5 h-5" aria-hidden="true" />
      </div>
    );
  }

  if (isCurrent) {
    return (
      <div
        className={`${baseClasses} bg-blue-500 text-white ring-2 ring-blue-400 ring-offset-2 ring-offset-[var(--ff-bg-primary)]`}
        aria-current="step"
        aria-label={`Step ${stepId} current`}
      >
        <span className="text-sm font-semibold">{stepId}</span>
      </div>
    );
  }

  return (
    <div
      className={`${baseClasses} bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]`}
      aria-label={`Step ${stepId} upcoming`}
    >
      <span className="text-sm">{stepId}</span>
    </div>
  );
}

/** Connector line between two step circles. Green when the left step is completed. */
function Connector({ leftStepCompleted }: { leftStepCompleted: boolean }) {
  return (
    <div
      className={`flex-1 h-0.5 mx-1 transition-colors duration-200 ${
        leftStepCompleted ? 'bg-green-500' : 'bg-[var(--ff-border-light)]'
      }`}
      aria-hidden="true"
    />
  );
}

/**
 * WizardStepIndicator renders a horizontal 10-step progress indicator.
 * Labels are shown only for completed, current, and the next upcoming step
 * to conserve horizontal space. On mobile the labels are hidden entirely
 * via `hidden sm:block`.
 */
export function WizardStepIndicator({ currentStep, completedSteps }: WizardStepIndicatorProps) {
  return (
    <nav
      aria-label="Procurement workflow steps"
      className="w-full px-2 py-4 bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)]"
    >
      {/* Step circles + connectors row */}
      <div className="flex items-center">
        {STEPS.map((step, index) => {
          const isCompleted = completedSteps.has(step.id);
          const isCurrent = step.id === currentStep;

          return (
            <div key={step.id} className="flex items-center" style={{ flex: index < STEPS.length - 1 ? '1' : 'none' }}>
              {/* Circle + label column */}
              <div className="flex flex-col items-center gap-1">
                <StepCircle stepId={step.id} isCompleted={isCompleted} isCurrent={isCurrent} />

                {/* Label — hidden on mobile, shown on sm+ only for relevant steps */}
                <span
                  className={[
                    'hidden sm:block text-xs text-center whitespace-nowrap max-w-[64px] leading-tight transition-colors duration-200',
                    isCompleted
                      ? 'text-green-500 font-medium'
                      : isCurrent
                      ? 'text-blue-400 font-semibold'
                      : shouldShowLabel(step.id, currentStep, completedSteps)
                      ? 'text-[var(--ff-text-secondary)]'
                      : 'text-transparent select-none',
                  ].join(' ')}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector to next step */}
              {index < STEPS.length - 1 && (
                <Connector leftStepCompleted={isCompleted} />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: show current step label only */}
      <p className="sm:hidden mt-2 text-center text-sm text-[var(--ff-text-secondary)]">
        <span className="font-semibold text-blue-400">
          Step {currentStep}:{' '}
        </span>
        {STEPS[currentStep - 1]?.label ?? ''}
      </p>
    </nav>
  );
}
