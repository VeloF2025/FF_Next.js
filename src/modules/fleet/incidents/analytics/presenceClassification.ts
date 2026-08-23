/**
 * Which presence state a day's operational status counts as.
 *
 * The aggregation reuses the SAME `OperationalStatus` the live roster screens
 * are driven by, rather than re-deriving presence from attendance and GPS. A
 * second derivation would be a second opinion, and the month-end aggregate
 * disagreeing with what a supervisor saw on the day is worse than either
 * answer being wrong on its own.
 *
 * The one rule that is not a mapping detail: `vehicle_on_site_driver_unconfirmed`
 * is its own state and never `confirmed`. That status exists precisely because
 * the vehicle was seen and the person was not.
 */
import type { OperationalStatus } from '@/modules/fleet/operations/types';
import type { PresenceFact } from './facts';

export type PresenceConfirmation = PresenceFact['confirmation'];

/**
 * Statuses that mean attendance evidence actually placed the person somewhere.
 *
 * `wrong_site` and `evidence_mismatch` belong here: the person was confirmed
 * present, and the fact that they were present in the wrong place is carried by
 * the incident metrics, not by pretending nobody showed up.
 */
const CONFIRMED_STATUSES = new Set<OperationalStatus>([
  'attendance_confirmed', 'on_site_dual', 'shift_complete',
  'left_early', 'wrong_site', 'evidence_mismatch',
]);

/** A vehicle at a site is not a person at a site. */
const VEHICLE_ONLY_STATUSES = new Set<OperationalStatus>(['vehicle_on_site_driver_unconfirmed']);

/**
 * Statuses that are not a scheduled day at all, and so produce no fact:
 * counting them would inflate every denominator with days nobody was expected.
 */
const NOT_SCHEDULED_STATUSES = new Set<OperationalStatus>(['off_duty']);

/**
 * The presence state for one roster day, or `null` when the day was not
 * scheduled and must not enter any denominator.
 *
 * Everything not explicitly confirmed or vehicle-only is `unconfirmed`. That
 * direction is deliberate: a status this function has not been taught about
 * should read as "we could not confirm this person", never as "present".
 */
export function presenceConfirmationFor(status: OperationalStatus): PresenceConfirmation | null {
  if (NOT_SCHEDULED_STATUSES.has(status)) return null;
  if (VEHICLE_ONLY_STATUSES.has(status)) return 'vehicle_only';
  if (CONFIRMED_STATUSES.has(status)) return 'confirmed';
  return 'unconfirmed';
}
