/**
 * issueFlowPersistence — sessionStorage survival for the stores issue wizard.
 *
 * The issue flow lives entirely in React state. On low-memory Android phones
 * the "Take a photo instead" serial fallback switches to the camera app; Chrome
 * discards the backgrounded tab and the reload threw the storeman back to
 * step 1, losing every scanned serial (reported with Gizzu issues, whose dense
 * Code128 labels force the photo fallback per unit). Persist the flow after
 * every change and restore it on mount so a reload resumes where they were.
 *
 * Not persisted: signature, proof photo, submit result — the user lands back
 * on the step they were on and re-signs. 'pending-validation' rows are dropped
 * on restore (their in-flight request died with the old page).
 */

import { log } from '@/lib/logger';
import type { PwaScannedSerial, PwaTechSummary } from '@/modules/field-stock-pwa/types';
import type { StockItem } from '@/modules/field-stock-pwa/components/PickItemStep';

export const ISSUE_FLOW_STORAGE_KEY = 'ff-stores-issue-flow-v1';

export type ResumableIssueStep =
  | 'pick-warehouse' | 'pick-tech' | 'pick-item'
  | 'scan-serials' | 'enter-quantity' | 'sign-submit';

const RESUMABLE_STEPS: ReadonlySet<string> = new Set([
  'pick-warehouse', 'pick-tech', 'pick-item', 'scan-serials', 'enter-quantity', 'sign-submit',
]);

export interface PersistedIssueFlow {
  step: ResumableIssueStep;
  sourceLocation: { id: string; name: string } | null;
  technician: PwaTechSummary | null;
  stockItem: StockItem | null;
  scanned: PwaScannedSerial[];
  quantity: number;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (err) {
    log.warn('sessionStorage unavailable — issue flow will not survive a reload', { err }, 'issueFlowPersistence');
    return null;
  }
}

/** Persist the current flow. A flow still on step 1 clears instead — nothing to resume. */
export function saveIssueFlow(flow: PersistedIssueFlow): void {
  const store = storage();
  if (!store) return;
  try {
    if (flow.step === 'pick-warehouse') {
      store.removeItem(ISSUE_FLOW_STORAGE_KEY);
      return;
    }
    store.setItem(ISSUE_FLOW_STORAGE_KEY, JSON.stringify(flow));
  } catch (err) {
    // Quota / serialization failure — resume is best-effort only.
    log.warn('failed to persist issue flow', { err }, 'issueFlowPersistence');
  }
}

export function clearIssueFlow(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(ISSUE_FLOW_STORAGE_KEY);
  } catch (err) {
    log.warn('failed to clear persisted issue flow', { err }, 'issueFlowPersistence');
  }
}

/**
 * Restore a previously saved flow, or null when absent/corrupt/not resumable.
 * Guards the invariants each step's render relies on (e.g. scan-serials needs
 * a stockItem) so a partial or tampered payload never renders a broken step.
 */
export function loadIssueFlow(): PersistedIssueFlow | null {
  const store = storage();
  if (!store) return null;
  let parsed: unknown;
  try {
    const raw = store.getItem(ISSUE_FLOW_STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn('discarding unreadable persisted issue flow', { err }, 'issueFlowPersistence');
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const flow = parsed as Partial<PersistedIssueFlow>;

  if (typeof flow.step !== 'string' || !RESUMABLE_STEPS.has(flow.step)) return null;
  if (flow.step !== 'pick-warehouse' && !flow.sourceLocation?.id) return null;
  if (['pick-item', 'scan-serials', 'enter-quantity', 'sign-submit'].includes(flow.step) && !flow.technician?.id) return null;
  if (['scan-serials', 'enter-quantity', 'sign-submit'].includes(flow.step) && !flow.stockItem?.id) return null;

  const scanned = Array.isArray(flow.scanned)
    ? flow.scanned.filter(
        (s): s is PwaScannedSerial =>
          typeof s === 'object' && s !== null &&
          typeof (s as PwaScannedSerial).serialNumber === 'string' &&
          (s as PwaScannedSerial).state !== 'pending-validation'
      )
    : [];

  return {
    step: flow.step as ResumableIssueStep,
    sourceLocation: flow.sourceLocation ?? null,
    technician: flow.technician ?? null,
    stockItem: flow.stockItem ?? null,
    scanned,
    quantity: typeof flow.quantity === 'number' && Number.isFinite(flow.quantity) ? flow.quantity : 0,
  };
}
