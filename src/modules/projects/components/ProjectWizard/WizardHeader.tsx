import { wizardSteps } from './constants';
import { cn } from '@/utils/cn';

interface WizardHeaderProps {
  currentStep: number;
}

export function WizardHeader({ currentStep }: WizardHeaderProps) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] mb-6">Create New Project</h1>

      {/* Progress Indicator */}
      <div className="flex items-center justify-between mb-6">
        {wizardSteps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          const Icon = step.icon;

          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center mb-2",
                  isActive ? "bg-blue-600 text-white" :
                  isCompleted ? "bg-green-600 text-white" :
                  "bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"
                )}>
                  <Icon size={20} />
                </div>
                <div className="text-center">
                  <p className={cn(
                    "text-sm font-medium",
                    isActive ? "text-blue-600" :
                    isCompleted ? "text-green-600" :
                    "text-[var(--ff-text-secondary)]"
                  )}>
                    {step.title}
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)] hidden sm:block">
                    {step.description}
                  </p>
                </div>
              </div>

              {/* Connector Line */}
              {index < wizardSteps.length - 1 && (
                <div className={cn(
                  "flex-1 h-px mx-4 mt-5",
                  isCompleted ? "bg-green-600" : "bg-[var(--ff-border-light)]"
                )} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}