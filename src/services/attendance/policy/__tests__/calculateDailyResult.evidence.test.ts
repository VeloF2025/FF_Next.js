import { describe, expect, it } from 'vitest';

import { VELOCITY_FIXED_POLICY } from '../defaultPolicy';
import { calculateDailyResult } from '../calculateDailyResult';

describe('calculateDailyResult evidence validation', () => {
  it('marks an invalid supplied clock-out unreliable before missing-clock-in routing', () => {
    const result = calculateDailyResult({
      policy: VELOCITY_FIXED_POLICY,
      evidence: {
        workDate: '2026-08-03',
        clockInAt: null,
        clockOutAt: new Date('invalid'),
        clockOutSource: 'device',
      },
      isPublicHoliday: false,
    });

    expect(result).toMatchObject({
      status: 'awaiting_supervisor',
      exceptionKinds: ['evidence_unreliable'],
    });
  });
});
