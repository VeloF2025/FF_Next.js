/**
 * Pure mapping for the stock_holders backfill (Sprint C). NO db imports — this
 * module is imported by a tsx CLI that calls dotenv.config() before touching the
 * pool, so it must not transitively pull @/lib/db-pool.
 */
export interface TechLocationRow {
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  assigned_to_phone: string | null;
  staff_exists: boolean;
}

export interface HolderInput { staffId: string; name: string; phone?: string }

/** Decide whether a technician location yields a staff holder, and how. */
export function eligibleHolderInput(row: TechLocationRow): HolderInput | null {
  if (!row.assigned_to_id || !row.staff_exists) return null;
  const name = row.assigned_to_name?.trim() || `Unknown (${row.assigned_to_id})`;
  return {
    staffId: row.assigned_to_id,
    name,
    phone: row.assigned_to_phone ?? undefined,
  };
}
