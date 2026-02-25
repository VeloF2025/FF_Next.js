// WORKING: Procurement Workflow Wizard — 9-step orchestrator
import { WizardStepIndicator } from './WizardStepIndicator';
import { useWorkflowState, type WorkflowState } from './useWorkflowState';
import { Step1Requirements } from './steps/Step1Requirements';
import { Step2Strategy } from './steps/Step2Strategy';
import { Step3Submit } from './steps/Step3Submit';
import { Step4Approval } from './steps/Step4Approval';
import { Step5Order } from './steps/Step5Order';
import { Step6Receive } from './steps/Step6Receive';
import { Step7PaymentRequest } from './steps/Step7PaymentRequest';
import { Step8PaymentApproval } from './steps/Step8PaymentApproval';
import { Step9Complete } from './steps/Step9Complete';

export function ProcurementWorkflowWizard() {
  const { state, setState, resetState, goToStep } = useWorkflowState();

  const completedSteps = new Set<number>();
  for (let i = 1; i < state.currentStep; i++) {
    completedSteps.add(i);
  }

  const handleComplete = (update: Partial<WorkflowState>) => {
    const nextStep = (state.currentStep + 1) as WorkflowState['currentStep'];
    setState({ ...update, currentStep: nextStep });
  };

  const handleBack = () => {
    if (state.currentStep > 1) {
      goToStep((state.currentStep - 1) as WorkflowState['currentStep']);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Step Indicator — hidden on completion */}
      {state.currentStep < 9 && (
        <div className="mb-8">
          <WizardStepIndicator
            currentStep={state.currentStep}
            completedSteps={completedSteps}
          />
        </div>
      )}

      {/* Step Content */}
      <div className="min-h-96">
        {state.currentStep === 1 && (
          <Step1Requirements state={state} onComplete={handleComplete} />
        )}
        {state.currentStep === 2 && (
          <Step2Strategy state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 3 && (
          <Step3Submit state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 4 && (
          <Step4Approval state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 5 && (
          <Step5Order state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 6 && (
          <Step6Receive state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 7 && (
          <Step7PaymentRequest state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 8 && (
          <Step8PaymentApproval state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 9 && (
          <Step9Complete state={state} onReset={resetState} />
        )}
      </div>
    </div>
  );
}
