import { describe, it, expect } from 'vitest';
import { getStepsForJobType, toGalleryJobType, CIVIL_STEPS, ACTIVATION_STEPS } from '../sitecamSteps';
import { CIVIL_CHECKLIST } from '@/modules/construction-qa/types/construction.types';

describe('getStepsForJobType', () => {
  it('returns the 8 civil steps for "civils", all VLM-gated', () => {
    const steps = getStepsForJobType('civils');
    expect(steps).toBe(CIVIL_STEPS);
    expect(steps).toHaveLength(8);
    expect(steps.every((s) => s.hasVlm)).toBe(true);
  });

  it('returns the 12 activation steps for "activations"', () => {
    const steps = getStepsForJobType('activations');
    expect(steps).toBe(ACTIVATION_STEPS);
    expect(steps).toHaveLength(12);
  });

  it('numbers civil steps 1..8 contiguously', () => {
    expect(CIVIL_STEPS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('civil step 8 is the Pole Label asset step, not Signature', () => {
    const step8 = CIVIL_STEPS.find((s) => s.number === 8);
    expect(step8?.label).toBe('Pole Label');
    // Signature is an activation step — it must NOT appear in the civil set.
    expect(CIVIL_STEPS.some((s) => s.label === 'Signature')).toBe(false);
    expect(ACTIVATION_STEPS.some((s) => s.label === 'Signature')).toBe(true);
  });
});

describe('civil checklist drift guard', () => {
  it('civil steps 1–7 labels stay aligned with construction-qa CIVIL_CHECKLIST', () => {
    for (const canonical of CIVIL_CHECKLIST) {
      const siteCamStep = CIVIL_STEPS.find((s) => s.number === canonical.step);
      expect(siteCamStep?.label, `civil step ${canonical.step}`).toBe(canonical.label);
    }
  });
});

describe('toGalleryJobType', () => {
  it('maps the plural UI job type to the singular DB gallery vocabulary', () => {
    expect(toGalleryJobType('activations')).toBe('activation');
    expect(toGalleryJobType('civils')).toBe('civils');
  });
});

describe('activation VLM coverage', () => {
  it('steps 3 and 4 are VLM-checked (regression: they were silently auto-accepted)', () => {
    expect(ACTIVATION_STEPS.find((s) => s.number === 3)?.hasVlm).toBe(true);
    expect(ACTIVATION_STEPS.find((s) => s.number === 4)?.hasVlm).toBe(true);
  });

  it('skips the VLM for step 6 (serial-scan) and step 10 (customer sign-off)', () => {
    const nonVlm = ACTIVATION_STEPS.filter((s) => !s.hasVlm).map((s) => s.number);
    expect(nonVlm).toEqual([6, 10]);
  });

  it('step 6 (ONT) is the ONLY serial-scan step — step 8 Final Installation is VLM-only', () => {
    const serialSteps = ACTIVATION_STEPS.filter((s) => s.hasSerialScan).map((s) => s.number);
    expect(serialSteps).toEqual([6]);
    const step8 = ACTIVATION_STEPS.find((s) => s.number === 8);
    expect(step8?.hasSerialScan).toBe(false);
    expect(step8?.serialDevice).toBeUndefined();
  });
});

describe('gallery upload allow-list', () => {
  it('only the Dome Joint shots allow gallery upload', () => {
    const uploadable = ACTIVATION_STEPS.filter((s) => s.allowUpload).map((s) => s.label);
    expect(uploadable).toEqual(['Dome Joint Open', 'Dome Joint Closed']);
  });

  it('no civil step allows gallery upload (camera-only)', () => {
    expect(CIVIL_STEPS.some((s) => s.allowUpload)).toBe(false);
  });
});

describe('customer sign-off step', () => {
  const signature = ACTIVATION_STEPS.find((s) => s.number === 10);

  it('step 10 (Signature) is a sign-off step, not a photo/upload step', () => {
    expect(signature?.label).toBe('Signature');
    expect(signature?.signature).toBe(true);
    expect(signature?.allowUpload).toBeFalsy();
  });

  it('is not VLM-graded (a drawn signature is not a gradeable photo)', () => {
    expect(signature?.hasVlm).toBe(false);
  });

  it('is the only signature step, and only for activations', () => {
    expect(ACTIVATION_STEPS.filter((s) => s.signature)).toHaveLength(1);
    expect(CIVIL_STEPS.some((s) => s.signature)).toBe(false);
  });
});
