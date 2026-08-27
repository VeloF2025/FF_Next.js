/**
 * Pure status derivation for the QA Centre delivery tree.
 *
 * Rules (Johan Scott walkthrough, 2026-08-27):
 * - Zone is `Maintenance` only when an active (non-superseded) FAC *and* an
 *   active CAC exist for that project + zone. Anything else is `WIP`.
 * - PON is `Optical Submitted` only when `pon_delivery_state.port_submitted_at`
 *   is recorded. Anything else is `WIP`.
 *
 * These functions are the single source of truth for both statuses; the API
 * route and the UI must not re-implement either rule.
 */

import type {
  DeliveryCounts,
  PonDeliveryStatus,
  ZoneDeliveryStatus,
  ZoneDocumentFlags,
} from './types';

/**
 * Zone status from active certificate presence.
 * Both certificates are required — one alone leaves the zone in WIP.
 */
export function deriveZoneStatus(flags: ZoneDocumentFlags): ZoneDeliveryStatus {
  return flags.hasActiveFac && flags.hasActiveCac ? 'Maintenance' : 'WIP';
}

/**
 * PON status from the recorded port submission timestamp.
 * @param portSubmittedAt ISO-8601 timestamp, or null when not yet submitted.
 */
export function derivePonStatus(portSubmittedAt: string | null): PonDeliveryStatus {
  return portSubmittedAt === null ? 'WIP' : 'Optical Submitted';
}

/** Zero counts — the identity element for {@link sumCounts}. */
export function emptyCounts(): DeliveryCounts {
  return { poles_total: 0, poles_planted: 0, activation_total: 0, activation_complete: 0 };
}

/** Sum build counts across PONs to produce a zone-level row. */
export function sumCounts(counts: readonly DeliveryCounts[]): DeliveryCounts {
  return counts.reduce<DeliveryCounts>((total, current) => ({
    poles_total: total.poles_total + current.poles_total,
    poles_planted: total.poles_planted + current.poles_planted,
    activation_total: total.activation_total + current.activation_total,
    activation_complete: total.activation_complete + current.activation_complete,
  }), emptyCounts());
}
