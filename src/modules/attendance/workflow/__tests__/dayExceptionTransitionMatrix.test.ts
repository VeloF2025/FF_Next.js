import { describe, expect, it } from 'vitest';

import { permittedDecisionActions } from '../dayExceptionDecisionValidation';
import type { DayExceptionKind, DayExceptionStatus } from '../types';

const workedKinds: DayExceptionKind[] = [
  'late_arrival', 'early_departure', 'outside_schedule',
  'sunday_work', 'public_holiday_work', 'evidence_unreliable',
];

function actions(args: {
  kind: DayExceptionKind;
  status: DayExceptionStatus;
  adjustmentStatus?: string | null;
}) {
  return permittedDecisionActions({
    kind: args.kind,
    status: args.status,
    adjustmentId: args.adjustmentStatus ? 'adjustment-1' : null,
    adjustmentStatus: args.adjustmentStatus ?? null,
  });
}

describe('day-exception kind x state x action matrix', () => {
  it.each(workedKinds)('permits only approve for awaiting-supervisor %s', (kind) => {
    expect(actions({ kind, status: 'awaiting_supervisor' })).toEqual(['approve']);
  });

  it('permits only absence classification for a missing clock-in', () => {
    expect(actions({ kind: 'missing_clock_in', status: 'awaiting_supervisor' }))
      .toEqual(['classify']);
  });

  it('permits approve and return only after a missing-out correction is pending', () => {
    expect(actions({
      kind: 'missing_clock_out',
      status: 'awaiting_supervisor',
      adjustmentStatus: 'pending',
    })).toEqual(['approve', 'return']);
  });

  it.each([
    ['awaiting worker', { kind: 'missing_clock_out', status: 'awaiting_worker' }],
    ['missing linked correction', { kind: 'missing_clock_out', status: 'awaiting_supervisor' }],
    ['non-pending correction', {
      kind: 'missing_clock_out', status: 'awaiting_supervisor', adjustmentStatus: 'approved',
    }],
    ['open worked exception', { kind: 'sunday_work', status: 'open' }],
    ['resolved exception', { kind: 'late_arrival', status: 'resolved' }],
    ['cancelled exception', { kind: 'missing_clock_in', status: 'cancelled' }],
  ] as const)('permits no action for %s', (_label, state) => {
    expect(actions(state)).toEqual([]);
  });
});
