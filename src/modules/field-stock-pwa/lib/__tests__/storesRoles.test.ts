/**
 * Unit tests for isStoresAuthorised.
 *
 * The gate has two layers:
 *   1. staff.role check: 'stores' | 'admin' are admitted.
 *   2. authRole (users.role) check: 'super_admin' | 'system' bypass the staff.role gate.
 *
 * Bug 3 from #1669 follow-ups: super_admin callers were blocked because
 * 'super_admin' is not a valid StaffRole — the session only exposed staff.role,
 * not users.role. /api/my/session now returns authRole for the second-layer check.
 */

import { describe, it, expect } from 'vitest';
import { isStoresAuthorised } from '../storesRoles';

describe('isStoresAuthorised', () => {
  // ── Staff-role pass cases ────────────────────────────────────────────────

  it('stores staff.role → true', () => {
    expect(isStoresAuthorised('stores', null)).toBe(true);
  });

  it('admin staff.role → true', () => {
    expect(isStoresAuthorised('admin', null)).toBe(true);
  });

  // ── Staff-role deny cases ────────────────────────────────────────────────

  it('technician staff.role → false', () => {
    expect(isStoresAuthorised('technician', null)).toBe(false);
  });

  it('driver staff.role → false', () => {
    expect(isStoresAuthorised('driver', null)).toBe(false);
  });

  it('supervisor staff.role → false', () => {
    expect(isStoresAuthorised('supervisor', null)).toBe(false);
  });

  it('office staff.role → false', () => {
    expect(isStoresAuthorised('office', null)).toBe(false);
  });

  it('null role with no authRole → false', () => {
    expect(isStoresAuthorised(null)).toBe(false);
  });

  it('null role and null authRole → false', () => {
    expect(isStoresAuthorised(null, null)).toBe(false);
  });

  // ── AuthRole (users.role) bypass cases ──────────────────────────────────

  it('super_admin authRole with null staff.role → true (Bug 3 fix)', () => {
    // super_admin has no staff.role; must be admitted via authRole
    expect(isStoresAuthorised(null, 'super_admin')).toBe(true);
  });

  it('system authRole with null staff.role → true', () => {
    expect(isStoresAuthorised(null, 'system')).toBe(true);
  });

  it('super_admin authRole with technician staff.role → true (auth bypass)', () => {
    // A super_admin who happens to also have a technician staff record
    expect(isStoresAuthorised('technician', 'super_admin')).toBe(true);
  });

  it('system authRole with driver staff.role → true (auth bypass)', () => {
    expect(isStoresAuthorised('driver', 'system')).toBe(true);
  });

  // ── AuthRole non-bypass cases ────────────────────────────────────────────

  it('manager authRole with null staff.role → false (manager not in STORES_AUTH_ROLES)', () => {
    expect(isStoresAuthorised(null, 'manager')).toBe(false);
  });

  it('technician authRole with null staff.role → false', () => {
    expect(isStoresAuthorised(null, 'technician')).toBe(false);
  });

  it('viewer authRole with null staff.role → false', () => {
    expect(isStoresAuthorised(null, 'viewer')).toBe(false);
  });

  it('storeman authRole (not a staff.role) with null staff.role → false', () => {
    // 'storeman' is an AuthRole but not in STORES_AUTH_ROLES
    expect(isStoresAuthorised(null, 'storeman')).toBe(false);
  });

  // ── Combined cases (authRole not provided) ───────────────────────────────

  it('stores staff.role without authRole argument → true (backward compat)', () => {
    // authRole is optional — existing callers that omit it must still work
    expect(isStoresAuthorised('stores')).toBe(true);
  });

  it('technician staff.role without authRole argument → false', () => {
    expect(isStoresAuthorised('technician')).toBe(false);
  });
});
