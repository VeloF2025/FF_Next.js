/**
 * Pure formatting/classification helpers for the group non-activation report.
 * No DB or I/O imports — unit-testable in isolation.
 *
 * @module lib/group-nonactivation/format
 */

/** Canonical DR shape; anything else on a miss is flagged as a likely typo. */
export const DR_CANONICAL = /^DR\d{7}$/;

export function isCanonicalDr(dr: string): boolean {
  return DR_CANONICAL.test(dr);
}

export type ResidualClass =
  | 'resolved'
  | 'resolvable'
  | 'placeholder'
  | 'in_stock_no_install'
  | 'unknown';

/** Human-readable reconciliation guidance per residual class (Pre-Provision tab). */
export const RESIDUAL_LABEL: Record<ResidualClass, string> = {
  resolved: 'Resolved',
  resolvable: 'Identifiable — resolver pending',
  placeholder: 'Field sheet: DR / activation needed',
  in_stock_no_install: 'In our stock, no install recorded',
  unknown: 'Unknown — not in our system',
};

/** Whole-day difference between two YYYY-MM-DD strings (UTC-anchored; tz-safe). */
export function dayDiffIso(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Shift a YYYY-MM-DD string by N days (negative = earlier). */
export function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** group.project_name → oes_pp_data.project (only the names that differ). */
const PP_PROJECT_MAP: Record<string, string> = {
  'Thembisa POP 1': 'TEM',
  'Thembisa POP 3': 'TEM-3',
};

/** Map a group's project_name to the oes_pp_data.project value; '' if unknown/null. */
export function ppProjectFor(projectName: string | null): string {
  if (!projectName) return '';
  return PP_PROJECT_MAP[projectName] ?? projectName;
}
