/**
 * Fold correctness for one vehicle's day.
 *
 * The fold's output is a row that will pass every CHECK migration 528 declares whether it is right
 * or wrong -- a distance understated by 4% and an idle bucket that swallowed unknown time both
 * look exactly like a good day. So these cases assert the arithmetic against fixtures whose
 * answers were computed by hand, not against the fold's own opinion of itself.
 */
import { describe, expect, it } from 'vitest';
import { feedProfile } from '../coverage';
import { foldVehicleDays } from '../dayFold';
import { fix, ituranDayWithLongSilence, netstarDay, urentDay, velocityRun } from './fixtures';

/** 06:00 SAST on 2026-08-10, well clear of both midnights. */
const MORNING = '2026-08-10T04:00:00.000Z';

describe('distance', () => {
  it('uses the odometer delta when the odometer is present and monotonic', () => {
    // 30 fixes, 8 s apart, all at 90 km/h: 29 intervals x 8 s x 90 km/h = 5.8 km.
    const [day] = foldVehicleDays(velocityRun(MORNING, 30, [90]));
    expect(day!.distanceKm).toBeCloseTo(5.8, 2);
  });

  it('falls back to haversine when the feed supplies no odometer at all', () => {
    // netstar/europcar has no odometer column. Nine 0.01-degree steps east at -26.2041.
    const [day] = foldVehicleDays(netstarDay(MORNING));
    // 0.01 deg of longitude at this latitude is ~0.9977 km; nine of them is ~8.98 km.
    expect(day!.distanceKm).toBeGreaterThan(8.5);
    expect(day!.distanceKm).toBeLessThan(9.5);
  });

  it('falls back to haversine for the one interval whose odometer ran backwards', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 60, odometerKm: 100, lat: -26.2, lon: 28.0 }),
      // A bad reading: the odometer cannot run backwards. Distance for this interval must come
      // from the coordinates instead of being dropped or recorded as a negative journey.
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 60, odometerKm: 20, lat: -26.2, lon: 28.01 }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.distanceKm).toBeGreaterThan(0.9);
    expect(day!.distanceKm).toBeLessThan(1.1);
  });

  it('records no distance at all when neither an odometer nor coordinates are available', () => {
    const positions = [
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 0, ignition: true, speedKph: 40 }),
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 60, ignition: true, speedKph: 40 }),
    ];
    expect(foldVehicleDays(positions)[0]!.distanceKm).toBe(0);
  });
});

describe('idle and moving', () => {
  it('books an interval as idle only when ignition is on and the speed is exactly zero', () => {
    // 11 fixes 8 s apart, all stationary with ignition on: 10 intervals x 8 s = 80 s of idling.
    const [day] = foldVehicleDays(velocityRun(MORNING, 11, [0]));
    expect(day!.idleSeconds).toBe(80);
    expect(day!.movingSeconds).toBe(0);
    expect(day!.ignitionSeconds).toBe(80);
  });

  it('books a moving interval at any speed above zero, however slow', () => {
    const [day] = foldVehicleDays(velocityRun(MORNING, 11, [1]));
    expect(day!.movingSeconds).toBe(80);
    expect(day!.idleSeconds).toBe(0);
  });

  it('books neither bucket when ignition is off, so a parked day carries no ignition time', () => {
    const parked = Array.from({ length: 11 }, (_, i) => fix(MORNING, 'cartrack', 'velocity', {
      offsetSeconds: i * 8, ignition: false, speedKph: 0,
    }));
    const [day] = foldVehicleDays(parked);
    expect(day!.ignitionSeconds).toBe(0);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.movingSeconds).toBe(0);
  });

  it('leaves an unreported speed unattributed rather than calling it stationary', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 50 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: null }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.ignitionSeconds).toBe(60);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.movingSeconds).toBe(0);
  });

  it('refuses to attribute a gap longer than the attribution ceiling', () => {
    // urent's median gap is 1,797 s against a 300 s ceiling: almost nothing is attributable, and
    // inventing half an hour of idling from one stationary fix is exactly the fabrication the
    // ceiling exists to prevent.
    const [day] = foldVehicleDays(urentDay(MORNING, 4));
    expect(day!.movingSeconds).toBe(0);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.ignitionSeconds).toBe(0);
  });

  it('prefers the provider IDLING_START/END boundary events over the sampled speed', () => {
    // Cartrack's firmware states the boundary exactly. Between IDLING_START and IDLING_END the
    // period is idling even though these fixes report a non-zero speed, which sampled speed alone
    // would have booked as moving.
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 3, providerEventType: 'IDLING_START' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 3, providerEventType: 'IDLING_CONTINUE' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 120, ignition: true, speedKph: 3, providerEventType: 'IDLING_END' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 180, ignition: true, speedKph: 3, providerEventType: 'PERIODIC_EVENT' }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.idleSeconds).toBe(120);
    expect(day!.movingSeconds).toBe(60);
  });

  it('prefers MOTION_START/END over a zero sampled speed', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 0, providerEventType: 'MOTION_START' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 0, providerEventType: 'MOTION_END' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 120, ignition: true, speedKph: 0, providerEventType: 'PERIODIC_EVENT' }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.movingSeconds).toBe(60);
    expect(day!.idleSeconds).toBe(60);
  });
});

