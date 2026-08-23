import { describe, it, expect } from 'vitest';
import { extractApiErrorMessage } from '@/lib/handleApiResponse';

const FALLBACK = 'Failed to process picking';

describe('extractApiErrorMessage', () => {
  it('folds validation details into the message instead of rendering [object Object]', () => {
    // Exactly what process.ts returns when a transfer line exceeds stock on hand.
    const body = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: {
          '9ac537f0-695f-48d0-b1cf-34b02092902e':
            'Insufficient stock of SPLIT-BF-1-16 at DC-KLM-01: required 140, available 116',
          '7e6d8c41-48d7-470c-864a-592e6ae0cb77':
            'No stock of DOME-OK5-7 recorded at DC-KLM-01',
        },
      },
    };
    const message = extractApiErrorMessage(body, FALLBACK);
    expect(message).not.toContain('[object Object]');
    expect(message).toContain('required 140, available 116');
    expect(message).toContain('No stock of DOME-OK5-7 recorded at DC-KLM-01');
  });

  it('uses error.message when there are no details', () => {
    const body = { error: { code: 'CONFLICT', message: 'holder_blocked' } };
    expect(extractApiErrorMessage(body, FALLBACK)).toBe('holder_blocked');
  });

  it('flattens array-valued details', () => {
    const body = { error: { message: 'Validation failed', details: { qty: ['too low', 'too high'] } } };
    expect(extractApiErrorMessage(body, FALLBACK)).toBe('Validation failed: too low; too high');
  });

  it('accepts a legacy string error body', () => {
    expect(extractApiErrorMessage({ error: 'Picking not found' }, FALLBACK)).toBe('Picking not found');
  });

  it('falls back when the body carries no usable message', () => {
    expect(extractApiErrorMessage({ error: { code: 'INTERNAL_ERROR' } }, FALLBACK)).toBe(FALLBACK);
    expect(extractApiErrorMessage({}, FALLBACK)).toBe(FALLBACK);
    expect(extractApiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(extractApiErrorMessage({ error: { message: '   ' } }, FALLBACK)).toBe(FALLBACK);
  });

  it('ignores non-string detail values rather than stringifying them', () => {
    const body = { error: { message: 'Validation failed', details: { stack: { deep: 1 } } } };
    expect(extractApiErrorMessage(body, FALLBACK)).toBe('Validation failed');
  });
});
