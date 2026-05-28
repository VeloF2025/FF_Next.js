import type { PoolClient } from 'pg';

/**
 * Per-transaction GUC variable names read by stock_serials lifecycle triggers
 * (mig 387). All five live under the `ff.` prefix; the validate + emit
 * triggers read these via `current_setting('ff.<name>', true)`.
 */
export const SERIAL_EVENT_GUCS = {
  sourceTable:   'ff.event_source_table',
  sourceId:      'ff.event_source_id',
  actorUserId:   'ff.event_actor_user_id',
  actorStaffId:  'ff.event_actor_staff_id',
  payload:       'ff.event_payload',
  occurredAt:    'ff.event_occurred_at',
  bypass:        'ff.bypass_validation',
} as const;

export interface SerialEventContext {
  sourceTable:  string;
  sourceId:     string;
  actorUserId?: string | null;
  actorStaffId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
  bypass?: boolean;
}

/**
 * Set per-txn `SET LOCAL ff.event_*` GUCs that the stock_serials triggers read.
 * MUST be called inside an open transaction on `client`. The variables are
 * cleared automatically when the transaction commits or rolls back.
 *
 * NOTE: Postgres `SET LOCAL` does not support bind parameters ($1). Values are
 * escaped via `client.escapeLiteral()` (the same quoting pg uses internally for
 * identifier/literal safety) before interpolation into the SQL string.
 */
export async function withSerialEventContext<T>(
  client: PoolClient,
  ctx: SerialEventContext,
  fn: () => Promise<T>,
): Promise<T> {
  // SET LOCAL requires literal values — bind params are not supported by Postgres
  // for configuration parameters. escapeLiteral wraps the value in single quotes
  // and escapes any embedded quotes, making injection impossible.
  const setLocal = async (guc: string, value: string): Promise<void> => {
    await client.query(`SET LOCAL ${guc} = ${client.escapeLiteral(value)}`);
  };

  await setLocal(SERIAL_EVENT_GUCS.sourceTable, ctx.sourceTable);
  await setLocal(SERIAL_EVENT_GUCS.sourceId,    ctx.sourceId);
  if (ctx.actorUserId)  await setLocal(SERIAL_EVENT_GUCS.actorUserId,  ctx.actorUserId);
  if (ctx.actorStaffId) await setLocal(SERIAL_EVENT_GUCS.actorStaffId, ctx.actorStaffId);
  if (ctx.payload)      await setLocal(SERIAL_EVENT_GUCS.payload,      JSON.stringify(ctx.payload));
  if (ctx.occurredAt)   await setLocal(SERIAL_EVENT_GUCS.occurredAt,   ctx.occurredAt.toISOString());
  if (ctx.bypass)       await client.query(`SET LOCAL ${SERIAL_EVENT_GUCS.bypass} = 'true'`);
  return fn();
}