describe('tracker silence', () => {
  it('reports the LARGEST gap, never the sum of gaps', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 600, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 1_500, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 1_800, ignition: true, speedKph: 0 }),
    ];
    const [day] = foldVehicleDays(positions);
    // Gaps are 600, 900, 300. The sum is 1,800 -- which is what a `+=` would report.
    expect(day!.trackerSilenceSeconds).toBe(900);
  });

  it('gives each observed day only the portion of a long silence that fell inside it', () => {
    const days = foldVehicleDays(ituranDayWithLongSilence(MORNING));
    // The 42-hour silence opens at 08:54:35 SAST on the 10th and closes at 02:54:35 on the 12th.
    // The 10th was dark for its remaining 54,325 s and the 12th for its first 10,475 s; neither
    // may claim the whole 42 hours.
    expect(days.map((d) => [d.workDate, d.trackerSilenceSeconds])).toEqual([
      ['2026-08-10', 54_325],
      ['2026-08-12', 10_475],
    ]);
  });
});

describe('a day we did not observe', () => {
  const days = () => foldVehicleDays(ituranDayWithLongSilence(MORNING));

  it('produces NO row for a date that only ever sat inside a gap', () => {
    // The 11th has not one fix. A row for it would publish zeroes, an interpolated distance and a
    // null source watermark -- which reads as a parked vehicle, not a dark tracker, and is
    // exactly the number a utilisation average would swallow.
    expect(days().map((d) => d.workDate)).toEqual(['2026-08-10', '2026-08-12']);
    expect(days().every((d) => d.positionCount > 0)).toBe(true);
    expect(days().every((d) => d.sourceWatermark !== null)).toBe(true);
  });

  it('gives the whole gap distance to the day of the CLOSING fix, and no total is lost', () => {
    // The odometer ran 88,200 -> 88,400 across the silence: 200 km that we know accrued somewhere
    // in 42 hours and observed on the 12th. Time-proportional apportionment would have put ~114 km
    // on the 11th, a date with no evidence of anything.
    const [tenth, twelfth] = days();
    expect(twelfth!.distanceKm).toBe(200);
    // The five intervals before the silence are 40 km each, all on the 10th.
    expect(tenth!.distanceKm).toBe(200);
    expect(days().reduce((km, d) => km + d.distanceKm, 0)).toBe(400);
  });

  it('makes the receiving day give up its claim to complete coverage', () => {
    // This fixture is built so the FLAG is the only thing deciding. The first attempt asserted it
    // on the ituran day above, where coverage_complete was already false for having 1 fix against
    // an expected 4 -- it passed with the guard deleted, which is no test at all.
    //
    // Here a cartrack/velocity vehicle goes quiet at 23:30 SAST and reappears at 00:30, then runs
    // normally. The receiving day has 260 fixes (>= 200 expected) and a largest silence of 1,800 s
    // (<= 3,600 allowed), so both coverage_complete conditions hold — yet it is carrying 100 km
    // whose date we do not actually know.
    const beforeMidnight = fix('2026-08-10T21:30:00.000Z', 'cartrack', 'velocity', {
      offsetSeconds: 0, ignition: true, speedKph: 0, odometerKm: 1_000,
    });
    const afterMidnight = velocityRun('2026-08-10T22:30:00.000Z', 260, [50], 1_100);
    const [, eleventh] = foldVehicleDays([beforeMidnight, ...afterMidnight]);

    expect(eleventh!.workDate).toBe('2026-08-11');
    expect(eleventh!.positionCount).toBe(260);
    expect(eleventh!.trackerSilenceSeconds).toBe(1_800);
    // The 100 km odometer delta across the silence landed here whole.
    expect(eleventh!.distanceKm).toBeGreaterThan(100);
    expect(eleventh!.coverageComplete).toBe(false);
  });

  it('leaves an equivalent day WITHOUT a carried gap complete, so the flag is what differs', () => {
    // The same shape with the vehicle simply starting at 00:30 and no earlier fix at all: no gap
    // is carried across midnight, and the day is complete.
    const [only] = foldVehicleDays(velocityRun('2026-08-10T22:30:00.000Z', 260, [50], 1_100));
    expect(only!.workDate).toBe('2026-08-11');
    expect(only!.coverageComplete).toBe(true);
  });

  it('leaves a straddling interval INSIDE the ceiling apportioned, not lumped', () => {
    // The rule is about silences, not about midnight. A continuous 8-second feed crossing the
    // boundary really did cover ground on both dates, and both keep their share.
    const crossing = foldVehicleDays(velocityRun('2026-08-10T21:59:00.000Z', 30, [90]));
    expect(crossing.map((d) => d.workDate)).toEqual(['2026-08-10', '2026-08-11']);
    // Both dates keep a real share -- lumping would have put the whole 5.8 km on the 11th.
    for (const day of crossing) expect(day.distanceKm).toBeGreaterThan(0);
    expect(crossing.reduce((km, d) => km + d.distanceKm, 0)).toBeCloseTo(5.8, 1);
  });
});

