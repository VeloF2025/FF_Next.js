/**
 * Resolving "which project did they mean" — once, for every reporting section.
 *
 * Loose name matching is the advertised behaviour ("Etwatwa", "Thembisa POP 1"), so the
 * match COUNT travels with the answer: "Thembisa" matches three projects, and silently
 * returning the alphabetically first is how a PM reads POP 1's numbers as POP 3's.
 */
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';

/**
 * The only keys in `vlm_results` that are real photo slots.
 *
 * `jsonb_each` over that column returns whatever is stored, and four projects carry
 * legacy `optical_dome_NN` keys duplicating the canonical `dome_NN` slot — 2,345 of them,
 * NONE ever scored, so every one lands in "never scored" and inflates it. Mamelodi's
 * count was 38% legacy, and 452 of those had a canonical twin that WAS scored. The store
 * also holds `tray_<uuid>` and `unassigned_<uuid>` keys, which were being presented
 * beside civil_05 as failing build steps.
 */
export const CANONICAL_SLOT_KEYS_SQL = `ARRAY[${SLOT_META.map((s) => `'${s.key}'`).join(',')}]::text[]`;

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
/**
 * A captured pole that exists in the pole plan.
 *
 * `pole_qa_photos` and `poles` are independently populated and share only a label, so
 * dividing one row count by the other is not a completion ratio. QField auto-generates
 * labels (`mam-poles_2025…`, `JPEG_2025…`) for captures it cannot place, and those exist
 * in no plan: Mamelodi has 459 of them against 1,821 captures, which reported the project
 * as 92.8% built where the plan-matched figure is 69.4%. Cancelled poles compound it —
 * they leave the denominator while their captures stay in the numerator.
 *
 * `superseded_at` (migration 481) marks captures a replan left with no matching pole;
 * they are excluded for the same reason.
 */
export const CAPTURED_IN_PLAN = `
        w.superseded_at IS NULL
        AND EXISTS (
          SELECT 1 FROM poles pl
          WHERE pl.project_id = w.project_id
            AND pl.pole_number = w.pole_label
            AND pl.status IS DISTINCT FROM 'cancelled'
        )`;

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
