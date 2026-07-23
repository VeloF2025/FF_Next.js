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

/**
 * Open OLT-recon states, in the shape the data-sync UI buckets them. `pending`
 * is the Fixable tab; the rest are the Investigate tab's sub-filters.
 */
export type OltFixStatus =
  | 'pending'
  | 'not_found'
  | 'serial_other_dr'
  | 'needs_investigation'
  | 'needs_reinvestigation'
  | 'empty_serial';

/** Every state the report treats as an open OLT item (matches the two tabs). */
export const OLT_OPEN_STATES: OltFixStatus[] = [
  'pending',
  'not_found',
  'serial_other_dr',
  'needs_investigation',
  'needs_reinvestigation',
  'empty_serial',
];

/**
 * Row label per state — deliberately the *same wording* as the Investigate tab's
 * sub-filter chips and the Fixable tab, so a row in the workbook is findable in
 * the UI by the same name.
 */
export const OLT_ISSUE_LABEL: Record<OltFixStatus, string> = {
  pending: 'Fixable — serial mismatch',
  not_found: 'Not on 1Map',
  serial_other_dr: 'Serial on Other DR',
  needs_investigation: 'Cross-DR Conflict',
  needs_reinvestigation: 'Cross-DR Conflict',
  empty_serial: 'Other',
};

/**
 * Label a row the way the UI would route it. `fix_status` alone is not enough:
 * the Fixable tab is `pending AND olt_serial IS NOT NULL`, and a `pending` row
 * with no OES serial falls through to Investigate's catch-all "Other" chip
 * (`pages/api/system/olt-report/records.ts` — `OR r.olt_serial IS NULL`).
 * Calling such a row "Fixable" would send the field team to the wrong tab.
 *
 * The row is still reported — it is genuinely open — only its label changes.
 */
export function oltIssueLabel(status: OltFixStatus, hasOesSerial: boolean): string {
  if (status === 'pending' && !hasOesSerial) return OLT_ISSUE_LABEL.empty_serial;
  return OLT_ISSUE_LABEL[status];
}

/**
 * Fibertime deduction note a state maps to. Note 2 = "No entry/submission on
 * Field App" (the DR/serial is absent from 1Map); Note 4 = "Inaccurate: Drop# &
 * ONT SN does not match" (present but wrong). Drives the caption breakdown.
 */
export type OltNote = 'note2' | 'note4';

export function oltNoteFor(status: OltFixStatus): OltNote {
  return status === 'not_found' || status === 'serial_other_dr' ? 'note2' : 'note4';
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