describe('max speed', () => {
  it('is null when no fix in the day carried a speed', () => {
    const positions = [
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 0, ignition: true }),
      fix(MORNING, 'ituran', 'avis', { offsetSeconds: 60, ignition: true }),
    ];
    expect(foldVehicleDays(positions)[0]!.maxSpeedKph).toBeNull();
  });

  it('is the largest speed observed, not the last one', () => {
    const [day] = foldVehicleDays(velocityRun(MORNING, 6, [40, 110, 60]));
    expect(day!.maxSpeedKph).toBe(110);
  });
});

describe('speeding', () => {
  it('counts a rising edge once, not once per fix inside it', () => {
    const speeding = [false, true, true, true, false, true].map((isSpeeding, i) => fix(
      MORNING, 'cartrack', 'velocity',
      { offsetSeconds: i * 8, ignition: true, speedKph: 130, isSpeeding },
    ));
    const [day] = foldVehicleDays(speeding);
    expect(day!.speedingEvents).toBe(2);
    // Four intervals close on a speeding fix (indices 1, 2, 3 and 5), at 8 s each.
    expect(day!.speedingSeconds).toBe(32);
  });
});

describe('ignition instants', () => {
  it('records the first and last fix that asserted ignition, and nulls both when none did', () => {
    const [driven] = foldVehicleDays(velocityRun(MORNING, 4, [50]));
    expect(driven!.firstIgnitionAt).toBe('2026-08-10T04:00:00.000Z');
    expect(driven!.lastIgnitionAt).toBe('2026-08-10T04:00:24.000Z');

    const parked = foldVehicleDays([
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: false, speedKph: 0 }),
    ]);
    expect(parked[0]!.firstIgnitionAt).toBeNull();
    expect(parked[0]!.lastIgnitionAt).toBeNull();
  });
});

