/**
 * Folds one vehicle's positions (and, when available, its built trips) into one row per SAST
 * calendar day.
 *
 * Pure: no SQL, no clock, no configuration lookup. Everything it needs is passed in, so a re-run
 * over the same window produces byte-identical output. That is not a stylistic preference -- the
 * trips builder shipped a straddler bug that six code reviewers read past, and the only thing that
 * found it was running the same input at several batch sizes and comparing the rows. Purity is
 * what makes that test possible.
 *
 * ## Batching is safe by construction, not by bookkeeping
 *
 * `addPositions` may be called with any partition of the vehicle's positions, in order, with no
 * overlap. The accumulator holds the previous position itself, so the interval spanning a batch
 * boundary is folded exactly once and exactly as it would have been in a single call. A caller
 * that gaps its batches would lose an interval, and out-of-order input throws rather than
 * mis-measuring the gaps.
 *
 * An OVERLAP is the harder half, because the ordering guard cannot be tightened to catch it. A
 * fix is not identified by its timestamp: 164 (vehicle, recorded_at) groups over 7 days of
 * production hold more than one row, on all seven `cartrack/velocity` vehicles, with distinct
 * `provider_event_id`s at the same instant -- sometimes disagreeing about ignition. Refusing an
 * equal timestamp would therefore throw on ordinary data. Refusing a repeated `providerEventId`
 * AT that timestamp catches the real hazard instead: a watermark that reads `recorded_at >=`
 * rather than `>` re-feeds the boundary fix, which would otherwise be counted twice in
 * `position_count` and contribute a zero-length interval to nothing at all.
 *
 * ## The SAST boundary
 *
 * SAST is UTC+2 with no DST, so 21:59:59Z is still today in Johannesburg and 22:00:00Z is already
 * tomorrow. Every interval -- attributed time, silence, distance -- is SPLIT at midnight and
 * apportioned, which is what makes a trip that straddles midnight sum to itself across two rows.
 * Work dates come from `sastDateString`; `toISOString().slice(0, 10)` is a UTC answer to a South
 * African question and is banned by a test.
 *
 * ## What is deliberately NOT attributed
 *
 * An interval longer than `maxAttributableIntervalSeconds` is counted toward nothing. Three of the
 * four live feeds have median gaps between 10 and 35 minutes; booking half an hour of idling
 * because one snapshot happened to catch a red light is an invention, and an invention that looks
 * exactly like a measurement. Migration 528's `unattributed_seconds` is where that uncertainty
 * becomes visible instead.
 */
import { coverageGforce, coverageProviderEvents } from './coverage';
import {
  intervalDistanceKm, intervalLabel, nextEventState, sastDay, splitAcrossDays,
} from './dayIntervals';
import type { EventState } from './dayIntervals';
import { finaliseDay, newDay } from './dayRow';
import type { DayAcc, HarshKind } from './dayRow';
import { HARSH_EVENT_TYPES } from './types';
import type { DayPosition, DayTrip, VehicleDayStats } from './types';

/**
 * Positions per page for the incremental build.
 *
 * 5,000 is roughly four `cartrack/velocity` vehicle-days at that feed's measured 1,169 fixes/day:
 * large enough that an ordinary rebuild is one page, small enough to stay well inside one query's
 * memory. Exported because the batch-invariance sweep must include the production value, or it
 * proves nothing about production.
 */
export const DAY_FOLD_POSITION_BATCH_SIZE = 5_000;

export interface DayFoldOptions {
  /** Longer than this and the interval is counted toward duration but attributed to nothing. */
  maxAttributableIntervalSeconds: number;
  /**
   * Harsh events below this speed are discarded.
   *
   * Not optional tuning: every live `HARSH_BRAKING` sample carried speed = 6 km/h, and 19 of the
   * 20 g-derived braking events on the only vehicle reporting g were at <= 10 km/h. Without the
   * gate this counter is a report on one broken device.
   */
  harshMinSpeedKph: number;
  /** p99.9 of abs(linear_g) is 0.140; Cartrack's own firmware fires at 0.42-0.68. */
  harshLinearG: number;
  /** lateral_g is already an unsigned magnitude (min 0.000 over 237,419 rows). */
  harshLateralG: number;
}

