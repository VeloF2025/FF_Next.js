import { describe, it, expect } from 'vitest';
import { buildHistoricalVlmEntry } from '../syncHistoricalEntry';

describe('buildHistoricalVlmEntry', () => {
  it('writes a pending marker when vlm_valid is null (never scored upstream)', () => {
    const e = JSON.parse(buildHistoricalVlmEntry({ slotKey: 'civil_01', vlmValid: null, vlmConfidence: null, vlmFeedback: null, source: 'qfield' }));
    expect(e.civil_01).toEqual({ scored: false });
  });
  it('writes a pending marker when vlm_valid is undefined', () => {
    const e = JSON.parse(buildHistoricalVlmEntry({ slotKey: 'civil_01', vlmValid: undefined, vlmConfidence: 0.9, vlmFeedback: 'x', source: 'qfield' }));
    expect(e.civil_01).toEqual({ scored: false });
  });
  it('keeps a real false verdict as a scored fail (NOT pending)', () => {
    const e = JSON.parse(buildHistoricalVlmEntry({ slotKey: 'civil_01', vlmValid: false, vlmConfidence: 0.8, vlmFeedback: 'no good', source: 'local' }));
    expect(e.civil_01).toEqual({ valid: false, confidence: 0.8, feedback: 'no good', scored: true });
  });
  it('keeps a real pass scored, defaulting feedback/confidence when null', () => {
    const e = JSON.parse(buildHistoricalVlmEntry({ slotKey: 'dome_02', vlmValid: true, vlmConfidence: null, vlmFeedback: null, source: 'sharepoint' }));
    expect(e.dome_02).toEqual({ valid: true, confidence: 0, feedback: 'Historical photo (sharepoint)', scored: true });
  });
});
