/**
 * Parses a Netstar VigilCloud "All Activity" CSV export into provider-blind
 * positions.
 *
 * Pure and network-free so it can be tested against a committed fixture. The
 * column names below are Netstar's, captured from a real export (see
 * __tests__/fixtures/README.md) — they are not guessable and must not be
 * "tidied" without re-capturing a fixture.
 *
 * A row with no usable GPS fix is dropped rather than emitted at 0,0: the map
 * would otherwise draw the vehicle off West Africa.
 */
import Papa from 'papaparse';
import type { ProviderPosition } from '../types';

/** Real header names, verbatim from a captured export. See fixtures/README.md. */
const COLUMNS = {
  timestamp: 'Time',
  speed: 'Speed',
  status: 'Status',
  gps: 'Gps',
  speedLimit: 'Speed Limit',
  latitude: 'Latitude',
  longitude: 'Longitude',
  odometer: 'Odometer',
} as const;

/** South Africa has no DST, so the offset is a constant +02:00 year-round. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * Netstar writes decimals with a COMMA: "-26,08975" is -26.08975.
 *
 * This is the single most dangerous field in the export. A generic
 * `replace(/[^\d.-]/g,'')` yields -2608975 — still a finite number, so nothing
 * throws, and every vehicle silently lands off the map.
 */
export function parseDecimalComma(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** `04/08/2026 07:26:38` — DD/MM/YYYY, no zone marker, meaning SAST. */
export function parseNetstarTs(raw: string | undefined): Date | null {
  const m = (raw ?? '').trim().match(
    /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  // noUncheckedIndexedAccess types every capture group as `string | undefined`
  // even though a successful match guarantees all six are present. Narrow
  // explicitly rather than asserting it away.
  if (!dd || !mm || !yyyy || !hh || !mi || !ss) return null;
  const asUtc = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss);
  const d = new Date(asUtc - SAST_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Ignition, where the row actually states it.
 *
 * `Status` is an event type, not a per-row state: only the two transition
 * events say anything about ignition. "Moving" strongly implies the engine is
 * running, but implying is not reporting — types.ts requires null for what the
 * provider did not supply.
 */
function ignitionFrom(status: string | undefined): boolean | null {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'ignition on') return true;
  if (s === 'ignition off') return false;
  return null;
}

export function parseAllActivityCsv(csv: string): ProviderPosition[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const out: ProviderPosition[] = [];
  for (const row of parsed.data) {
    // Gps=false means the row carries a stale or absent fix. Keeping it would
    // draw the vehicle at its last known point as though that were current.
    if ((row[COLUMNS.gps] ?? '').trim().toLowerCase() === 'false') continue;

    const lat = parseDecimalComma(row[COLUMNS.latitude]);
    const lon = parseDecimalComma(row[COLUMNS.longitude]);
    const recordedAt = parseNetstarTs(row[COLUMNS.timestamp]);
    if (lat === null || lon === null || recordedAt === null) continue;
    if (lat === 0 && lon === 0) continue;

    const status = (row[COLUMNS.status] ?? '').trim();

    out.push({
      externalId: '',            // stamped by the provider, which knows the vehicle
      providerEventId: null,     // Netstar supplies none; ingest synthesises one
      recordedAt,
      lat,
      lon,
      speedKph: parseDecimalComma(row[COLUMNS.speed]),
      roadSpeedKph: parseDecimalComma(row[COLUMNS.speedLimit]),
      // Only the Speeding event asserts speeding. Other rows are silent on it,
      // not evidence of compliance.
      isSpeeding: status.toLowerCase() === 'speeding' ? true : null,
      ignition: ignitionFrom(status),
      odometerKm: parseDecimalComma(row[COLUMNS.odometer]),
      linearG: null,
      lateralG: null,
      // This feed exposes no event vocabulary of its own. Null, never a synthesised value.
      providerEventType: null,
      bearing: null,             // no heading column in this export
      altitudeM: null,
      gpsFixType: null,
    });
  }
  return out;
}
