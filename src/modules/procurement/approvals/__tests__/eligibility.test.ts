import { describe, it, expect } from 'vitest';
import { isEligibleApprover } from '../eligibility';

const base = { userId: 'u1', userRole: 'project_manager', approverType: 'role',
  approverUserId: null, approverRole: 'project_manager', assignedTo: null };

describe('isEligibleApprover', () => {
  it('super_admin always eligible', () => {
    expect(isEligibleApprover({ ...base, userRole: 'super_admin', approverRole: 'x' })).toBe(true);
  });
  it('role match → eligible', () => {
    expect(isEligibleApprover(base)).toBe(true);
  });
  it('role mismatch → not eligible', () => {
    expect(isEligibleApprover({ ...base, userRole: 'field_technician' })).toBe(false);
  });
  it('named user approver match → eligible', () => {
    expect(isEligibleApprover({ ...base, approverType: 'user', approverUserId: 'u1', approverRole: null })).toBe(true);
  });
  it('named user approver mismatch → not eligible', () => {
    expect(isEligibleApprover({ ...base, approverType: 'user', approverUserId: 'u2', approverRole: null })).toBe(false);
  });
  it('assigned_to match overrides type → eligible', () => {
    expect(isEligibleApprover({ ...base, userRole: 'field_technician', approverRole: 'project_manager', assignedTo: 'u1' })).toBe(true);
  });
});
