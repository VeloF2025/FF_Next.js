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
 * ## The window has two unobserved edges, and the caller owns them
 *
 * Silence is measured between fixes, so it cannot see the hours before the first or after the
 * last. The caller therefore supplies `leadIn` (the last position BEFORE the window, whatever day
 * it falls on) and `windowEnd`. `leadIn` is passed ONCE and never derived from the first batch --
 * deriving it would make the result depend on how the input was paged, which is what the
 * batch-invariance sweep forbids. `foldVehicleDays` defaults `windowEnd` to the last fix, which
 * asserts "the window ended when observation ended"; the build service passes the real one. The
 * arithmetic and its reasoning live in `dayWindow.ts`.
 *
 * ## A row is only meaningful if the window covers that day's whole span
 *
 * The three contracts above make a fold correct for the window it was given. This one is about
 * which windows are worth asking for. `coverage_complete`, `tracker_silence_seconds` and every
 * ignition-derived second describe A DAY -- so a window that opens or closes mid-day yields a row
 * describing only the part it saw, which is honest but is not the day.
 *
 * The head and tail machinery makes that visible rather than hidden: a partial day reports the
 * unobserved remainder as silence and gives up its completeness claim. It does not make the row
 * a whole-day row. So an incremental caller must open its window at a SAST day boundary (or at a
 * `leadIn` that reaches back to one) and either close it at a boundary or accept that the final
 * day is still in progress. PR2's build service does exactly this.
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
  hasImplausibleOdometerJump, intervalDistanceKm, intervalLabel, nextEventState, sastDay,
  splitAcrossDays,
} from './dayIntervals';
import { parseWindowEnd, windowEdgeSilence } from './dayWindow';
import type { EventState } from './dayIntervals';
import { finaliseDay, newDay } from './dayRow';
import type { DayAcc } from './dayRow';
import { countHarsh } from './harshEvents';
import { createInstantDeduper } from './inputOrder';
import {
  DEFAULT_DAY_FOLD_OPTIONS,
} from './dayFoldOptions';
import type { DayFoldOptions, DayFoldWindow } from './dayFoldOptions';
import type { DayPosition, DayTrip, VehicleDayStats } from './types';

export interface DayFoldAccumulator {
  /** One page of this vehicle's positions, ascending, disjoint from every previous page. */
  addPositions(batch: readonly DayPosition[]): void;
  /** Closed trips only. An open trip has no bounded ignition period and is ignored. */
  addTrips(trips: readonly DayTrip[]): void;
  result(): VehicleDayStats[];
}

