/**
 * Groups attendance rows by the site the worker was actually on.
 *
 * Attribution is deliberately narrow: a shift counts towards a site only when
 * a clock event landed INSIDE that site's boundary. The recorded AOI is the
 * NEAREST project, which for an off-site fix can be a site 100 km away that
 * the worker has never visited — naming it as "where they are working" would
 * be fiction. Those shifts land in the unattributed bucket instead, carrying
 * their nearest-site distance so the reader can see why.
 *
 * There is no authoritative site assignment to fall back on:
 * `attendance_entries.site_geofence_id` is populated on zero rows and the
 * table it references does not exist. Inference is all there is.
 *
 * Clock-in is preferred over clock-out when the two disagree, because a shift
 * belongs to where the work started; the clock-out site is still surfaced by
 * the row's own badges.
 */

import type { FieldAttendanceRow } from './api';
import { classifyProximity } from './aoiProximity';

export interface SiteGroup {
  /** Project name, or null for the unattributed bucket. */
  siteName: string | null;
  rows: FieldAttendanceRow[];
  /** Distinct staff, not row count — a worker with three shifts is one person. */
  workerCount: number;
}

/** The site a shift is attributable to, or null when none is. */
export function attributedSite(row: FieldAttendanceRow): string | null {
  if (classifyProximity(row.clock_in_aoi_distance_m) === 'on_site') {
    return row.clock_in_aoi_project ?? null;
  }
  if (classifyProximity(row.clock_out_aoi_distance_m) === 'on_site') {
    return row.clock_out_aoi_project ?? null;
  }
  return null;
}

/**
 * Named sites first, ordered by headcount descending then name; the
 * unattributed bucket always last so it never buries a real site.
 */
export function groupBySite(rows: readonly FieldAttendanceRow[]): SiteGroup[] {
  const bySite = new Map<string | null, FieldAttendanceRow[]>();
  for (const row of rows) {
    const site = attributedSite(row);
    const bucket = bySite.get(site);
    if (bucket) bucket.push(row);
    else bySite.set(site, [row]);
  }

  const groups: SiteGroup[] = Array.from(bySite.entries()).map(([siteName, groupRows]) => ({
    siteName,
    rows: groupRows,
    workerCount: new Set(groupRows.map((r) => r.staff_id)).size,
  }));

  return groups.sort((a, b) => {
    if (a.siteName === null) return 1;
    if (b.siteName === null) return -1;
    if (b.workerCount !== a.workerCount) return b.workerCount - a.workerCount;
    return a.siteName.localeCompare(b.siteName);
  });
}
