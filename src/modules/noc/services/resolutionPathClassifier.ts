/**
 * Resolution Path Classifier
 *
 * Maps the signals a ticket carries at creation time onto a ResolutionPath,
 * which downstream drives:
 *  - the verification step template the technician sees on /snag/resolve/[token]
 *  - the Context Panel variant (Photos / Data / Site)
 *  - dispatch routing
 *
 * Returns 'triage_required' when the signals are ambiguous; the resolve page
 * will then show a single classification step on first interaction.
 *
 * This is a pure function — no DB access. Callers are expected to gather the
 * signals (ticket_category, ticket_type, dr_number presence, etc.) and pass
 * them in. Tests live alongside this file.
 */

import { ResolutionPath, TicketType } from '../types/ticket';

export interface ClassifierInput {
  /**
   * The free-form ticket_category string written by ticket creators. PP-data
   * tickets use sub-type strings like 'pre_provision', 'home_signup_not_done',
   * 'ont_swap', 'new_installation', 'fault_repair', 'modification'. Other
   * creators use TicketCategory enum values ('snag', 'maintenance', etc.).
   * Pass exactly what was written to maintenance_tickets.ticket_category.
   */
  ticket_category?: string | null;
  /** The discipline (TicketType enum value) — civils / optical / activations / maintenance / dev_ops. */
  ticket_type?: TicketType | string | null;
  /** Whether the ticket has a resolved DR number. */
  hasDrNumber: boolean;
  /**
   * Optional richer signal from the detector that created the ticket.
   * E.g. PP-data ingest knows whether the DR appears in OES, 1Map, OLT.
   * When present, this overrides the category-based heuristic.
   */
  detection?: {
    inOes?: boolean;
    inOneMap?: boolean;
    inOlt?: boolean;
    /** OES recorded serial differs from 1Map / OLT serial */
    serialMismatch?: boolean;
    /** Project tag in source data conflicts with assigned project */
    projectMismatch?: boolean;
  };
}

/**
 * Classify a ticket to its resolution path.
 *
 * Order of precedence:
 *   1. detection signals (most specific)
 *   2. ticket_category heuristic
 *   3. ticket_type fallback
 *   4. triage_required (the safe default)
 */
export function classifyResolutionPath(input: ClassifierInput): ResolutionPath {
  const { ticket_category, ticket_type, hasDrNumber, detection } = input;

  // Disciplines that don't follow this routing model.
  if (
    ticket_type === TicketType.DEV_OPS ||
    ticket_category === 'dev_ops' ||
    ticket_category === 'hse_incident' ||
    ticket_category === 'hse_near_miss' ||
    ticket_category === 'sales_lead'
  ) {
    return ResolutionPath.NOT_APPLICABLE;
  }

  // 1. Detection-driven classification (preferred when available).
  if (detection) {
    if (detection.serialMismatch) return ResolutionPath.FIX_SERIAL;
    if (detection.projectMismatch) return ResolutionPath.FIX_PROJECT_TAG;

    // DR present somewhere but not everywhere = data gap (no field work).
    const sourcesPresent = [detection.inOes, detection.inOneMap, detection.inOlt].filter(Boolean).length;
    const sourcesKnown = [detection.inOes, detection.inOneMap, detection.inOlt].filter(
      (v) => typeof v === 'boolean',
    ).length;
    if (sourcesKnown >= 2 && sourcesPresent >= 1 && sourcesPresent < sourcesKnown) {
      return ResolutionPath.INVESTIGATE_DATA_GAP;
    }

    // Nothing anywhere + no DR = home sign-up never happened.
    if (sourcesKnown >= 2 && sourcesPresent === 0 && !hasDrNumber) {
      return ResolutionPath.DISPATCH_SIGNUP;
    }
  }

  // 2. Category heuristic (PP-data sub-types + canonical categories).
  switch (ticket_category) {
    case 'snag':
    case 'internal_snag':
      return ResolutionPath.SNAG;
    case 'home_signup_not_done':
      return ResolutionPath.DISPATCH_SIGNUP;
    case 'ont_swap':
      return ResolutionPath.FIX_SERIAL;
    case 'new_installation':
      return ResolutionPath.INSTALL;
    case 'fault_repair':
    case 'modification':
    case 'maintenance':
      return ResolutionPath.MAINTENANCE;
    case 'pre_provision':
      // Without a DR we can't decide between data-gap, missing-signup, or
      // wrong-project — defer to the technician.
      return hasDrNumber ? ResolutionPath.INVESTIGATE_DATA_GAP : ResolutionPath.TRIAGE_REQUIRED;
    default:
      break;
  }

  // 3. Discipline fallback when category is missing.
  if (ticket_type === TicketType.CIVILS || ticket_type === TicketType.OPTICAL) {
    return ResolutionPath.SNAG;
  }
  if (ticket_type === TicketType.MAINTENANCE) {
    return ResolutionPath.MAINTENANCE;
  }
  if (ticket_type === TicketType.ACTIVATIONS && hasDrNumber) {
    return ResolutionPath.INSTALL;
  }

  // 4. Safe default — the resolve page surfaces a classification step.
  return ResolutionPath.TRIAGE_REQUIRED;
}

/**
 * Type guard for ResolutionPath strings (e.g. from DB rows).
 */
export function isResolutionPath(value: unknown): value is ResolutionPath {
  return typeof value === 'string' && (Object.values(ResolutionPath) as string[]).includes(value);
}
