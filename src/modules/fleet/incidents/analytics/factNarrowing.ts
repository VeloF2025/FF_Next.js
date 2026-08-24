/**
 * The optional WHERE predicates a fact loader appends when its caller already
 * knows what it will keep.
 *
 * One definition serves every loader. A filter that narrows incidents but was
 * forgotten for monitor runs would not fail — it would return more rows than
 * the answer describes, and the extra rows would be silently dropped in JS
 * after being scanned and shipped, which is exactly the cost this exists to
 * avoid.
 *
 * No caller value is ever placed in the SQL text: each predicate carries a
 * `$n` placeholder and `params` is extended in place, so a predicate and its
 * value cannot drift apart. This is one parameterized statement with optional
 * predicates appended, not a conditional tagged-template fragment (CLAUDE.md).
 */

/**
 * What a caller already knows it will keep. Every field narrows; none widens,
 * and an absent field means "no restriction" rather than "restrict to null".
 */
export interface FactQueryScope {
  /** The projects the answer may draw on. An empty list means none of them. */
  projectIds?: readonly string[];
  operationalSiteId?: string;
  incidentType?: string;
  severity?: string;
  outcome?: string;
  staffId?: string;
  vehicleId?: string;
}

export type NarrowableField = keyof FactQueryScope;

/** The dimension fields every fact-bearing table carries. */
export const DIMENSION_FIELDS: readonly NarrowableField[] = ['projectIds', 'operationalSiteId'];

/** Everything an incident row can be narrowed by, dimensions included. */
export const INCIDENT_FIELDS: readonly NarrowableField[] = [
  ...DIMENSION_FIELDS, 'incidentType', 'severity', 'outcome', 'staffId', 'vehicleId',
];

type PredicateBuilder = (alias: string, position: number) => string;

const PREDICATES: Record<NarrowableField, PredicateBuilder> = {
  projectIds: (alias, n) => `${alias}.project_id = ANY($${n}::uuid[])`,
  operationalSiteId: (alias, n) => `${alias}.operational_site_id = $${n}::uuid`,
  incidentType: (alias, n) => `${alias}.incident_type = $${n}`,
  severity: (alias, n) => `${alias}.severity = $${n}`,
  outcome: (alias, n) => `${alias}.outcome = $${n}`,
  staffId: (alias, n) => `${alias}.staff_id = $${n}::uuid`,
  vehicleId: (alias, n) => `${alias}.vehicle_id = $${n}::uuid`,
};

function valueOf(scope: FactQueryScope, field: NarrowableField): unknown {
  return field === 'projectIds' ? [...(scope.projectIds ?? [])] : scope[field];
}

/**
 * The predicates for `fields` that `scope` actually sets, as SQL to append to a
 * WHERE clause whose fixed parameters are already bound.
 */
export function narrowingFor(
  scope: FactQueryScope | undefined,
  params: unknown[],
  alias: string,
  fields: readonly NarrowableField[],
): string {
  if (!scope) return '';
  const clauses: string[] = [];
  for (const field of fields) {
    if (scope[field] === undefined) continue;
    params.push(valueOf(scope, field));
    clauses.push(PREDICATES[field](alias, params.length));
  }
  return clauses.map((clause) => `\n    AND ${clause}`).join('');
}
