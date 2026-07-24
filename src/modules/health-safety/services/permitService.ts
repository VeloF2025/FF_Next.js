/**
 * H&S Permit service — lifecycle transition + expiry enforcement (§7.4)
 *
 * Two invariants, both enforced server-side (never trusted from the UI):
 *  1. A status change must be a legal edge in PERMIT_STATUS_TRANSITIONS.
 *  2. A permit whose validity window has lapsed is EXPIRED regardless of its
 *     stored status — an expired permit must visibly block, not silently lapse.
 */

import { PERMIT_STATUS_TRANSITIONS, type PermitStatus, type PermitPrecondition } from '../types/permit.types';

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

/** Terminal states — no further transitions and (server-side) no field edits. */
export const TERMINAL_PERMIT_STATUSES: PermitStatus[] = ['closed', 'expired', 'rejected'];

/** Every mandatory precondition of the type is present in the confirmed set. */
export function allMandatoryPreconditionsMet(preconditions: PermitPrecondition[], confirmed: string[]): boolean {
  const set = new Set(confirmed);
  return preconditions.filter((p) => p.required).every((p) => set.has(p.text));
}

/**
 * The status a permit effectively has right now. If it is stored as approved or
 * active but its valid_to has passed, it is expired — this is what the gate and
 * the UI must treat it as. Terminal states and requested/rejected are unaffected.
 */
export function effectivePermitStatus(stored: PermitStatus, validTo: string | Date | null, now: Date): PermitStatus {
  if ((stored === 'approved' || stored === 'active') && validTo != null) {
    const to = validTo instanceof Date ? validTo : new Date(validTo);
    if (to.getTime() < now.getTime()) return 'expired';
  }
  return stored;
}

/**
 * Whether a requested transition is allowed, given the permit's EFFECTIVE status
 * (so you cannot, e.g., activate an already-expired permit). Also enforces the
 * preconditions gate on requested → approved.
 */
export function checkTransition(
  effectiveStatus: PermitStatus,
  target: PermitStatus,
  opts: { allPreconditionsMet: boolean }
): TransitionCheck {
  const allowed = PERMIT_STATUS_TRANSITIONS[effectiveStatus] || [];
  if (!allowed.includes(target)) {
    return {
      ok: false,
      reason: `Cannot transition from '${effectiveStatus}' to '${target}'. Allowed: ${allowed.length ? allowed.join(', ') : 'none (terminal)'}`,
    };
  }
  if (target === 'approved' && !opts.allPreconditionsMet) {
    return { ok: false, reason: 'All mandatory preconditions must be confirmed before approval' };
  }
  return { ok: true };
}
