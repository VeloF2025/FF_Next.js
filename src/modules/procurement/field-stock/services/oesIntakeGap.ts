/**
 * oesIntakeGap.ts — close the #1864 stock-receipt gap on every sync run.
 *
 * Some ONTs are reported Active in OES but have no `stock_serials` row at all:
 * they reached the field without passing through any intake channel. The
 * recurring SharePoint sync has always MEASURED this gap (`oesGapRemaining`)
 * and never closed it, while a one-shot script that could close it sat unrun —
 * so the gap simply persisted (682 serials as of 2026-08-20).
 *
 * This receives them, then promotes them in the SAME run, and the second half
 * is not optional. A received-but-unpromoted serial is `in_stock` with NO
 * location, and a serial with no recorded location is issuable from ANY
 * warehouse (the stores scan step treats a missing location as "no
 * contradiction" rather than a mismatch). These ONTs are already installed at
 * customers, so leaving them in that state — even until the next OES import —
 * would put hundreds of phantom units on the shelf.
 *
 * Promotion goes through the sanctioned `promoteOesActivatedSerials`, which
 * uses the mig-393 `in_stock → activated` transition and is idempotent. It is
 * NOT fabricating activation state: OES is the system of record saying these
 * are active, and this is the same helper the OES import itself calls.
 *
 * The promotion set is deliberately NOT "the rows this run received". It is
 * every OES-active serial currently sitting `in_stock`, recomputed after the
 * receive. Two reasons, both real:
 *
 *   1. Self-healing. If a previous run received rows and then failed to promote
 *      them, those serials now HAVE stock rows, so the receive query can never
 *      see them again — promoting only what this run created would strand them
 *      as location-less issuable stock forever.
 *   2. It cleans up intake from other sources. The SharePoint workbook lists
 *      units as warehouse stock that OES already reports live at a customer
 *      (460 such serials at Tembelihle on 2026-08-20, straight from a sheet
 *      import). Those are phantom shelf stock until something reconciles them.
 */

import { randomUUID } from 'node:crypto';
import { log } from '@/lib/logger';
import { receiveSerials } from './serialIntake';
import type { SerialIntakeItem, SerialIntakeContext, SerialIntakeResult } from './serialIntake';
import { promoteOesActivatedSerials } from '@/modules/activate/services/oes/oesSerialLifecycle';
import type { OesSerialRow } from '@/modules/activate/services/oes/oesSerialLifecycle';
import { FT_ONT_ITEM_ID } from './ontSerialWorkbook';

/** Minimal query surface needed here — a pg Pool satisfies it. */
export interface GapQuerier {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface OesIntakeGapReport {
  /** OES-active serials found with no stock_serials row. */
  candidates: number;
  /** Rows created by this run. */
  received: number;
  /** Already present (idempotent re-run). */
  skipped: number;
  /** Serials handed to the activation cascade. */
  promoted: number;
  /** Set when promotion threw — the receive still stands and is reported. */
  promotionFailed?: boolean;
}

/** Injectable seams so the orchestration is testable without a live database. */
export interface GapDeps {
  receive: (items: SerialIntakeItem[], ctx: SerialIntakeContext) => Promise<SerialIntakeResult>;
  promote: (rows: ReadonlyArray<OesSerialRow>) => Promise<void>;
}

interface GapRow {
  serial_number: string;
  drop_number: string;
}

/**
 * Every ONT currently sitting `in_stock` that OES reports active, whatever put
 * it there. Recomputed AFTER the receive so it includes rows this run created.
 *
 * Bounded to the FT-ONT stock item on purpose, mirroring the receive side.
 * `oes_activations` is an external feed: today its only non-ONT rows are 60
 * `-` placeholders matching nothing, but an unbounded join would let a future
 * feed promote a Gizzu — or anything else — out of stock on a 4-hourly cron.
 */
const PROMOTABLE_SQL = `
  SELECT DISTINCT ON (ss.serial_number)
         ss.serial_number,
         oa.drop_number
    FROM stock_serials ss
    JOIN oes_activations oa
      ON upper(trim(oa.serial_number)) = ss.serial_number
   WHERE ss.status = 'in_stock'
     AND ss.stock_item_id = $1
     AND ss.serial_number LIKE 'ALCL%'
   ORDER BY ss.serial_number, oa.activation_date DESC NULLS LAST`;

export async function closeOesIntakeGap(
  db: GapQuerier,
  deps: GapDeps,
): Promise<OesIntakeGapReport> {
  // DISTINCT ON: a serial can appear on several OES activation rows (re-swaps,
  // re-activations); the intake needs it once.
  const { rows } = await db.query<GapRow>(
    `SELECT DISTINCT ON (upper(trim(oa.serial_number)))
            upper(trim(oa.serial_number)) AS serial_number,
            oa.drop_number
       FROM oes_activations oa
      WHERE oa.serial_number ILIKE 'ALCL%'
        AND NOT EXISTS (
          SELECT 1 FROM stock_serials ss
           WHERE ss.serial_number = upper(trim(oa.serial_number))
        )
      ORDER BY upper(trim(oa.serial_number)), oa.activation_date DESC NULLS LAST`,
  );

  if (rows.length === 0) {
    // Nothing new to receive, but earlier runs or a sheet import may have left
    // OES-active serials sitting in_stock — still worth a promotion pass.
    return { candidates: 0, received: 0, skipped: 0, ...(await promoteInStock(db, deps)) };
  }

  const items: SerialIntakeItem[] = rows.map((r) => ({
    stockItemId: FT_ONT_ITEM_ID,
    serialNumber: r.serial_number,
    // OES knows the drop, not the warehouse the unit was picked from — and
    // inventing one would be worse than leaving it unset. Promotion below moves
    // these straight to `activated`, so the null never sits on issuable stock.
    locationId: null,
  }));

  const intake = await deps.receive(items, {
    sourceTable: 'oes_intake_gap',
    sourceId: randomUUID(),
    receivedReference: `OES intake gap ${new Date().toISOString().split('T')[0]}`,
    payload: { source: 'oes_intake_gap', kind: 'ont' },
  });

  return { candidates: rows.length, ...intake, ...(await promoteInStock(db, deps)) };
}

/** Promote every OES-active serial left sitting in_stock, whatever created it. */
async function promoteInStock(
  db: GapQuerier,
  deps: GapDeps,
): Promise<{ promoted: number; promotionFailed?: boolean }> {
  const { rows } = await db.query<GapRow>(PROMOTABLE_SQL, [FT_ONT_ITEM_ID]);
  if (rows.length === 0) return { promoted: 0 };

  try {
    await deps.promote(rows);
    return { promoted: rows.length };
  } catch (error) {
    log.error(
      'OES intake gap: promotion failed — OES-active serials remain in_stock',
      { error, promotable: rows.length },
      'oes-intake-gap',
    );
    return { promoted: 0, promotionFailed: true };
  }
}

/** Production wiring: the real intake and the real activation cascade. */
export function liveGapDeps(pool: Parameters<typeof receiveSerials>[0]): GapDeps {
  return {
    receive: (items, ctx) => receiveSerials(pool, items, ctx),
    promote: (rows) => promoteOesActivatedSerials(rows),
  };
}
