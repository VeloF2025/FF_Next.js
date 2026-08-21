/**
 * runBatchValidation — validate every serial in one carton in a single round-trip.
 *
 * The stores PWA scans a Nokia carton code and gets nine serials at once;
 * nine sequential lookups would be nine HTTP requests on a warehouse phone.
 *
 * Verdicts come from the shared verdictForSerial so this endpoint and the
 * single-serial scan path can never disagree.
 *
 * The stock_quants comparison implements the "check both, warn on mismatch"
 * decision: serials decide issuability, quants disagreement is reported so the
 * drift stays visible until PWA receiving (Phase 2) lands.
 */

import { verdictForSerial } from '@/modules/field-stock-pwa/lib/serialVerdict';
import { serialsEligibleForIntake } from '@/modules/field-stock-pwa/lib/boxScan';
import type { SerialRecord } from '@/modules/field-stock-pwa/lib/serialVerdict';

/**
 * Minimal query surface this core needs. Matches db-pool's exported
 * `query<T extends SqlRow>(text, params)` so the route can pass it directly,
 * and a plain object literal satisfies it in tests.
 */
export interface BatchQuerier {
  query<T extends Record<string, unknown>>(text: string, params: unknown[]): Promise<T[]>;
}

export interface BatchResult {
  serialNumber: string;
  valid: boolean;
  errorMessage?: string;
  /** Set on a valid row worth flagging — e.g. not on the stock sheet yet. */
  warning?: string;
  /** True when no stock row exists and one will be created at picking time. */
  provisional?: true;
  stockItemId?: string;
  stockItemName?: string;
  currentLocationId?: string | null;
  currentLocationName?: string | null;
}

export interface BatchResponse {
  results: BatchResult[];
  quantsWarning?: { serialsInStock: number; quantsOnHand: number };
}

interface SerialQueryRow extends Record<string, unknown> {
  serial_number: string;
  stock_item_id: string;
  stock_item_name: string | null;
  status: string;
  current_location_id: string | null;
  current_location_name: string | null;
}

export async function runBatchValidation(
  db: BatchQuerier,
  input: {
    serials: string[];
    stockItemId: string;
    sourceLocationId: string | null;
    /**
     * The RAW decoded scan payload, when there was one. The server re-derives
     * which serials it corroborates rather than trusting a client flag — see
     * serialsEligibleForIntake. Absent means nothing may be taken in.
     */
    scanPayload?: string | null;
  },
): Promise<BatchResponse> {
  const { serials, stockItemId, sourceLocationId, scanPayload } = input;
  // Derived here, from the payload itself — never taken on the caller's word.
  const intakeEligible = serialsEligibleForIntake(scanPayload);

  // Plain equality, not UPPER(TRIM(...)): it matches the single-serial route
  // (serialService.getSerialByNumber) exactly, and it can use
  // idx_stock_serials_number — the function-wrapped form forces a sequential
  // scan of every serial on each carton scan. Callers already upper-case and
  // trim, and every stored serial is already normalised.
  const rows = await db.query<SerialQueryRow>(
    `SELECT s.serial_number,
            s.stock_item_id,
            i.name        AS stock_item_name,
            s.status,
            s.current_location_id,
            l.name        AS current_location_name
       FROM stock_serials s
       LEFT JOIN stock_items     i ON i.id = s.stock_item_id
       LEFT JOIN stock_locations l ON l.id = s.current_location_id
      WHERE s.serial_number = ANY($1::text[])`,
    [serials],
  );

  // stock_serials is unique on (stock_item_id, serial_number) — NOT on
  // serial_number alone — so one scanned serial can legitimately return rows for
  // two different items. Keep the row for the item being issued; only fall back
  // to another item's row when the expected item has none, so the "wrong stock
  // item" verdict still fires. Last-write-wins would silently misattribute.
  const byNumber = new Map<string, SerialQueryRow>();
  for (const row of rows) {
    const key = row.serial_number.trim().toUpperCase();
    const existing = byNumber.get(key);
    if (!existing || (existing.stock_item_id !== stockItemId && row.stock_item_id === stockItemId)) {
      byNumber.set(key, row);
    }
  }

  let sourceLocationName = '';
  if (sourceLocationId) {
    const locRows = await db.query<{ name: string | null }>(
      `SELECT name FROM stock_locations WHERE id = $1`,
      [sourceLocationId],
    );
    // || not ??: an empty-string name must fall back too, not render blank.
    sourceLocationName = locRows[0]?.name || sourceLocationId;
  }

  let expectedItemName = '';
  for (const row of rows) {
    if (row.stock_item_id === stockItemId && row.stock_item_name) {
      expectedItemName = row.stock_item_name;
      break;
    }
  }

  const ctx = {
    expectedItemId: stockItemId,
    expectedItemName: expectedItemName || stockItemId,
    sourceLocation: sourceLocationId ? { id: sourceLocationId, name: sourceLocationName } : null,
  };

  const results: BatchResult[] = serials.map((serialNumber) => {
    const row = byNumber.get(serialNumber);
    const record: SerialRecord | null = row
      ? {
          serialNumber: row.serial_number,
          stockItemId: row.stock_item_id,
          stockItemName: row.stock_item_name,
          status: row.status,
          currentLocationId: row.current_location_id,
          currentLocationName: row.current_location_name,
        }
      : null;

    // Per-serial: only a serial the payload actually lists may be taken in.
    const verdict = verdictForSerial(record, {
      ...ctx,
      scanSource: intakeEligible.has(serialNumber) ? 'machine' : 'manual',
    });
    return {
      serialNumber,
      valid: verdict.valid,
      ...(verdict.valid
        ? {
            ...(verdict.warning ? { warning: verdict.warning } : {}),
            ...(verdict.provisional ? { provisional: true as const } : {}),
          }
        : { errorMessage: verdict.errorMessage }),
      stockItemId: verdict.stockItemId,
      stockItemName: verdict.stockItemName,
      currentLocationId: row?.current_location_id ?? null,
      currentLocationName: row?.current_location_name ?? null,
    };
  });

  if (!sourceLocationId) return { results };

  const serialsInStock = results.filter((r) => r.valid).length;
  const quantRows = await db.query<{ quantity: number }>(
    `SELECT quantity FROM stock_quants
      WHERE stock_item_id = $1 AND location_id = $2 AND COALESCE(lot_number, '') = ''`,
    [stockItemId, sourceLocationId],
  );
  const quantsOnHand = Number(quantRows[0]?.quantity ?? 0);

  return quantsOnHand === serialsInStock
    ? { results }
    : { results, quantsWarning: { serialsInStock, quantsOnHand } };
}
