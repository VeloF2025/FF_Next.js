/**
 * Unit tests for the shared HR-visibility SQL fragments (Slice B).
 *
 * These pin the exact clause text so the ~19 surfaces that interpolate them
 * cannot drift, and assert the NULL-handling that keeps legacy employees
 * visible. Behavioural (does-it-actually-hide) coverage lives in the
 * DB-gated hiding-audit test.
 */

import { describe, it, expect } from 'vitest';
import {
  hrEmployeePredicate,
  approvedAccountPredicate,
  HR_EXCLUDED_ROLES,
} from '../hrVisibilityFilters';

describe('hrEmployeePredicate (Rule H)', () => {
  it('defaults to the "s" alias', () => {
    expect(hrEmployeePredicate()).toBe(
      "(s.role NOT IN ('technician','casual') OR s.role IS NULL)"
    );
  });

  it('emits bare column refs for an empty alias', () => {
    expect(hrEmployeePredicate('')).toBe(
      "(role NOT IN ('technician','casual') OR role IS NULL)"
    );
  });

  it('supports an arbitrary alias', () => {
    expect(hrEmployeePredicate('emp')).toBe(
      "(emp.role NOT IN ('technician','casual') OR emp.role IS NULL)"
    );
  });

  it('keeps NULL-role rows visible (explicit OR … IS NULL)', () => {
    // NOT IN with a NULL operand yields NULL, which would drop NULL-role
    // legacy employees — the OR … IS NULL clause is what keeps them visible.
    expect(hrEmployeePredicate('s')).toContain('OR s.role IS NULL');
  });

  it('excludes exactly technician + casual', () => {
    expect(HR_EXCLUDED_ROLES).toEqual(['technician', 'casual']);
  });
});

describe('approvedAccountPredicate (Rule P)', () => {
  it('defaults to the "s" alias and LOWER()s mixed-case status', () => {
    expect(approvedAccountPredicate()).toBe(
      "(s.account_status IS NULL OR LOWER(s.account_status) <> 'pending')"
    );
  });

  it('emits bare column refs for an empty alias', () => {
    expect(approvedAccountPredicate('')).toBe(
      "(account_status IS NULL OR LOWER(account_status) <> 'pending')"
    );
  });

  it('keeps NULL-account_status rows visible (legacy employees)', () => {
    expect(approvedAccountPredicate('s')).toContain('s.account_status IS NULL OR');
  });

  it('only hides pending — approved/suspended pass', () => {
    expect(approvedAccountPredicate('s')).toContain("<> 'pending'");
    expect(approvedAccountPredicate('s')).not.toContain('active');
    expect(approvedAccountPredicate('s')).not.toContain('suspended');
  });
});
