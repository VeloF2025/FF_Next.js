/**
 * Parses the Ituran PeleGrid payload into provider-blind positions.
 *
 * Pure and network-free so it can be tested against a committed fixture. Field
 * names are Ituran's, captured from the live portal on 2026-08-07 by recording
 * the app's own XHR — they are not guessable and must not be renamed without
 * re-capturing.
 *
 * TIMEZONES — the payload carries the same instant three times, in three
 * different zones, and only one of them is unambiguous:
 *
 *   Location_RowLocTime  "2026-08-07 10:26:54"   UTC          <- the only one we use
 *   LastGoodLocTimeStr   "07/08/2026 12:26:54"   SAST (UTC+2), display format
 *   DATEsortable         "2026-08-07 12:26:54"   SAST (UTC+2)
 *   DataTimeStamp        "2026-08-07 13:27:01"   Israel (UTC+3), envelope-level
 *
 * DATEsortable is the trap: it looks like an ISO timestamp and sorts correctly,
 * so it reads as the obvious choice, but it is local time with no zone marker.
 * Using it would file every fix two hours in the future, which then poisons the
 * watermark and strands the poll on an inverted window. Verified against a live
 * capture where SAST was 12:26 and UTC was 10:26.
 */
import { MAX_FUTURE_MS } from '../ingest';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';

export interface IturanStatus {
  StatName?: string | null;
}

export interface IturanGridRow {
  PlatformId?: number | string | null;
  Plate?: string | null;
  Label?: string | null;
  Lat?: number | null;
  Lon?: number | null;
  LastSpeed?: number | string | null;
  LastHead?: number | string | null;
  LastMileage?: number | string | null;
  SpeedLimit?: number | string | null;
  Location_RowLocTime?: string | null;
  Statuses?: IturanStatus[] | null;
}

export interface IturanGridResponse {
  ResultType?: string | null;
  ErrorStr?: string | null;
  rows_data?: Record<string, IturanGridRow> | null;
  DataTimeStamp?: string | null;
}

/**
 * The portal answers HTTP 200 with ErrorStr 'LoginError!' when PassEnc is dead,
 * so a dead session is a body-level fact, not a status code. HTTP 203 rides
 * along with it but is not relied upon here.
 */
export const LOGIN_ERROR = 'LoginError!';

export function isLoginError(res: IturanGridResponse): boolean {
  return (res.ErrorStr ?? '').trim() === LOGIN_ERROR;
}

/**
 * "2026-08-07 10:26:54" (UTC, no zone marker) -> Date.
 *
 * The space is replaced and a 'Z' appended explicitly: `new Date(...)` on a
 * bare "YYYY-MM-DD hh:mm:ss" is implementation-defined and V8 reads it as
 * LOCAL time, which on a SAST server silently shifts every fix by two hours.
 */
