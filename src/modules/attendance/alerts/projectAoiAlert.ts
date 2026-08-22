/**
 * WhatsApp alert builder for the nightly project-AOI refresh cron.
 *
 * `project_aois` holds the convex hull of each project's poles and is what the
 * attendance geofence answers "was this person on site?" against. On
 * 2026-08-21 one pole assigned to the wrong project — 145 km out of a site
 * 2.4 km across — inflated one project's hull 63x, and nobody noticed for
 * months. Migration 523 makes that measurable (`project_aois.aoi_status`,
 * `outlier_pole_count`, `aoi_area_ratio`); this module is what makes it
 * *visible*, because a column nobody queries is the same silence in a
 * different place.
 *
 * The design deliberately mirrors `cartrackWaAlert.ts`, the sibling attendance
 * cron's alerter, rather than inventing a path:
 *   - `shouldAlert` and `buildAlertMessage` are pure, so unit tests need no WA
 *     stub and no database.
 *   - the sender is injected, so the cron supplies the real
 *     `sendWhatsAppGroup` and tests supply a spy.
 *   - sending is BEST-EFFORT: a WA failure logs and returns. The refresh
 *     already succeeded by the time this runs, and failing the cron over an
 *     undelivered message would replace a visible warning with a red job.
 *
 * A WA group is used rather than `notify()` for the same reason the sibling
 * cron does: `notify()` needs resolved recipient user ids, and the only
 * candidate here is `projects.project_manager` — which is null for some
 * projects and, for a project whose poles are misassigned, is quite possibly
 * the person who would have to notice their own data problem. The ops group
 * has a guaranteed audience.
 */

/** One row of migration 523's scoring, as the cron reads it back. */
export interface ProjectAoiHealthRow {
  projectName: string | null;
  /** 'ok' | 'suspect' | 'distorted' | 'unassessed' — see migration 523. */
  aoiStatus: string;
  /** Which signal raised it: absolute_area | area_growth | outlier_ratio | no_robust_hull. */
  aoiStatusReason: string | null;
  /** aoi_status as of the PREVIOUS refresh. NULL on a project's first scoring. */
  previousAoiStatus: string | null;
  poleCount: number;
  outlierPoleCount: number;
  aoiAreaM2: number | null;
  robustAoiAreaM2: number | null;
  aoiAreaRatio: number | null;
  furthestOutlierM: number | null;
  previousAoiAreaM2: number | null;
  aoiGrowthRatio: number | null;
}

const ALERTING_STATUS = 'distorted';

/**
 * Pure predicate. Returns the rows that warrant an alert; an empty array means
 * nothing changed for the worse.
 *
 * TWO deliberate narrowings from the first version, both to stop this becoming
 * a nightly message nobody reads:
 *
 * 1. Only `distorted` qualifies. `suspect` records that the outlier ratio moved
 *    without an absolute signal behind it — and an adversarial review measured
 *    that the ratio tracks how a project is SPLIT between two work areas, not
 *    how distorted it is. A dense cluster with a long feeder, or a 90/10 split
 *    of two genuine areas, would have alerted every single night. Chronic false
 *    alarms manufacture the muted channel this guard exists to prevent.
 *
 * 2. Only a TRANSITION into `distorted` qualifies. This cron runs nightly and
 *    has no memory between runs, so `previous_aoi_status` — written by the same
 *    refresh from the pre-update snapshot — is the dedupe. A distortion left
 *    unfixed stays visible in `project_aois`; it does not message someone again
 *    every night until they fix it.
 *
 * A project with no previous status has never been scored, so a brand-new
 * project that arrives already distorted still alerts.
 *
 * `unassessed` is deliberately NOT handled here. A row the refresh never
 * touched has no previous status either, so this path could not dedupe it and
 * would alert nightly. That condition belongs to the liveness check in
 * `/api/cron/db-health`, which watches it from outside this cron and has its
 * own cooldown — see `./projectAoiStaleness`.
 */
