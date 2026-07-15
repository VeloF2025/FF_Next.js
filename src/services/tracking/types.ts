/**
 * Provider-blind tracking contract. Everything downstream of the position
 * store speaks these types and never learns which platform a fix came from.
 *
 * Fields a provider cannot supply are null — never zero, never invented.
 * A null lateral_g means "this provider does not report cornering", not
 * "the vehicle cornered gently".
 */
export type ProviderKey = 'cartrack' | 'netstar' | 'ituran';

export interface ProviderVehicle {
  externalId: string;
  registration: string | null;
  description: string | null;
}

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
  listVehicles(): Promise<ProviderVehicle[]>;
  fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]>;
}
