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
 *
 * `promoted` is MEASURED, not assumed. `promoteOesActivatedSerials` catches
 * every per-serial error internally and never rethrows, so "the call returned"
 * says nothing about how many serials actually moved. This re-runs the
 * promotable query afterwards: whatever still answers is still `in_stock`, and
 * is reported as `stillInStock` rather than counted as a success.
 *
 * A separate nightly backstop also exists — `reconcileInStockOesActivated()`,
 * called from oesPostImportService — so a serial this run fails to move is not
 * lost forever. This module does not depend on that, and reports its own
 * stragglers regardless.
 */

import { randomUUID } from 'node:crypto';
import { log } from '@/lib/logger';
import { receiveSerials } from './serialIntake';
import type { SerialIntakeItem, SerialIntakeContext, SerialIntakeResult } from './serialIntake';
import { promoteOesActivatedSerials } from '@/modules/activate/services/oes/oesSerialLifecycle';
import type { OesSerialRow } from '@/modules/activate/services/oes/oesSerialLifecycle';
import { FT_ONT_ITEM_ID } from './ontSerialWorkbook';

/**
 * Refuse to promote more than this in one unattended run.
 *
 * This job writes `activated` to a shared production database on a 4-hourly
 * cron with nobody watching. Steady state is near zero; the first run clears a
 * known backlog of ~1,142 (682 received + 460 already stuck). The ceiling is
 * whatever FT-ONT stock is `in_stock` at all — 2,931 today — so a number above
 * the backlog but below the ceiling turns "something is badly wrong" into a
 * refusal and a loud log, instead of a four-figure silent state change.
 *
 * Tripping this is not self-correcting: it needs a human to look. The check runs
 * BEFORE the receive, deliberately: receiving and then refusing to promote would
 * leave hundreds of location-less `in_stock` rows — issuable from any warehouse —
 * which is precisely the state this whole module exists to prevent. If the pass
 * cannot finish the job, it does not start it.
 *
 * Before raising this number, check the spike is real: genuine ONT deliveries
 * entered late into the workbook plus genuine OES activity, not a serial-number
 * collision or a duplicated feed. The ceiling it sits under is not fixed — the
 * same sync receives sheet rows into `in_stock` moments earlier, so a large real
 * delivery moves it.
 */
export const MAX_PROMOTIONS_PER_RUN = 2000;

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
  /** Serials that ACTUALLY left in_stock, measured after the fact. */
  promoted: number;
  /** OES-active serials still sitting in_stock after the promotion attempt. */
  stillInStock: number;
  /** Set when promotion threw outright, or left stragglers behind. */
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

  // Decide BEFORE receiving. The work this pass would have to promote is what
  // is already stuck plus what the receive is about to create; if that exceeds
  // the cap, receiving first would strand location-less issuable stock.
  const { rows: alreadyStuck } = await db.query<GapRow>(PROMOTABLE_SQL, [FT_ONT_ITEM_ID]);
  const wouldPromote = alreadyStuck.length + rows.length;
  if (wouldPromote > MAX_PROMOTIONS_PER_RUN) {
    log.error(
      'OES intake gap: pass would exceed the per-run cap — REFUSING to receive or promote. ' +
        'Check the spike is real ONT deliveries plus real OES activity, not a serial collision ' +
        'or a duplicated feed, before raising the cap.',
      {
        alreadyStuck: alreadyStuck.length,
        wouldReceive: rows.length,
        wouldPromote,
        cap: MAX_PROMOTIONS_PER_RUN,
      },
      'oes-intake-gap',
    );
    return {
      candidates: rows.length,
      received: 0,
      skipped: 0,
      promoted: 0,
      stillInStock: alreadyStuck.length,
      promotionFailed: true,
    };
  }

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
): Promise<{ promoted: number; stillInStock: number; promotionFailed?: boolean }> {
  const { rows } = await db.query<GapRow>(PROMOTABLE_SQL, [FT_ONT_ITEM_ID]);
  if (rows.length === 0) return { promoted: 0, stillInStock: 0 };

  // Backstop. The primary gate runs before the receive; this only fires if the
  // set grew between the two (a concurrent writer), and by then refusing is
  // still better than an unbounded unattended promotion.
  if (rows.length > MAX_PROMOTIONS_PER_RUN) {
    log.error(
      'OES intake gap: promotable set exceeds the per-run cap — REFUSING to promote, needs a human',
      { promotable: rows.length, cap: MAX_PROMOTIONS_PER_RUN },
      'oes-intake-gap',
    );
    return { promoted: 0, stillInStock: rows.length, promotionFailed: true };
  }

  try {
    await deps.promote(rows);
  } catch (error) {
    log.error(
      'OES intake gap: promotion threw — OES-active serials remain in_stock',
      { error, promotable: rows.length },
      'oes-intake-gap',
    );
    return { promoted: 0, stillInStock: rows.length, promotionFailed: true };
  }

  // Measure. promoteOesActivatedSerials swallows per-serial failures, so the
  // only honest count comes from asking the database what actually moved.
  //
  // The two selects are independent — no snapshot ties them together — so under
  // a concurrent run the second can see serials the first did not, and the
  // subtraction is an attribution estimate rather than an exact figure. Clamped
  // at zero so it can never report a nonsensical negative. `stillInStock` needs
  // no such caveat: it is a direct reading of the true stuck count either way,
  // which is the number the failure signal and the cron warning key off.
  const after = await db.query<GapRow>(PROMOTABLE_SQL, [FT_ONT_ITEM_ID]);
  const stillInStock = after.rows.length;
  const promoted = Math.max(0, rows.length - stillInStock);

  if (stillInStock > 0) {
    log.warn(
      'OES intake gap: some serials did not leave in_stock',
      { attempted: rows.length, promoted, stillInStock },
      'oes-intake-gap',
    );
  }

  return { promoted, stillInStock, ...(stillInStock > 0 ? { promotionFailed: true } : {}) };
}

/** Production wiring: the real intake and the real activation cascade. */
export function liveGapDeps(pool: Parameters<typeof receiveSerials>[0]): GapDeps {
  return {
    receive: (items, ctx) => receiveSerials(pool, items, ctx),
    promote: (rows) => promoteOesActivatedSerials(rows),
  };
}
