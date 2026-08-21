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
 */

export type ProjectSource = 'checkin-today' | 'declared-today' | 'stale-declaration' | 'none';

export interface ProjectSignals {
  /** projects.id from an H&S check-in made today, if any. */
  checkinTodayProjectId?: string | null;
  /** projects.id the worker explicitly declared in the portal today, if any. */
  declaredTodayProjectId?: string | null;
  /** staff.declared_project_id — possibly months old. */
  standingDeclarationProjectId?: string | null;
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
  return { projectId: null, source: 'none', shouldAsk: true };
}
