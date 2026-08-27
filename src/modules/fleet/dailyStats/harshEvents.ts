/**
 * Counting harsh-driving events for one fix.
 *
 * Its own module because it carries two independent evidence bases with a precedence rule between
 * them, and because that rule is the part most likely to be quietly broken by an edit: Cartrack's
 * firmware computes harshness itself and fires HARSH_BRAKING / HARSH_CORNERING on the vehicles
 * whose `linear_g` and `lateral_g` are constant zero. Those are events our g columns cannot see at
 * all, so the firmware's verdict WINS for a fix that carries both and the g branch is not also
 * consulted -- otherwise one event is counted twice.
 */
import { HARSH_EVENT_TYPES } from './types';
import type { DayPosition } from './types';
import type { DayAcc, HarshKind } from './dayRow';

export interface HarshThresholds {
  harshMinSpeedKph: number;
  harshLinearG: number;
  harshLateralG: number;
}

export function countHarsh(day: DayAcc, p: DayPosition, opts: HarshThresholds): void {
  // Every live HARSH_BRAKING sample carried speed = 6 km/h, and 19 of the 20 g-derived braking
  // events on the only vehicle reporting g were at <= 10 km/h. Below the gate this counter is a
  // report on one broken device, not on driving.
  if (p.speedKph === null || p.speedKph < opts.harshMinSpeedKph) return;

  // `Object.hasOwn`, not a bare index. providerEventType is a provider's string held verbatim, so
  // it can be anything, and `HARSH_EVENT_TYPES['constructor']` is a truthy FUNCTION rather than
  // undefined.
  //
  // Defensive rather than a fix for a live defect, and the difference was measured rather than
  // asserted: that stray lookup writes to a key named by the stringified function, so the three
  // real counters are untouched and `finaliseDay` reads them by name. Hardened anyway, because the
  // next reader of this lookup should not have to redo that reasoning to know it is safe.
  const event = p.providerEventType;
  const named = event !== null && Object.hasOwn(HARSH_EVENT_TYPES, event)
    ? (HARSH_EVENT_TYPES as Record<string, HarshKind>)[event]
    : undefined;
  if (named) {
    day.fromEvents[named] += 1;
    return;
  }

  if (p.linearG !== null) {
    if (p.linearG <= -opts.harshLinearG) day.fromG.brake += 1;
    else if (p.linearG >= opts.harshLinearG) day.fromG.accel += 1;
  }
  // No abs(): lateral_g is already reported as an unsigned magnitude (min 0.000 over 237,419 rows).
  if (p.lateralG !== null && p.lateralG >= opts.harshLateralG) day.fromG.corner += 1;
}