describe('harsh events', () => {
  it('counts the provider HARSH_* event above the minimum speed gate', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 110, providerEventType: 'HARSH_CORNERING' }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 8, ignition: true, speedKph: 95, providerEventType: 'HARSH_BRAKING' }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.harshCornerEvents).toBe(1);
    expect(day!.harshBrakeEvents).toBe(1);
    expect(day!.coverageProviderEvents).toBe(true);
  });

  it('discards the provider HARSH_* event below the speed gate, because that is a device artefact', () => {
    // Every live HARSH_BRAKING sample carried speed = 6 km/h, and 19 of 20 g-derived braking
    // events on the only vehicle reporting g were at <= 10 km/h. That is the device, not driving.
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 6, providerEventType: 'HARSH_BRAKING' }),
    ];
    expect(foldVehicleDays(positions)[0]!.harshBrakeEvents).toBe(0);
  });

  it('falls back to the g threshold on a vehicle-day that reports real g', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 80, linearG: -0.52, lateralG: 0.02 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 8, ignition: true, speedKph: 80, linearG: 0.01, lateralG: 0.47 }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.coverageGforce).toBe(true);
    expect(day!.harshBrakeEvents).toBe(1);
    expect(day!.harshCornerEvents).toBe(1);
  });

  it('stores no harsh count at all on a vehicle-day whose g columns are constant zero', () => {
    // The six-of-seven firmware family. Nothing here may reach the harsh counters, or migration
    // 528's harsh-requires-coverage CHECK would be satisfied by a fabrication.
    const [day] = foldVehicleDays(velocityRun(MORNING, 40, [80]).map((p) => ({ ...p, providerEventType: null })));
    expect(day!.coverageGforce).toBe(false);
    expect(day!.coverageProviderEvents).toBe(false);
    expect(day!.harshBrakeEvents + day!.harshAccelEvents + day!.harshCornerEvents).toBe(0);
  });
});

