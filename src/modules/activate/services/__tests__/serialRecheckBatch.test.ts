/**
 * serialRecheckBatch.test.ts — unit tests for the UPS auto-correct decision.
 */
import { describe, it, expect } from 'vitest';
import { decideUpsAction } from '../serialRecheckBatchService';

const VALID_A = 'GU18W12V2509031056';
const VALID_B = 'GU18W12V2509031054';
const ONT_IN_FIELD = 'ALCLB48DB9F9';   // not a Gizzu serial
const GARBAGE = '9112284722217';        // not a Gizzu serial

describe('decideUpsAction', () => {
  it('CORRECT: 2 passes agree on valid serial and 1Map is not a valid Gizzu (slam-dunk)', () => {
    expect(decideUpsAction(VALID_A, VALID_A, ONT_IN_FIELD)).toBe('correct');
    expect(decideUpsAction(VALID_A, VALID_A, GARBAGE)).toBe('correct');
  });

  it('QUEUE: 2 passes agree on valid serial but 1Map is also a valid (different) Gizzu', () => {
    expect(decideUpsAction(VALID_A, VALID_A, VALID_B)).toBe('queue');
  });

  it('SKIP: VLM passes disagree (inconsistent read)', () => {
    expect(decideUpsAction(VALID_A, VALID_B, ONT_IN_FIELD)).toBe('skip');
  });

  it('SKIP: 2nd pass returned nothing', () => {
    expect(decideUpsAction(VALID_A, null, GARBAGE)).toBe('skip');
  });

  it('SKIP: no first-pass value', () => {
    expect(decideUpsAction(null, null, VALID_A)).toBe('skip');
  });

  it('SKIP: first pass is not a valid Gizzu serial even if passes agree', () => {
    expect(decideUpsAction('NOTASERIAL', 'NOTASERIAL', GARBAGE)).toBe('skip');
  });

  it('SKIP: passes agree and equal 1Map (no real mismatch)', () => {
    expect(decideUpsAction(VALID_A, VALID_A, VALID_A)).toBe('skip');
  });
});
