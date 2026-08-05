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
import { SA_BOUNDS, type GpsPoint } from '@/modules/noc/utils/gps';

// Re-exported so server-side callers keep a single import site. Client
// components must import from '@/modules/noc/utils/gps' directly — this module
// pulls in `pg` via @/lib/db and would land a Postgres driver in the browser
// bundle (it did: `next build` failed on Can't resolve 'fs' through
// ticketBatchService -> CreatePPTicketsModal).
export * from '@/modules/noc/utils/gps';

const logger = createLogger('noc:ticket-gps');

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
