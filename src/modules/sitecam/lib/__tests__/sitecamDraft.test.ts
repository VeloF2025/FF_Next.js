/**
 * Tests for SiteCam draft persistence — round-trip, stale-shape rejection,
 * and the quota fallback that drops photos but keeps progress.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveDraft, loadDraft, clearDraft } from '../sitecamDraft';
import { resumeStepIndex } from '../resumeStepIndex';
import type { StepState } from '../../hooks/useSiteCamCapture';
import type { SiteCamStep } from '../sitecamSteps';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const STEPS: readonly SiteCamStep[] = [
  { number: 1, label: 'Step 1', hasVlm: true, hasSerialScan: false },
  { number: 2, label: 'Step 2', hasVlm: true, hasSerialScan: false },
];
const JOB = 'activations' as const;

function step(num: number, over: Partial<StepState> = {}): StepState {
  return {
    stepNumber: num,
    label: `Step ${num}`,
    hasVlm: true,
    hasSerialScan: false,
    serials: [],
    serialIndex: 0,
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
    expect(loadDraft(JOB, 'DR2', [{ number: 1, label: 'Step 1', hasVlm: true, hasSerialScan: false }])).toBeNull();
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

  it('reopens a step-6 draft completed under the OLD single-serial flow to collect the added UPS serial', () => {
    // Step 6 now scans two serials (ONT then Gizzu UPS).
    const STEP6: readonly SiteCamStep[] = [
      {
        number: 6, label: 'ONT Back After Install', hasVlm: false, hasSerialScan: true,
        serials: [
          { device: 'ont', label: 'ONT Serial' },
          { device: 'ups', label: 'Gizzu UPS Serial' },
        ],
      },
    ];
    // A pre-change draft: step 6 finished the ONT-only flow (serial_pending),
    // with none of the new serials/serialIndex fields written.
    const legacy = {
      stepNumber: 6, label: 'ONT Back After Install', hasVlm: false, hasSerialScan: true,
      serialLabel: 'ONT Serial', serialDevice: 'ont', serialAttempts: 1, serialScanned: 'ALCLB48CC3CA',
      status: 'serial_pending', photoBase64: null, attemptNumber: 1, failReasons: [], corrections: [],
      needsManualReview: false,
    };
    window.localStorage.setItem(
      'sitecam:draft:v1:activations:DR-MIDDEPLOY',
      JSON.stringify({ stepStates: [legacy], currentStepIndex: 0, appealedIndex: null }),
    );

    const loaded = loadDraft('activations', 'DR-MIDDEPLOY', STEP6);
    expect(loaded).not.toBeNull();
    const s = loaded!.stepStates[0];
    // Reopened at the still-unscanned Gizzu UPS serial (6b), NOT left "done".
    expect(s.status).toBe('serial_scan');
    expect(s.serialIndex).toBe(1);
    expect(s.serialDevice).toBe('ups');
    expect(s.serialLabel).toBe('Gizzu UPS Serial');
  });

  it('routes the technician BACK to the reopened step even after they advanced past it', () => {
    // A 7-step activation where step 6 (index 5) now scans two serials.
    const STEPS7: readonly SiteCamStep[] = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      n === 6
        ? {
            number: 6, label: 'ONT Back After Install', hasVlm: false, hasSerialScan: true,
            serials: [{ device: 'ont', label: 'ONT Serial' }, { device: 'ups', label: 'Gizzu UPS Serial' }],
          }
        : { number: n, label: `Step ${n}`, hasVlm: true, hasSerialScan: false },
    );
    // Old draft: steps 1-5 passed, step 6 finished the ONT-only flow
    // (serial_pending, pre-change shape), tech advanced to step 7 (index 6).
    const legacy6 = {
      stepNumber: 6, label: 'ONT Back After Install', hasVlm: false, hasSerialScan: true,
      serialLabel: 'ONT Serial', serialDevice: 'ont', serialAttempts: 1, serialScanned: 'ALCLB48CC3CA',
      status: 'serial_pending', photoBase64: null, attemptNumber: 1, failReasons: [], corrections: [],
      needsManualReview: false,
    };
    const legacyStates = [
      step(1, { status: 'pass' }), step(2, { status: 'pass' }), step(3, { status: 'pass' }),
      step(4, { status: 'pass' }), step(5, { status: 'pass' }), legacy6, step(7),
    ];
    window.localStorage.setItem(
      'sitecam:draft:v1:activations:DR-ADVANCED',
      JSON.stringify({ stepStates: legacyStates, currentStepIndex: 6, appealedIndex: null }),
    );

    const loaded = loadDraft('activations', 'DR-ADVANCED', STEPS7);
    expect(loaded).not.toBeNull();
    // Position routed back from step 7 (index 6) to the reopened step 6 (index 5)…
    expect(loaded!.currentStepIndex).toBe(5);
    // …and resumeStepIndex keeps it there (the reopened serial step is not "done").
    expect(resumeStepIndex(loaded!.stepStates, loaded!.currentStepIndex)).toBe(5);
    expect(loaded!.stepStates[5].status).toBe('serial_scan');
    expect(loaded!.stepStates[5].serialDevice).toBe('ups');
  });
});
