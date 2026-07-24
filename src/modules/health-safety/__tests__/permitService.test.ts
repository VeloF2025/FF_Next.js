/**
 * H&S permit lifecycle (§7.4) — enforced server-side.
 *
 * The two invariants a blind UI cannot be trusted with: an expired permit
 * blocks every transition, and approval requires all mandatory preconditions.
 */

import { describe, it, expect } from 'vitest';
import { effectivePermitStatus, checkTransition } from '../services/permitService';
import { PERMIT_STATUS_TRANSITIONS } from '../types/permit.types';

const NOW = new Date('2026-07-24T12:00:00Z');
const PAST = '2026-07-20T12:00:00Z';
const FUTURE = '2026-07-30T12:00:00Z';

describe('effectivePermitStatus', () => {
  it('reports an approved permit past its window as expired', () => {
    expect(effectivePermitStatus('approved', PAST, NOW)).toBe('expired');
  });
  it('reports an active permit past its window as expired', () => {
    expect(effectivePermitStatus('active', PAST, NOW)).toBe('expired');
  });
  it('leaves an in-window active permit active', () => {
    expect(effectivePermitStatus('active', FUTURE, NOW)).toBe('active');
  });
  it('never expires a requested permit (no window yet)', () => {
    expect(effectivePermitStatus('requested', PAST, NOW)).toBe('requested');
  });
  it('leaves terminal states untouched', () => {
    expect(effectivePermitStatus('closed', PAST, NOW)).toBe('closed');
    expect(effectivePermitStatus('rejected', PAST, NOW)).toBe('rejected');
  });
  it('does not expire when valid_to is null (open-ended)', () => {
    expect(effectivePermitStatus('active', null, NOW)).toBe('active');
  });
});

describe('checkTransition', () => {
  const met = { allPreconditionsMet: true };
  const unmet = { allPreconditionsMet: false };

  it('allows requested → approved only when preconditions are met', () => {
    expect(checkTransition('requested', 'approved', met).ok).toBe(true);
    expect(checkTransition('requested', 'approved', unmet).ok).toBe(false);
  });

  it('allows requested → rejected without preconditions', () => {
    expect(checkTransition('requested', 'rejected', unmet).ok).toBe(true);
  });

  it('allows approved → active and active → closed', () => {
    expect(checkTransition('approved', 'active', met).ok).toBe(true);
    expect(checkTransition('active', 'closed', met).ok).toBe(true);
  });

  it('blocks EVERY transition from an expired permit', () => {
    for (const target of ['approved', 'active', 'closed', 'rejected'] as const) {
      expect(checkTransition('expired', target, met).ok).toBe(false);
    }
  });

  it('blocks illegal jumps (requested → active)', () => {
    expect(checkTransition('requested', 'active', met).ok).toBe(false);
  });

  it('treats closed/rejected as terminal', () => {
    expect(PERMIT_STATUS_TRANSITIONS.closed).toHaveLength(0);
    expect(PERMIT_STATUS_TRANSITIONS.rejected).toHaveLength(0);
    expect(checkTransition('closed', 'active', met).ok).toBe(false);
  });
});
