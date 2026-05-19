/**
 * IssueOrchestrator — state-machine orchestrator for the /my/stores/issue flow.
 *
 * Rendered by pages/my/stores/issue/index.tsx once session is confirmed.
 * Extracted to keep the page file under 300 lines.
 *
 * State machine (useState enum — no xstate):
 *   pick-warehouse → pick-tech → pick-item → scan-serials → sign-submit → done
 *
 * Dirty-state guard: inline confirm panel (no native confirm() — blocks iOS
 * Safari PWA main thread). Shown when user tries to leave mid-flow.
 * ⚪ UNTESTED: integration tests in follow-on task.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { ChevronLeft } from 'lucide-react';

import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { PickWarehouseStep } from '@/modules/field-stock-pwa/components/PickWarehouseStep';
import { PickTechStep } from '@/modules/field-stock-pwa/components/PickTechStep';
import { PickItemStep } from '@/modules/field-stock-pwa/components/PickItemStep';
import type { StockItem } from '@/modules/field-stock-pwa/components/PickItemStep';
import { ScanSerialsStep } from '@/modules/field-stock-pwa/components/ScanSerialsStep';
import { SignAndSubmitStep } from '@/modules/field-stock-pwa/components/SignAndSubmitStep';
import { IssueSuccess } from '@/modules/field-stock-pwa/components/IssueSuccess';
import { FIELD_DEFAULT_LOCATION_ID } from '@/modules/field-stock-pwa/lib/locationDefaults';
import type {
  PwaTechSummary,
  PwaScannedSerial,
  PwaPickingResult,
} from '@/modules/field-stock-pwa/types';

// =============================================================================
// State machine types
// =============================================================================

type IssueStep =
  | 'pick-warehouse'
  | 'pick-tech'
  | 'pick-item'
  | 'scan-serials'
  | 'sign-submit'
  | 'done';

interface SourceLocation {
  id: string;
  name: string;
}

interface IssueState {
  step: IssueStep;
  sourceLocation: SourceLocation | null;
  technician: PwaTechSummary | null;
  stockItem: StockItem | null;
  scanned: PwaScannedSerial[];
  result: PwaPickingResult | null;
}

const INITIAL_ISSUE_STATE: IssueState = {
  step: 'pick-warehouse',
  sourceLocation: null,
  technician: null,
  stockItem: null,
  scanned: [],
  result: null,
};

/** Maps IssueStep to a 1-based progress index (done = same as sign-submit). */
const STEP_INDEX: Record<IssueStep, number> = {
  'pick-warehouse': 1,
  'pick-tech': 2,
  'pick-item': 3,
  'scan-serials': 4,
  'sign-submit': 5,
  'done': 5,
};

const STEP_LABELS = ['WH', 'Tech', 'Item', 'Serials', 'Sign'];

// =============================================================================
// Props
// =============================================================================

export interface IssueOrchestratorProps {
  profile: AttendanceProfile;
}

// =============================================================================
// Component
// =============================================================================

export function IssueOrchestrator({ profile }: IssueOrchestratorProps) {
  const router = useRouter();
  const [flow, setFlow] = React.useState<IssueState>(INITIAL_ISSUE_STATE);
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);

  /** True when there is uncommitted work that would be lost on navigate away. */
  const isDirty =
    flow.step !== 'pick-warehouse' &&
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
        {showProgress && (
          <StepProgress current={currentStepIndex} labels={STEP_LABELS} />
        )}
      </div>

      {/* Inline discard confirmation — avoids native confirm() on iOS PWA */}
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
      {flow.step === 'pick-warehouse' && (
        <PickWarehouseStep
          onPick={(loc) =>
            setFlow((s) => ({ ...s, step: 'pick-tech', sourceLocation: loc }))
          }
        />
      )}

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

      {flow.step === 'sign-submit' &&
        flow.technician &&
        flow.stockItem &&
        flow.sourceLocation && (
          <SignAndSubmitStep
            technician={flow.technician}
            stockItem={flow.stockItem}
            scanned={flow.scanned}
            contractorId={flow.technician.contractorId}
            sourceLocationId={flow.sourceLocation.id}
            destinationLocationId={FIELD_DEFAULT_LOCATION_ID}
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
              <li aria-hidden="true" className="h-px w-3 bg-neutral-700" />
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