describe('the row migration 528 will accept', () => {
  it('never lets moving plus idle exceed ignition, on any fixture', () => {
    const fixtures = [
      velocityRun(MORNING, 200, [0, 40, 0, 90]),
      urentDay(MORNING),
      netstarDay(MORNING),
      ituranDayWithLongSilence(MORNING),
    ];
    for (const positions of fixtures) {
      for (const day of foldVehicleDays(positions)) {
        expect(day.movingSeconds + day.idleSeconds).toBeLessThanOrEqual(day.ignitionSeconds);
      }
    }
  });

  it('keeps ignition above moving + idle when sub-second intervals round in opposite directions', () => {
    // The floor in finaliseDay is `Math.max(..., movingSeconds + idleSeconds)`, and without that
    // last term this row is REJECTED by the parts-within-whole CHECK. Three fixes 500 ms apart:
    // both intervals are 500 ms, so ignition holds 1,000 ms and the moving and idle buckets hold
    // 500 ms each. Rounded independently that is 1 s of ignition against 1 s + 1 s -- each
    // bucket rounds UP while their sum rounds to the same second.
    const positions = [0, 500, 1_000].map((offsetMs, i) => ({
      ...fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: i === 1 ? 60 : 0 }),
      recordedAt: new Date(Date.parse(MORNING) + offsetMs).toISOString(),
    }));
    const [day] = foldVehicleDays(positions);
    expect([day!.ignitionSeconds, day!.movingSeconds, day!.idleSeconds]).toEqual([2, 1, 1]);
    expect(day!.movingSeconds + day!.idleSeconds).toBeLessThanOrEqual(day!.ignitionSeconds);
  });

  it('zeroes every ignition-derived second on a day that does not assert ignition', () => {
    // Below the 90% ratio: three of five fixes leave ignition null.
    const positions = [true, null, null, null, true].map((ignition, i) => fix(
      MORNING, 'ituran', 'avis', { offsetSeconds: i * 60, ignition, speedKph: 0, odometerKm: 10 + i },
    ));
    const [day] = foldVehicleDays(positions);
    expect(day!.coverageIgnition).toBe(false);
    expect(day!.ignitionSeconds).toBe(0);
    expect(day!.idleSeconds).toBe(0);
    expect(day!.movingSeconds).toBe(0);
  });

  it('refuses to call a coarse feed measurable, so its zeroes are not read as observations', () => {
    // Each of these three asserts ignition on essentially every fix and measures none of it,
    // because every interval exceeds the 300 s ceiling. coverage_ignition = false is what makes
    // the 0 / 0 / 0 honest rather than a claim that the vehicle never ran.
    for (const [name, positions] of [
      ['cartrack/urent', urentDay(MORNING)],
      ['netstar/europcar', netstarDay(MORNING)],
      ['ituran/avis', ituranDayWithLongSilence(MORNING)],
    ] as const) {
      const [day] = foldVehicleDays(positions);
      expect(day!.coverageIgnition, name).toBe(false);
      expect([day!.ignitionSeconds, day!.movingSeconds, day!.idleSeconds], name).toEqual([0, 0, 0]);
    }
  });

  it('calls cartrack/velocity measurable, because at 8 seconds it genuinely is', () => {
    const [day] = foldVehicleDays(velocityRun(MORNING, 200, [0, 40, 0, 90]));
    expect(day!.coverageIgnition).toBe(true);
    expect(day!.ignitionSeconds).toBeGreaterThan(0);
    expect(day!.movingSeconds).toBeGreaterThan(0);
    expect(day!.idleSeconds).toBeGreaterThan(0);
  });

  it('carries a source watermark whenever it folded a fix', () => {
    const [day] = foldVehicleDays(velocityRun(MORNING, 5, [40]));
    expect(day!.positionCount).toBe(5);
    expect(day!.sourceWatermark).toBe('2026-08-10T04:00:32.000Z');
  });
});

