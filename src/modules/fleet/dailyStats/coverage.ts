/**
 * What a feed can honestly be asked for, and whether one vehicle-day got it.
 *
 * Pure: no database, no clock. Every number below was measured against 30 days of
 * `fleet_vehicle_positions` on 2026-08-25 and is quoted with its evidence, because a coverage
 * threshold pulled out of the air is worse than no flag at all -- it makes a fabrication look
 * audited.
 *
 * ## The trap this module exists to contain
 *
 * Six of the seven `cartrack/velocity` vehicles report `linear_g` and `lateral_g` as CONSTANT
 * ZERO, not null -- one distinct value across 22k-60k rows each. So `linear_g IS NOT NULL` passes
 * for all seven, and so does `provider = 'cartrack'`. Both are wrong for six of the seven, and
 * both fail in the direction that matters: they claim g coverage a vehicle does not have, which
 * would let migration 528's harsh-count CHECK pass while the counts are structurally zero.
 * `coverageGforce` is therefore computed from OBSERVED non-zero readings, per vehicle-day.
 */
import type { CoverageGranularity, DayPosition } from './types';

/** What one feed delivers, and what "a complete day" means for it. */
export interface FeedProfile {
  granularity: Exclude<CoverageGranularity, 'mixed' | 'none'>;
  /** Fewer fixes than this in a day means the day is under-observed for this feed. */
  expectedMinFixes: number;
  /** A silence longer than this means the day is under-observed however many fixes it holds. */
  maxAllowedGapSeconds: number;
}

/**
 * Measured profiles, keyed `provider/account_ref`.
 *
 * `expectedMinFixes` sits at or just under each feed's p10 fixes-per-day so an ordinary quiet day
 * is not marked incomplete; `maxAllowedGapSeconds` sits above each feed's p90 gap for the same
 * reason. Both conditions are required together, because a count alone marks a legitimately parked
 * snapshot day incomplete and a gap alone misses a feed that stopped after breakfast.
 *
 *   cartrack/velocity  p10 386 fixes/day, median 1,169, gap p99 298 s   (event-driven, 8 s median)
 *   cartrack/urent     p10 5,   median 15,             gap p90 7,581 s
 *   netstar/europcar   p10 2,   median 10,             gap p90 9,618 s  (no odometer at all)
 *   ituran/avis        p10 6,   median 11,             gap p90 7,472 s
 */
const FEED_PROFILES: Readonly<Record<string, FeedProfile>> = {
  'cartrack/velocity': { granularity: 'history', expectedMinFixes: 200, maxAllowedGapSeconds: 3_600 },
  'cartrack/urent': { granularity: 'history', expectedMinFixes: 4, maxAllowedGapSeconds: 14_400 },
  'netstar/europcar': { granularity: 'snapshot', expectedMinFixes: 2, maxAllowedGapSeconds: 14_400 },
  'ituran/avis': { granularity: 'snapshot', expectedMinFixes: 4, maxAllowedGapSeconds: 14_400 },
};

/**
 * Granularity by provider, for an account this module has never measured.
 *
 * A new account on a known provider inherits its provider's API shape -- that is a fact about the
 * API, not about the tenant -- but not its cadence, so the thresholds below stay deliberately
 * permissive until someone measures the new account and adds it above.
 */
const PROVIDER_GRANULARITY: Readonly<Record<string, FeedProfile['granularity']>> = {
  cartrack: 'history',
  netstar: 'snapshot',
  ituran: 'snapshot',
};

/**
 * Used for a feed with no measured profile. Permissive on purpose: an unmeasured account should
 * report "complete" rather than flood the fleet overview with red on its first day.
 */
const UNMEASURED_PROFILE: FeedProfile = {
  granularity: 'snapshot',
  expectedMinFixes: 1,
  maxAllowedGapSeconds: 86_400,
};

/**
 * The share of a day's fixes that must carry a non-null `ignition` before ignition-derived
 * seconds may be stored.
 *
 * 0.90 because all four live feeds clear it and the nearest one clears it by 4.5 points:
 * cartrack/velocity, cartrack/urent and netstar/europcar all assert ignition on 100% of fixes,
 * ituran/avis on 94.5%. A vehicle-day that falls below this is a device fault, not a feed
 * property, and its ignition and idle seconds are not worth storing.
 */
export const IGNITION_COVERAGE_MIN_RATIO = 0.9;

export function feedProfile(provider: string | null, accountRef: string | null): FeedProfile {
  const measured = FEED_PROFILES[`${provider ?? ''}/${accountRef ?? ''}`];
  if (measured) return measured;
  const granularity = provider === null ? null : PROVIDER_GRANULARITY[provider];
  if (!granularity) return UNMEASURED_PROFILE;
  return { ...UNMEASURED_PROFILE, granularity };
}

/**
 * The granularity for a vehicle-day, given every feed that contributed a fix to it.
 *
 * Two feeds of the SAME kind still read as that kind -- two snapshot accounts do not make a day
 * more finely observed. Only feeds of differing kinds produce 'mixed', which is the case a reader
 * must not average across.
 */
export function dayGranularity(profiles: readonly FeedProfile[]): CoverageGranularity {
  if (profiles.length === 0) return 'none';
  const kinds = new Set(profiles.map((p) => p.granularity));
  if (kinds.size > 1) return 'mixed';
  return profiles[0]!.granularity;
}

/**
 * Did any fix in this vehicle-day carry a real g reading?
 *
 * Non-zero, not non-null -- see the module header. `lateral_g` is already an unsigned magnitude
 * (min 0.000 over 237,419 rows), so no `abs()` is needed on either: zero is zero.
 */
export function coverageGforce(positions: readonly DayPosition[]): boolean {
  return positions.some((p) => (p.linearG !== null && p.linearG !== 0) || (p.lateralG !== null && p.lateralG !== 0));
}

/** Did any fix in this vehicle-day carry the provider's own event vocabulary? */
export function coverageProviderEvents(positions: readonly DayPosition[]): boolean {
  return positions.some((p) => p.providerEventType !== null && p.providerEventType !== '');
}

/**
 * Does this vehicle-day assert ignition often enough to trust ignition-derived seconds?
 *
 * A day with no fixes at all cannot: there is nothing to assert it.
 */
export function coverageIgnition(fixesWithIgnition: number, positionCount: number): boolean {
  if (positionCount === 0) return false;
  return fixesWithIgnition / positionCount >= IGNITION_COVERAGE_MIN_RATIO;
}

/**
 * Was the day observed as well as its feed can manage?
 *
 * Both conditions are required. Counting alone calls a parked snapshot day incomplete; gap alone
 * misses a tracker that delivered its usual handful of fixes and then went dark for six hours.
 */
export function coverageComplete(
  positionCount: number,
  trackerSilenceSeconds: number,
  profile: FeedProfile,
): boolean {
  return positionCount >= profile.expectedMinFixes
    && trackerSilenceSeconds <= profile.maxAllowedGapSeconds;
}
