import { describe, it, expect } from 'vitest';
import { deriveSlotCardStatus } from '../slot-card-status';

describe('deriveSlotCardStatus', () => {
  it('empty when no photo', () => {
    expect(deriveSlotCardStatus(null, undefined)).toBe('empty');
  });
  it('pending when photo present but vlm entry is a pending marker', () => {
    expect(deriveSlotCardStatus('k', { scored: false } as never)).toBe('pending');
  });
  it('pending when photo present but no vlm entry at all', () => {
    expect(deriveSlotCardStatus('k', undefined)).toBe('pending');
  });
  it('overridden takes precedence', () => {
    expect(deriveSlotCardStatus('k', { valid: false, confidence: 0, feedback: '', overridden_by: 'u' })).toBe('overridden');
  });
  it('pass when scored valid', () => {
    expect(deriveSlotCardStatus('k', { valid: true, confidence: 0.9, feedback: '' })).toBe('pass');
  });
  it('fail when scored invalid', () => {
    expect(deriveSlotCardStatus('k', { valid: false, confidence: 0.2, feedback: '' })).toBe('fail');
  });
});
