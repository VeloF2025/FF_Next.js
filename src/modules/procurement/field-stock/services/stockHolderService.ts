/**
 * Stock Holder Service — typed custody-identity registry (Sprint C).
 *
 * holder_type ∈ {staff, contractor, external_person}. SMME is NOT a holder type
 * (it is a future contractor attribute); teams never hold. See the design spec.
 *
 * Core functions take an injectable HolderExecutor so the emitted SQL is
 * unit-testable without a live DB (mirrors postGrnReceiptLines). Public wrappers
 * bind the core to the pg.Pool singleton in @/lib/db-pool.
 */
import { query, queryOne, transaction, type SqlRow } from '@/lib/db-pool';
import { log } from '@/lib/logger';

export type HolderType = 'staff' | 'contractor' | 'external_person';

export interface StockHolder {
  id: string;
  holderType: HolderType;
  staffId: string | null;
  contractorId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal query surface; satisfied by @/lib/db-pool and by a transaction client. */
export interface HolderExecutor {
  query<T extends SqlRow = SqlRow>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends SqlRow = SqlRow>(text: string, params?: unknown[]): Promise<T | null>;
}

const HOLDER_COLS =
  'id, holder_type, staff_id, contractor_id, name, phone, email, is_active, created_at, updated_at';

export function rowToHolder(r: Record<string, unknown>): StockHolder {
  return {
    id: String(r.id),
    holderType: r.holder_type as HolderType,
    staffId: (r.staff_id as string) ?? null,
    contractorId: (r.contractor_id as string) ?? null,
    name: String(r.name),
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

const STAFF_UPSERT = `
  INSERT INTO stock_holders (holder_type, staff_id, name, phone)
  VALUES ('staff', $1, $2, $3)
  ON CONFLICT (staff_id) WHERE holder_type = 'staff'
  DO UPDATE SET name = EXCLUDED.name,
                phone = COALESCE(EXCLUDED.phone, stock_holders.phone),
                updated_at = now()
  RETURNING ${HOLDER_COLS}`;

const CONTRACTOR_UPSERT = `
  INSERT INTO stock_holders (holder_type, contractor_id, name)
  VALUES ('contractor', $1, $2)
  ON CONFLICT (contractor_id) WHERE holder_type = 'contractor'
  DO UPDATE SET name = EXCLUDED.name, updated_at = now()
  RETURNING ${HOLDER_COLS}`;

const EXTERNAL_FIND = `
  SELECT ${HOLDER_COLS} FROM stock_holders
  WHERE holder_type = 'external_person'
    AND lower(name) = lower($1)
    AND coalesce(phone, '') = coalesce($2, '')
  LIMIT 1`;

const EXTERNAL_INSERT = `
  INSERT INTO stock_holders (holder_type, name, phone, email)
  VALUES ('external_person', $1, $2, $3)
  RETURNING ${HOLDER_COLS}`;

const BY_ID = `SELECT ${HOLDER_COLS} FROM stock_holders WHERE id = $1`;

// ---- core (executor-injected; unit-tested) --------------------------------

export async function upsertStaffHolderWith(
  exec: HolderExecutor, staffId: string, name: string, phone?: string,
): Promise<StockHolder> {
  const row = await exec.queryOne(STAFF_UPSERT, [staffId, name, phone ?? null]);
  return rowToHolder(row as Record<string, unknown>);
}

export async function upsertContractorHolderWith(
  exec: HolderExecutor, contractorId: string, name: string,
): Promise<StockHolder> {
  const row = await exec.queryOne(CONTRACTOR_UPSERT, [contractorId, name]);
  return rowToHolder(row as Record<string, unknown>);
}

export async function getOrCreateExternalHolderWith(
  exec: HolderExecutor, name: string, phone?: string, email?: string,
): Promise<StockHolder> {
  const found = await exec.queryOne(EXTERNAL_FIND, [name, phone ?? null]);
  if (found) return rowToHolder(found as Record<string, unknown>);
  const created = await exec.queryOne(EXTERNAL_INSERT, [name, phone ?? null, email ?? null]);
  return rowToHolder(created as Record<string, unknown>);
}

/** Best-effort: a holder-sync failure must never break the caller (location creation). */
export async function syncTechnicianHolderWith(
  exec: HolderExecutor, staffId: string, name: string, phone?: string,
): Promise<void> {
  try {
    await upsertStaffHolderWith(exec, staffId, name, phone);
  } catch (error) {
    log.error('technician holder sync failed (non-fatal)', { error, staffId }, 'stockHolderService');
  }
}

// ---- public wrappers (bound to the pg.Pool singleton) ---------------------

const poolExec: HolderExecutor = { query, queryOne };

export const getOrCreateStaffHolder = (staffId: string, name: string, phone?: string) =>
  upsertStaffHolderWith(poolExec, staffId, name, phone);

export const getOrCreateContractorHolder = (contractorId: string, name: string) =>
  upsertContractorHolderWith(poolExec, contractorId, name);

export const getOrCreateExternalHolder = (name: string, phone?: string, email?: string) =>
  transaction((txn) => getOrCreateExternalHolderWith(txn as HolderExecutor, name, phone, email));

export const syncTechnicianHolder = (staffId: string, name: string, phone?: string) =>
  syncTechnicianHolderWith(poolExec, staffId, name, phone);

export async function getHolderById(id: string): Promise<StockHolder | null> {
  const row = await queryOne(BY_ID, [id]);
  return row ? rowToHolder(row as Record<string, unknown>) : null;
}
