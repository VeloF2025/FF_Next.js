/**
 * /my/stores/issue — issue-flow orchestrator.
 *
 * Walks the user through four steps:
 *   1. pick-tech     → PickTechStep
 *   2. pick-item     → PickItemStep
 *   3. scan-serials  → ScanSerialsStep
 *   4. sign-submit   → SignAndSubmitStep
 *   5. done          → IssueSuccess
 *
 * State machine is a simple useState enum — no xstate needed.
 * The `contractorId` passed to SignAndSubmitStep comes from the technician
 * resolved at step 1.
 *
 * Dirty-state guard: clicking "Back to /my/stores" when scanned serials
 * or the flow is past pick-tech shows an inline confirm panel — no native
 * `window.confirm()` (blocks PWA main thread on iOS Safari).
 *
 * ⚪ UNTESTED: integration tests in Task 2.9
 */

import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { ChevronLeft, Loader2, AlertCircle } from 'lucide-react';

import { getSession } from '@/modules/attendance/portal/client/api';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { PickTechStep } from '@/modules/field-stock-pwa/components/PickTechStep';
import { PickItemStep } from '@/modules/field-stock-pwa/components/PickItemStep';
import type { StockItem } from '@/modules/field-stock-pwa/components/PickItemStep';
import { ScanSerialsStep } from '@/modules/field-stock-pwa/components/ScanSerialsStep';
import { SignAndSubmitStep } from '@/modules/field-stock-pwa/components/SignAndSubmitStep';
import { IssueSuccess } from '@/modules/field-stock-pwa/components/IssueSuccess';
import type {
  PwaTechSummary,
  PwaScannedSerial,
  PwaPickingResult,
} from '@/modules/field-stock-pwa/types';
import type { StaffRole } from '@/modules/attendance/portal/types';

// =============================================================================
// Role gate
// =============================================================================

const STORES_ROLES: ReadonlyArray<StaffRole> = ['stores', 'admin'];

function isAuthorised(role: StaffRole | null): boolean {
  return role !== null && (STORES_ROLES as ReadonlyArray<string>).includes(role);
}

// =============================================================================
// State machine
// =============================================================================

type IssueStep = 'pick-tech' | 'pick-item' | 'scan-serials' | 'sign-submit' | 'done';

interface IssueState {
  step: IssueStep;
  technician: PwaTechSummary | null;
  stockItem: StockItem | null;
  scanned: PwaScannedSerial[];
  result: PwaPickingResult | null;
}

const INITIAL_ISSUE_STATE: IssueState = {
  step: 'pick-tech',
  technician: null,
  stockItem: null,
  scanned: [],
  result: null,
};

/** Maps IssueStep to a 1-based progress index (done = same as sign-submit) */
const STEP_INDEX: Record<IssueStep, number> = {
  'pick-tech': 1,
  'pick-item': 2,
  'scan-serials': 3,
  'sign-submit': 4,
  'done': 4,
};

const STEP_LABELS = ['Tech', 'Item', 'Serials', 'Sign'];

// =============================================================================
// Page
// =============================================================================

const StoresIssuePage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const [sessionState, setSessionState] = React.useState<
    | { kind: 'loading' }
    | { kind: 'guest' }
    | { kind: 'authed'; profile: AttendanceProfile }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    getSession()
      .then((res) => {
        if (cancelled) return;
        if (res.session && res.profile) {
          setSessionState({ kind: 'authed', profile: res.profile });
        } else {
          setSessionState({ kind: 'guest' });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSessionState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Session check failed',
          });
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (sessionState.kind === 'loading') {
    return (
      <MyPortalShell title="Issue stock" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 gap-2 text-sm text-neutral-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      </MyPortalShell>
    );
  }

  if (sessionState.kind === 'guest') {
    if (typeof window !== 'undefined') void router.replace('/my');
    return (
      <MyPortalShell title="Issue stock" showFooterNav={false}>
        <div className="flex items-center justify-center pt-24 text-sm text-neutral-400">
          Redirecting…
        </div>
      </MyPortalShell>
    );
  }

  if (sessionState.kind === 'error') {
    return (
      <MyPortalShell title="Issue stock" showFooterNav={false}>
        <div className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-3 text-sm text-red-200 mt-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{sessionState.message}</span>
        </div>
      </MyPortalShell>
    );
  }

  const { profile } = sessionState;
  if (!isAuthorised(profile.role)) {
    return (
      <MyPortalShell title="Issue stock" staffName={profile.name} showFooterNav={false}>
        <div className="flex flex-col items-center gap-4 pt-16 text-center">
          <AlertCircle className="w-12 h-12 text-neutral-600" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-neutral-200">Not authorised</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            The stores section is only available to stores staff and administrators.
          </p>
          <button
            type="button"
            onClick={() => void router.push('/my')}
            className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to hub
          </button>
        </div>
      </MyPortalShell>
    );
  }

  return <IssueOrchestrator profile={profile} />;
};

