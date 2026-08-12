/**
 * Resolving "which project did they mean" — once, for every reporting section.
 *
 * Loose name matching is the advertised behaviour ("Etwatwa", "Thembisa POP 1"), so the
 * match COUNT travels with the answer: "Thembisa" matches three projects, and silently
 * returning the alphabetically first is how a PM reads POP 1's numbers as POP 3's.
 */

/** LIKE wildcards escaped so `project=%` cannot silently become "all of them". */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Predicate against a `projects p`, pushing its value onto the shared params array. */
export function projectPredicate(project: string, params: unknown[]): string {
  if (UUID.test(project)) {
    params.push(project);
    return `p.id = $${params.length}::uuid`;
  }
  params.push(`%${escapeLike(project)}%`);
  return `p.project_name ILIKE $${params.length}`;
}

/**
 * The `target` and `matches` CTEs every section starts from.
 *
 * `matches` is deliberately a second scan rather than a window over `target`: `target`
 * is LIMIT 1, so it cannot report how many it discarded.
 */
export function targetCte(project: string, params: unknown[]): string {
  const predicate = projectPredicate(project, params);
  const matchPredicate = projectPredicate(project, params);
  return `
      target AS (
        SELECT p.id, p.project_name, p.status
        FROM projects p WHERE ${predicate}
        ORDER BY p.project_name LIMIT 1
      ),
      matches AS (
        SELECT count(*)::bigint n FROM projects p WHERE ${matchPredicate}
      )`;
}

/** Caveats every section carries, whatever it measures. */
export function baseCaveats(projectName: string, nameMatches: number): string[] {
  const caveats = [
    'Actuals only. FibreFlow holds no maintained schedule, so nothing here states whether the project is ahead of or behind plan.',
  ];
  if (nameMatches > 1) {
    caveats.push(
      `"${projectName}" was one of ${nameMatches} projects matching that name. These figures are for that project alone — name it exactly, or pass its UUID, to be sure of which.`,
    );
  }
  return caveats;
}
