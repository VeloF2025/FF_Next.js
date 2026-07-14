/**
 * Local-draft persistence for the SiteCam capture wizard.
 *
 * The wizard holds every captured photo + per-step status in React state. Before
 * this module a page refresh (or the PWA reloading from the service worker) wiped
 * it all and dumped the technician back at Step 1. We now mirror that state into
 * localStorage keyed by job type + siteId so a refresh restores progress. The job
 * type is part of the key because the same DR can be captured under different job
 * types (activations vs civils) whose step lists differ — namespacing prevents one
 * job type's draft from being restored into the other's wizard.
 *
 * Quota: a watermarked photo is a ~0.4–0.8 MB base64 JPEG; a full 12-step job can
 * exceed localStorage's ~5 MB origin budget. {@link saveDraft} therefore degrades
 * gracefully — if the full payload (with photos) overflows, it retries persisting
 * progress ONLY (statuses, current step, attempt counts) so the technician keeps
 * their place even if a photo or two must be re-captured.
 */

import { log } from '@/lib/logger';
import type { SiteCamJobType, SiteCamStep, SerialSpec } from './sitecamSteps';
import type { StepState } from '../hooks/useSiteCamCapture';
import { nextSerialPatch } from './serialSequence';

/** Serials configured for a step, in order (empty for non-serial steps). */
function stepSerials(step: SiteCamStep | undefined): SerialSpec[] {
  return step?.serials ? step.serials.map((s) => ({ ...s })) : [];
}

const MODULE = 'sitecamDraft';
const KEY_PREFIX = 'sitecam:draft:v1:';

export interface SiteCamDraft {
  stepStates: StepState[];
  currentStepIndex: number;
  /** Index of a step with an appeal awaiting a supervisor decision, if any. */
  appealedIndex: number | null;
}

function draftKey(jobType: SiteCamJobType, siteId: string): string {
  return `${KEY_PREFIX}${jobType}:${siteId}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // localStorage can throw in private-mode / disabled-storage browsers.
    return null;
  }
}

/**
 * Persist the wizard draft. Tries the full payload first; on a quota error,
 * retries with photos stripped so at least the progress survives.
 */
export function saveDraft(
  jobType: SiteCamJobType,
  siteId: string,
  stepStates: StepState[],
  currentStepIndex: number,
  appealedIndex: number | null,
): void {
  const store = storage();
  if (!store) return;

  const key = draftKey(jobType, siteId);
  const full: SiteCamDraft = { stepStates, currentStepIndex, appealedIndex };
  try {
    store.setItem(key, JSON.stringify(full));
  } catch {
    // Most likely QuotaExceededError — retry without the heavy base64 photos.
    const lite: SiteCamDraft = {
      stepStates: stepStates.map((s) => ({ ...s, photoBase64: null })),
      currentStepIndex,
      appealedIndex,
    };
    try {
      store.setItem(key, JSON.stringify(lite));
      log.warn('SiteCam draft too large — persisted progress without photos', { siteId }, MODULE);
    } catch (err) {
      log.warn('Failed to persist SiteCam draft', { siteId, err: String(err) }, MODULE);
    }
  }
}

/**
 * Load a saved draft for this site. Returns null when there is none, when storage
 * is unavailable, or when the saved shape no longer matches the current step
 * definition (e.g. the step list changed in a deploy) — a stale draft is ignored
 * rather than restored into a mismatched wizard.
 */
export function loadDraft(
  jobType: SiteCamJobType,
  siteId: string,
  steps: readonly SiteCamStep[],
): SiteCamDraft | null {
  const store = storage();
  if (!store) return null;

  const raw = store.getItem(draftKey(jobType, siteId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SiteCamDraft>;
    const states = parsed.stepStates;
    if (!Array.isArray(states) || states.length !== steps.length) return null;
    // Guard against a step-definition change since the draft was written.
    const sameShape = states.every((s, i) => s && s.stepNumber === steps[i]?.number);
    if (!sameShape) return null;

    // Backfill the serial-sequence fields so a draft written before step 6
    // gained its two-serial flow (a mid-job deploy) can't strand the wizard
    // with an undefined `serials`/`serialIndex`.
    const restored = states.map((s, i) => {
      const serials = Array.isArray(s.serials) && s.serials.length > 0 ? s.serials : stepSerials(steps[i]);
      const maxIndex = Math.max(serials.length, 1);
      const serialIndex =
        typeof s.serialIndex === 'number' && s.serialIndex >= 0 && s.serialIndex < maxIndex ? s.serialIndex : 0;
      const base = { ...s, serials, serialIndex };

      // A serial step marked complete (`serial_pending`) under an OLDER
      // single-serial flow, but which now has more serials to collect (e.g. the
      // Gizzu UPS added at 6b), is reopened at the next unscanned serial so the
      // remaining serial is still captured — "both serials mandatory" must hold
      // for a job in flight across the deploy.
      if (base.hasSerialScan && base.status === 'serial_pending' && serialIndex < serials.length - 1) {
        return { ...base, status: 'serial_scan' as const, ...nextSerialPatch(base) };
      }
      return base;
    });

    const idx =
      typeof parsed.currentStepIndex === 'number' &&
      parsed.currentStepIndex >= 0 &&
      parsed.currentStepIndex < steps.length
        ? parsed.currentStepIndex
        : 0;

    // Validate the appealed-step index the same way: a stale draft (e.g. written
    // before the step list changed) could carry an index past the current range,
    // which would make `steps[appealedIndex]` undefined and silently stall the
    // polling effect. Drop an out-of-range pointer rather than restore it.
    const appealedIndex =
      typeof parsed.appealedIndex === 'number' &&
      parsed.appealedIndex >= 0 &&
      parsed.appealedIndex < steps.length
        ? parsed.appealedIndex
        : null;

    return {
      stepStates: restored,
      currentStepIndex: idx,
      appealedIndex,
    };
  } catch {
    return null;
  }
}

/** Remove the draft once the job has been submitted (or is otherwise finished). */
export function clearDraft(jobType: SiteCamJobType, siteId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(draftKey(jobType, siteId));
  } catch {
    // Non-fatal: a leftover draft is cleared on the next successful save/submit.
  }
}
