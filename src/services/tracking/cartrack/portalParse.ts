/**
 * Parses the Cartrack fleetweb JSON-RPC vehicle list into provider-blind positions.
 *
 * This is the PORTAL API (`fleetweb-za.cartrack.com/jsonrpc/index.php`), which is
 * a different service from the REST API in ./client.ts that the velocity account
 * uses. Same vendor, same `provider: 'cartrack'`, different account_ref and a
 * completely different wire format. Captured live 2026-08-07 from the urent
 * account; field names are Cartrack's and must not be tidied without recapturing.
 *
 * Pure and network-free so it can be tested against a committed fixture.
 */
import { parseSampleTs } from './client';
import { MAX_FUTURE_MS } from '../ingest';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';

export interface FleetwebVehicle {
  vehicle_id?: string | number | null;
  /** The real plate. See the warning on registration below. */
  vehicle_name?: string | null;
  registration?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  /** `2026-08-07 15:47:47+02` — carries an explicit two-digit offset. */
  event_ts?: string | null;
  speed?: string | number | null;
  road_speed?: string | number | null;
  /** Metres. See toPositions. */
  odometer?: string | number | null;
  ignition?: string | number | null;
  bearing?: string | number | null;
  gps_fix_type?: string | number | null;
}

export interface FleetwebVehicleListResult {
  ct_fleet_get_vehiclelist?: FleetwebVehicle[] | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * The plate, taken from `vehicle_name` and NEVER from `registration`.
 *
 * Live data on this account carries `vehicle_name: "HW50KNGP"` alongside
 * `registration: "HW50KNGPNE"`. Normalising the latter yields HW50KNGPNE, which
 * matches no fleet row, so that vehicle would silently never map. The REST
 * client documents the same hazard for the SA tenant ("registration is an
 * INTERNAL placeholder; vehicle_name is the actual plate") — this is the second
 * account to confirm it.
 */
export function plateOf(v: FleetwebVehicle): string | null {
  const name = (v.vehicle_name ?? '').trim();
  return name || null;
}

/**
 * Ignition, or null when it cannot be read.
 *
 * Observed values are "2" on a driving vehicle (speed 25, then 12) and again on
 * a stationary one that was idling — so it is not merely speed-derived — and
 * "1" on parked vehicles. Hence 2=on / 1=off.
 *
 * That is a two-state observation of an undocumented enum, not a specification,
 * so every other value is reported unknown rather than guessed.
 *
 * THIS MAPPING IS NOW LOAD-BEARING. It used to say no consumer read `ignition`
 * at all, which stopped being true when `statusFor` (src/modules/fleet/utils/
 * liveMapHelpers.ts) began choosing between Parked, Idling, Moving and Lost
 * contact from it. A wrong mapping now mislabels every Cartrack-portal vehicle
 * on the live map, so treat 2=on/1=off as a finding to re-verify against the
 * portal rather than a settled fact.
 *
 * Re-verified live 2026-08-13 against the urent account: all five vehicles
 * reported `ignition: 1` with `speed: 0`, one of them 5 days after its last
 * event — consistent with 1=off and not with 1=on.
 *
 * An unrecognised value still degrades safely: null flows through to
 * `statusFor`'s `unknown`, which renders "No recent fix" rather than asserting
 * a state we cannot read.
 */
export function readIgnition(raw: string | number | null | undefined): boolean | null {
  const n = num(raw);
  if (n === 2) return true;
  if (n === 1) return false;
  return null;
}

/** Rows keyed by vehicle_id, refusing both sides of any id collision. */
function usableRows(vehicles: FleetwebVehicle[]): Array<[string, FleetwebVehicle]> {
  const seen = new Map<string, FleetwebVehicle>();
  const duplicated = new Set<string>();
  for (const v of vehicles) {
    if (!v || typeof v !== 'object') continue;
    const id = String(v.vehicle_id ?? '').trim();
    if (!id) continue;
    if (seen.has(id)) {
      duplicated.add(id);
      continue;
    }
    seen.set(id, v);
  }
  // A duplicated external id would attribute one vehicle's positions to another,
  // and the ingest dedup key carries no vehicle_id, so it could never be
  // repaired. Refuse both, as portal/registration.ts does.
  for (const id of duplicated) seen.delete(id);
  return [...seen];
}

/**
 * Positions for every vehicle whose last fix falls inside [from, to].
 *
 * SNAPSHOT semantics: one current fix per vehicle however wide the window, and a
 * parked vehicle keeps returning the same fix indefinitely — this account has
 * vehicles whose last fix is days old. Absence of rows is therefore never the
 * dead-feed signal; see newestFixAt.
 */
export function toPositions(
  vehicles: FleetwebVehicle[],
  from: Date,
  to: Date
): ProviderPosition[] {
  const out: ProviderPosition[] = [];
  for (const [externalId, v] of usableRows(vehicles)) {
    const recordedAt = parseSampleTs(v.event_ts ?? '');
    if (!recordedAt) continue;
    if (recordedAt < from || recordedAt > to) continue;

    const lat = num(v.latitude);
    const lon = num(v.longitude);
    if (lat === null || lon === null) continue;
    // Null island: a device with no fix reports 0,0 rather than omitting it.
    if (lat === 0 && lon === 0) continue;

    const speedKph = num(v.speed);
    const roadSpeedKph = num(v.road_speed);
    const odometerM = num(v.odometer);

    out.push({
      externalId,
      // The list is current state, not an event log — there is no per-fix id, so
      // identity is (vehicle, instant) and ingest dedups on recorded_at.
      providerEventId: null,
      recordedAt,
      lat,
      lon,
      speedKph,
      roadSpeedKph,
      isSpeeding:
        speedKph !== null && roadSpeedKph !== null && roadSpeedKph > 0
          ? speedKph > roadSpeedKph
          : null,
      ignition: readIgnition(v.ignition),
      // METRES on this API, unlike the REST one. Live values are 62291600 …
      // 149989788, i.e. 62 291 km … 149 990 km — plausible odometers. Read as
      // kilometres they would be 62 million km, which is why this must not be
      // passed through unscaled.
      odometerKm: odometerM === null ? null : odometerM / 1000,
      linearG: null,
      lateralG: null,
      // This feed exposes no event vocabulary of its own. Null, never a synthesised value.
      providerEventType: null,
      bearing: num(v.bearing),
      altitudeM: null,
      gpsFixType: num(v.gps_fix_type),
    });
  }
  return out;
}

/** The account's vehicle list, for reconciliation against fleet_vehicles. */
export function toVehicles(vehicles: FleetwebVehicle[]): PortalVehicle[] {
  return usableRows(vehicles).map(([externalId, v]) => ({
    externalId,
    registration: plateOf(v),
    groupName: null,
  }));
}

/**
 * Newest fix anywhere on the account — the dead-feed probe.
 *
 * A snapshot provider cannot signal a dead feed by returning nothing, so for
 * this provider staleness is the ONLY such signal: gapReason's
 * "returned no positions" branch is gated on `granularity === 'history'`. That
 * makes this function load-bearing, and it is why future-dated fixes must be
 * excluded rather than merely not stored.
 *
 * A tracker with a rolled-over or corrupted clock reports a date years ahead.
 * Taking a plain max would then make `feedAgeMs = now - newest` NEGATIVE, so
 * `feedAgeMs > staleFeedMs` is false forever and the whole account could go
 * dark permanently while every tick still logs as healthy. ingestPositions
 * already refuses such a fix, so counting it as "fresh" would also be
 * incoherent: it would mean the feed is proven live by a reading we declined
 * to store. Same tolerance as ingest, deliberately shared.
 *
 * `now` is injectable so the guard is testable without touching the clock.
 */
export function newestFixAt(vehicles: FleetwebVehicle[], now: Date = new Date()): Date | null {
  const cutoff = now.getTime() + MAX_FUTURE_MS;
  let newest: Date | null = null;
  for (const [, v] of usableRows(vehicles)) {
    const at = parseSampleTs(v.event_ts ?? '');
    if (!at || at.getTime() > cutoff) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}
