/**
 * Source-event identity.
 *
 * `produceIncident` dedups on `(incident_type, source_event_id)`, so this is the
 * only thing standing between one condition and 288 incidents a day. The
 * stability assertions below are deliberately phrased as "three consecutive
 * ticks" rather than "the function is pure": a `Date.now()` smuggled into the
 * id passes a purity reading and fails here.
 */

import { describe, expect, it, vi } from 'vitest';
import { afterHoursWindowKey, buildSourceEventId } from '../sourceEventId';
import { RULE, VEHICLE_ID } from './detectorFixtures';

const OTHER_VEHICLE = 'b2b2b2b2-2222-4222-8222-222222222222';

describe('buildSourceEventId', () => {
  it('is stable across ticks for the same occurrence', () => {
    const ids = [0, 5, 10].map((minutes) => {
      vi.setSystemTime(new Date(Date.parse('2026-08-18T19:00:00.000Z') + minutes * 60_000));
      return buildSourceEventId('theft_after_hours_movement', VEHICLE_ID, '2026-08-18T21:00:00');
    });
    vi.useRealTimers();

    expect(new Set(ids).size).toBe(1);
  });

  it('separates two vehicles in the same window', () => {
    expect(buildSourceEventId('severe_driving', VEHICLE_ID, 'evt-1'))
      .not.toBe(buildSourceEventId('severe_driving', OTHER_VEHICLE, 'evt-1'));
  });

  it('separates two windows for the same vehicle', () => {
    expect(buildSourceEventId('theft_after_hours_movement', VEHICLE_ID, '2026-08-18T21:00:00'))
      .not.toBe(buildSourceEventId('theft_after_hours_movement', VEHICLE_ID, '2026-08-19T21:00:00'));
  });

  it('separates two detectors that bucket on the same instant', () => {
    expect(buildSourceEventId('lost_contact_moving', VEHICLE_ID, '2026-08-18T21:00:00'))
      .not.toBe(buildSourceEventId('prolonged_unauthorized_stop', VEHICLE_ID, '2026-08-18T21:00:00'));
  });

  it('refuses an empty bucket key, which would collapse every occurrence into one incident', () => {
    expect(() => buildSourceEventId('severe_driving', VEHICLE_ID, '   ')).toThrow(/bucket key/);
  });

  it('refuses an empty vehicle', () => {
    expect(() => buildSourceEventId('severe_driving', '', 'evt-1')).toThrow(/vehicle/);
  });
});

describe('afterHoursWindowKey', () => {
  it('buckets an evening instant on its own calendar night', () => {
    // 21:10 SAST = 19:10Z.
    expect(afterHoursWindowKey('2026-08-18T19:10:00.000Z', RULE)).toBe('2026-08-18T21:00:00');
  });

  it('buckets a small-hours instant on the PREVIOUS night — the window wraps midnight', () => {
    // 02:30 SAST on the 19th = 00:30Z on the 19th.
    expect(afterHoursWindowKey('2026-08-19T00:30:00.000Z', RULE)).toBe('2026-08-18T21:00:00');
  });

  it('crosses a month boundary without an off-by-one day', () => {
    // 01:00 SAST on 2026-09-01 = 23:00Z on 2026-08-31.
    expect(afterHoursWindowKey('2026-08-31T23:00:00.000Z', RULE)).toBe('2026-08-31T21:00:00');
    // 23:00 SAST on 2026-08-31 = 21:00Z the same day.
    expect(afterHoursWindowKey('2026-08-31T21:00:00.000Z', RULE)).toBe('2026-08-31T21:00:00');
  });

  it('resolves the key in SAST, not UTC — one night, two UTC dates', () => {
    // 22:30 UTC is already 00:30 the NEXT day in Johannesburg, and both instants
    // belong to the SAME night. A UTC read would split them across two buckets
    // and open a second incident at midnight, every time.
    expect(afterHoursWindowKey('2026-08-18T21:30:00.000Z', RULE)).toBe('2026-08-18T21:00:00');
    expect(afterHoursWindowKey('2026-08-18T22:30:00.000Z', RULE)).toBe('2026-08-18T21:00:00');
  });

  it('normalises an HH:MM rule to one spelling of the bucket', () => {
    const shortForm = { ...RULE, afterHoursStartTime: '21:00' };

    expect(afterHoursWindowKey('2026-08-18T19:10:00.000Z', shortForm)).toBe('2026-08-18T21:00:00');
  });
});
