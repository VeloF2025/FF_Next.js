/**
 * IssueOrchestrator — state-machine orchestrator for /my/stores/issue.
 * State: pick-warehouse → pick-tech → pick-item → (scan-serials | enter-quantity) → sign-submit → done
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
import { EnterQuantityStep } from '@/modules/field-stock-pwa/components/EnterQuantityStep';
import { SignAndSubmitStep } from '@/modules/field-stock-pwa/components/SignAndSubmitStep';
import { IssueSuccess } from '@/modules/field-stock-pwa/components/IssueSuccess';
import { StepProgress } from '@/modules/field-stock-pwa/components/StepProgress';
import { IssueDirtyConfirmDialog } from '@/modules/field-stock-pwa/components/IssueDirtyConfirmDialog';
import { FIELD_DEFAULT_LOCATION_ID } from '@/modules/field-stock-pwa/lib/locationDefaults';
import { saveIssueFlow, loadIssueFlow, clearIssueFlow } from '@/modules/field-stock-pwa/lib/issueFlowPersistence';
import type { PwaTechSummary, PwaScannedSerial, PwaPickingResult } from '@/modules/field-stock-pwa/types';

// --- Types ---

type IssueStep = 'pick-warehouse' | 'pick-tech' | 'pick-item' | 'scan-serials' | 'enter-quantity' | 'sign-submit' | 'done';

interface SourceLocation { id: string; name: string; }

interface IssueState {
  step: IssueStep;
  sourceLocation: SourceLocation | null;
  technician: PwaTechSummary | null;
  stockItem: StockItem | null;
  scanned: PwaScannedSerial[];
  quantity: number;
  result: PwaPickingResult | null;
}

const INITIAL_ISSUE_STATE: IssueState = {
  step: 'pick-warehouse', sourceLocation: null, technician: null,
  stockItem: null, scanned: [], quantity: 0, result: null,
};

/** 1-based progress index — done and enter-quantity render at same position as scan-serials. */
const STEP_INDEX: Record<IssueStep, number> = {
  'pick-warehouse': 1, 'pick-tech': 2, 'pick-item': 3,
  'scan-serials': 4, 'enter-quantity': 4, 'sign-submit': 5, 'done': 5,
};

const stepLabels = (item: StockItem | null): string[] =>
  ['WH', 'Tech', 'Item', item && item.trackingType !== 'serial' ? 'Qty' : 'Serials', 'Sign'];

// --- Props ---

export interface IssueOrchestratorProps {
  profile: AttendanceProfile;
}

// --- Component ---

export function IssueOrchestrator({ profile }: IssueOrchestratorProps) {
  const router = useRouter();
  const [flow, setFlow] = React.useState<IssueState>(INITIAL_ISSUE_STATE);
  const [showDiscardConfirm, setShowDiscardConfirm] = React.useState(false);

  // Survive a page reload (Android discards the tab while the camera app is
  // open for the photo-serial fallback): restore the saved flow on mount,
  // persist on every change. Restore runs in an effect — not the useState
  // initializer — so SSR markup and first client render match.
  //
  // pendingRestoreRef: both effects run in the same initial flush, and the save
  // effect's closure still sees the pre-restore INITIAL state (step 1 → clear).
  // Without the guard it would delete the entry just restored and rely on the
  // follow-up render to re-save it — an ordering coincidence, not a design.
  const pendingRestoreRef = React.useRef(false);
  React.useEffect(() => {
    const saved = loadIssueFlow();
    if (saved) {
      pendingRestoreRef.current = true;
      setFlow({ ...saved, result: null });
    }
  }, []);
  React.useEffect(() => {
    if (pendingRestoreRef.current) { pendingRestoreRef.current = false; return; }
    const { step } = flow;
    if (step === 'done') { clearIssueFlow(); return; }
    saveIssueFlow({
      step,
      sourceLocation: flow.sourceLocation,
      technician: flow.technician,
      stockItem: flow.stockItem,
      scanned: flow.scanned,
      quantity: flow.quantity,
    });
  }, [flow]);

  const isDirty =
    flow.step !== 'pick-warehouse' &&
    flow.step !== 'done' &&
    (flow.scanned.length > 0 || flow.quantity > 0 || flow.technician !== null);

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
          <StepProgress current={STEP_INDEX[flow.step]} labels={stepLabels(flow.stockItem)} />
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
          storeLocationId={flow.sourceLocation?.id ?? null}
          storeName={flow.sourceLocation?.name ?? null}
          onPick={(tech) => setFlow((s) => ({ ...s, step: 'pick-item', technician: tech }))} />
      )}
      {flow.step === 'pick-item' && flow.technician && (
        <PickItemStep technician={flow.technician}
          onPick={(item) => setFlow((s) => ({
            ...s,
            step: item.trackingType === 'serial' ? 'scan-serials' : 'enter-quantity',
            stockItem: item,
            scanned: [],
            quantity: 0,
          }))} />
      )}
      {flow.step === 'scan-serials' && flow.stockItem && (
        <ScanSerialsStep stockItem={flow.stockItem} scanned={flow.scanned}
          sourceLocation={flow.sourceLocation}
          onChange={(next) => setFlow((s) => ({ ...s, scanned: next }))}
          onDone={() => setFlow((s) => ({ ...s, step: 'sign-submit' }))} />
      )}
      {flow.step === 'enter-quantity' && flow.stockItem && (
        <EnterQuantityStep stockItem={flow.stockItem} quantity={flow.quantity}
          onChange={(q) => setFlow((s) => ({ ...s, quantity: q }))}
          onDone={() => setFlow((s) => ({ ...s, step: 'sign-submit' }))} />
      )}
      {flow.step === 'sign-submit' && flow.technician && flow.stockItem && flow.sourceLocation && (
        <SignAndSubmitStep technician={flow.technician} stockItem={flow.stockItem}
          scanned={flow.scanned} contractorId={flow.technician.contractorId}
          sourceLocationId={flow.sourceLocation.id}
          destinationLocationId={FIELD_DEFAULT_LOCATION_ID}
          quantity={flow.quantity}
          onSubmitted={(result) => setFlow((s) => ({ ...s, step: 'done', result }))}
          onBack={() => setFlow((s) => ({
            ...s,
            step: s.stockItem && s.stockItem.trackingType !== 'serial' ? 'enter-quantity' : 'scan-serials',
          }))} />
      )}
      {flow.step === 'done' && flow.result && (
        <IssueSuccess result={flow.result} onStartAnother={resetAll}
          onBackToHub={() => void router.push('/my/stores')} />
      )}
    </MyPortalShell>
  );
}
