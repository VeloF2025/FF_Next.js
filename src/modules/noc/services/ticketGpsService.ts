/**
 * Ticket GPS resolution.
 *
 * Every location FibreFlow held for a ticket came from one lineage: the SOW /
 * HLD design import, mirrored into `drops`, `sow_drops` and `onemap_properties`
 * (they agree to a metre because they ARE each other). Those are *planned* drop
 * positions.
 *
 * The daily OES report carries a second, independent coordinate —
 * `oes_activations.latitude/longitude`, explicit columns in Fibertime's
 * activation sheet, recorded at activation and keyed to the ONT serial.
 *
 * For serial-mismatch / no-OES-entry / pre-provision tickets the DR↔serial link
 * is the very thing under investigation, so deriving the location from the DR is
 * circular — it inherits the error being investigated. The OES coordinate is
 * keyed to the serial, which is the fact not in dispute, so it ranks FIRST for
 * those categories. Field techs report it matches reality; the design coordinate
 * is kept and surfaced alongside it whenever the two disagree materially.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('noc:ticket-gps');

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

/**
 * South African bounding box. 13 of 25,414 OES rows (0.05%) carry coordinates
 * from Nepal, Indonesia and Iraq — a handful of activation devices report a
 * bogus fix. `drops` has zero out-of-bounds rows, so this guard applies to the
 * OES side only and a rejected OES point falls through to the design coordinate
 * rather than replacing it with garbage.
 */
const SA_BOUNDS = { minLat: -35, maxLat: -22, minLng: 16, maxLng: 33 } as const;

/** Metres beyond which the two sources are shown side by side instead of one winning silently. */
export const GPS_DIVERGENCE_THRESHOLD_M = 50;

export function isPlausibleSaCoordinate(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined
): boolean {
  if (lat == null || lng == null) return false;
  const latNum = typeof lat === 'number' ? lat : parseFloat(lat);
  const lngNum = typeof lng === 'number' ? lng : parseFloat(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return false;
  if (latNum === 0 && lngNum === 0) return false;
  return (
    latNum >= SA_BOUNDS.minLat && latNum <= SA_BOUNDS.maxLat &&
    lngNum >= SA_BOUNDS.minLng && lngNum <= SA_BOUNDS.maxLng
  );
}

/** Great-circle distance in metres. */
export function haversineMeters(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rank candidate coordinates: OES activation first, then the design lineage.
 *
 * PAIR-WISE: a returned pair always comes from ONE source. Resolving latitude
 * and longitude independently would mix a latitude from the OES report with a
 * longitude from the design import and produce a plausible-looking point that
 * is nowhere.
 */
export function resolveTicketGps(
  oes: GpsPoint | null | undefined,
  design: GpsPoint | null | undefined
): { point: GpsPoint; source: 'oes_report' | 'design' } | null {
  if (oes && isPlausibleSaCoordinate(oes.latitude, oes.longitude)) {
    return { point: oes, source: 'oes_report' };
  }
  if (design && Number.isFinite(design.latitude) && Number.isFinite(design.longitude)) {
    return { point: design, source: 'design' };
  }
  return null;
}

/** Serialize for the `maintenance_tickets.gps_coordinates` text column ("lat,lng"). */
export function formatGpsColumn(point: GpsPoint): string {
  return `${point.latitude},${point.longitude}`;
}

/**
 * OES activation coordinate for a DR. Latest activation wins — the OES sheet is
 * re-imported nightly and a re-activation supersedes the earlier fix.
 */
export async function lookupOesGpsByDr(drNumber: string | null | undefined): Promise<GpsPoint | null> {
  if (!drNumber) return null;
  try {
    const result = await pool.query<{ latitude: string; longitude: string }>(
      `SELECT latitude, longitude
         FROM oes_activations
        WHERE UPPER(drop_number) = UPPER($1)
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN $2 AND $3
          AND longitude BETWEEN $4 AND $5
        ORDER BY activation_date DESC NULLS LAST, imported_at DESC
        LIMIT 1`,
      [drNumber, SA_BOUNDS.minLat, SA_BOUNDS.maxLat, SA_BOUNDS.minLng, SA_BOUNDS.maxLng]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { latitude: Number(row.latitude), longitude: Number(row.longitude) };
  } catch (err) {
    logger.warn('OES GPS lookup failed', {
      drNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * OES activation coordinate for an ONT serial. Used where the DR itself is in
 * dispute (serial mismatches, unresolved pre-provision rows) — the serial is the
 * anchor that survives a wrong DR link.
 */
export async function lookupOesGpsBySerial(serial: string | null | undefined): Promise<GpsPoint | null> {
  if (!serial) return null;
  try {
    const result = await pool.query<{ latitude: string; longitude: string }>(
      `SELECT latitude, longitude
         FROM oes_activations
        WHERE LOWER(serial_number) = LOWER($1)
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN $2 AND $3
          AND longitude BETWEEN $4 AND $5
        ORDER BY activation_date DESC NULLS LAST, imported_at DESC
        LIMIT 1`,
      [serial, SA_BOUNDS.minLat, SA_BOUNDS.maxLat, SA_BOUNDS.minLng, SA_BOUNDS.maxLng]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { latitude: Number(row.latitude), longitude: Number(row.longitude) };
  } catch (err) {
    logger.warn('OES GPS lookup by serial failed', {
      serial,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * DR first, serial as fallback. A mismatch ticket often has an OES row under the
 * serial but none under the DR we were given — that fallback is the whole point.
 */
export async function lookupOesGps(
  drNumber: string | null | undefined,
  serial?: string | null
): Promise<GpsPoint | null> {
  return (await lookupOesGpsByDr(drNumber)) ?? (await lookupOesGpsBySerial(serial));
}
