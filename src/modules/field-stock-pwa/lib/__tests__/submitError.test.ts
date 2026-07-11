/**
 * Tests for formatSubmitError — the issue submit must surface the server's
 * per-item validation details ("No stock of FT-ONT recorded at Garstfontein
 * DC"), not the generic envelope message "Validation failed".
 */

import { describe, it, expect } from 'vitest';
import { formatSubmitError } from '../submitError';
import { ApiError } from '../../api/request';

describe('formatSubmitError', () => {
  it('surfaces validation detail messages instead of the generic envelope message', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', {
      '84cc2348-f8a9-486f-826a-6b8b20579765': 'No stock of FT-ONT recorded at Garstfontein DC',
    });

    const msg = formatSubmitError(err);

    expect(msg).toContain('No stock of FT-ONT recorded at Garstfontein DC');
    expect(msg).not.toBe('Validation failed');
  });

  it('joins multiple detail messages', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', {
      a: 'First problem',
      b: 'Second problem',
    });

    const msg = formatSubmitError(err);

    expect(msg).toContain('First problem');
    expect(msg).toContain('Second problem');
  });

  it('ignores non-string detail values', () => {
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Validation failed', {
      a: { nested: true },
    });

    expect(formatSubmitError(err)).toBe('Validation failed');
  });

  it('falls back to the error message for non-validation ApiErrors', () => {
    const err = new ApiError(409, 'holder_blocked', 'Holder is blocked');

    expect(formatSubmitError(err)).toBe('Holder is blocked');
  });

  it('handles plain Errors and unknown values', () => {
    expect(formatSubmitError(new Error('boom'))).toBe('boom');
    expect(formatSubmitError('nope')).toBe('An unexpected error occurred. Please try again.');
  });
});
