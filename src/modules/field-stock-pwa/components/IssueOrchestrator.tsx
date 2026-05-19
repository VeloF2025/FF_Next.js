/**
 * IssueOrchestrator — state-machine orchestrator for /my/stores/issue.
 * State: pick-warehouse → pick-tech → pick-item → scan-serials → sign-submit → done
 * Sub-components: StepProgress, IssueDirtyConfirmDialog.
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
import { StepProgress } from '@/modules/field-stock-pwa/components/StepProgress';
import { IssueDirtyConfirmDialog } from '@/modules/field-stock-pwa/components/IssueDirtyConfirmDialog';
import { FIELD_DEFAULT_LOCATION_ID } from '@/modules/field-stock-pwa/lib/locationDefaults';
import type { PwaTechSummary, PwaScannedSerial, PwaPickingResult } from '@/modules/field-stock-pwa/types';

// --- Types ---

type IssueStep = 'pick-warehouse' | 'pick-tech' | 'pick-item' | 'scan-serials' | 'sign-submit' | 'done';

interface SourceLocation { id: string; name: string; }

interface IssueState {
  step: IssueStep;
  sourceLocation: SourceLocation | null;
  technician: PwaTechSummary | null;
  stockItem: StockItem | null;
  scanned: PwaScannedSerial[];
  result: PwaPickingResult | null;
}

const INITIAL_ISSUE_STATE: IssueState = {
  step: 'pick-warehouse', sourceLocation: null, technician: null,
  stockItem: null, scanned: [], result: null,
};

/** 1-based progress index — done renders at same position as sign-submit. */
const STEP_INDEX: Record<IssueStep, number> = {
  'pick-warehouse': 1, 'pick-tech': 2, 'pick-item': 3,
  'scan-serials': 4, 'sign-submit': 5, 'done': 5,
};
const STEP_LABELS = ['WH', 'Tech', 'Item', 'Serials', 'Sign'];

// --- Props ---

export interface IssueOrchestratorProps {
  profile: AttendanceProfile;
}

// --- Component ---

export function IssueOrchestrator({ profile }: IssueOrchestratorProps) {
  const router = useRouter();
  const [flow, setFlow] = React.useState<IssueState>(INITIAL_ISSUE_STATE);
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);

  const isDirty =
    flow.step !== 'pick-warehouse' &&
    flow.step !== 'done' &&
    (flow.scanned.length > 0 || flow.technician !== null);

  const handleBackToHub = React.useCallback(() => {
    if (isDirty) { setShowDiscardConfirm(true); } else { void router.push('/my/stores'); }
  }, [isDirty, router]);

  const resetAll = React.useCallback(() => {
    setFlow(INITIAL_ISSUE_STATE);
    setShowDiscardConfirm(false);
  }, []);

  return (
    <MyPortalShell title="Issue stock" staffName={profile.name}
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

      {flow.step === 'pick-warehouse' && (
        <PickWarehouseStep
          onPick={(loc) => setFlow((s) => ({ ...s, step: 'pick-tech', sourceLocation: loc }))} />
      )}
      {flow.step === 'pick-tech' && (
        <PickTechStep
          onPick={(tech) => setFlow((s) => ({ ...s, step: 'pick-item', technician: tech }))} />
      )}
      {flow.step === 'pick-item' && flow.technician && (
        <PickItemStep technician={flow.technician}
          onPick={(item) => setFlow((s) => ({ ...s, step: 'scan-serials', stockItem: item }))} />
      )}
      {flow.step === 'scan-serials' && flow.stockItem && (
        <ScanSerialsStep stockItem={flow.stockItem} scanned={flow.scanned}
          onChange={(next) => setFlow((s) => ({ ...s, scanned: next }))}
          onDone={() => setFlow((s) => ({ ...s, step: 'sign-submit' }))} />
      )}
      {flow.step === 'sign-submit' && flow.technician && flow.stockItem && flow.sourceLocation && (
        <SignAndSubmitStep technician={flow.technician} stockItem={flow.stockItem}
          scanned={flow.scanned} contractorId={flow.technician.contractorId}
          sourceLocationId={flow.sourceLocation.id}
          destinationLocationId={FIELD_DEFAULT_LOCATION_ID}
          onSubmitted={(result) => setFlow((s) => ({ ...s, step: 'done', result }))}
          onBack={() => setFlow((s) => ({ ...s, step: 'scan-serials' }))} />
      )}
      {flow.step === 'done' && flow.result && (
        <IssueSuccess result={flow.result} onStartAnother={resetAll}
          onBackToHub={() => void router.push('/my/stores')} />
      )}
    </MyPortalShell>
  );
}
