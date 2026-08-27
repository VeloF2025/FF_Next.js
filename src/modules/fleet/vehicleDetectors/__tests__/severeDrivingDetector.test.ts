/**
 * `severe_driving` — the provider's verdict first, signed g as a gated fallback.
 *
 * The load-bearing negative is the g gate: six of seven `cartrack/velocity`
 * vehicles report `linear_g`/`lateral_g` as CONSTANT ZERO, so a fallback keyed
 * on `linear_g IS NOT NULL` would look alive and be dead. A vehicle-day whose g
 * is uniformly zero must take no g path at all.
 *
 * No test here asserts that `HARSH_ACCELERATION` exists in the feed — it was not
 * observed in 55,009 events over 7 days. It is accepted if it appears; that is
 * all this suite may claim.
 */

import { describe, expect, it } from 'vitest';
import { detectSevereDriving, windowHasNonZeroG } from '../severeDrivingDetector';
import { RULE, VEHICLE_ID, context, position } from './detectorFixtures';

describe('detectSevereDriving — the provider event path', () => {
  it('fires on HARSH_BRAKING even at 6 km/h, the speed every live sample carries', () => {
    const positions = [position({ providerEventType: 'HARSH_BRAKING', speedKph: 6 })];

    const events = detectSevereDriving(context({ positions }));

    expect(events).toHaveLength(1);
    expect(events[0]?.metadata.harshKind).toBe('braking');
    expect(events[0]?.metadata.evidence).toBe('provider_event');
  });

  it('fires on HARSH_CORNERING at speed with structurally zero g', () => {
    const positions = [position({
      providerEventType: 'HARSH_CORNERING', speedKph: 110, linearG: 0, lateralG: 0,
    })];

    expect(detectSevereDriving(context({ positions }))).toHaveLength(1);
  });

  it('ignores the ordinary event vocabulary', () => {
    const positions = ['PERIODIC_EVENT', 'IDLING_START', 'MOTION_END', 'SPEEDING_START']
      .map((event, i) => position({ providerEventType: event, providerEventId: `ct-${i}`, speedKph: 80 }));

    expect(detectSevereDriving(context({ positions }))).toEqual([]);
  });

  it('does not let a prototype key masquerade as an event type', () => {
    const positions = [position({ providerEventType: 'constructor', speedKph: 80 })];

    expect(detectSevereDriving(context({ positions }))).toEqual([]);
  });

  it('buckets on provider_event_id, so the same event re-read is one id', () => {
    const positions = [position({ providerEventType: 'HARSH_BRAKING', providerEventId: 'evt-77' })];

    const events = detectSevereDriving(context({ positions }));

    expect(events[0]?.sourceEventId).toBe(`severe_driving:${VEHICLE_ID}:evt-77`);
  });
});

