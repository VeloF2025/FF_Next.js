/**
 * Tests for SiteCam draft persistence — round-trip, stale-shape rejection,
 * and the quota fallback that drops photos but keeps progress.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveDraft, loadDraft, clearDraft } from '../sitecamDraft';
import type { StepState } from '../../hooks/useSiteCamCapture';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const STEPS = [{ number: 1 }, { number: 2 }] as const;
const JOB = 'activations' as const;

function step(num: number, over: Partial<StepState> = {}): StepState {
  return {
    stepNumber: num,
    label: `Step ${num}`,
    hasVlm: true,
    hasSerialScan: false,
    serialLabel: '',
    serialDevice: null,
    serialAttempts: 0,
    serialScanned: null,
    status: 'pending',
    photoBase64: null,
    attemptNumber: 0,
    failReasons: [],
    corrections: [],
    needsManualReview: false,
    ...over,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('sitecamDraft', () => {
  it('round-trips a saved draft', () => {
    const states = [step(1, { status: 'pass', photoBase64: 'AAAA' }), step(2)];
    saveDraft(JOB, 'DR1', states, 1, null);

    const loaded = loadDraft(JOB, 'DR1', STEPS);
    expect(loaded).not.toBeNull();
    expect(loaded!.currentStepIndex).toBe(1);
    expect(loaded!.stepStates[0].status).toBe('pass');
    expect(loaded!.stepStates[0].photoBase64).toBe('AAAA');
  });

  it('returns null when no draft exists', () => {
    expect(loadDraft(JOB, 'DR-none', STEPS)).toBeNull();
  });

  it('rejects a draft whose step shape no longer matches', () => {
    saveDraft(JOB, 'DR2', [step(1), step(2)], 0, null);
    // Step list shrank to one step since the draft was written.
    expect(loadDraft(JOB, 'DR2', [{ number: 1 }])).toBeNull();
  });

  it('does not load a draft saved under a different job type for the same site', () => {
    saveDraft('activations', 'DR-SAME', [step(1), step(2)], 1, null);
    // A civils job for the same DR must not pick up the activations draft.
    expect(loadDraft('civils', 'DR-SAME', STEPS)).toBeNull();
    // The original job type still reads its own draft.
    expect(loadDraft('activations', 'DR-SAME', STEPS)).not.toBeNull();
  });

  it('drops an out-of-range appealedIndex instead of restoring it', () => {
    // Persist a draft whose appealedIndex points past the current step list
    // (e.g. the step list shrank after the draft was written).
    window.localStorage.setItem(
      'sitecam:draft:v1:activations:DR-STALE',
      JSON.stringify({
        stepStates: [step(1), step(2)],
        currentStepIndex: 0,
        appealedIndex: 5,
      }),
    );

    const loaded = loadDraft(JOB, 'DR-STALE', STEPS);
    expect(loaded).not.toBeNull();
    // Progress is preserved but the bogus appeal pointer is dropped.
    expect(loaded!.appealedIndex).toBeNull();
    expect(loaded!.stepStates).toHaveLength(2);
  });

  it('clears a draft', () => {
    saveDraft(JOB, 'DR3', [step(1), step(2)], 0, null);
    clearDraft(JOB, 'DR3');
    expect(loadDraft(JOB, 'DR3', STEPS)).toBeNull();
  });

  it('falls back to persisting progress without photos when storage quota is exceeded', () => {
    const states = [step(1, { status: 'pass', photoBase64: 'BIGPHOTO' }), step(2)];
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      // First call (full payload) overflows; second call (lite) succeeds.
      .mockImplementationOnce(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });

    saveDraft(JOB, 'DR4', states, 0, null);

    // The retry persisted a payload with the photo stripped.
    expect(setItem).toHaveBeenCalledTimes(2);
    const litePayload = JSON.parse(setItem.mock.calls[1][1] as string) as {
      stepStates: StepState[];
    };
    expect(litePayload.stepStates[0].photoBase64).toBeNull();
    expect(litePayload.stepStates[0].status).toBe('pass');
    setItem.mockRestore();
  });
});
