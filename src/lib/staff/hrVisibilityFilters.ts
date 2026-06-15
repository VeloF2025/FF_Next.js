/**
 * Shared HR-visibility SQL fragments — Slice B (field-worker HR-hiding, G2).
 *
 * Self-registered field workers are real `staff` rows (`role IN
 * ('technician','casual')`, `source='self_registered'`, `status='active'`,
 * `account_status='pending'` until approved). Because `status='active'`, they
 * — and storeman-created pending technicians — leak into HR/employee/payroll
 * surfaces. These two predicates are ANDed into the ~19 affected queries so
 * the rule is defined once here and cannot drift across call sites.
 *
 * Both return a bare boolean predicate (no leading `AND`/`WHERE`); the call
 * site supplies the keyword and the table alias. Inject into tagged templates
 * via `sql.unsafe('AND ' + predicate(alias))`, into raw `parts[]` builders by
 * pushing the predicate directly, or into plain `query(text)` strings by
 * interpolating the text.
 *
 * @see docs/superpowers/plans/2026-06-15-field-worker-self-registration-sliceB-hr-hiding.md
 */

/** Roles that identify a self-registered field worker (hidden from HR surfaces). */
export const HR_EXCLUDED_ROLES = ['technician', 'casual'] as const;

/** `alias.column`, or bare `column` when alias is empty. */
function col(alias: string, column: string): string {
  return alias ? `${alias}.${column}` : column;
}

/**
 * Rule H — HR / employee / payroll surfaces.
 * TRUE for employees, FALSE for self-registered field workers.
 *
 * The `role` CHECK constraint guarantees stored values are lowercase, so no
 * `LOWER()` is needed. The explicit `OR … IS NULL` keeps NULL-role legacy
 * employees visible — `role NOT IN (…)` is NULL (not TRUE) when role is NULL,
 * which would otherwise drop them.
 */
export function hrEmployeePredicate(alias = 's'): string {
  const role = col(alias, 'role');
  const list = HR_EXCLUDED_ROLES.map((r) => `'${r}'`).join(',');
  return `(${role} NOT IN (${list}) OR ${role} IS NULL)`;
}

/**
 * Rule P (ref form) — given a full column reference (e.g. `s.account_status`),
 * build the predicate. Used by the report `sqlHelpers.buildBaseWhere`, which
 * threads full column refs rather than aliases.
 *
 * `LOWER()` because `account_status` casing is mixed in the shared DB. The
 * `IS NULL OR` keeps legacy employees (NULL account_status) visible —
 * `NULL <> 'pending'` is NULL (not TRUE), which would otherwise drop them.
 *
 * SECURITY: `accountStatusRef` is inlined VERBATIM into SQL (no
 * parameterisation). It MUST be a hard-coded column reference such as
 * `'s.account_status'` — NEVER a request/user/DB-supplied string.
 */
export function approvedAccountPredicateRef(accountStatusRef: string): string {
  return `(${accountStatusRef} IS NULL OR LOWER(${accountStatusRef}) <> 'pending')`;
}

/**
 * Rule P — attendance / operational surfaces.
 * TRUE for everyone except PENDING (unapproved) accounts; approved technicians
 * keep showing their hours, only `account_status='pending'` is hidden.
 */
export function approvedAccountPredicate(alias = 's'): string {
  return approvedAccountPredicateRef(col(alias, 'account_status'));
}
