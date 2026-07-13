import type { StepState } from './sitecamTypes';

/**
 * Statuses that mark a step as done — the tech should never be parked back on
 * one. Mirrors the wizard's `doneCount` filter. `serial_scan` is intentionally
 * excluded (photo taken but serial not yet saved → the tech must finish it).
 */
const DONE_STATUSES: ReadonlySet<StepState['status']> = new Set([
  'pass',
  'escalated',
  'serial_pending',
]);

/**
 * Resolve where to resume the wizard after a draft restore.
 *
 * The wizard advances between steps with a one-shot client-side timer. If the
 * PWA reloads or is backgrounded in that window (service-worker update,
 * app-switch, screen-lock), the draft is restored with the current step still
 * marked complete and no timer to advance it — leaving the tech stranded on a
 * "Step complete" card with no way forward (observed as "stuck at step 6"
 * after the ONT serial saves). This skips FORWARD from the saved index past
 * any already-complete steps to the first unfinished one. It only moves
 * forward and never past the last step (an all-complete job resolves to the
 * final index, where the submit screen takes over).
 */
export function resumeStepIndex(
  stepStates: readonly StepState[],
  savedIndex: number,
): number {
  if (stepStates.length === 0) return 0;
  let i = Math.max(0, Math.min(savedIndex, stepStates.length - 1));
  while (i < stepStates.length - 1 && DONE_STATUSES.has(stepStates[i]!.status)) {
    i += 1;
  }
  return i;
}
