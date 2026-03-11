/**
 * useWorkflowState — Procurement Workflow Wizard state hook
 * Persists state to localStorage and syncs the `step` URL param.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { log } from '@/lib/logger';

// 🟢 WORKING: full type coverage
export interface WorkflowState {
  currentStep: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  strategy?: 'rfq' | 'direct_po';
  /** Pipeline thread (DB-backed tracking) */
  threadId?: string;
  threadNumber?: string;
  /** Step 1 */
  requisitionId?: string;
  requisitionNumber?: string;
  estimatedTotal?: number;
  projectId?: string;
  projectName?: string;
  /** Step 4 */
  approvalStatus?: 'auto_approved' | 'pending' | 'approved' | 'rejected';
  approvalRequestId?: string;
  /** Step 5 — Sourcing */
  rfqId?: string;
  rfqNumber?: string;
  /** Step 6 — Quote & Award */
  selectedSupplierId?: string;
  selectedSupplierName?: string;
  awardedQuoteAmount?: number;
  /** Step 7 — Create PO */
  poId?: string;
  poNumber?: string;
  /** Step 8 — Receive Goods */
  grnId?: string;
  grnStatus?: 'pending' | 'created' | 'confirmed';
  /** Steps 9–10 */
  paymentApprovalRequestId?: string;
  invoiceAmount?: number;
  invoiceDueDate?: string;
  paymentApprovalStatus?: 'pending' | 'approved' | 'rejected';
}

const STORAGE_KEY = 'procurement_workflow_state';

const STEP_MIN = 1;
const STEP_MAX = 10;

type StepNumber = WorkflowState['currentStep'];

/** Parse a raw step value from a URL query param to a valid StepNumber, or return undefined. */
function parseStep(raw: string | string[] | undefined): StepNumber | undefined {
  if (!raw) return undefined;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(n) || n < STEP_MIN || n > STEP_MAX) return undefined;
  return n as StepNumber;
}

/** Load persisted state from localStorage; returns null on any parse failure. */
function loadPersistedState(): WorkflowState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkflowState;
  } catch (err) {
    log.warn('Failed to parse persisted workflow state — resetting', { err }, 'useWorkflowState');
    return null;
  }
}

/** Persist state to localStorage. */
function persistState(state: WorkflowState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    log.warn('Failed to persist workflow state', { err }, 'useWorkflowState');
  }
}

const DEFAULT_STATE: WorkflowState = { currentStep: 1 };

/** Build the initial state by merging persisted state and URL params. URL params win for step. */
function buildInitialState(
  persisted: WorkflowState | null,
  urlStep: StepNumber | undefined,
  urlReqId: string | undefined,
  urlApprovalId: string | undefined,
  urlThreadId: string | undefined,
  isNewPipeline: boolean,
): WorkflowState {
  // Explicit "new pipeline" — ignore persisted state entirely
  if (isNewPipeline) {
    return { ...DEFAULT_STATE };
  }

  const base: WorkflowState = persisted ?? { ...DEFAULT_STATE };

  // If a threadId is provided via URL and differs from persisted, load the thread from DB
  if (urlThreadId && urlThreadId !== base.threadId) {
    return {
      ...DEFAULT_STATE,
      threadId: urlThreadId,
      currentStep: urlStep ?? 1,
    };
  }

  return {
    ...base,
    currentStep: urlStep ?? base.currentStep,
    requisitionId: urlReqId ?? base.requisitionId,
    approvalRequestId: urlApprovalId ?? base.approvalRequestId,
  };
}

export interface UseWorkflowStateReturn {
  state: WorkflowState;
  /** Merge a partial update into state and persist. */
  setState: (update: Partial<WorkflowState>) => void;
  /** Wipe all state and go back to step 1. */
  resetState: () => void;
  /** Navigate to a specific step number. */
  goToStep: (step: StepNumber) => void;
}

/**
 * useWorkflowState manages the multi-step procurement workflow wizard.
 *
 * - Reads initial values from URL query params: `step`, `reqId`, `approvalId`.
 * - Persists to `localStorage` under key `procurement_workflow_state`.
 * - Shallow-replaces the URL `step` param whenever `currentStep` changes.
 */
export function useWorkflowState(): UseWorkflowStateReturn {
  const router = useRouter();

  const [state, setRawState] = useState<WorkflowState>(() => {
    const urlStep = parseStep(router.query.step);
    const urlReqId = router.query.reqId
      ? String(Array.isArray(router.query.reqId) ? router.query.reqId[0] : router.query.reqId)
      : undefined;
    const urlApprovalId = router.query.approvalId
      ? String(Array.isArray(router.query.approvalId) ? router.query.approvalId[0] : router.query.approvalId)
      : undefined;
    const urlThreadId = router.query.threadId
      ? String(Array.isArray(router.query.threadId) ? router.query.threadId[0] : router.query.threadId)
      : undefined;
    // "New Pipeline" = /procurement/workflow with no threadId, reqId, or approvalId
    const isNew = router.query.new === '1';

    return buildInitialState(loadPersistedState(), urlStep, urlReqId, urlApprovalId, urlThreadId, isNew);
  });

  // Re-hydrate once router is ready (query may be empty on first render with SSR)
  useEffect(() => {
    if (!router.isReady) return;

    const urlStep = parseStep(router.query.step);
    const urlReqId = router.query.reqId
      ? String(Array.isArray(router.query.reqId) ? router.query.reqId[0] : router.query.reqId)
      : undefined;
    const urlApprovalId = router.query.approvalId
      ? String(Array.isArray(router.query.approvalId) ? router.query.approvalId[0] : router.query.approvalId)
      : undefined;
    const urlThreadId = router.query.threadId
      ? String(Array.isArray(router.query.threadId) ? router.query.threadId[0] : router.query.threadId)
      : undefined;
    const isNew = router.query.new === '1';

    // For new pipelines, always reset even if no other params present
    if (isNew) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(STORAGE_KEY);
      }
      setRawState({ ...DEFAULT_STATE });
      return;
    }

    if (!urlStep && !urlReqId && !urlApprovalId && !urlThreadId) return;

    setRawState((prev) => buildInitialState(prev, urlStep, urlReqId, urlApprovalId, urlThreadId, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  // Persist to localStorage on every state change
  useEffect(() => {
    persistState(state);
  }, [state]);

  // Sync `step` URL param whenever currentStep changes
  useEffect(() => {
    if (!router.isReady) return;
    const currentUrlStep = parseStep(router.query.step);
    if (currentUrlStep === state.currentStep) return;

    router.replace(
      { pathname: router.pathname, query: { ...router.query, step: state.currentStep } },
      undefined,
      { shallow: true },
    ).catch((err: unknown) => {
      log.warn('Failed to update step URL param', { err }, 'useWorkflowState');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentStep, router.isReady]);

  const setState = useCallback((update: Partial<WorkflowState>) => {
    setRawState((prev) => ({ ...prev, ...update }));
  }, []);

  const resetState = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setRawState({ ...DEFAULT_STATE });
  }, []);

  const goToStep = useCallback((step: StepNumber) => {
    setRawState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  return { state, setState, resetState, goToStep };
}
