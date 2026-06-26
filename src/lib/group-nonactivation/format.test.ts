import { describe, it, expect } from 'vitest';
import {
  isCanonicalDr,
  dayDiffIso,
  addDaysIso,
  RESIDUAL_LABEL,
  type ResidualClass,
} from './format';

describe('group-nonactivation/format', () => {
  describe('isCanonicalDr', () => {
    it('accepts a canonical 7-digit DR', () => {
      expect(isCanonicalDr('DR1857119')).toBe(true);
    });
    it('rejects typo / placeholder DR shapes', () => {
      expect(isCanonicalDr('DR185729')).toBe(false); // 6 digits
      expect(isCanonicalDr('DR NEEDED')).toBe(false);
      expect(isCanonicalDr('ACTIVATION NEEDED')).toBe(false);
      expect(isCanonicalDr('dr1857119')).toBe(false); // lowercase prefix
    });
  });

  describe('dayDiffIso', () => {
    it('returns whole-day difference, tz-independent', () => {
      expect(dayDiffIso('2026-06-25', '2026-06-26')).toBe(1);
      expect(dayDiffIso('2026-06-11', '2026-06-26')).toBe(15);
      expect(dayDiffIso('2026-06-26', '2026-06-26')).toBe(0);
    });
    it('handles month boundaries', () => {
      expect(dayDiffIso('2026-05-31', '2026-06-01')).toBe(1);
    });
  });

  describe('addDaysIso', () => {
    it('shifts a date forward and backward', () => {
      expect(addDaysIso('2026-06-25', -1)).toBe('2026-06-24');
      expect(addDaysIso('2026-06-25', -13)).toBe('2026-06-12');
      expect(addDaysIso('2026-06-01', -1)).toBe('2026-05-31');
    });
  });

  describe('RESIDUAL_LABEL', () => {
    it('has a human label for every residual class', () => {
      const classes: ResidualClass[] = [
        'resolved',
        'resolvable',
        'placeholder',
        'in_stock_no_install',
        'unknown',
      ];
      for (const c of classes) {
        expect(RESIDUAL_LABEL[c]).toBeTruthy();
      }
    });
  });
});
