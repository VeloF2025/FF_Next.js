/**
 * Conformed project dimension.
 *
 * `project` is free text in every source table, so the same site appears under
 * several spellings. Without folding them, `pp_new` by project and `zone_uptake`
 * by project return lists that cannot be added together — and they fail silently,
 * which is the dangerous part.
 *
 * The canonical vocabulary is `projects.project_name`.
 *
 * ── Every alias below was resolved from data, not from its shape ──
 * Each free-text value was joined through to a real project and counted:
 *
 *   SELECT o.project, p.project_name, count(*)
 *   FROM oes_pp_data o
 *   JOIN drops d    ON d.drop_number = o.resolved_drop_number
 *   JOIN projects p ON p.id = d.project_id
 *   GROUP BY 1, 2 ORDER BY 1, 3 DESC;
 *
 * Measured 2026-08-02: TEM → Thembisa POP 1 (157/170), TEM-3 → Thembisa POP 3
 * (42/42), ETW-2 → Etwatwa.
 *
 * ⚠️ TEM and TEM-3 are DIFFERENT PROJECTS. They read like a base name and a
 * variant of it, so the intuitive move is to fold TEM-3 into TEM — that would
 * merge Thembisa POP 1 and POP 3 into a single number. An earlier draft of this
 * module did exactly that. The shape of a string is not evidence.
 *
 * ⚠️ Do not add an alias you have not resolved this way. A previous draft mapped
 * MOH and MOA to Mohadin; neither string occurs as a project value anywhere in
 * the database. That recollection was about 1Map *site codes* — a different
 * field. A speculative alias is a silent mis-grouping waiting to happen.
 *
 * To find aliases still unmapped, list values that match no canonical name:
 *
 *   SELECT DISTINCT project FROM oes_pp_data
 *   WHERE project NOT IN (SELECT btrim(project_name) FROM projects);
 */

/**
 * Alias (lowercased, trimmed) -> canonical `projects.project_name`.
 *
 * A Map, not an object literal. A plain object inherits from Object.prototype, so
 * `obj['__proto__']` returns the prototype and `obj['constructor']` returns a
 * function — both truthy, so `?? ` never fires and canonicalProject() would return
 * a non-string, diverging from SQL (which just passes those strings through) and
 * violating its own declared return type. A Map has no such keys.
 */
export const PROJECT_ALIASES: ReadonlyMap<string, string> = new Map([
  ['tem', 'Thembisa POP 1'],
  ['tem-3', 'Thembisa POP 3'],
  ['etw-2', 'Etwatwa'],
]);

/**
 * The canonical vocabulary, from `SELECT project_name FROM projects` on 2026-08-02.
 *
 * Present so a case variant of a real project ('lawley', 'MOHADIN') folds to the
 * canonical spelling instead of forming a second bucket for the same site. This is
 * NOT the speculative-alias hazard warned about above: every entry maps a name to
 * *itself*, so it cannot mis-group anything. The worst a stale list can do is leave
 * a newly-added project passing through unchanged — exactly today's behaviour.
 *
 * Note two defects in the source table, left as-is because they are that table's to
 * fix, not this module's: `'Middelburg '` carries a trailing space (handled by the
 * trim), and `'Phalaborwa - Ben Farm'` / `'Phalabrowa - Namakgale'` spell the town
 * two different ways. They are separate projects, so neither folds into the other.
 */
export const CANONICAL_NAMES: readonly string[] = [
  'Botshabelo', 'Cradock', 'Etwatwa', 'General / Equipment', 'Grabouw', 'Lawley',
  'Mahikeng', 'Mamelodi', 'Middelburg', 'Mohadin', 'Phalaborwa - Ben Farm',
  'Phalabrowa - Namakgale', "Themb'elihle", 'Thembisa POP 1', 'Thembisa POP 2',
  'Thembisa POP 3', 'Tonga',
] as const;

/** Map, not an object — same prototype-key hazard as PROJECT_ALIASES. */
const CANONICAL_BY_LOWER: ReadonlyMap<string, string> = new Map(
  CANONICAL_NAMES.map((n) => [n.toLowerCase(), n]),
);

export const UNKNOWN_PROJECT = 'Unknown';

/**
 * The exact characters trimmed from both ends, kept identical to the SQL side.
 *
 * JS `trim()` and Postgres `btrim(x)` are NOT equivalent: `trim()` strips every
 * Unicode whitespace character, while single-argument `btrim` strips **only**
 * U+0020 spaces. Measured: `btrim(E'\tTEM\t')` returns the tabs untouched, so
 * `'\tTEM\t'` would fold to 'Thembisa POP 1' in TypeScript and stay '\tTEM\t' in
 * SQL — a silent parity break on any value arriving from an Excel or CSV import.
 *
 * So both sides name the set explicitly: space, tab, LF, CR, form feed, vertical
 * tab, and NBSP (U+00A0, common in spreadsheet exports). Change one side and
 * 477_conformed_project_dimension.test.ts fails.
 */
const TRIM_CHARS = ' \t\n\r\f\v ';
const TRIM_RE = new RegExp(`^[${TRIM_CHARS}]+|[${TRIM_CHARS}]+$`, 'g');

/**
 * Fold a free-text project string to its canonical name.
 *
 * An unmapped value passes through **trimmed but otherwise unchanged**. Dropping
 * it, or bucketing it into Unknown, would silently shrink totals; an unfamiliar
 * label in the output is visible and fixable. Only null/blank becomes Unknown,
 * because that genuinely carries no project.
 *
 * Trimming also normalises the canonical table's own defect: `projects` holds
 * `'Middelburg '` with a trailing space.
 */
export function canonicalProject(raw: string | null | undefined): string {
  // Explicit character set, NOT .trim() — see TRIM_CHARS.
  const trimmed = (raw ?? '').replace(TRIM_RE, '');
  if (!trimmed) return UNKNOWN_PROJECT;
  const lower = trimmed.toLowerCase();
  // Aliases first: an alias must win over a same-spelled canonical name.
  return PROJECT_ALIASES.get(lower) ?? CANONICAL_BY_LOWER.get(lower) ?? trimmed;
}

export interface DimensionSpec {
  key: string;
  label: string;
  /** SQL expression producing the dimension value, given the metric's `src` alias. */
  expression: string;
}

export const DIMENSIONS: readonly DimensionSpec[] = [
  // ::text is explicit because source columns vary — project_weekly_zone_pon_uptake
  // .project_name is VARCHAR(100) while oes_pp_data.project is text. Implicit
  // varchar->text resolution works but fails opaquely if a source supplies a
  // different string type.
  { key: 'project', label: 'Project', expression: 'canonical_project(src.project::text)' },
  { key: 'pop', label: 'POP / OLT', expression: 'src.olt_name' },
  { key: 'zone', label: 'Zone', expression: 'src.zone_no' },
] as const;
