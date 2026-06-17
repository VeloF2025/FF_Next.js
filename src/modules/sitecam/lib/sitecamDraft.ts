/**
 * Local-draft persistence for the SiteCam capture wizard.
 *
 * The wizard holds every captured photo + per-step status in React state. Before
 * this module a page refresh (or the PWA reloading from the service worker) wiped
 * it all and dumped the technician back at Step 1. We now mirror that state into
 * localStorage keyed by siteId so a refresh restores progress.
 *
 * Quota: a watermarked photo is a ~0.4–0.8 MB base64 JPEG; a full 12-step job can
 * exceed localStorage's ~5 MB origin budget. {@link saveDraft} therefore degrades
 * gracefully — if the full payload (with photos) overflows, it retries persisting
 * progress ONLY (statuses, current step, attempt counts) so the technician keeps
 * their place even if a photo or two must be re-captured.
 */

import { log } from '@/lib/logger';
import type { StepState } from '../hooks/useSiteCamCapture';

const MODULE = 'sitecamDraft';
const KEY_PREFIX = 'sitecam:draft:v1:';

export interface SiteCamDraft {
  stepStates: StepState[];
  currentStepIndex: number;
  /** Index of a step with an appeal awaiting a supervisor decision, if any. */
  appealedIndex: number | null;
}

function draftKey(siteId: string): string {
  return `${KEY_PREFIX}${siteId}`;
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
  siteId: string,
  stepStates: StepState[],
  currentStepIndex: number,
  appealedIndex: number | null,
): void {
  const store = storage();
  if (!store) return;

  const full: SiteCamDraft = { stepStates, currentStepIndex, appealedIndex };
  try {
    store.setItem(draftKey(siteId), JSON.stringify(full));
  } catch {
    // Most likely QuotaExceededError — retry without the heavy base64 photos.
    const lite: SiteCamDraft = {
      stepStates: stepStates.map((s) => ({ ...s, photoBase64: null })),
      currentStepIndex,
      appealedIndex,
    };
    try {
      store.setItem(draftKey(siteId), JSON.stringify(lite));
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
export function loadDraft(siteId: string, steps: readonly { number: number }[]): SiteCamDraft | null {
  const store = storage();
  if (!store) return null;

  const raw = store.getItem(draftKey(siteId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SiteCamDraft>;
    const states = parsed.stepStates;
    if (!Array.isArray(states) || states.length !== steps.length) return null;
    // Guard against a step-definition change since the draft was written.
    const sameShape = states.every((s, i) => s && s.stepNumber === steps[i]?.number);
    if (!sameShape) return null;

    const idx =
      typeof parsed.currentStepIndex === 'number' &&
      parsed.currentStepIndex >= 0 &&
      parsed.currentStepIndex < steps.length
        ? parsed.currentStepIndex
        : 0;

    return {
      stepStates: states,
      currentStepIndex: idx,
      appealedIndex:
        typeof parsed.appealedIndex === 'number' ? parsed.appealedIndex : null,
    };
  } catch {
    return null;
  }
}

/** Remove the draft once the job has been submitted (or is otherwise finished). */
export function clearDraft(siteId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(draftKey(siteId));
  } catch {
    // Non-fatal: a leftover draft is cleared on the next successful save/submit.
  }
}