describe('detectSevereDriving — the g fallback', () => {
  const harshBrake = { linearG: -0.5, lateralG: 0, speedKph: 60 };

  it('fires when the window carries a real g reading', () => {
    const positions = [position({ ...harshBrake, providerEventType: 'PERIODIC_EVENT' })];

    const events = detectSevereDriving(context({ positions }));

    expect(events).toHaveLength(1);
    expect(events[0]?.metadata.evidence).toBe('g_force');
    expect(events[0]?.metadata.harshKind).toBe('braking');
  });

  it('is DISABLED for a window whose every g reading is zero', () => {
    // The six-of-seven case: the fix looks harsh only because a zero window
    // would have been treated as g-capable. It is not.
    const positions = [
      position({ providerEventId: 'ct-0', linearG: 0, lateralG: 0, speedKph: 60 }),
      position({ providerEventId: 'ct-1', linearG: 0, lateralG: 0, speedKph: 60 }),
    ];

    expect(windowHasNonZeroG(positions)).toBe(false);
    expect(detectSevereDriving(context({ positions }))).toEqual([]);
  });

  it('does NOT fire below harsh_min_speed_kph — the one broken device', () => {
    const positions = [position({ linearG: -0.5, lateralG: 0.4, speedKph: 6 })];

    expect(detectSevereDriving(context({ positions }))).toEqual([]);
  });

  it('reads linear_g as SIGNED: braking is negative, acceleration positive', () => {
    const braking = detectSevereDriving(context({
      positions: [position({ linearG: -0.5, speedKph: 60 })],
    }));
    const accelerating = detectSevereDriving(context({
      positions: [position({ linearG: 0.5, speedKph: 60 })],
    }));

    expect(braking[0]?.metadata.harshKind).toBe('braking');
    expect(accelerating[0]?.metadata.harshKind).toBe('acceleration');
  });

  it('treats lateral_g as an unsigned magnitude — a negative never fires cornering', () => {
    const positions = [position({ linearG: 0, lateralG: -0.9, speedKph: 60 })];

    expect(detectSevereDriving(context({ positions }))).toEqual([]);
  });

  it('does not double-report a fix the provider already named', () => {
    const positions = [position({
      providerEventType: 'HARSH_BRAKING', linearG: -0.6, lateralG: 0.5, speedKph: 60,
    })];

    const events = detectSevereDriving(context({ positions }));

    expect(events).toHaveLength(1);
    expect(events[0]?.metadata.evidence).toBe('provider_event');
  });

  it('honours a raised threshold', () => {
    const positions = [position({ linearG: -0.5, speedKph: 60 })];
    const ctx = context({ positions, rule: { ...RULE, harshLinearG: 0.8 } });

    expect(detectSevereDriving(ctx)).toEqual([]);
  });
});

describe('the window g gate', () => {
  it('is subsumed by the strict per-fix comparison, and this pins that reasoning', () => {
    // The gate stays in the source for the edit that breaks this implication —
    // see the module header. What can be asserted is the implication itself:
    // any fix that would fire the g path already carries non-zero g.
    const firing = [
      position({ linearG: -0.5, lateralG: 0, speedKph: 60 }),
      position({ linearG: 0.5, lateralG: 0, speedKph: 60 }),
      position({ linearG: 0, lateralG: 0.5, speedKph: 60 }),
    ];

    for (const fix of firing) {
      expect(detectSevereDriving(context({ positions: [fix] }))).toHaveLength(1);
      expect(windowHasNonZeroG([fix])).toBe(true);
    }
  });

  it('holds the implication at the threshold boundary: exactly 0.350 g does not fire', () => {
    const atThreshold = position({ linearG: -0.35, lateralG: 0.35, speedKph: 60 });

    expect(detectSevereDriving(context({ positions: [atThreshold] }))).toEqual([]);
  });
});

describe('precedence between the two evidence paths', () => {
  it('reports ONE event for a fix that satisfies both, and the provider wins', () => {
    // The firmware says cornering; the g columns say braking. Both are "true"
    // for this fix, and it is one event. Reporting it twice would open two
    // incidents under two bucket keys, and reporting the g verdict would
    // contradict the device that measured it.
    const positions = [position({
      providerEventType: 'HARSH_CORNERING', linearG: -0.9, lateralG: 0, speedKph: 80,
    })];

    const events = detectSevereDriving(context({ positions }));

    expect(events).toHaveLength(1);
    expect(events[0]?.metadata.harshKind).toBe('cornering');
    expect(events[0]?.metadata.evidence).toBe('provider_event');
  });

  it('still takes the g path for a fix the provider did not name, in the same window', () => {
    const positions = [
      position({ providerEventId: 'a', providerEventType: 'HARSH_CORNERING', linearG: -0.9, speedKph: 80 }),
      position({ providerEventId: 'b', providerEventType: 'PERIODIC_EVENT', linearG: -0.9, speedKph: 80 }),
    ];

    const events = detectSevereDriving(context({ positions }));

    expect(events.map((e) => e.metadata.evidence)).toEqual(['provider_event', 'g_force']);
  });
});
