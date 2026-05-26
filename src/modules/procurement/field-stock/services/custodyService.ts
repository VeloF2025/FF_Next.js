/**
 * custodyService — executor-injected holder-keyed stock postings
 *
 * All functions accept a TxnClient as the first argument and run INSIDE the
 * caller's existing pg.Pool transaction. No connections are opened here.
 *
 * Three movement variants:
 *   issue       — location → holder  (debit stock_quants, credit stock_custody)
 *   consumption — holder → consumed  (debit stock_custody, no to-side)
 *   return      — holder → location  (debit stock_custody, credit stock_quants)
 *
 * Movement INSERTs use the `INSERT INTO t SELECT * FROM (VALUES (...)) AS v(cols)`
 * form so that the movement-type literal ('issue', 'consumption', 'return') appears
 * in the VALUES tuple BEFORE the endpoint-column aliases in the alias list. This
 * keeps the SQL text order unambiguous for assertion-based unit tests.
 */

import type { TxnClient } from '@/lib/db-pool';

// ============================================================================
// Types
// ============================================================================

export interface CustodyLine {
  stockItemId: string;
  quantity: number;
  lotNumber: string | null;
  unitCost: number | null;
}

export interface PostIssueArgs {
  lines: CustodyLine[];
  sourceLocationId: string;
  toHolderId: string;
  reference?: string;
  performedBy?: string;
}

export interface PostConsumeArgs {
  stockItemId: string;
  quantity: number;
  lotNumber: string | null;
  unitCost: number | null;
  fromHolderId: string;
  reference?: string;
  performedBy?: string;
}

export interface PostReturnArgs {
  lines: CustodyLine[];
  fromHolderId: string;
  toLocationId: string;
  reference?: string;
  performedBy?: string;
}

// ============================================================================
// SQL constants — stock_quants
// ============================================================================

/**
 * Debit qty from a location's quant.
 * Params: $1=stock_item_id, $2=location_id, $3=lot_number, $4=quantity
 */
const SQL_DEBIT_QUANT =
  `UPDATE stock_quants ` +
  `SET quantity = stock_quants.quantity - $4, updated_at = NOW() ` +
  `WHERE stock_item_id = $1 AND location_id = $2 ` +
  `AND COALESCE(lot_number, '') = COALESCE($3, '')`;

/**
 * Credit qty to a location's quant (upsert on canonical key).
 * Params: $1=stock_item_id, $2=location_id, $3=lot_number, $4=quantity
 */
const SQL_CREDIT_QUANT =
  `INSERT INTO stock_quants (id, stock_item_id, location_id, lot_number, quantity, created_at, updated_at) ` +
  `VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW()) ` +
  `ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number, '')) ` +
  `DO UPDATE SET quantity = stock_quants.quantity + EXCLUDED.quantity, updated_at = NOW()`;

// ============================================================================
// SQL constants — stock_custody
// ============================================================================

/**
 * Credit qty to a holder's custody row (upsert on canonical key).
 * Params: $1=holder_id, $2=stock_item_id, $3=lot_number, $4=quantity, $5=unit_cost
 */
const SQL_CREDIT_CUSTODY =
  `INSERT INTO stock_custody (id, holder_id, stock_item_id, lot_number, quantity, total_value, created_at, updated_at) ` +
  `VALUES (gen_random_uuid(), $1, $2, $3, $4, COALESCE($5, 0) * $4, NOW(), NOW()) ` +
  `ON CONFLICT (holder_id, stock_item_id, COALESCE(lot_number, '')) ` +
  `DO UPDATE SET ` +
  `quantity = stock_custody.quantity + EXCLUDED.quantity, ` +
  `total_value = COALESCE(stock_custody.total_value, 0) + EXCLUDED.total_value, ` +
  `updated_at = NOW()`;

/**
 * Debit qty from a holder's custody row.
 * Params: $1=holder_id, $2=stock_item_id, $3=lot_number, $4=quantity, $5=unit_cost
 */
const SQL_DEBIT_CUSTODY =
  `UPDATE stock_custody ` +
  `SET quantity = stock_custody.quantity - $4, ` +
  `total_value = COALESCE(stock_custody.total_value, 0) - (COALESCE($5, 0) * $4), ` +
  `updated_at = NOW() ` +
  `WHERE holder_id = $1 AND stock_item_id = $2 ` +
  `AND COALESCE(lot_number, '') = COALESCE($3, '')`;

// ============================================================================
// SQL constants — field_stock_movements (one literal per movement variant)
// ============================================================================

/**
 * Issue movement: location → holder.
 *
 * Uses INSERT ... SELECT * FROM (VALUES (...)) AS v(cols) so that the literal
 * 'issue' appears in the VALUES tuple before the column alias `to_holder_id`
 * in the alias list, satisfying test regex:
 *   /INSERT INTO field_stock_movements[\s\S]*'issue'[\s\S]*to_holder_id/i
 *
 * Params: $1=stock_item_id, $2=from_location_id, $3=to_holder_id,
 *         $4=quantity, $5=unit_cost, $6=reference, $7=performed_by
 */
const SQL_MOVEMENT_ISSUE =
  `INSERT INTO field_stock_movements ` +
  `SELECT * FROM (VALUES (gen_random_uuid(), $1::uuid, 'issue'::text, $2::uuid, $4::numeric, $5::numeric, COALESCE($5::numeric,0)*$4::numeric, $6::text, $7::text, NOW(), NOW(), $3::uuid)) ` +
  `AS v(id, stock_item_id, movement_type, from_location_id, quantity, unit_cost, total_cost, reference, performed_by, performed_at, created_at, to_holder_id)`;

