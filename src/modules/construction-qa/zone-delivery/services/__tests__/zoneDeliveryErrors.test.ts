import { describe, expect, it } from 'vitest';
import {
  MAX_EFFECTIVE_AT_FUTURE_SKEW_MS,
  validateMeta,
} from '../zoneDeliveryErrors';

const transactionTime = new Date('2026-07-30T08:00:00.000Z');
const meta = {
  expectedRowVersion: 2,
  effectiveAt: transactionTime.toISOString(),
  source: 'supervised command',
};

describe('validateMeta', () => {
  it('allows documented clock skew and rejects materially future timestamps', () => {
    expect(() => validateMeta({
      ...meta,
      effectiveAt: new Date(
        transactionTime.valueOf() + MAX_EFFECTIVE_AT_FUTURE_SKEW_MS,
      ).toISOString(),
    }, transactionTime)).not.toThrow();

    expect(() => validateMeta({
      ...meta,
      effectiveAt: new Date(
        transactionTime.valueOf() + MAX_EFFECTIVE_AT_FUTURE_SKEW_MS + 1,
      ).toISOString(),
    }, transactionTime)).toThrowError('Effective time is too far in the future');
  });

  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    2_147_483_648,
  ])('rejects row version outside PostgreSQL integer bounds: %s', expectedRowVersion => {
    expect(() => validateMeta({
      ...meta,
      expectedRowVersion,
    }, transactionTime)).toThrowError('Valid source, row version and effective time are required');
  });
});
