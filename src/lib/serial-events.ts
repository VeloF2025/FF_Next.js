/**
 * serial-events.ts — Application-layer helpers for stock_serial_events.
 *
 * The live path is handled by PostgreSQL triggers (migration 364).
 * This module provides query helpers used by API routes and services.
 */
import type { Pool, PoolClient } from 'pg';
import { log } from './logger';

export interface SerialEvent {
  id: string;
  serialId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  actorUserId: string | null;
  actorStaffId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  recordedAt: Date;
}

type DbClient = Pool | PoolClient;

function mapRow(row: Record<string, unknown>): SerialEvent {
  return {
    id:           row.id as string,
    serialId:     row.serial_id as string,
    eventType:    row.event_type as string,
    fromState:    (row.from_state as string | null) ?? null,
    toState:      (row.to_state as string | null) ?? null,
    sourceTable:  (row.source_table as string | null) ?? null,
    sourceId:     (row.source_id as string | null) ?? null,
    actorUserId:  (row.actor_user_id as string | null) ?? null,
    actorStaffId: (row.actor_staff_id as string | null) ?? null,
    payload:      (row.payload as Record<string, unknown>) ?? {},
    occurredAt:   row.occurred_at as Date,
    recordedAt:   row.recorded_at as Date,
  };
}

/**
 * Returns all events for a serial, ordered newest-first.
 */
export async function getSerialEvents(
  db: DbClient,
  serialId: string,
  limit = 50,
): Promise<SerialEvent[]> {
  const r = await db.query(
    `SELECT *
     FROM   stock_serial_events
     WHERE  serial_id = $1
     ORDER  BY occurred_at DESC, recorded_at DESC
     LIMIT  $2`,
    [serialId, limit],
  );
  return r.rows.map(mapRow);
}

/**
 * Returns the most-recent event for a serial, or null if none exists.
 */
export async function getLatestSerialEvent(
  db: DbClient,
  serialId: string,
): Promise<SerialEvent | null> {
  const r = await db.query(
    `SELECT *
     FROM   stock_serial_events
     WHERE  serial_id = $1
     ORDER  BY occurred_at DESC, recorded_at DESC
     LIMIT  1`,
    [serialId],
  );
  if (r.rows.length === 0) return null;
  return mapRow(r.rows[0]);
}

/**
 * Returns events grouped by event_type for a set of serials.
 * Useful for dashboard counts (how many issued, installed, activated).
 */
export async function getSerialEventCounts(
  db: DbClient,
  serialIds: string[],
): Promise<Record<string, number>> {
  if (serialIds.length === 0) return {};

  const r = await db.query(
    `SELECT event_type, COUNT(*)::integer AS cnt
     FROM   stock_serial_events
     WHERE  serial_id = ANY($1::uuid[])
     GROUP  BY event_type`,
    [serialIds],
  );

  const out: Record<string, number> = {};
  for (const row of r.rows) {
    out[row.event_type as string] = row.cnt as number;
  }
  return out;
}

/**
 * Manually inserts a serial event (for cases where the triggering source
 * table does not have a PostgreSQL trigger — e.g., manual corrections).
 * Idempotent via the uq_sse_dedupe partial index when source_id is provided.
 */
export async function emitSerialEvent(
  db: DbClient,
  opts: {
    serialId: string;
    eventType: string;
    fromState?: string | null;
    toState?: string | null;
    sourceTable?: string | null;
    sourceId?: string | null;
    actorUserId?: string | null;
    actorStaffId?: string | null;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  },
): Promise<SerialEvent | null> {
  const {
    serialId, eventType, fromState, toState,
    sourceTable, sourceId, actorUserId, actorStaffId,
    payload, occurredAt,
  } = opts;

  const r = await db.query(
    `INSERT INTO stock_serial_events
       (serial_id, event_type, from_state, to_state, source_table, source_id,
        actor_user_id, actor_staff_id, payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
     ON CONFLICT (serial_id, source_table, source_id, event_type)
       WHERE source_id IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [
      serialId,
      eventType,
      fromState ?? null,
      toState ?? null,
      sourceTable ?? null,
      sourceId ?? null,
      actorUserId ?? null,
      actorStaffId ?? null,
      JSON.stringify(payload ?? {}),
      occurredAt ?? new Date(),
    ],
  );

  if (r.rows.length === 0) {
    log.info('serial-events: emitSerialEvent was a no-op (duplicate)', {
      serialId, eventType, sourceTable, sourceId,
    });
    return null;
  }

  return mapRow(r.rows[0]);
}