export function shouldAlert(rows: readonly ProjectAoiHealthRow[]): ProjectAoiHealthRow[] {
  return rows.filter(
    (r) => r.aoiStatus === ALERTING_STATUS && r.previousAoiStatus !== ALERTING_STATUS,
  );
}

function km2(areaM2: number | null): string {
  return areaM2 === null ? '?' : `${(areaM2 / 1e6).toFixed(2)} km²`;
}

const REASON_TEXT: Record<string, string> = {
  absolute_area: 'the hull is larger than any real project site',
  area_growth: 'the hull jumped against its own previous refresh',
  outlier_ratio: 'outlier poles moved the hull',
  no_robust_hull: 'too few poles left to check the hull against',
};

function describe(row: ProjectAoiHealthRow): string {
  const name = row.projectName ?? 'Unknown project';
  const why = REASON_TEXT[row.aoiStatusReason ?? ''] ?? 'flagged';
  const parts = [`• ${name} — ${why}.`, `Geofence now ${km2(row.aoiAreaM2)}`];
  if (row.aoiStatusReason === 'area_growth' && row.previousAoiAreaM2 !== null) {
    parts.push(
      `, up from ${km2(row.previousAoiAreaM2)}` +
        (row.aoiGrowthRatio === null ? '' : ` (${row.aoiGrowthRatio.toFixed(1)}x)`),
    );
  } else if (row.robustAoiAreaM2 !== null) {
    parts.push(` vs ${km2(row.robustAoiAreaM2)} without its outlier poles`);
  }
  if (row.outlierPoleCount > 0) {
    const furthest = row.furthestOutlierM === null ? '?' : `${(row.furthestOutlierM / 1000).toFixed(1)} km`;
    parts.push(`. ${row.outlierPoleCount} of ${row.poleCount} pole(s) out of place, furthest ${furthest}`);
  }
  return `${parts.join('')}.`;
}

/**
 * Pure formatter. Short enough to read on a phone; the detail lives in
 * `project_aois` and in the cron log.
 *
 * The closing line is not decoration. The geometry is deliberately NOT
 * corrected automatically — an AOI trimmed by a heuristic can shrink a
 * legitimate site's geofence and flag people as off-site who were on it, in a
 * system that feeds disciplinary findings. Whoever reads this needs to know the
 * fix is a pole reassignment, not a button.
 */
export function buildAlertMessage(flagged: readonly ProjectAoiHealthRow[], totalProjects: number): string {
  const lines: string[] = [];
  lines.push('*Project AOI check — attention needed*');
  lines.push(`${flagged.length} of ${totalProjects} project AOI(s) newly look distorted.`);
  lines.push('');
  for (const row of flagged) lines.push(describe(row));
  lines.push('');
  lines.push('The geofence still uses the full hull — nothing was trimmed automatically.');
  lines.push('Fix the pole assignment, then the next refresh clears this.');
  return lines.join('\n');
}

/**
 * Orchestrator. Best-effort — logs but never throws on send failure.
 */
export async function sendProjectAoiDistortionAlert(args: {
  rows: readonly ProjectAoiHealthRow[];
  groupJid: string;
  send: (groupJid: string, message: string) => Promise<void>;
  logger: { info: (msg: string) => void; error: (msg: string) => void };
}): Promise<{ alerted: boolean; flagged: ProjectAoiHealthRow[] }> {
  const flagged = shouldAlert(args.rows);
  if (flagged.length === 0) {
    args.logger.info(
      `[project-aoi-refresh] no WA alert — no new distortion across ${args.rows.length} AOI(s)`,
    );
    return { alerted: false, flagged: [] };
  }
  const message = buildAlertMessage(flagged, args.rows.length);
  try {
    await args.send(args.groupJid, message);
    args.logger.info(`[project-aoi-refresh] WA alert sent to ${args.groupJid} (${flagged.length} project(s))`);
    return { alerted: true, flagged };
  } catch (err) {
    args.logger.error(
      `[project-aoi-refresh] WA alert send failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { alerted: false, flagged };
  }
}
