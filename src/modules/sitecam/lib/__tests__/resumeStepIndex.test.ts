import { describe, it, expect } from 'vitest';
import { resumeStepIndex } from '../resumeStepIndex';
import type { StepState, StepStatus } from '../sitecamTypes';

function step(status: StepStatus, stepNumber: number): StepState {
  return {
    stepNumber,
    label: `Step ${stepNumber}`,
    hasVlm: true,
    hasSerialScan: false,
    serialLabel: '',
    serialDevice: null,
    serialAttempts: 0,
    serialScanned: null,
    status,
    photoBase64: null,
    attemptNumber: status === 'pending' ? 0 : 1,
    failReasons: [],
    corrections: [],
    needsManualReview: false,
  };
}

// A 12-step activation shape where step 6 (index 5) is the serial-scan step.
function states(statuses: StepStatus[]): StepState[] {
  return statuses.map((s, i) => step(s, i + 1));
}

describe('resumeStepIndex', () => {
  it('stays on the saved step when it is not yet complete', () => {
    const s = states(['pass', 'pass', 'pending', 'pending']);
    expect(resumeStepIndex(s, 2)).toBe(2); // step 3, still pending
  });

  it('skips forward off a serial_pending step whose advance timer was lost (the step-6 strand)', () => {
    // steps 1-5 done, step 6 serial saved (serial_pending), 7-12 not started;
    // draft was persisted with the current index still on step 6 (index 5).
    const s = states([
      'pass', 'pass', 'pass', 'pass', 'pass',
      'serial_pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending',
    ]);
    expect(resumeStepIndex(s, 5)).toBe(6); // resume on step 7, not stranded on step 6
  });

  it('skips forward off a passed step whose advance timer was lost (same class, VLM steps)', () => {
    const s = states(['pass', 'pass', 'pending', 'pending']);
    expect(resumeStepIndex(s, 1)).toBe(2); // step 2 passed → resume step 3
  });

  it('skips over consecutive completed steps to the first unfinished one', () => {
    const s = states(['pass', 'escalated', 'pass', 'fail', 'pending']);
    expect(resumeStepIndex(s, 0)).toBe(3); // 0,1,2 done → land on the fail (step 4) to retake
  });

  it('does NOT skip a serial_scan step (photo taken, serial not yet saved)', () => {
    const s = states(['pass', 'pass', 'serial_scan', 'pending']);
    expect(resumeStepIndex(s, 2)).toBe(2); // must finish the serial scan
  });

  it('returns the last index when every step is complete (submit screen takes over)', () => {
    const s = states(['pass', 'pass', 'serial_pending']);
    expect(resumeStepIndex(s, 0)).toBe(2);
  });

  it('clamps an out-of-range saved index', () => {
    const s = states(['pending', 'pending']);
    expect(resumeStepIndex(s, 99)).toBe(1);
    expect(resumeStepIndex(s, -3)).toBe(0);
  });

  it('handles an empty step list', () => {
    expect(resumeStepIndex([], 0)).toBe(0);
  });
});
