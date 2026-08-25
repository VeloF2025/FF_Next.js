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
    expect(events[0]?.sourceEventId).toBe(`lost_contact_moving:${VEHICLE_ID}:${LAST_FIX}`);
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
});
