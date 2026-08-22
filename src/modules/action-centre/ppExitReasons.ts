/**
 * The pre-provision exit-reason vocabulary — single source of truth.
 *
 * Three places must agree on this list: the CHECK constraint in migration 524,
 * the API's request validation, and the dropdown. When they drift, a request
 * passes validation and then dies as a Postgres 23514 AFTER the caller has been
 * told nothing was wrong. Both the API and the UI import from here, and the
 * migration test drives the database from this same constant so a divergence
 * fails a test rather than a production write.
 *
 * Adding a value means editing this list AND adding it to the constraint in a
 * new migration. Seven is deliberately near the ceiling: past that a dropdown
 * stops being classified and becomes "first plausible option".
 */
export const PP_EXIT_REASONS = [
  'ont_faulty',
  'false_positive',
  'duplicate',
  'customer_cancelled',
  'no_access',
  'moved_away',
  'unknown',
] as const;

export type PpExitReason = (typeof PP_EXIT_REASONS)[number];

/** Display text for the dropdown. Keys must cover PP_EXIT_REASONS exactly. */
export const EXIT_REASON_LABELS: Record<PpExitReason, string> = {
  ont_faulty: 'ONT faulty / RMA',
  false_positive: 'False positive',
  duplicate: 'Duplicate of a live PP',
  customer_cancelled: 'Customer cancelled',
  no_access: 'No access',
  moved_away: 'Moved away',
  unknown: 'Unknown',
};
