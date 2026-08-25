/**
 * The day accumulator and the row it finalises into.
 *
 * Kept beside `dayFold` rather than inside it because this is where the schema's refusals are
 * honoured in TypeScript: migration 528 will not store ignition-derived seconds from a feed that
 * does not assert ignition, nor a harsh count from a vehicle-day that could not observe one, and
 * `finaliseDay` is the single place those two facts are applied. A row leaving here is a row the
 * database will accept, or one of the two is wrong and a migration test says so.
 */
import {
  coverageComplete, coverageIgnition, dayGranularity, feedProfile,
} from './coverage';
import { HARSH_EVENT_TYPES } from './types';
import type { VehicleDayStats } from './types';

export type HarshKind = (typeof HARSH_EVENT_TYPES)[keyof typeof HARSH_EVENT_TYPES];

export interface HarshCounts { brake: number; accel: number; corner: number }

export interface DayAcc {
  workDate: string;
  ignitionMs: number; movingMs: number; idleMs: number; tripIgnitionMs: number;
  speedingMs: number; speedingEvents: number;
  distanceKm: number; maxSpeedKph: number | null;
  fromEvents: HarshCounts; fromG: HarshCounts;
  firstIgnitionAt: string | null; lastIgnitionAt: string | null;
  positionCount: number; fixesWithIgnition: number; largestGapMs: number;
  /** Inter-fix intervals whose CLOSING fix fell in this day, and how many were attributable. */
  gapCount: number; gapsWithinCeiling: number;
  /**
   * This day closed a gap that began on an earlier day, and took the whole distance for it.
   *
   * The kilometres were really covered, but not necessarily on this date -- so the day may still
   * report them and must not also claim to be completely observed.
   */
  carriedGapDistance: boolean;
  feeds: Map<string, { provider: string | null; accountRef: string | null; count: number }>;
  gforce: boolean; providerEvents: boolean; sourceWatermark: string | null;
}

export function newDay(workDate: string): DayAcc {
  return {
    workDate,
    ignitionMs: 0, movingMs: 0, idleMs: 0, tripIgnitionMs: 0,
    speedingMs: 0, speedingEvents: 0,
    distanceKm: 0, maxSpeedKph: null,
    fromEvents: { brake: 0, accel: 0, corner: 0 }, fromG: { brake: 0, accel: 0, corner: 0 },
    firstIgnitionAt: null, lastIgnitionAt: null,
    positionCount: 0, fixesWithIgnition: 0, largestGapMs: 0,
    gapCount: 0, gapsWithinCeiling: 0, carriedGapDistance: false,
    feeds: new Map(), gforce: false, providerEvents: false, sourceWatermark: null,
  };
}

function dominantFeed(day: DayAcc): { provider: string | null; accountRef: string | null } {
  // Ties break on the key so the row is deterministic whatever order the feeds were inserted in.
  const ranked = [...day.feeds.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  return ranked.length === 0 ? { provider: null, accountRef: null } : ranked[0]![1];
}

/**
 * @param windowEdgeSilenceMs unobserved milliseconds at the window's head or tail that belong to
 *   THIS day. Passed in rather than accumulated, because the tail depends on `windowEnd` and the
 *   last fix seen SO FAR -- both of which move as more input arrives. Writing it into the
 *   accumulator made `result()` destructive: a mid-stream call baked a tail gap in permanently,
 *   and every later row carried a silence measured against a window that had since grown.
 */
export function finaliseDay(day: DayAcc, windowEdgeSilenceMs = 0): VehicleDayStats {
  const seconds = (ms: number) => Math.round(ms / 1_000);
  const profiles = [...day.feeds.values()].map((f) => feedProfile(f.provider, f.accountRef));
  const granularity = dayGranularity(profiles);
  const dominant = dominantFeed(day);

  // A built trip IS an ignition-on period -- it is segmented from ignition transitions -- so its
  // presence is itself evidence the feed asserts ignition, even on a day whose positions were
  // trimmed away by retention.
  const coverageIgn = coverageIgnition({
    fixesWithIgnition: day.fixesWithIgnition,
    positionCount: day.positionCount,
    gapCount: day.gapCount,
    gapsWithinCeiling: day.gapsWithinCeiling,
  }) || day.tripIgnitionMs > 0;

  let movingSeconds = seconds(day.movingMs);
  let idleSeconds = seconds(day.idleMs);
  // Ignition time is at least any lower bound we have for it: what the fixes attributed, what the
  // trips measured, and the time already booked into the two buckets. The last term is what keeps
  // migration 528's parts-within-whole CHECK satisfied by construction rather than by luck.
  let ignitionSeconds = Math.max(seconds(day.ignitionMs), seconds(day.tripIgnitionMs), movingSeconds + idleSeconds);
  if (!coverageIgn) {
    // The schema refuses ignition-derived numbers from a feed that does not assert ignition, and
    // it is right to: they would be a guess wearing a measurement's clothes.
    ignitionSeconds = 0; movingSeconds = 0; idleSeconds = 0;
  }

  const trackerSilenceSeconds = seconds(Math.max(day.largestGapMs, windowEdgeSilenceMs));
  return {
    workDate: day.workDate,
    ignitionSeconds, movingSeconds, idleSeconds,
    distanceKm: Math.round(day.distanceKm * 100) / 100,
    // Rounded to NUMERIC(6,2), the column's own scale, so the value the fold reports and the value
    // the database stores are the same number. Without it a fold-vs-row comparison in a test or a
    // backfill check fails on a difference the schema itself introduced.
    maxSpeedKph: day.maxSpeedKph === null ? null : Math.round(day.maxSpeedKph * 100) / 100,
    speedingEvents: day.speedingEvents,
    speedingSeconds: seconds(day.speedingMs),
    // Each evidence base is gated on its own coverage flag. Neither can contribute a count the
    // day could not have observed, which is what migration 528's harsh CHECK states in SQL.
    harshBrakeEvents: (day.providerEvents ? day.fromEvents.brake : 0) + (day.gforce ? day.fromG.brake : 0),
    harshAccelEvents: (day.providerEvents ? day.fromEvents.accel : 0) + (day.gforce ? day.fromG.accel : 0),
    harshCornerEvents: (day.providerEvents ? day.fromEvents.corner : 0) + (day.gforce ? day.fromG.corner : 0),
    // DELIBERATELY NOT nulled when coverageIgn is false, though the seconds beside them are.
    //
    // The two are different kinds of claim. `ignition_seconds` is a MEASUREMENT, and a feed whose
    // fixes are hours apart cannot make it — hence the zeroing above. These two are OBSERVATIONS:
    // a fix said `ignition = true` at this instant, and that is exactly as true on a two-hour feed
    // as on an eight-second one. Nulling them would throw away the only usable answer a snapshot
    // feed can give to "when did this vehicle first move today", and would do it in the name of
    // honesty while actually discarding evidence.
    firstIgnitionAt: day.firstIgnitionAt,
    lastIgnitionAt: day.lastIgnitionAt,
    positionCount: day.positionCount,
    trackerSilenceSeconds,
    provider: dominant.provider,
    accountRef: dominant.accountRef,
    coverageGranularity: granularity,
    coverageIgnition: coverageIgn,
    coverageGforce: day.gforce,
    coverageProviderEvents: day.providerEvents,
    coverageComplete: granularity !== 'none'
      && !day.carriedGapDistance
      && coverageComplete(day.positionCount, trackerSilenceSeconds, feedProfile(dominant.provider, dominant.accountRef)),
    sourceWatermark: day.sourceWatermark,
  };
}
