/**
 * ReturnOrchestrator — state-machine orchestrator for /my/stores/return.
 * State: pick-reason → scan-serials → sign-submit → done
 * Sub-components: StepProgress, IssueDirtyConfirmDialog.
 * Mirrors IssueOrchestrator patterns exactly (same shell, same back-navigation guard).
 */

import React from 'react';
import { useRouter } from 'next/router';
import { ChevronLeft } from 'lucide-react';

import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { PickReturnReasonStep } from '@/modules/field-stock-pwa/components/PickReturnReasonStep';
import { ScanMyStockStep } from '@/modules/field-stock-pwa/components/ScanMyStockStep';
import { ReturnSignSubmitStep } from '@/modules/field-stock-pwa/components/ReturnSignSubmitStep';
import { ReturnSuccess } from '@/modules/field-stock-pwa/components/ReturnSuccess';
import { StepProgress } from '@/modules/field-stock-pwa/components/StepProgress';
import { IssueDirtyConfirmDialog } from '@/modules/field-stock-pwa/components/IssueDirtyConfirmDialog';
import type { ReturnReason } from '@/modules/field-stock-pwa/lib/returnReasons';
import type { PwaMyHeldSerial, PwaReturnResult } from '@/modules/field-stock-pwa/types';

// =============================================================================
// State shape
// =============================================================================

type ReturnStep = 'pick-reason' | 'scan-serials' | 'sign-submit' | 'done';

interface ReturnState {
  step: ReturnStep;
  reason: ReturnReason | null;
  scanned: PwaMyHeldSerial[];
  lockedSourceWarehouseId: string | null;
  lockedSourceWarehouseName: string | null;
  result: PwaReturnResult | null;
}

const INITIAL_RETURN_STATE: ReturnState = {
  step: 'pick-reason',
  reason: null,
  scanned: [],
  lockedSourceWarehouseId: null,
  lockedSourceWarehouseName: null,
  result: null,
};

/** 1-based progress index — done renders at same position as sign-submit. */
const STEP_INDEX: Record<ReturnStep, number> = {
  'pick-reason': 1, 'scan-serials': 2, 'sign-submit': 3, 'done': 3,
};
const STEP_LABELS = ['Reason', 'Serials', 'Sign'];

// =============================================================================
// Props
// =============================================================================

export interface ReturnOrchestratorProps {
  profile: AttendanceProfile;
}

// =============================================================================
// Component
// =============================================================================

export function ReturnOrchestrator({ profile }: ReturnOrchestratorProps) {
  const router = useRouter();
  const [flow, setFlow] = React.useState<ReturnState>(INITIAL_RETURN_STATE);
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);

  const isDirty =
    flow.step !== 'pick-reason' &&
    flow.step !== 'done' &&
    (flow.scanned.length > 0 || flow.reason !== null);

  const handleBackToHub = React.useCallback(() => {
    if (isDirty) { setShowDiscardConfirm(true); } else { void router.push('/my/stores'); }
  }, [isDirty, router]);

  const resetAll = React.useCallback(() => {
    setFlow(INITIAL_RETURN_STATE);
    setShowDiscardConfirm(false);
  }, []);

  return (
    <MyPortalShell title="Return stock" staffName={profile.name}
      staffPhotoUrl={profile.profilePhotoUrl} showFooterNav={false}>

      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={handleBackToHub}
          className="inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200">
          <ChevronLeft className="w-4 h-4" />Stores
        </button>
        {flow.step !== 'done' && (
          <StepProgress current={STEP_INDEX[flow.step]} labels={STEP_LABELS} />
        )}
      </div>

      {showDiscardConfirm && (
        <IssueDirtyConfirmDialog
          onDiscard={() => { resetAll(); void router.push('/my/stores'); }}
          onContinue={() => setShowDiscardConfirm(false)}
        />
      )}

      {flow.step === 'pick-reason' && (
        <PickReturnReasonStep
          initial={flow.reason}
          onPick={(reason) => setFlow((s) => ({ ...s, step: 'scan-serials', reason }))}
        />
      )}

      {flow.step === 'scan-serials' && (
        <ScanMyStockStep
          scanned={flow.scanned}
          lockedSourceWarehouseId={flow.lockedSourceWarehouseId}
          lockedSourceWarehouseName={flow.lockedSourceWarehouseName}
          onChange={(next, lockedId, lockedName) =>
            setFlow((s) => ({
              ...s,
              scanned: next,
              lockedSourceWarehouseId: lockedId,
              lockedSourceWarehouseName: lockedName,
            }))
          }
          onDone={() => setFlow((s) => ({ ...s, step: 'sign-submit' }))}
        />
      )}

      {flow.step === 'sign-submit' &&
        flow.reason !== null &&
        flow.lockedSourceWarehouseId !== null &&
        flow.lockedSourceWarehouseName !== null && (
          <ReturnSignSubmitStep
            reason={flow.reason}
            serials={flow.scanned}
            returnToLocationId={flow.lockedSourceWarehouseId}
            returnToLocationName={flow.lockedSourceWarehouseName}
            originalPickingId={null}
            onSubmitted={(result) => setFlow((s) => ({ ...s, step: 'done', result }))}
            onBack={() => setFlow((s) => ({ ...s, step: 'scan-serials' }))}
          />
        )}

      {flow.step === 'done' && flow.result && (
        <ReturnSuccess
          result={flow.result}
          onStartAnother={resetAll}
          onBackToHub={() => void router.push('/my/stores')}
        />
      )}
    </MyPortalShell>
  );
}
