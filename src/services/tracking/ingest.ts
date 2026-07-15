/**
 * Writes normalised positions into fleet_vehicle_positions.
 *
 * Idempotent by (provider, provider_event_id): polling windows overlap on
 * purpose, so re-ingesting the same event must be a no-op, not a duplicate.
 *
 * Inserts are batched (not per-row) because the first run is a 6-hour
 * cold-start backfill — roughly 1,600 positions in one call. Each chunk
 * carries its own RETURNING id, and `inserted` is the sum of rows that
 * actually landed, not the number submitted.
 *
 * Chunks are NOT wrapped in a transaction: positions are append-only facts,
 * so if a later chunk fails, earlier chunks that already landed should stay
 * landed rather than being rolled back.
 */
import { sql, query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { ProviderKey, ProviderPosition } from './types';

/** Reject fixes dated further ahead than this — device clock skew. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

/** Rows per INSERT: 500 * 17 columns = 8,500 params, well under Postgres's 65,535 limit. */
const CHUNK_SIZE = 500;

const COLUMNS = [
  'vehicle_id', 'tracker_id', 'provider', 'provider_event_id', 'recorded_at',
  'lat', 'lon', 'speed_kph', 'road_speed_kph', 'is_speeding', 'ignition',
  'odometer_km', 'linear_g', 'lateral_g', 'bearing', 'altitude_m', 'gps_fix_type',
] as const;

interface TrackerRow extends Record<string, unknown> {
  external_id: string;
  vehicle_id: string;
  tracker_id: string;
}

/** One row's params, in COLUMNS order. */
type InsertRow = readonly unknown[];

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildInsertQuery(rows: InsertRow[]): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = row.map((v) => {
      params.push(v);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  const text = `
    INSERT INTO fleet_vehicle_positions (${COLUMNS.join(', ')})
    VALUES ${tuples.join(', ')}
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  return { text, params };
}

export async function ingestPositions(
  provider: ProviderKey,
  positions: ProviderPosition[]
): Promise<{ inserted: number; skippedUnmapped: number }> {
  if (positions.length === 0) return { inserted: 0, skippedUnmapped: 0 };

  const trackers = await sql<TrackerRow>`
    SELECT external_id, vehicle_id, id AS tracker_id
    FROM fleet_vehicle_trackers
    WHERE provider = ${provider} AND is_active
  `;
  const byExternalId = new Map(trackers.map((t) => [t.external_id, t]));

  const cutoff = Date.now() + MAX_FUTURE_MS;
  let skippedUnmapped = 0;
  let skippedFuture = 0;
  const rows: InsertRow[] = [];

  for (const p of positions) {
    const t = byExternalId.get(p.externalId);
    if (!t) { skippedUnmapped++; continue; }
    if (p.recordedAt.getTime() > cutoff) { skippedFuture++; continue; }

    // The Cartrack adapter (and possibly others) can omit the provider's
    // event id. The dedup index is partial — WHERE provider_event_id IS
    // NOT NULL — so a null id would never conflict and would re-insert on
    // every overlapping poll, forever. Synthesise a deterministic id from
    // stable fields so the same event always maps to the same synthetic
    // id, keeping it dedupable via the existing (provider, provider_event_id)
    // index without touching migration 441.
    const eventId = p.providerEventId ?? `syn:${p.externalId}:${p.recordedAt.toISOString()}`;

    rows.push([
      t.vehicle_id, t.tracker_id, provider, eventId, p.recordedAt,
      p.lat, p.lon, p.speedKph, p.roadSpeedKph, p.isSpeeding, p.ignition,
      p.odometerKm, p.linearG, p.lateralG, p.bearing, p.altitudeM, p.gpsFixType,
    ]);
  }

  let inserted = 0;
  for (const rowChunk of chunk(rows, CHUNK_SIZE)) {
    const { text, params } = buildInsertQuery(rowChunk);
    const result = await query(text, params);
    inserted += result.length;
  }

  if (skippedFuture > 0) {
    log.warn('[tracking-ingest] rejected positions dated in the future', { provider, skippedFuture });
  }
  if (skippedUnmapped > 0) {
    const payload = { provider, skippedUnmapped, total: positions.length };
    if (skippedUnmapped === positions.length) {
      // Every position in this batch was unmapped — e.g. 441 not applied
      // yet, or fleet_vehicle_trackers is empty/all-inactive. That's a
      // structurally different situation from a few stray rows and should
      // not read the same as routine steady state.
      log.warn('[tracking-ingest] entire batch skipped: no mapped trackers', payload);
    } else {
      // Expected steady state — e.g. a tracker on the account with no plate.
      log.info('[tracking-ingest] positions for unmapped trackers', payload);
    }
  }
  return { inserted, skippedUnmapped };
}