StoresIssuePage.getLayout = (page: React.ReactElement) => page;

export default StoresIssuePage;

// =============================================================================
// Orchestrator — extracted to keep the page component lean
// =============================================================================

interface IssueOrchestratorProps {
  profile: AttendanceProfile;
}

function IssueOrchestrator({ profile }: IssueOrchestratorProps) {
  const router = useRouter();
  const [flow, setFlow] = React.useState<IssueState>(INITIAL_ISSUE_STATE);
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);

  /** True when there's uncommitted work that would be lost on nav away. */
  const isDirty =
    flow.step !== 'pick-tech' &&
    flow.step !== 'done' &&
    (flow.scanned.length > 0 || flow.technician !== null);

  const handleBackToHub = React.useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      void router.push('/my/stores');
    }
  }, [isDirty, router]);

  const resetAll = React.useCallback(() => {
    setFlow(INITIAL_ISSUE_STATE);
    setShowDiscardConfirm(false);
  }, []);

  const currentStepIndex = STEP_INDEX[flow.step];
  const showProgress = flow.step !== 'done';

  return (
    <MyPortalShell
      title="Issue stock"
      staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl}
      showFooterNav={false}
    >
      {/* Top nav row */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={handleBackToHub}
          className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
        >
          <ChevronLeft className="w-4 h-4" />
          Stores
        </button>
        {showProgress && <StepProgress current={currentStepIndex} labels={STEP_LABELS} />}
      </div>

      {/* Inline discard confirmation — no native confirm() on iOS PWA */}
      {showDiscardConfirm && (
        <div
          role="alertdialog"
          aria-label="Discard issue?"
          className="mb-4 rounded-lg border border-amber-800 bg-amber-950/60 px-4 py-3 space-y-3"
        >
          <p className="text-sm text-amber-200 font-medium">Discard this issue?</p>
          <p className="text-xs text-amber-300/80">
            Any scanned serials and entered data will be lost.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                resetAll();
                void router.push('/my/stores');
              }}
              className="flex-1 py-2.5 rounded-lg bg-amber-700 text-white text-sm font-medium hover:bg-amber-600"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => setShowDiscardConfirm(false)}
              className="flex-1 py-2.5 rounded-lg border border-neutral-700 text-neutral-300 text-sm font-medium hover:bg-neutral-800"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step content */}
      {flow.step === 'pick-tech' && (
        <PickTechStep
          onPick={(tech) =>
            setFlow((s) => ({ ...s, step: 'pick-item', technician: tech }))
          }
        />
      )}

      {flow.step === 'pick-item' && flow.technician && (
        <PickItemStep
          technician={flow.technician}
          onPick={(item) =>
            setFlow((s) => ({ ...s, step: 'scan-serials', stockItem: item }))
          }
        />
      )}

      {flow.step === 'scan-serials' && flow.stockItem && (
        <ScanSerialsStep
          stockItem={flow.stockItem}
          scanned={flow.scanned}
          onChange={(next) => setFlow((s) => ({ ...s, scanned: next }))}
          onDone={() => setFlow((s) => ({ ...s, step: 'sign-submit' }))}
        />
      )}

      {flow.step === 'sign-submit' && flow.technician && flow.stockItem && (
        <SignAndSubmitStep
          technician={flow.technician}
          stockItem={flow.stockItem}
          scanned={flow.scanned}
          contractorId={flow.technician.contractorId}
          onSubmitted={(result) =>
            setFlow((s) => ({ ...s, step: 'done', result }))
          }
          onBack={() => setFlow((s) => ({ ...s, step: 'scan-serials' }))}
        />
      )}

      {flow.step === 'done' && flow.result && (
        <IssueSuccess
          result={flow.result}
          onStartAnother={resetAll}
          onBackToHub={() => void router.push('/my/stores')}
        />
      )}
    </MyPortalShell>
  );
}

// =============================================================================
// StepProgress — numbered dot indicator
// =============================================================================

interface StepProgressProps {
  current: number;
  labels: string[];
}

function StepProgress({ current, labels }: StepProgressProps) {
  return (
    <ol className="flex items-center gap-1" aria-label="Progress">
      {labels.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === current;
        const isDone = stepNum < current;
        return (
          <React.Fragment key={label}>
            {idx > 0 && (
              <li aria-hidden="true" className="h-px w-4 bg-neutral-700" />
            )}
            <li
              aria-current={isActive ? 'step' : undefined}
              aria-label={`Step ${stepNum}: ${label}`}
              className={[
                'flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold border transition-colors',
                isActive
                  ? 'bg-emerald-600 border-emerald-500 text-white'
                  : isDone
                    ? 'bg-emerald-900/50 border-emerald-800 text-emerald-400'
                    : 'bg-neutral-900 border-neutral-700 text-neutral-500',
              ].join(' ')}
            >
              {stepNum}
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}
