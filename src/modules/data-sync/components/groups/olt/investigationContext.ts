import type { InvestigationContext } from '../../../types';

/**
 * A cross-DR conflict is the only investigation reason that drives the
 * "Check Other DR" swap workflow. That workflow POSTs `wrongSerial` and
 * `belongsToDr` to /api/system/olt-report/cross-dr-lookup, which rejects the
 * request (400) when either is missing.
 *
 * Other reasons (e.g. `status_mismatch`) carry neither field, so offering them
 * the swap panel both 400s the lookup and mislabels them as cross-DR conflicts.
 * Treat a context as swappable only when it is a genuine cross-DR conflict that
 * actually carries both fields the lookup requires.
 */
export function isCrossDrSwappable(ctx: InvestigationContext): boolean {
  return ctx.reason === 'cross_dr_conflict' && !!ctx.wrongSerial && !!ctx.belongsToDr;
}
