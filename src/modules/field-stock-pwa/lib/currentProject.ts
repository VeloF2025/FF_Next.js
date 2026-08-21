/**
 * currentProject.ts — which project is this worker on TODAY, and do we need to ask?
 *
 * Three signals exist, of decreasing freshness:
 *
 *   1. Today's H&S daily check-in. Already asked every morning, already carries
 *      a project, and is geofenced. 15 of 26 technicians used it in the last 7
 *      days (2026-08-21).
 *   2. An explicit declaration the worker gave in the portal today.
 *   3. `staff.declared_project_id` — set ONCE at self-registration and never
 *      refreshed. Measured against the same workers' latest check-in, it
 *      disagreed for 5 of 15: stale one time in three.
 *
 * So (3) is a fallback for display, never a reason to skip asking. And when (1)
 * already holds today's answer we must NOT ask again — a worker who has just
 * completed the morning check-in should not be interrogated a second time.
 *
 * Field workers move between sites, so "today" is the right window: a project
 * declared last week says nothing about where someone is standing now.
 *
 * Only FIELD workers are asked, and that is decided by behaviour rather than by
 * role. Roles do not carry the answer here: 89 of the staff rows have a NULL
 * role, and 18 of those — plus 9 `casual` and even one `admin` — have real
 * project check-ins, while `stores` and `supervisor` have none (2026-08-21).
 * A role allow-list would both miss real field workers and prompt office staff.
 * Having ever checked in against a project, or carrying a standing declaration,
 * is direct evidence that the question means something to this person.
 */

export type ProjectSource = 'checkin-today' | 'declared-today' | 'stale-declaration' | 'none';

export interface ProjectSignals {
  /** projects.id from an H&S check-in made today, if any. */
  checkinTodayProjectId?: string | null;
  /** projects.id the worker explicitly declared in the portal today, if any. */
  declaredTodayProjectId?: string | null;
  /** staff.declared_project_id — possibly months old. */
  standingDeclarationProjectId?: string | null;
  /**
   * Has this person ever checked in against a project? Direct evidence that
   * they do field work, and the only thing that makes the question meaningful.
   * Someone who never has is not asked at all.
   */
  hasEverCheckedInOnProject?: boolean;
}

export interface CurrentProject {
  /** Best available project id, or null when nothing is known. */
  projectId: string | null;
  /** Where that id came from — drives whether we trust it. */
  source: ProjectSource;
  /**
   * True when the worker should be asked. Only false when something recorded
   * TODAY answers it; a standing declaration is shown but never trusted to
   * silence the prompt.
   */
  shouldAsk: boolean;
}

export function resolveCurrentProject(signals: ProjectSignals): CurrentProject {
  // Not a field worker: never ask. The portal shell renders this for every
  // /my page and every role, so an office worker fetching a payslip must not
  // be interrogated about a project — and must not be able to write junk into
  // the field the stores flow depends on.
  const doesFieldWork =
    signals.hasEverCheckedInOnProject === true || !!signals.standingDeclarationProjectId;

  if (signals.checkinTodayProjectId) {
    // Already answered this morning. Asking again is nagging.
    return { projectId: signals.checkinTodayProjectId, source: 'checkin-today', shouldAsk: false };
  }
  if (signals.declaredTodayProjectId) {
    return { projectId: signals.declaredTodayProjectId, source: 'declared-today', shouldAsk: false };
  }
  if (signals.standingDeclarationProjectId) {
    // Offer it as the pre-selected answer, but still ask — this is the field
    // that was wrong for a third of the workers we could check.
    return {
      projectId: signals.standingDeclarationProjectId,
      source: 'stale-declaration',
      shouldAsk: true,
    };
  }
  return { projectId: null, source: 'none', shouldAsk: doesFieldWork };
}
