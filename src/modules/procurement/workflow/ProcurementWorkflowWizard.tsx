// WORKING: Procurement Workflow Wizard — 10-step orchestrator with DB thread tracking
import { useEffect } from 'react';
import { WizardStepIndicator } from './WizardStepIndicator';
import { useWorkflowState, type WorkflowState } from './useWorkflowState';
import { Step1Requirements } from './steps/Step1Requirements';
import { Step2Strategy } from './steps/Step2Strategy';
import { Step3Submit } from './steps/Step3Submit';
import { Step4Approval } from './steps/Step4Approval';
import { Step5Order } from './steps/Step5Order';
import { Step6QuoteAward } from './steps/Step6QuoteAward';
import { Step7CreatePO } from './steps/Step7CreatePO';
import { Step6Receive } from './steps/Step6Receive';
import { Step7PaymentRequest } from './steps/Step7PaymentRequest';
import { Step9Complete } from './steps/Step9Complete';
import { log } from '@/lib/logger';

/** Create a new procurement thread via API. */
async function createThread(state: WorkflowState, user: string): Promise<{ id: string; threadNumber: string } | null> {
  try {
    const res = await fetch('/api/procurement/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        projectId: state.projectId ?? null,
        title: state.projectName ? `${state.projectName} — Requisition` : 'New Procurement',
        requisitionId: state.requisitionId ?? null,
        strategy: state.strategy ?? null,
        estimatedTotal: state.estimatedTotal ?? null,
        createdBy: user,
      }),
    });
    const data = await res.json();
    if (data.success && data.data) {
      const d = data.data;
      return { id: d.id ?? d.ID, threadNumber: d.thread_number ?? d.threadNumber };
    }
    log.warn('Thread create returned non-success', { data }, 'ProcurementWizard');
    return null;
  } catch (err) {
    log.error('Failed to create procurement thread', { error: err }, 'ProcurementWizard');
    return null;
  }
}

/** Update an existing procurement thread via API. */
async function updateThread(threadId: string, update: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`/api/procurement/threads/${threadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(update),
    });
  } catch (err) {
    log.error('Failed to update procurement thread', { error: err, threadId }, 'ProcurementWizard');
  }
}

/** Load an existing thread from API and hydrate into WorkflowState fields. */
async function loadThread(threadId: string): Promise<Partial<WorkflowState> | null> {
  try {
    const res = await fetch(`/api/procurement/threads/${threadId}`, { credentials: 'include' });
    const data = await res.json();
    if (!data.success || !data.data) return null;
    const t = data.data;
    return {
      threadId: t.id,
      threadNumber: t.threadNumber,
      currentStep: Number(t.currentStep) as WorkflowState['currentStep'],
      projectId: t.projectId ?? undefined,
      projectName: t.projectName ?? undefined,
      requisitionId: t.requisitionId ?? undefined,
      requisitionNumber: t.requisitionNumber ?? undefined,
      strategy: t.strategy ?? undefined,
      rfqId: t.rfqId ?? undefined,
      poId: t.poId ?? undefined,
      poNumber: t.poNumber ?? undefined,
      grnId: t.grnId ?? undefined,
      estimatedTotal: t.estimatedTotal ?? undefined,
    };
  } catch (err) {
    log.error('Failed to load procurement thread', { error: err, threadId }, 'ProcurementWizard');
    return null;
  }
}

export function ProcurementWorkflowWizard() {
  const { state, setState, resetState, goToStep } = useWorkflowState();

  // If we have a threadId but no threadNumber, load the thread from DB
  useEffect(() => {
    if (state.threadId && !state.threadNumber) {
      loadThread(state.threadId).then((loaded) => {
        if (loaded) {
          setState(loaded);
        }
      });
    }
  }, [state.threadId, state.threadNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const completedSteps = new Set<number>();
  for (let i = 1; i < state.currentStep; i++) {
    completedSteps.add(i);
  }

  const handleComplete = async (update: Partial<WorkflowState>) => {
    const nextStep = (state.currentStep + 1) as WorkflowState['currentStep'];
    const merged = { ...state, ...update, currentStep: nextStep };

    // Thread sync: create on first step completion, update on subsequent steps
    if (!state.threadId && state.currentStep === 1) {
      const thread = await createThread(merged, merged.projectName ?? 'system');
      if (thread) {
        setState({ ...update, currentStep: nextStep, threadId: thread.id, threadNumber: thread.threadNumber });
        return;
      }
    } else if (state.threadId) {
      const threadUpdate: Record<string, unknown> = { currentStep: nextStep };
      if (update.strategy) threadUpdate.strategy = update.strategy;
      if (update.requisitionId) threadUpdate.requisitionId = update.requisitionId;
      if (update.rfqId) threadUpdate.rfqId = update.rfqId;
      if (update.poId) threadUpdate.poId = update.poId;
      if (update.grnId) threadUpdate.grnId = update.grnId;
      if (update.estimatedTotal) threadUpdate.estimatedTotal = update.estimatedTotal;
      if (update.paymentApprovalRequestId) threadUpdate.paymentApprovalId = update.paymentApprovalRequestId;
      if (update.awardedQuoteAmount) threadUpdate.poTotal = update.awardedQuoteAmount;
      if (nextStep === 10) threadUpdate.status = 'completed';

      updateThread(state.threadId, threadUpdate);
    }

    setState({ ...update, currentStep: nextStep });
  };

  const handleBack = () => {
    if (state.currentStep > 1) {
      goToStep((state.currentStep - 1) as WorkflowState['currentStep']);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Thread number badge */}
      {state.threadNumber && (
        <div className="mb-4 flex items-center gap-2">
          <span className="px-3 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-sm font-medium">
            {state.threadNumber}
          </span>
          {state.projectName && (
            <span className="text-sm text-[var(--ff-text-secondary)]">{state.projectName}</span>
          )}
        </div>
      )}

      {/* Step Indicator — hidden on completion */}
      {state.currentStep < 10 && (
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
          <Step6QuoteAward state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 7 && (
          <Step7CreatePO state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 8 && (
          <Step6Receive state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 9 && (
          <Step7PaymentRequest state={state} onComplete={handleComplete} onBack={handleBack} />
        )}
        {state.currentStep === 10 && (
          <Step9Complete state={state} onReset={resetState} />
        )}
      </div>
    </div>
  );
}