describe('feed attribution', () => {
  it('names the feed that contributed the most fixes, and calls a two-kind day mixed', () => {
    const positions = [
      ...velocityRun(MORNING, 30, [40]),
      ...netstarDay(MORNING, 3),
    ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const [day] = foldVehicleDays(positions);
    expect(day!.provider).toBe('cartrack');
    expect(day!.accountRef).toBe('velocity');
    expect(day!.coverageGranularity).toBe('mixed');
  });
});

describe('an exact tie between two feeds', () => {
  /**
   * The tie-break in `dominantFeed` is load-bearing and invisible.
   *
   * `Array.prototype.sort` is stable, so without the tie-break the winner is simply whichever feed
   * the accumulator's Map saw FIRST -- and that is decided by which feed's fix happens to carry
   * the earlier timestamp. The same vehicle-day then yields a different `provider`, `account_ref`
   * and `coverage_complete` (the two feeds carry different `expected_min_fixes`) depending on an
   * accident of ordering, and two correct runs produce different row hashes.
   *
   * A first version of this test varied the array order but sorted by `recordedAt` afterwards, so
   * cartrack led in both variants and the map insertion order never actually changed. It passed
   * with the tie-break deleted. What has to differ is which feed owns the EARLIER instant.
   */
  const tied = (leader: 'cartrack' | 'netstar') => {
    const early = { offsetSeconds: 0, ignition: true, speedKph: 40 } as const;
    const late = { offsetSeconds: 30, ignition: true, speedKph: 40 } as const;
    return leader === 'cartrack'
      ? [fix(MORNING, 'cartrack', 'urent', early), fix(MORNING, 'netstar', 'europcar', late)]
      : [fix(MORNING, 'netstar', 'europcar', early), fix(MORNING, 'cartrack', 'urent', late)];
  };

  it('resolves to the same feed whichever one happened to report first', () => {
    const [cartrackFirst] = foldVehicleDays(tied('cartrack'));
    const [netstarFirst] = foldVehicleDays(tied('netstar'));
    expect(cartrackFirst!.provider).toBe(netstarFirst!.provider);
    expect(cartrackFirst!.accountRef).toBe(netstarFirst!.accountRef);
    expect(cartrackFirst!.coverageComplete).toBe(netstarFirst!.coverageComplete);
  });

  it('is a genuine tie, and the two feeds really would disagree about the row', () => {
    // Both halves guard the case itself. Unequal counts would make the assertion above pass
    // without exercising the tie-break at all; identical feed profiles would make the
    // coverage_complete comparison prove nothing.
    const positions = tied('cartrack');
    const counts = new Map<string, number>();
    for (const p of positions) {
      const key = `${p.provider}/${p.accountRef}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([1, 1]);
    // Two fixes clears netstar's expected minimum of 2 and misses urent's of 4, so which feed
    // wins the tie genuinely changes coverage_complete.
    expect(feedProfile('cartrack', 'urent').expectedMinFixes).toBeGreaterThan(positions.length);
    expect(feedProfile('netstar', 'europcar').expectedMinFixes).toBeLessThanOrEqual(positions.length);
    expect(foldVehicleDays(positions)[0]!.coverageGranularity).toBe('mixed');
  });
});

describe('input contract', () => {
  it('accepts two DIFFERENT fixes sharing one instant, because production is full of them', () => {
    // 164 (vehicle, recorded_at) groups over 7 days of production hold more than one row, on all
    // seven cartrack/velocity vehicles -- distinct provider_event_ids at the same instant, and in
    // one sampled pair disagreeing about ignition. A guard that refused an equal timestamp would
    // throw on ordinary data every day.
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, providerEventId: '2772573715', ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, providerEventId: '2772574862', ignition: false, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 8, providerEventId: '2772574900', ignition: true, speedKph: 0 }),
    ];
    const [day] = foldVehicleDays(positions);
    expect(day!.positionCount).toBe(3);
  });

  it('refuses the SAME fix supplied twice, which is what an inclusive watermark would do', () => {
    // PR2 reads its window from a watermark. If that read is `recorded_at >= watermark` rather
    // than `>`, the boundary fix is re-fed and counted twice. The timestamp cannot catch it; the
    // id can.
    const duplicated = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, providerEventId: 'evt-1', ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, providerEventId: 'evt-1', ignition: true, speedKph: 0 }),
    ];
    expect(() => foldVehicleDays(duplicated)).toThrow(/exclusive/i);
  });

  it('refuses a snapshot feed repeating an instant with no id, which can only be a duplicate', () => {
    // netstar and ituran supply no per-fix id. Two fixes at the identical instant from a feed
    // that returns one point per vehicle per poll is a re-fetch, not a tie.
    const repeated = [
      fix(MORNING, 'netstar', 'europcar', { offsetSeconds: 0, providerEventId: null, ignition: true, speedKph: 0 }),
      fix(MORNING, 'netstar', 'europcar', { offsetSeconds: 0, providerEventId: null, ignition: true, speedKph: 0 }),
    ];
    expect(() => foldVehicleDays(repeated)).toThrow(/supplied twice/i);
  });

  it('does not confuse an id reused at a LATER instant with a duplicate', () => {
    // The seen-id set is scoped to one instant, so it cannot grow without bound over a backfill
    // -- and cannot reject a feed that recycles ids across time.
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, providerEventId: 'evt-1', ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 8, providerEventId: 'evt-1', ignition: true, speedKph: 0 }),
    ];
    expect(foldVehicleDays(positions)[0]!.positionCount).toBe(2);
  });

  it('refuses positions that arrive out of order rather than mis-measuring the gaps', () => {
    const positions = [
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 60, ignition: true, speedKph: 0 }),
      fix(MORNING, 'cartrack', 'velocity', { offsetSeconds: 0, ignition: true, speedKph: 0 }),
    ];
    expect(() => foldVehicleDays(positions)).toThrow(/ascending/i);
  });
});