export function createDayFold(
  options: Partial<DayFoldOptions> & DayFoldWindow = {},
): DayFoldAccumulator {
  const opts: DayFoldOptions = { ...DEFAULT_DAY_FOLD_OPTIONS, ...options };
  const maxAttributableMs = opts.maxAttributableIntervalSeconds * 1_000;
  const days = new Map<string, DayAcc>();
  const leadIn = options.leadIn ?? null;
  const windowEndMs = parseWindowEnd(options.windowEnd);
  let prev: DayPosition | null = null;
  let prevMs = 0;
  // The first and last fix actually folded, for the window edges. Tracked here rather than derived
  // in `result()` so they cannot be confused with a day the trips alone created.
  let firstFixMs: number | null = null;
  let lastFixMs: number | null = null;
  let eventState: EventState = null;
  let prevIsSpeeding: boolean | null = null;
  const deduper = createInstantDeduper();

  if (leadIn !== null) {
    // Seeded as the previous position WITHOUT being counted as one. Its own day may end up in the
    // map because the interval out of it is apportioned across dates, but with no positions and no
    // trips that day is dropped by `result()` -- the lead-in informs the window, it is not part
    // of it.
    const leadInMs = Date.parse(leadIn.recordedAt);
    if (!Number.isFinite(leadInMs)) {
      throw new Error(`dayFold: unparseable lead-in recordedAt ${leadIn.recordedAt}`);
    }
    prev = leadIn;
    prevMs = leadInMs;
    deduper.seed(leadIn);
    eventState = nextEventState(null, leadIn);
    prevIsSpeeding = leadIn.isSpeeding;
  }

  function dayFor(workDate: string): DayAcc {
    const existing = days.get(workDate);
    if (existing) return existing;
    const created = newDay(workDate);
    days.set(workDate, created);
    return created;
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

    // Cadence, counted on the day the interval CLOSED -- not the day it opened. `coverageIgnition`
    // needs to know whether THIS day's fixes were close enough together for ignition time to be
    // measurable, and the silence a day opens with is that day's problem, not the previous day's.
    // Two counters answer the median without retaining every gap.
    //
    // A zero-length interval is not evidence of cadence. Two fixes can share an instant -- 164
    // such groups exist in 7 days of production -- and each twin would otherwise contribute a
    // free "0 ms, well within the ceiling" vote. Enough of them drag the median under the ceiling
    // and hand a two-hour feed a coverage_ignition it did not earn.
    const closingDay = dayFor(sastDay(curMs));
    if (elapsedMs > 0) {
      closingDay.gapCount += 1;
      if (elapsedMs <= maxAttributableMs) closingDay.gapsWithinCeiling += 1;
    }

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
    // only the split between moving and idling was unknowable.
    // An odometer that leapt forward beyond belief is refused by intervalDistanceKm, which falls
    // back to the straight line between the two fixes. That fallback is a guess about a feed we
    // have just caught misreporting, so the day stops claiming complete coverage as well.
    if (hasImplausibleOdometerJump(prev!, cur)) closingDay.carriedGapDistance = true;

    const km = intervalDistanceKm(prev!, cur);
    if (km <= 0) return;

    // WHERE those kilometres land is the question, and time-proportional apportionment answers it
    // wrongly across a silence. A 42-hour gap spanning three dates would put ~114 km of an
    // odometer delta on the middle date -- a date on which we observed NOTHING, with
    // position_count 0 and no source watermark. That is interpolation presented as measurement,
    // and it is the number a utilisation report would happily average.
    //
    // We know only that the delta accrued somewhere in the interval, and the one date we actually
    // observed is the one the closing fix fell on. So a gap's distance goes there whole, and that
    // row gives up its claim to complete coverage.
    if (elapsedMs > maxAttributableMs || elapsedMs <= 0) {
      closingDay.distanceKm += km;
      if (sastDay(from) !== sastDay(curMs)) closingDay.carriedGapDistance = true;
      return;
    }
    // Short enough to attribute honestly: a fix-to-fix interval inside the ceiling really did
    // happen across the boundary it straddles, so it is apportioned by the seconds on each side.
    splitAcrossDays(from, curMs, (workDate, ms) => { dayFor(workDate).distanceKm += km * (ms / elapsedMs); });
  }

  function addPosition(p: DayPosition): void {
    const curMs = Date.parse(p.recordedAt);
    deduper.admit(p, curMs, prevMs, prev !== null);
    if (prev !== null) foldInterval(p, curMs);

    if (firstFixMs === null) firstFixMs = curMs;
    lastFixMs = curMs;

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
    countHarsh(day, p, opts);

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
      // Recomputed per call and never stored -- see `windowEdgeSilence` for what accumulating it
      // cost. This is what makes result() repeatable.
      const edgeSilence = windowEdgeSilence(
        firstFixMs, lastFixMs, leadIn === null ? null : Date.parse(leadIn.recordedAt), windowEndMs,
      );
      return [...days.values()]
        // A date the accumulator only ever touched while apportioning a silence across it is not
        // a vehicle-day we observed -- it is the shape of a gap. Emitting a row for it would
        // publish zeroes and an interpolated distance under a null source watermark, which reads
        // as a parked vehicle rather than a dark tracker. A trip alone still earns a row: that IS
        // an observation, just one whose positions have aged out.
        .filter((day) => day.positionCount > 0 || day.tripIgnitionMs > 0)
        .sort((a, b) => a.workDate.localeCompare(b.workDate))
        .map((day) => finaliseDay(day, edgeSilence.get(day.workDate) ?? 0));
    },
  };
}

export function foldVehicleDays(
  positions: readonly DayPosition[],
  trips: readonly DayTrip[] = [],
  options: Partial<DayFoldOptions> & DayFoldWindow = {},
): VehicleDayStats[] {
  const fold = createDayFold(options);
  fold.addPositions(positions);
  fold.addTrips(trips);
  return fold.result();
}