export const DEFAULT_DAY_FOLD_OPTIONS: DayFoldOptions = {
  maxAttributableIntervalSeconds: 300,
  harshMinSpeedKph: 20,
  harshLinearG: 0.35,
  harshLateralG: 0.35,
};

export interface DayFoldAccumulator {
  /** One page of this vehicle's positions, ascending, disjoint from every previous page. */
  addPositions(batch: readonly DayPosition[]): void;
  /** Closed trips only. An open trip has no bounded ignition period and is ignored. */
  addTrips(trips: readonly DayTrip[]): void;
  result(): VehicleDayStats[];
}

export function createDayFold(options: Partial<DayFoldOptions> = {}): DayFoldAccumulator {
  const opts: DayFoldOptions = { ...DEFAULT_DAY_FOLD_OPTIONS, ...options };
  const maxAttributableMs = opts.maxAttributableIntervalSeconds * 1_000;
  const days = new Map<string, DayAcc>();
  let prev: DayPosition | null = null;
  let prevMs = 0;
  let eventState: EventState = null;
  let prevIsSpeeding: boolean | null = null;
  /**
   * The ids already folded at exactly `prevMs`, cleared the moment the clock moves on.
   *
   * Bounded by the number of fixes sharing one instant -- two or three in the observed data --
   * rather than by the window, so this stays O(1) over a month-long backfill.
   */
  let idsAtPrevMs = new Set<string>();

  function dayFor(workDate: string): DayAcc {
    const existing = days.get(workDate);
    if (existing) return existing;
    const created = newDay(workDate);
    days.set(workDate, created);
    return created;
  }

  function countHarsh(day: DayAcc, p: DayPosition): void {
    if (p.speedKph === null || p.speedKph < opts.harshMinSpeedKph) return;
    const named = p.providerEventType === null
      ? undefined
      : (HARSH_EVENT_TYPES as Record<string, HarshKind | undefined>)[p.providerEventType];
    if (named) {
      // The firmware computed this itself, on the vehicles whose g columns are structurally zero.
      // It beats our own threshold for the same fix, so the g branch is not also consulted.
      day.fromEvents[named] += 1;
      return;
    }
    if (p.linearG !== null) {
      if (p.linearG <= -opts.harshLinearG) day.fromG.brake += 1;
      else if (p.linearG >= opts.harshLinearG) day.fromG.accel += 1;
    }
    // No abs(): lateral_g is already reported as an unsigned magnitude.
    if (p.lateralG !== null && p.lateralG >= opts.harshLateralG) day.fromG.corner += 1;
  }

  function foldInterval(cur: DayPosition, curMs: number): void {
    const from = prevMs;
    const elapsedMs = curMs - from;
    splitAcrossDays(from, curMs, (workDate, ms) => {
      const day = dayFor(workDate);
      // The LARGEST gap, never the running total: a sum answers "how much of the day went
      // unobserved", which on a snapshot feed is almost all of it and therefore says nothing.
      day.largestGapMs = Math.max(day.largestGapMs, ms);
    });

    if (elapsedMs <= maxAttributableMs) {
      if (cur.isSpeeding === true) {
        splitAcrossDays(from, curMs, (workDate, ms) => { dayFor(workDate).speedingMs += ms; });
      }
      if (cur.ignition === true) {
        splitAcrossDays(from, curMs, (workDate, ms) => { dayFor(workDate).ignitionMs += ms; });
        const label = intervalLabel(eventState, cur);
        if (label !== null) {
          splitAcrossDays(from, curMs, (workDate, ms) => {
            const day = dayFor(workDate);
            if (label === 'moving') day.movingMs += ms; else day.idleMs += ms;
          });
        }
      }
    }

    // Distance accrues even across an unattributable gap: the kilometres were really covered, and
    // only the split between moving and idling was unknowable. Apportioned by time so a straddling
    // interval lands on both days in the same proportion its seconds did.
    const km = intervalDistanceKm(prev!, cur);
    if (km <= 0) return;
    if (elapsedMs <= 0) { dayFor(sastDay(curMs)).distanceKm += km; return; }
    splitAcrossDays(from, curMs, (workDate, ms) => { dayFor(workDate).distanceKm += km * (ms / elapsedMs); });
  }

  function addPosition(p: DayPosition): void {
    const curMs = Date.parse(p.recordedAt);
    if (!Number.isFinite(curMs)) throw new Error(`dayFold: unparseable recordedAt ${p.recordedAt}`);
    if (prev !== null && curMs < prevMs) {
      throw new Error('dayFold: positions must be supplied in ascending recordedAt order');
    }
    if (prev !== null && curMs === prevMs) {
      // A genuine tie carries a different id and folds normally; the same id at the same instant
      // is the same fix arriving twice, and folding it again would inflate position_count.
      const key = p.providerEventId ?? '';
      if (idsAtPrevMs.has(key)) {
        throw new Error(
          'dayFold: the same fix was supplied twice -- batches must not overlap, and a watermark '
          + `must be exclusive (recorded_at > watermark). Repeated at ${p.recordedAt}.`,
        );
      }
      idsAtPrevMs.add(key);
    } else {
      // The clock moved on, so nothing seen before can be a duplicate of anything to come.
      idsAtPrevMs = new Set([p.providerEventId ?? '']);
    }
    if (prev !== null) foldInterval(p, curMs);

    const day = dayFor(sastDay(curMs));
    day.positionCount += 1;
    if (p.ignition !== null) day.fixesWithIgnition += 1;
    if (p.ignition === true) {
      if (day.firstIgnitionAt === null) day.firstIgnitionAt = p.recordedAt;
      day.lastIgnitionAt = p.recordedAt;
    }
    if (p.speedKph !== null && (day.maxSpeedKph === null || p.speedKph > day.maxSpeedKph)) {
      day.maxSpeedKph = p.speedKph;
    }
    if (p.isSpeeding === true && prevIsSpeeding !== true) day.speedingEvents += 1;
    // Both coverage questions are answered by the same predicates the read path uses, one fix at a
    // time, so there is no second copy of either rule to drift.
    if (!day.gforce) day.gforce = coverageGforce([p]);
    if (!day.providerEvents) day.providerEvents = coverageProviderEvents([p]);
    day.sourceWatermark = p.recordedAt;
    const key = `${p.provider ?? ''}/${p.accountRef ?? ''}`;
    const feed = day.feeds.get(key) ?? { provider: p.provider, accountRef: p.accountRef, count: 0 };
    feed.count += 1;
    day.feeds.set(key, feed);
    countHarsh(day, p);

    eventState = nextEventState(eventState, p);
    prevIsSpeeding = p.isSpeeding;
    prev = p;
    prevMs = curMs;
  }

  return {
    addPositions(batch) { for (const p of batch) addPosition(p); },

    addTrips(trips) {
      for (const trip of trips) {
        if (trip.ignitionOffAt === null) continue;
        const onMs = Date.parse(trip.ignitionOnAt);
        const offMs = Date.parse(trip.ignitionOffAt);
        if (!Number.isFinite(onMs) || !Number.isFinite(offMs) || offMs <= onMs) continue;
        splitAcrossDays(onMs, offMs, (workDate, ms) => { dayFor(workDate).tripIgnitionMs += ms; });
      }
    },

    result() {
      return [...days.values()]
        .sort((a, b) => a.workDate.localeCompare(b.workDate))
        .map(finaliseDay);
    },
  };
}

export function foldVehicleDays(
  positions: readonly DayPosition[],
  trips: readonly DayTrip[] = [],
  options: Partial<DayFoldOptions> = {},
): VehicleDayStats[] {
  const fold = createDayFold(options);
  fold.addPositions(positions);
  fold.addTrips(trips);
  return fold.result();
}
