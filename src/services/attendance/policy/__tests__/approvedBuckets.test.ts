import { describe, expect, it } from 'vitest';

import {
  ApprovedBucketInvariantError,
  approvedBucketInvariantSql,
  assertApprovedBucketInvariant,
} from '../approvedBuckets';

const zeroes = {
  regular: 0,
  overtime: 0,
  sunday: 0,
  holiday: 0,
  leave: 0,
  unpaid: 0,
};

describe('canonical approved attendance bucket invariant', () => {
  it.each([
    [null, { ...zeroes, regular: 8, overtime: 1 }],
    [null, { ...zeroes, sunday: 5 }],
    ['approved_leave', { ...zeroes, leave: 8 }],
    ['sick_leave', { ...zeroes, leave: 8 }],
    ['site_shutdown_weather', { ...zeroes, regular: 8 }],
    ['public_holiday', { ...zeroes, holiday: 8 }],
    ['unauthorised_absence', { ...zeroes, unpaid: 8 }],
  ] as const)('accepts the valid %s bucket family', (classification, buckets) => {
    expect(() => assertApprovedBucketInvariant(classification, buckets)).not.toThrow();
  });

  it.each([
    [null, { ...zeroes, regular: 5, sunday: 5 }],
    [null, { ...zeroes, regular: 5, holiday: 5 }],
    [null, { ...zeroes, sunday: 5, holiday: 5 }],
    [null, { ...zeroes, leave: 8 }],
    ['approved_leave', { ...zeroes, regular: 8, leave: 8 }],
    ['site_shutdown_weather', { ...zeroes, leave: 8 }],
    ['public_holiday', { ...zeroes, regular: 8 }],
    ['public_holiday', { ...zeroes, regular: 8, holiday: 8 }],
    ['unauthorised_absence', { ...zeroes, regular: 8, unpaid: 8 }],
  ] as const)('rejects contradictory %s buckets', (classification, buckets) => {
    expect(() => assertApprovedBucketInvariant(classification, buckets))
      .toThrow(ApprovedBucketInvariantError);
  });

  it('rejects non-finite, negative, over-cap and over-day values', () => {
    for (const buckets of [
      { ...zeroes, regular: Number.NaN },
      { ...zeroes, regular: -1 },
      { ...zeroes, overtime: 16 },
      { ...zeroes, regular: 20, overtime: 5 },
    ]) {
      expect(() => assertApprovedBucketInvariant(null, buckets))
        .toThrow(ApprovedBucketInvariantError);
    }
  });

  it('makes the SQL form reject unknown non-null classifications', () => {
    const sql = approvedBucketInvariantSql('ds');
    expect(sql).toMatch(/ELSE\s+ds\.attendance_classification\s+IS\s+NULL/i);
  });
});
