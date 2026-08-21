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
  poleCount: number;
  outlierPoleCount: number;
  aoiAreaM2: number | null;
  robustAoiAreaM2: number | null;
  aoiAreaRatio: number | null;
  furthestOutlierM: number | null;
}

/**
 * Pure predicate. Returns the rows that warrant an alert; an empty array means
 * everything is clean.
 *
 * Any outlier pole at all qualifies, not only a `distorted` hull. A pole more
 * than 5 km AND more than 8x the median distance from its project's centroid is
 * already a data error worth a human look, even when it happens not to have
 * moved the hull much — and under-alerting is the failure this guard exists to
 * end.
 *
 * `unassessed` also qualifies. Migration 523's refresh writes a real status to
 * every row it touches, so a row still carrying the column default after a
 * refresh means the refresh did not reach it — a silent scoring gap, which is
 * exactly the shape of the original incident.
 */
export function shouldAlert(rows: readonly ProjectAoiHealthRow[]): ProjectAoiHealthRow[] {
  return rows.filter((r) => r.outlierPoleCount > 0 || r.aoiStatus === 'unassessed');
}

function km2(areaM2: number | null): string {
  return areaM2 === null ? '?' : `${(areaM2 / 1e6).toFixed(2)} km²`;
}

function describe(row: ProjectAoiHealthRow): string {
  const name = row.projectName ?? 'Unknown project';
  if (row.aoiStatus === 'unassessed') {
    return `• ${name}: not scored by the last refresh — check the AOI cron`;
  }
  const ratio = row.aoiAreaRatio === null ? 'no robust hull' : `${row.aoiAreaRatio.toFixed(1)}x`;
  const furthest = row.furthestOutlierM === null ? '?' : `${(row.furthestOutlierM / 1000).toFixed(1)} km`;
  return (
    `• ${name} [${row.aoiStatus}]: ${row.outlierPoleCount} of ${row.poleCount} pole(s) out of place, ` +
    `furthest ${furthest}. Geofence ${km2(row.aoiAreaM2)} vs ${km2(row.robustAoiAreaM2)} without them (${ratio}).`
  );
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
  lines.push(`${flagged.length} of ${totalProjects} project AOI(s) look distorted.`);
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
    args.logger.info(`[project-aoi-refresh] no WA alert — all ${args.rows.length} AOI(s) clean`);
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
