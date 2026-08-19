/**
 * Proximity classification for attendance clock events.
 *
 * The distance is metres from the clock fix to the nearest project AOI (the
 * convex hull of that project's surveyed poles), recorded at write time by
 * the clock-in and clock-out paths. 0 means inside the site boundary.
 *
 * The 500 m "near" threshold mirrors NEAR_THRESHOLD_M in the checkin-locations
 * report, but is redeclared here rather than imported: that module imports
 * `sql` from @/lib/db-pool, and importing it from a client component would
 * bundle database code into the browser payload. Keep the two numbers equal.
 */

/** Outside the hull by less than this still counts as "near", metres. */
export const NEAR_THRESHOLD_M = 500;

export type Proximity =
  /** Inside the site boundary. */
  | 'on_site'
  /** Outside, but by less than NEAR_THRESHOLD_M. */
  | 'near'
  /** Outside by more. */
  | 'off_site'
  /** No distance recorded: no GPS fix, no AOI, or an entry not written by the
   *  portal clock path (manual admin entries and the auto-close cron). */
  | 'unknown';

export function classifyProximity(distanceM: number | null | undefined): Proximity {
  // Not `!distanceM` — 0 is the most meaningful value there is here, and a
  // falsy check would report every on-site clock as unknown.
  if (distanceM == null || !Number.isFinite(distanceM)) return 'unknown';
  if (distanceM <= 0) return 'on_site';
  if (distanceM < NEAR_THRESHOLD_M) return 'near';
  return 'off_site';
}

/** Metres under a kilometre, one decimal of a kilometre above it. */
export function formatDistance(distanceM: number | null | undefined): string {
  if (distanceM == null || !Number.isFinite(distanceM)) return '';
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

/**
 * What to show for a clock event: the site name when they were on it, the
 * distance when they were not. Naming the site for an off-site fix would
 * claim they were at a site they were only nearest to — sometimes 100 km away.
 */
export function proximityLabel(
  projectName: string | null | undefined,
  distanceM: number | null | undefined,
): string {
  const kind = classifyProximity(distanceM);
  if (kind === 'unknown') return '';
  if (kind === 'on_site') return projectName ?? 'on site';
  return formatDistance(distanceM);
}
