/**
 * `theft_after_hours_movement`.
 *
 * Every event this detector emits sends an immediate WhatsApp (migration 529
 * leaves it `critical`), so the NEGATIVES below carry as much weight as the
 * positives: a single blip, an exempt vehicle, an engine-off tow, and a daytime
 * drive must each be silent.
 *
 * TZ-hermetic: the after-hours decision goes through `Intl` in the rule's zone,
 * so these pass identically under TZ=UTC and TZ=Africa/Johannesburg.
 */

import { describe, expect, it } from 'vitest';
import { detectTheftAfterHoursMovement } from '../theftDetector';
import { RULE, VEHICLE_ID, context, latOffset, position } from './detectorFixtures';

// 21:10 SAST = 19:10Z, inside the seeded 21:00->05:00 window.
const NIGHT_A = '2026-08-18T19:10:00.000Z';
// The second fix, one minute on: where the displacement first clears the threshold.
const NIGHT_A_SECOND_FIX = '2026-08-18T19:11:00.000Z';
const BASE_LAT = -26.1;

function movingNight(meters: number, count: number, startIso = NIGHT_A) {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => position({
    recordedAt: new Date(start + i * 60_000).toISOString(),
    providerEventId: `ct-${i}`,
    lat: latOffset(BASE_LAT, i === 0 ? 0 : meters),
    speedKph: 60,
  }));
}

describe('detectTheftAfterHoursMovement', () => {
  it('fires once for an after-hours drive past the displacement threshold', () => {
    const events = detectTheftAfterHoursMovement(context({ positions: movingNight(600, 3) }));

    expect(events).toHaveLength(1);
    expect(events[0]?.occurredAt).toBe(NIGHT_A_SECOND_FIX);
    expect(events[0]?.sourceEventId)
      .toBe(`theft_after_hours_movement:${VEHICLE_ID}:2026-08-18T21:00:00`);
    expect(events[0]?.metadata.displacementMeters).toBe(599); // haversine, not the flat-earth 600
    expect(events[0]?.metadata.positionsInWindow).toBe(2);
  });

  it('does NOT fire on a single after-hours blip 600 m away (theft_min_positions)', () => {
    const positions = [position({
      recordedAt: NIGHT_A, lat: latOffset(BASE_LAT, 600), speedKph: 60,
    })];

    expect(detectTheftAfterHoursMovement(context({ positions }))).toEqual([]);
  });

  it('does NOT fire below the displacement threshold however many fixes there are', () => {
    // 20 fixes, each 400 m from the anchor: a path sum would be 7.6 km.
    const events = detectTheftAfterHoursMovement(context({ positions: movingNight(400, 20) }));

    expect(events).toEqual([]);
  });

  it('does NOT fire for a vehicle marked after_hours_exempt', () => {
    const ctx = context({
      positions: movingNight(600, 3),
      vehicle: { vehicleId: VEHICLE_ID, registration: 'ABC 123 GP', afterHoursExempt: true },
    });

    expect(detectTheftAfterHoursMovement(ctx)).toEqual([]);
  });

  it('does NOT fire with the ignition off — a tow is not this detector', () => {
    const positions = movingNight(600, 3).map((p) => ({ ...p, ignition: false }));

    expect(detectTheftAfterHoursMovement(context({ positions }))).toEqual([]);
  });

  it('does NOT fire during working hours', () => {
    // 10:00 SAST = 08:00Z on a Tuesday.
    const positions = movingNight(600, 3, '2026-08-18T08:00:00.000Z');

    expect(detectTheftAfterHoursMovement(context({ positions }))).toEqual([]);
  });

  it('fires on a Saturday morning, which the rule counts as after hours', () => {
    // 2026-08-22 is a Saturday; 10:00 SAST = 08:00Z.
    const events = detectTheftAfterHoursMovement(context({
      positions: movingNight(600, 3, '2026-08-22T08:00:00.000Z'),
    }));

    expect(events).toHaveLength(1);
    // Bucketed by the calendar night, so a Saturday morning belongs to Friday 21:00.
    expect(events[0]?.sourceEventId).toContain('2026-08-21T21:00:00');
  });

  it('opens one incident per night, not one per qualifying fix', () => {
    const nightA = movingNight(600, 5);
    const nightB = movingNight(600, 5, '2026-08-19T19:10:00.000Z');

    const events = detectTheftAfterHoursMovement(context({ positions: [...nightA, ...nightB] }));

    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.sourceEventId)).size).toBe(2);
  });

  it('carries only flat primitives in metadata', () => {
    const events = detectTheftAfterHoursMovement(context({ positions: movingNight(600, 3) }));

    for (const value of Object.values(events[0]?.metadata ?? {})) {
      expect(['string', 'number', 'boolean']).toContain(value === null ? 'string' : typeof value);
    }
  });

  it('honours a raised theft_min_positions', () => {
    const ctx = context({
      positions: movingNight(600, 3),
      rule: { ...RULE, theftMinPositions: 4 },
    });

    expect(detectTheftAfterHoursMovement(ctx)).toEqual([]);
  });
});
