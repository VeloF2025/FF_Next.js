/**
 * When a tracking tick counts as "we got no usable data".
 *
 * Pure, so the policy can be exercised without a portal or a database — and
 * separate from pollProvider.ts because the ordering below is the whole point
 * and it deserves to be read on its own.
 *
 * The subtle part is that the answer depends on the provider's granularity:
 *
 *   history  — an empty window genuinely means nothing happened, so an empty
 *              result IS the signal.
 *   snapshot — the provider returns each vehicle's last known fix, so a frozen
 *              portal keeps handing back the same stale positions forever. An
 *              empty result is therefore unreachable, and absence of data
 *              cannot detect an outage. Staleness of the whole account can.
 */
import type { ProviderGranularity } from './types';

export interface GapInput {
  granularity: ProviderGranularity;
  /** Vehicles the portal listed this tick. */
  portalVehicleCount: number;
  /** Trackers mapped right now — the denominator for "should we have data?". */
  activeTrackers: number;
  /** The portal listed vehicles but none could be placed against our fleet. */
  matchedNone: boolean;
  /** The wholesale-unmapping brake engaged. */
  deactivationSuppressed: boolean;
  /** Positions accepted from this tick. */
  positionCount: number;
  /**
   * Age of the newest fix anywhere on the provider's account, or null when the
   * provider offers no such probe (history providers do not need one).
   */
  feedAgeMs: number | null;
  /** Above this, a snapshot provider's whole account counts as dead. */
  staleFeedMs: number;
}

/**
 * The reason this tick is a gap, or null if it is healthy.
 *
 * Ordered most-specific first: an empty vehicle list explains everything
 * downstream of it, so reporting "no positions" there would name a symptom
 * instead of the cause.
 */
export function decideGapReason(i: GapInput): string | null {
  if (i.activeTrackers <= 0) return null;

  if (i.portalVehicleCount === 0) {
    return `portal returned an empty vehicle list while ${i.activeTrackers} trackers remain mapped`;
  }
  if (i.matchedNone) {
    return `portal returned ${i.portalVehicleCount} vehicles but none could be mapped `
      + '— registration format drift or a vehicle-tree change';
  }
  if (i.deactivationSuppressed) {
    return `refused to unmap ${i.activeTrackers} trackers: this tick matched too few vehicles`;
  }
  if (i.feedAgeMs !== null && i.feedAgeMs > i.staleFeedMs) {
    const hours = Math.round(i.feedAgeMs / 3_600_000);
    return `portal feed is stale: newest fix on the whole account is ${hours}h old`;
  }
  // Only meaningful for a history provider — see the header.
  if (i.granularity === 'history' && i.positionCount === 0) {
    return `${i.activeTrackers} vehicles mapped but the provider returned no positions`;
  }
  return null;
}