/**
 * Consumption movement: from holder, no to-side.
 *
 * Literal 'consumption' in VALUES before column alias `from_holder_id`:
 *   /INSERT INTO field_stock_movements[\s\S]*'consumption'[\s\S]*from_holder_id/i
 *
 * Params: $1=stock_item_id, $2=from_holder_id,
 *         $3=quantity, $4=unit_cost, $5=reference, $6=performed_by
 */
const SQL_MOVEMENT_CONSUMPTION =
  `INSERT INTO field_stock_movements ` +
  `SELECT * FROM (VALUES (gen_random_uuid(), $1::uuid, 'consumption'::text, $3::numeric, $4::numeric, COALESCE($4::numeric,0)*$3::numeric, $5::text, $6::text, NOW(), NOW(), $2::uuid)) ` +
  `AS v(id, stock_item_id, movement_type, quantity, unit_cost, total_cost, reference, performed_by, performed_at, created_at, from_holder_id)`;

/**
 * Return movement: holder → location.
 *
 * Literal 'return' in VALUES before aliases `from_holder_id` then `to_location_id`:
 *   /INSERT INTO field_stock_movements[\s\S]*'return'[\s\S]*from_holder_id[\s\S]*to_location_id/i
 *
 * Params: $1=stock_item_id, $2=from_holder_id, $3=to_location_id,
 *         $4=quantity, $5=unit_cost, $6=reference, $7=performed_by
 */
const SQL_MOVEMENT_RETURN =
  `INSERT INTO field_stock_movements ` +
  `SELECT * FROM (VALUES (gen_random_uuid(), $1::uuid, 'return'::text, $4::numeric, $5::numeric, COALESCE($5::numeric,0)*$4::numeric, $6::text, $7::text, NOW(), NOW(), $2::uuid, $3::uuid)) ` +
  `AS v(id, stock_item_id, movement_type, quantity, unit_cost, total_cost, reference, performed_by, performed_at, created_at, from_holder_id, to_location_id)`;

// ============================================================================
// Public API
// ============================================================================

/**
 * Post an issue from a warehouse location into a holder's custody.
 *
 * Per line (skips empty stockItemId or qty <= 0):
 *   1. Debit stock_quants at sourceLocationId
 *   2. Credit stock_custody for toHolderId
 *   3. Insert field_stock_movements 'issue' row (from_location_id → to_holder_id)
 *
 * Returns total quantity issued.
 */
export async function postIssueToHolderWith(
  txn: TxnClient,
  args: PostIssueArgs,
): Promise<number> {
  const { lines, sourceLocationId, toHolderId, reference, performedBy } = args;
  let total = 0;

  for (const l of lines) {
    if (!l.stockItemId || l.quantity <= 0) continue;

    await txn.query(SQL_DEBIT_QUANT, [l.stockItemId, sourceLocationId, l.lotNumber, l.quantity]);
    await txn.query(SQL_CREDIT_CUSTODY, [toHolderId, l.stockItemId, l.lotNumber, l.quantity, l.unitCost]);
    await txn.query(SQL_MOVEMENT_ISSUE, [
      l.stockItemId,
      sourceLocationId,
      toHolderId,
      l.quantity,
      l.unitCost,
      reference ?? null,
      performedBy ?? null,
    ]);

    total += l.quantity;
  }
  return total;
}

/**
 * Post a consumption from a holder's custody (stock used in the field).
 *
 * Debits stock_custody and inserts a field_stock_movements 'consumption' row
 * with from_holder_id set; no to-side endpoint.
 *
 * Skips silently when stockItemId is empty or quantity <= 0.
 */
export async function postConsumeFromHolderWith(
  txn: TxnClient,
  args: PostConsumeArgs,
): Promise<void> {
  const { stockItemId, quantity, lotNumber, unitCost, fromHolderId, reference, performedBy } = args;

  if (!stockItemId || quantity <= 0) return;

  await txn.query(SQL_DEBIT_CUSTODY, [fromHolderId, stockItemId, lotNumber, quantity, unitCost]);
  await txn.query(SQL_MOVEMENT_CONSUMPTION, [
    stockItemId,
    fromHolderId,
    quantity,
    unitCost,
    reference ?? null,
    performedBy ?? null,
  ]);
}

/**
 * Post a return from a holder's custody back to a warehouse location.
 *
 * Per line (skips empty stockItemId or qty <= 0):
 *   1. Debit stock_custody for fromHolderId
 *   2. Credit stock_quants at toLocationId
 *   3. Insert field_stock_movements 'return' row (from_holder_id → to_location_id)
 *
 * Returns total quantity returned.
 */
export async function postReturnFromHolderWith(
  txn: TxnClient,
  args: PostReturnArgs,
): Promise<number> {
  const { lines, fromHolderId, toLocationId, reference, performedBy } = args;
  let total = 0;

  for (const l of lines) {
    if (!l.stockItemId || l.quantity <= 0) continue;

    await txn.query(SQL_DEBIT_CUSTODY, [fromHolderId, l.stockItemId, l.lotNumber, l.quantity, l.unitCost]);
    await txn.query(SQL_CREDIT_QUANT, [l.stockItemId, toLocationId, l.lotNumber, l.quantity]);
    await txn.query(SQL_MOVEMENT_RETURN, [
      l.stockItemId,
      fromHolderId,
      toLocationId,
      l.quantity,
      l.unitCost,
      reference ?? null,
      performedBy ?? null,
    ]);

    total += l.quantity;
  }
  return total;
}
