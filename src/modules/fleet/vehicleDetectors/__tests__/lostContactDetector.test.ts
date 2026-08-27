/**
 * `lost_contact_moving`.
 *
 * The threshold is scaled per feed from the vehicle's own measured p90 gap, and
 * the tests below use the MEASURED numbers: 30 s for `cartrack/velocity`, 126
 * min for `cartrack/urent`, 160 min for `netstar/europcar`, 125 min for
 * `ituran/avis`. A fixed 30-minute rule fires on the eleven slow-feed vehicles
 * every tick forever, so "the slow feed stays silent" is the assertion that
 * makes this detector usable at all.
 */

import { describe, expect, it } from 'vitest';
import { detectLostContact, effectiveLostContactMinutes } from '../lostContactDetector';
import { RULE, VEHICLE_ID, context, position } from './detectorFixtures';

const LAST_FIX = '2026-08-18T10:00:00.000Z';
const moving = position({ recordedAt: LAST_FIX, speedKph: 60, ignition: true });

function silentFor(minutes: number, gapP90Seconds: number | null) {
  return context({
    lastPosition: moving,
    gapP90Seconds,
    now: new Date(Date.parse(LAST_FIX) + minutes * 60_000).toISOString(),
  });
}

describe('effectiveLostContactMinutes', () => {
  it('holds the floor for the dense feed (p90 30 s -> 1.5 min is below 30)', () => {
    expect(effectiveLostContactMinutes(RULE, 30)).toBe(30);
  });

  it('scales past the floor for every slow feed', () => {
    expect(effectiveLostContactMinutes(RULE, 126 * 60)).toBe(378);
    expect(effectiveLostContactMinutes(RULE, 160 * 60)).toBe(480);
    expect(effectiveLostContactMinutes(RULE, 125 * 60)).toBe(375);
  });

  it('falls back to the floor when there is no measurable cadence', () => {
    expect(effectiveLostContactMinutes(RULE, null)).toBe(30);
    expect(effectiveLostContactMinutes(RULE, 0)).toBe(30);
  });
});

describe('detectLostContact', () => {
  it('fires on the dense feed after the floor elapses', () => {
    const events = detectLostContact(silentFor(45, 30));

    expect(events).toHaveLength(1);
    expect(events[0]?.occurredAt).toBe(LAST_FIX);
    expect(events[0]?.sourceEventId).toBe(`lost_contact_moving:${VEHICLE_ID}:2026-08-18`);
    expect(events[0]?.metadata.thresholdMinutes).toBe(30);
    expect(events[0]?.metadata.silentMinutes).toBe(45);
  });

  it('stays SILENT on a slow feed at the same 45 minutes', () => {
    expect(detectLostContact(silentFor(45, 126 * 60))).toEqual([]);
    expect(detectLostContact(silentFor(45, 160 * 60))).toEqual([]);
  });

  it('fires on a slow feed once its own scaled threshold is passed', () => {
    expect(detectLostContact(silentFor(400, 126 * 60))).toHaveLength(1);
  });

  it('does NOT fire when the last fix was parked', () => {
    const parked = { ...moving, speedKph: 0, ignition: false };

    expect(detectLostContact({ ...silentFor(600, 30), lastPosition: parked })).toEqual([]);
  });

  it('fires when the last fix was stationary but the ignition was on', () => {
    const idling = { ...moving, speedKph: 0, ignition: true };

    expect(detectLostContact({ ...silentFor(45, 30), lastPosition: idling })).toHaveLength(1);
  });

  it('does NOT fire within the threshold', () => {
    expect(detectLostContact(silentFor(20, 30))).toEqual([]);
  });

  it('is silent for a vehicle that has never reported', () => {
    expect(detectLostContact({ ...silentFor(600, 30), lastPosition: null })).toEqual([]);
  });

  it('keeps one id however long the silence lasts', () => {
    const ids = [45, 90, 600].map((m) => detectLostContact(silentFor(m, 30))[0]?.sourceEventId);

    expect(new Set(ids).size).toBe(1);
  });

  /**
   * The daily cooldown (Hein, 2026-08-27): a flappy unit that reconnects mints
   * a new last-fix instant per drop — MW63YBGP opened four incidents in 48 h —
   * so the bucket is the SAST calendar day of the last fix, and the producer's
   * dedup on `source_event_id` folds every same-day loss onto one incident.
   */
  describe('per-vehicle SAST-day cooldown', () => {
    function lossAt(recordedAt: string, silentMinutes: number) {
      const fix = position({ recordedAt, speedKph: 60, ignition: true });
      return context({
        lastPosition: fix,
        gapP90Seconds: 30,
        now: new Date(Date.parse(recordedAt) + silentMinutes * 60_000).toISOString(),
      });
    }

    it('gives a SECOND loss on the same SAST day the SAME id (deduped by the producer)', () => {
      // Both fixes fall on SAST 2026-08-18; the unit reconnected in between.
      const first = detectLostContact(lossAt('2026-08-18T06:00:00.000Z', 45))[0];
      const second = detectLostContact(lossAt('2026-08-18T12:30:00.000Z', 45))[0];

      expect(first?.sourceEventId).toBe(`lost_contact_moving:${VEHICLE_ID}:2026-08-18`);
      expect(second?.sourceEventId).toBe(first?.sourceEventId);
    });

    it('gives a DIFFERENT vehicle the same day its own incident', () => {
      const otherId = 'b2b2b2b2-2222-4222-8222-222222222222';
      const ctx = lossAt('2026-08-18T12:30:00.000Z', 45);
      const other = detectLostContact({
        ...ctx, vehicle: { ...ctx.vehicle, vehicleId: otherId },
      })[0];

      expect(other?.sourceEventId).toBe(`lost_contact_moving:${otherId}:2026-08-18`);
      expect(other?.sourceEventId).not.toBe(detectLostContact(ctx)[0]?.sourceEventId);
    });

    it('buckets a loss straddling SAST midnight into the NEXT day', () => {
      // 21:50Z = 23:50 SAST (day 18); 22:30Z = 00:30 SAST (day 19). Both are
      // 2026-08-18 in UTC — a UTC fold would wrongly dedup them.
      const before = detectLostContact(lossAt('2026-08-18T21:50:00.000Z', 45))[0];
      const after = detectLostContact(lossAt('2026-08-18T22:30:00.000Z', 45))[0];

      expect(before?.sourceEventId).toBe(`lost_contact_moving:${VEHICLE_ID}:2026-08-18`);
      expect(after?.sourceEventId).toBe(`lost_contact_moving:${VEHICLE_ID}:2026-08-19`);
    });
  });
});
