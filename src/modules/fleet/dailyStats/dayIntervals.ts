/**
 * The instant-level arithmetic the vehicle-day fold is built from.
 *
 * Split out of `dayFold` because these are the parts with a right answer independent of any
 * accumulator: which SAST day an instant falls in, how an interval that crosses midnight divides,
 * how far a vehicle went between two fixes, and whether that stretch was moving or idling.
 *
 * SAST is UTC+2 with no DST, so every boundary here is a fixed offset and there is no ambiguous
 * or skipped hour to handle. `sastDateString` is the one way a work date is derived;
 * `toISOString().slice(0, 10)` is a UTC answer to a South African question and is banned by a
 * test in this module's __tests__ directory.
 */
import { sastDateString } from '../parking/sastDate';
import { haversineDistance } from '../utils/geoUtils';
import { IDLE_END_EVENTS, IDLE_START_EVENTS, MOTION_END_EVENTS, MOTION_START_EVENTS } from './types';
import type { DayPosition } from './types';

const MS_PER_DAY = 86_400_000;

/** Above this speed an interval is moving; at it, the vehicle is idling. */
export const IDLE_SPEED_KPH = 0;

export type IntervalLabel = 'moving' | 'idle' | null;
export type EventState = 'moving' | 'idling' | null;

export function sastDay(atMs: number): string {
  return sastDateString(new Date(atMs));
}

/** Midnight SAST that opens `workDate`, as epoch ms. Fixed offset, so no DST case exists. */
export function dayStartMs(workDate: string): number {
  return Date.parse(`${workDate}T00:00:00+02:00`);
}

/**
 * Walks `[fromMs, toMs)` a SAST day at a time, handing each day the milliseconds that fell in it.
 *
 * A zero-length interval still visits its own day once with 0 ms, so a caller can rely on the day
 * existing afterwards.
 */
export function splitAcrossDays(fromMs: number, toMs: number, apply: (workDate: string, ms: number) => void): void {
  if (toMs <= fromMs) { apply(sastDay(fromMs), 0); return; }
  let cursor = fromMs;
  while (cursor < toMs) {
    const workDate = sastDay(cursor);
    const end = Math.min(toMs, dayStartMs(workDate) + MS_PER_DAY);
    // The loop only terminates while `sastDay` and `dayStartMs` agree on the same calendar. They
    // do -- both are SAST -- but a helper swapped for a UTC one makes the day this instant is IN
    // end BEFORE the instant, and the cursor stops advancing. A silent hang is the worst way to
    // learn that, so the disagreement is stated instead.
    if (end <= cursor) {
      throw new Error(`dayIntervals: ${workDate} does not contain ${new Date(cursor).toISOString()}`);
    }
    apply(workDate, end - cursor);
    cursor = end;
  }
}

/** The distance covered between two fixes: odometer when it is present and monotonic, else GPS. */
export function intervalDistanceKm(prev: DayPosition, cur: DayPosition): number {
  if (prev.odometerKm !== null && cur.odometerKm !== null && cur.odometerKm >= prev.odometerKm) {
    return cur.odometerKm - prev.odometerKm;
  }
  // netstar/europcar supplies no odometer at all, and a reading that ran backwards is a fault
  // rather than a negative journey. Either way the coordinates are the honest fallback.
  if (prev.lat !== null && prev.lon !== null && cur.lat !== null && cur.lon !== null) {
    return haversineDistance({ lat: prev.lat, lon: prev.lon }, { lat: cur.lat, lon: cur.lon });
  }
  return 0;
}

/**
 * Whether the interval closing at `cur` was moving or idling.
 *
 * The provider's own boundary events win when the day carries them: Cartrack states IDLING_START
 * and MOTION_END exactly, which makes the split measured rather than inferred from a sampled
 * speed. Absent an event, the speed of the fix that CLOSES the interval decides -- and a fix that
 * reported no speed at all decides nothing, because `speedKph ?? 0` would book unknown time as
 * idling.
 */
export function intervalLabel(state: EventState, cur: DayPosition): IntervalLabel {
  if (state === 'idling') return 'idle';
  if (state === 'moving') return 'moving';
  if (cur.speedKph === null) return null;
  return cur.speedKph > IDLE_SPEED_KPH ? 'moving' : 'idle';
}

export function nextEventState(current: EventState, p: DayPosition): EventState {
  const event = p.providerEventType;
  if (!event) return current;
  if ((IDLE_START_EVENTS as readonly string[]).includes(event)) return 'idling';
  if ((MOTION_START_EVENTS as readonly string[]).includes(event)) return 'moving';
  if ((IDLE_END_EVENTS as readonly string[]).includes(event)) return null;
  if ((MOTION_END_EVENTS as readonly string[]).includes(event)) return null;
  // An engine that stopped is neither idling nor moving, whatever the last boundary event said.
  if (event === 'IGNITION_OFF') return null;
  return current;
}
