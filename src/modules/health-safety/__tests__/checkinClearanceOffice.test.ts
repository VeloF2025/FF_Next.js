import { describe, it, expect } from 'vitest';
import { deriveClearance } from '@/modules/health-safety/services/checkinClearance';

const officeBase = {
  work_location: 'office' as const,
  fit_for_duty: true,
  ppe_complete: true,
  declared_activities: [],
  medical_status: 'missing' as const,
};

describe('deriveClearance — office declarations', () => {
  it('clears a fit office worker with no medical certificate', () => {
    // The office path never asks about height or plant work, so a missing
    // certificate is not evidence of anything.
    const result = deriveClearance(officeBase);
    expect(result.clearance).toBe('cleared');
    expect(result.blocked_reasons).toEqual([]);
  });

  it('blocks an office worker who declares themselves unfit', () => {
    const result = deriveClearance({ ...officeBase, fit_for_duty: false });
    expect(result.clearance).toBe('blocked');
    expect(result.blocked_reasons).toEqual(['self_declared_unfit']);
  });

  it('raises no PPE warning for an office declaration', () => {
    // ppe_complete is not asked on the office path; it arrives false by
    // default and must not become a finding on the officer board.
    const result = deriveClearance({ ...officeBase, ppe_complete: false });
    expect(result.warnings).toEqual([]);
  });

  it('still blocks a site worker with an expired medical for height work', () => {
    // Pins that the office branch did not weaken the site rule.
    const result = deriveClearance({
      work_location: 'site',
      fit_for_duty: true,
      ppe_complete: true,
      declared_activities: ['working_at_heights'],
      medical_status: 'expired',
    });
    expect(result.clearance).toBe('blocked');
    expect(result.blocked_reasons).toContain('medical_not_current');
  });
});
