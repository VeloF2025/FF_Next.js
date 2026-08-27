/**
 * Provider-blind tracking contract. Everything downstream of the position
 * store speaks these types and never learns which platform a fix came from.
 *
 * Fields a provider cannot supply are null — never zero, never invented.
 * A null lateral_g means "this provider does not report cornering", not
 * "the vehicle cornered gently".
 */
export type ProviderKey = 'cartrack' | 'netstar' | 'ituran';

export interface ProviderPosition {
  externalId: string;
  providerEventId: string | null;
  recordedAt: Date;
  lat: number;
  lon: number;
  speedKph: number | null;
  roadSpeedKph: number | null;
  isSpeeding: boolean | null;
  ignition: boolean | null;
  odometerKm: number | null;
  linearG: number | null;
  lateralG: number | null;
  bearing: number | null;
  altitudeM: number | null;
  gpsFixType: number | null;
  /**
   * The provider's own event vocabulary for this fix, verbatim and unmapped.
   *
   * Cartrack's `event_description` carries a 14-value set -- IGNITION_ON/OFF, MOTION_START/END,
   * IDLING_START/CONTINUE/END, GPS_LOCK/LOST, SPEEDING_START/END, HARSH_BRAKING, HARSH_CORNERING,
   * PERIODIC_EVENT -- measured over 55,009 events across 8 vehicles and 7 days on 2026-08-25. It
   * is worth keeping because the device already computes harshness itself, and it does so on the
   * firmware family whose `linearG`/`lateralG` are constant zero: those are real events our g
   * columns cannot see at all.
   *
   * Null for netstar and ituran, whose live paths expose no equivalent field. Deliberately NOT
   * normalised into a shared enum -- a provider may add a value at any time, and silently mapping
   * an unrecognised one to null would lose exactly the value worth noticing.
   */
  providerEventType: string | null;
}

/**
 * What a provider's fetchPositions actually returns.
 *
 *   'history'  — every event the provider recorded in [from, to]. Cartrack.
 *   'snapshot' — each vehicle's LAST KNOWN fix, filtered by [from, to]. Netstar's
 *                portal exposes no history API, so a window returns at most one
 *                point per vehicle however wide it is.
 *
 * This is on the interface rather than in a comment because the two are not
 * substitutable and the difference is invisible at the call site. A caller that
 * wants a track (a trip report, a route replay, a re-ingest) gets one point per
 * vehicle from a snapshot provider with no type error and no runtime signal.
 * It also decides how a caller detects a dead feed: an empty array means
 * "nothing happened" for history, but a snapshot keeps returning the same stale
 * fix forever, so absence of data is not the signal. See pollProvider.ts.
 */
export type ProviderGranularity = 'history' | 'snapshot';

export interface TrackingProvider {
  readonly key: ProviderKey;
  readonly accountRef: string;
  readonly granularity: ProviderGranularity;
  /**
   * Most events one fetchPositions call can return before it gives up.
   *
   * Only meaningful for `granularity: 'history'`. A snapshot provider is bounded
   * by fleet size, not by event volume, and sets this to MAX_SAFE_INTEGER.
   *
   * The caller needs this to size its query window: these feeds are
   * account-wide, so events scale with fleet size, and a window wide enough to
   * blow the budget throws rather than returning a truncated page. Exposed per
   * provider because it is a fact about that provider's API, not about us.
   */
  readonly maxEventsPerFetch: number;
  fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]>;
}