export function parseUtcTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const t = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;

  const d = new Date(`${t.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;

  // Shape and NaN are NOT enough. V8 rolls an impossible day over instead of
  // rejecting it — `new Date('2026-02-30T10:26:54Z')` is a valid Date for
  // 2 March. A corrupted day field would therefore survive as a
  // wrong-but-plausible instant a few days off, which is precisely the silent
  // misfiling this function exists to prevent. (Month 13 and hour 25 ARE
  // rejected by V8; only day overflow within 01-31 slips through.) Comparing
  // the parsed fields back against the input rejects exactly that case.
  if (
    d.getUTCFullYear() !== Number(m[1]) ||
    d.getUTCMonth() + 1 !== Number(m[2]) ||
    d.getUTCDate() !== Number(m[3])
  ) {
    return null;
  }
  return d;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Ignition from the status list, or null when the portal does not say.
 *
 * Null is not "off": a vehicle whose statuses we cannot read must not be
 * reported as stationary-with-engine-off, because downstream parking
 * compliance treats that as a definite state.
 *
 * ONLY the literal "Ignition On"/"Ignition Off" statuses count, matching
 * Netstar's convention. The portal reports engine and ignition independently,
 * and a live capture of a moving vehicle carried `Engine On` with no ignition
 * status at all — so in practice a driving vehicle often yields null here.
 * That is deliberate. "Engine On" implies ignition, but "Engine Off" does NOT
 * imply ignition off (accessory mode is engine-off, ignition-on), so inferring
 * from engine state would be sound in one direction only, and an asymmetric
 * rule buried in a parser is how a wrong overnight-parking verdict gets built.
 * Prefer an honest unknown.
 */
export function readIgnition(statuses: IturanStatus[] | null | undefined): boolean | null {
  if (!Array.isArray(statuses)) return null;
  for (const s of statuses) {
    const name = (s?.StatName ?? '').trim().toLowerCase();
    if (name === 'ignition on') return true;
    if (name === 'ignition off') return false;
  }
  return null;
}

/**
 * Rows carrying a usable fix, keyed by the portal's PlatformId.
 *
 * `PlatformId` is the identity; the dict key is only a fallback, since in every
 * captured payload the two are the same value. That fallback makes a collision
 * conceivable — a row missing its PlatformId whose dict key equals another
 * row's real one — and two rows sharing an externalId would attribute one
 * vehicle's positions to the other. The ingest dedup key carries no vehicle_id,
 * so such a position can never be repaired by re-ingesting.
 *
 * So a duplicate refuses BOTH rows rather than letting the first win, matching
 * how registration.ts resolves the same class of ambiguity.
 */
function* usableRows(res: IturanGridResponse): Generator<[string, IturanGridRow]> {
  const rows = res.rows_data;
  if (!rows || typeof rows !== 'object') return;

  const seen = new Map<string, IturanGridRow>();
  const duplicated = new Set<string>();
  for (const [key, row] of Object.entries(rows)) {
    if (!row || typeof row !== 'object') continue;
    const externalId = String(row.PlatformId ?? key ?? '').trim();
    if (!externalId) continue;
    if (seen.has(externalId)) {
      duplicated.add(externalId);
      continue;
    }
    seen.set(externalId, row);
  }
  for (const externalId of duplicated) seen.delete(externalId);

  yield* seen;
}

/**
 * Positions for every vehicle whose last fix falls inside [from, to].
 *
 * This is a SNAPSHOT feed: each vehicle appears at most once however wide the
 * window, and a vehicle that has not moved keeps returning the same fix
 * forever. Absence of rows is therefore never the signal that the feed died —
 * see newestFixAt.
 */
export function toPositions(
  res: IturanGridResponse,
  from: Date,
  to: Date
): ProviderPosition[] {
  const out: ProviderPosition[] = [];
  for (const [externalId, row] of usableRows(res)) {
    const recordedAt = parseUtcTimestamp(row.Location_RowLocTime);
    if (!recordedAt) continue;
    if (recordedAt < from || recordedAt > to) continue;

    const lat = num(row.Lat);
    const lon = num(row.Lon);
    if (lat === null || lon === null) continue;
    // Null island. A device with no fix reports 0,0 rather than omitting the
    // field, and drawing it puts the vehicle in the Gulf of Guinea.
    if (lat === 0 && lon === 0) continue;

    const speedKph = num(row.LastSpeed);
    const roadSpeedKph = num(row.SpeedLimit);
    out.push({
      externalId,
      // The feed carries no per-fix event id — only the vehicle's current
      // state — so identity is (vehicle, instant). ingestPositions dedups on
      // (provider, account_ref, external_id, recorded_at) when this is null.
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
      ignition: readIgnition(row.Statuses),
      odometerKm: num(row.LastMileage),
      // Ituran's grid reports none of these.
      linearG: null,
      lateralG: null,
      bearing: num(row.LastHead),
      altitudeM: null,
      gpsFixType: null,
    });
  }
  return out;
}

/** The account's vehicle list, for reconciliation against fleet_vehicles. */
export function toVehicles(res: IturanGridResponse): PortalVehicle[] {
  const out: PortalVehicle[] = [];
  for (const [externalId, row] of usableRows(res)) {
    out.push({
      externalId,
      // Plate is the real registration; Label is a display name that carries a
      // suffix ("KW96KRGP (R)") and must never be matched on.
      registration: (row.Plate ?? '').trim() || null,
      groupName: null,
    });
  }
  return out;
}

/**
 * Newest fix anywhere on the account — the dead-feed probe.
 *
 * A snapshot provider cannot signal a dead feed by returning nothing, so
 * staleness is measured account-wide instead. Returns null when the account
 * carries no parseable fix at all.
 */
export function newestFixAt(
  res: IturanGridResponse,
  now: Date = new Date()
): Date | null {
  // Future-dated fixes are excluded, not just left unstored. A device with a
  // rolled-over clock reporting years ahead would make pollProvider's
  // `feedAgeMs = now - newest` NEGATIVE, so gapReason's `feedAgeMs >
  // staleFeedMs` is false forever — and for a snapshot provider that check is
  // the ONLY dead-feed signal, since the "returned no positions" branch is
  // gated on granularity === 'history'. The account could then go dark
  // permanently while every tick logged as healthy. ingestPositions already
  // refuses such a fix, so treating it as proof of freshness would also be
  // incoherent. Same tolerance as ingest, deliberately shared.
  const cutoff = now.getTime() + MAX_FUTURE_MS;
  let newest: Date | null = null;
  for (const [, row] of usableRows(res)) {
    const at = parseUtcTimestamp(row.Location_RowLocTime);
    if (!at || at.getTime() > cutoff) continue;
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}
