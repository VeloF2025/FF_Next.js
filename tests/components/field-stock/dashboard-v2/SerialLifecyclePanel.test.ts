import { describe, it, expect } from 'vitest';
import { activatedSharePct } from '@/components/field-stock/dashboard-v2/SerialLifecyclePanel';

describe('activatedSharePct', () => {
  it('returns 0 when installed and activated are both 0 (no divide-by-zero)', () => {
    expect(activatedSharePct(0, 0)).toBe(0);
  });
  it('computes a bounded percentage of installed+activated', () => {
    expect(activatedSharePct(129, 1412)).toBe(92);
  });
  it('returns 100 when all are activated', () => {
    expect(activatedSharePct(0, 50)).toBe(100);
  });
});
