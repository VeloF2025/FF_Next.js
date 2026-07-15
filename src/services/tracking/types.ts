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
}

export interface TrackingProvider {
  readonly key: ProviderKey;
  readonly accountRef: string;
  /**
   * Most events one fetchPositions call can return before it gives up.
   *
   * The caller needs this to size its query window: these feeds are
   * account-wide, so events scale with fleet size, and a window wide enough to
   * blow the budget throws rather than returning a truncated page. Exposed per
   * provider because it is a fact about that provider's API, not about us.
   */
  readonly maxEventsPerFetch: number;
  fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]>;
}
