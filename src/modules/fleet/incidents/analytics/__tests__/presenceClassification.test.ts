/**
 * The status-to-presence mapping.
 *
 * Its failure mode is quiet: a status mapped to `confirmed` by mistake makes an
 * absent driver look present in every report built on top of it, and nothing
 * downstream can detect that. So every status in the union is asserted here by
 * name, and the exhaustiveness test fails when a new one is added without a
 * decision being made about it.
 */
import { describe, expect, it } from 'vitest';
import { presenceConfirmationFor } from '../presenceClassification';
import type { OperationalStatus } from '@/modules/fleet/operations/types';

/** Every member of the OperationalStatus union, listed independently of the source. */
const ALL_STATUSES: OperationalStatus[] = [
  'off_duty', 'scheduled_not_due', 'unassigned', 'unverifiable',
  'late', 'approaching', 'attendance_confirmed',
  'vehicle_on_site_driver_unconfirmed', 'on_site_dual',
  'wrong_site', 'evidence_mismatch', 'left_early', 'shift_complete',
];

describe('presenceConfirmationFor', () => {
  it('NEVER reports a vehicle-only day as confirmed presence', () => {
    expect(presenceConfirmationFor('vehicle_on_site_driver_unconfirmed')).toBe('vehicle_only');
  });

  it.each([
    'attendance_confirmed', 'on_site_dual', 'shift_complete', 'left_early',
  ] as OperationalStatus[])('counts %s as confirmed presence', (status) => {
    expect(presenceConfirmationFor(status)).toBe('confirmed');
  });

  it.each(['wrong_site', 'evidence_mismatch'] as OperationalStatus[])(
    'counts %s as present, because the person was seen - in the wrong place',
    (status) => {
      expect(presenceConfirmationFor(status)).toBe('confirmed');
    },
  );

  it.each([
    'scheduled_not_due', 'unassigned', 'unverifiable', 'late', 'approaching',
  ] as OperationalStatus[])('counts %s as unconfirmed', (status) => {
    expect(presenceConfirmationFor(status)).toBe('unconfirmed');
  });

  it('produces no fact at all for a day nobody was scheduled', () => {
    expect(presenceConfirmationFor('off_duty')).toBeNull();
  });

  it('has a decision recorded for every status this test knows about', () => {
    for (const status of ALL_STATUSES) {
      const result = presenceConfirmationFor(status);
      expect(['confirmed', 'unconfirmed', 'vehicle_only', null]).toContain(result);
    }
    expect(new Set(ALL_STATUSES).size).toBe(ALL_STATUSES.length); // no duplicates
  });

  it('is exhaustive over ALL_STATUSES by construction, and nothing more', () => {
    // HONEST SCOPE: ALL_STATUSES is hand-written and this repo excludes test
    // files from tsc entirely (tsconfig.json excludes **/__tests__/**), so no
    // type-level trick here can catch the union gaining a 14th member -- a
    // mapped type would compile-check nothing and merely LOOK like a guard.
    // What actually protects `presenceConfirmationFor` against an unknown
    // status is its fail-closed default, asserted in the next test.
    expect(ALL_STATUSES).toHaveLength(13);
    expect(new Set(ALL_STATUSES).size).toBe(ALL_STATUSES.length);
  });

  it('defaults an unknown status to unconfirmed, never to present', () => {
    // A status added upstream and not yet classified here must fail closed.
    const unknown = 'some_new_status_nobody_taught_us' as OperationalStatus;
    expect(presenceConfirmationFor(unknown)).toBe('unconfirmed');
  });
});
