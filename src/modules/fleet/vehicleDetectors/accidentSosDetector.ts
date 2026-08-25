/**
 * `accident_sos` — a documented STUB. It returns zero events, always.
 *
 * Not an oversight and not a placeholder to be filled in by guesswork: NO SOS,
 * panic, impact, crash, tow or jam field exists on any of the three provider
 * feeds. Every field was enumerated on 2026-08-25 (PR0/U1; full evidence in
 * `.claude/modules/fleet.md` § "Vehicle-first spike findings"), and this header
 * names them so the next person does not have to redo the spike to find out
 * what was already checked:
 *
 *   Cartrack `GET /vehicles/events` — all 57 fields enumerated. Specifically
 *   checked and cleared: `event_description`, `terminal_event_type_id`,
 *   `input_state`, `input_state2`, `input_state3`, `output_state`,
 *   `dynamic1`–`dynamic4`, `driver_id`, `battery_percentage_left`, `x_accel`,
 *   `y_accel`, `z_accel`, `linear_g`, `lateral_g`. The `event_description`
 *   vocabulary over 55,009 events / 8 vehicles / 7 days is 14 values, none of
 *   them an alarm class: PERIODIC_EVENT, IDLING_START/CONTINUE/END,
 *   MOTION_START/END, IGNITION_ON/OFF, GPS_LOCK/LOST, SPEEDING_START/END,
 *   HARSH_BRAKING, HARSH_CORNERING.
 *
 *   Netstar — the live `tree.ts` path carries no status or alarm field at all,
 *   only `IgnitionOn`. The backfill-only CSV `Status` column has 8 observed
 *   values, all alarm-free: Timed Event, Stopped, Moving, Ignition on,
 *   Ignition off, Speeding, Idling, HeadingChange.
 *
 *   Ituran — `Statuses[].StatName` observed: Ignition On, Ignition Off, Engine
 *   On, Engine Off, Vehicle Stopped.
 *
 * Neither portal's raw payload is retained anywhere, so there is nothing to
 * re-mine offline either.
 *
 * ## The one thing that would reopen this
 *
 * Cartrack's undocumented `input_state` bitfield (24 distinct signed values
 * over 24 h). A panic button is normally a digital input, so if Cartrack
 * confirms which bit it is, this file gains a real implementation and
 * `provider_event_type`'s sibling column is the landing spot. That is a vendor
 * question, not an inference.
 *
 * ## What must never happen here
 *
 * Do NOT synthesise SOS from g-force, from harsh braking, or from a sudden stop.
 * `accident_sos` is one of the two types migration 529 leaves at
 * `severity='critical'`, so every event it emits sends an immediate WhatsApp: a
 * derived guess would be a false emergency, and a false emergency once is a
 * channel nobody trusts afterwards. An honest gap beats a plausible fabrication.
 */

import type { DetectedVehicleEvent, VehicleDetectorContext } from './types';

/** Always empty. See the header — this is the implementation, not a TODO. */
export function detectAccidentSos(_ctx: VehicleDetectorContext): DetectedVehicleEvent[] {
  return [];
}

/** The async detector shape `vehicleDetectorService` registers. */
export async function accidentSosDetector(ctx: VehicleDetectorContext): Promise<DetectedVehicleEvent[]> {
  return detectAccidentSos(ctx);
}
