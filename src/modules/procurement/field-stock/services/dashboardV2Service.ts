/**
 * Dashboard v2 metrics service.
 * Four parallel aggregation queries → DashboardV2Summary.
 * Schema verified against live DB 2026-05-21..2026-05-25.
 */
import { sql } from '@/lib/db-pool';
import type {
  DashboardV2Summary,
  StockValueByLocationRow,
  ContractorExposureRow,
} from '@/types/field-stock';

const THRESHOLD_DAYS = 30;
const TOP_CONTRACTORS = 10;

interface StockValueRaw { name: string; type: string; value: string | number; item_count: string | number; }
interface ContractorRaw { name: string; held_value: string | number; unaccounted_value: string | number; is_blocked: boolean; pending_recovery: string | number; }
interface LifecycleRaw { status: string; cnt: string | number; recent_installed: string | number; recent_activated: string | number; }
interface AgeingRaw { stagnant_count: string | number; stagnant_value: string | number; issued_not_installed: string | number; }

const n = (v: unknown): number => Number(v) || 0;

export async function getDashboardV2Summary(): Promise<DashboardV2Summary> {
  const [valueRows, contractorRows, lifecycleRows, ageingRows] = (await Promise.all([
    sql`
      SELECT sl.name AS name,
             sl.location_type AS type,
             COALESCE(SUM(COALESCE(sq.total_value, sq.quantity * sq.unit_cost, 0)), 0) AS value,
             COUNT(DISTINCT sq.stock_item_id) AS item_count
      FROM stock_quants sq
      JOIN stock_locations sl ON sl.id = sq.location_id
      WHERE sl.is_active = true
      GROUP BY sl.id, sl.name, sl.location_type
      HAVING COALESCE(SUM(COALESCE(sq.total_value, sq.quantity * sq.unit_cost, 0)), 0) <> 0
      ORDER BY value DESC
    `,
    sql`
      SELECT contractor_name AS name,
             COALESCE(current_held_value, 0) AS held_value,
             COALESCE(unaccounted_value, 0) AS unaccounted_value,
             COALESCE(pending_recovery_amount, 0) AS pending_recovery,
             COALESCE(is_blocked, false) AS is_blocked
      FROM contractor_stock_accountability
      ORDER BY unaccounted_value DESC NULLS LAST, current_held_value DESC NULLS LAST
    `,
    sql`
      SELECT status,
             COUNT(*) AS cnt,
             -- "recent" = an install/activate event in the last 7 days, regardless of the serial's current status (funnel velocity, not current-state count)
             SUM(CASE WHEN installed_date > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS recent_installed,
             SUM(CASE WHEN status = 'activated' AND status_changed_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END) AS recent_activated
      FROM stock_serials
      GROUP BY status
    `,
    sql`
      SELECT
        (SELECT COUNT(*) FROM stock_quants
           WHERE quantity > 0 AND last_movement_date < NOW() - (${THRESHOLD_DAYS} * INTERVAL '1 day')) AS stagnant_count,
        (SELECT COALESCE(SUM(COALESCE(total_value, quantity * unit_cost, 0)), 0) FROM stock_quants
           WHERE quantity > 0 AND last_movement_date < NOW() - (${THRESHOLD_DAYS} * INTERVAL '1 day')) AS stagnant_value,
        (SELECT COUNT(*) FROM stock_serials
           WHERE status IN ('issued', 'in_transit')
             AND status_changed_at < NOW() - (${THRESHOLD_DAYS} * INTERVAL '1 day')) AS issued_not_installed
    `,
  ])) as unknown as [StockValueRaw[], ContractorRaw[], LifecycleRaw[], AgeingRaw[]];

  const byLocation: StockValueByLocationRow[] = valueRows.map((r) => ({
    name: r.name,
    type: r.type,
    value: n(r.value),
    itemCount: n(r.item_count),
  }));
  const stockValueTotal = byLocation.reduce((acc, r) => acc + r.value, 0);

  let totalHeldValue = 0;
  let totalUnaccountedValue = 0;
  let totalPendingRecovery = 0;
  let blockedCount = 0;
  const contractors: ContractorExposureRow[] = contractorRows.map((r) => {
    const heldValue = n(r.held_value);
    const unaccountedValue = n(r.unaccounted_value);
    totalHeldValue += heldValue;
    totalUnaccountedValue += unaccountedValue;
    totalPendingRecovery += n(r.pending_recovery);
    if (r.is_blocked) blockedCount += 1;
    return { name: r.name, heldValue, unaccountedValue, isBlocked: Boolean(r.is_blocked) };
  });

  const byStatus: Record<string, number> = {};
  let recentlyInstalled = 0;
  let recentlyActivated = 0;
  for (const r of lifecycleRows) {
    byStatus[r.status] = n(r.cnt);
    recentlyInstalled += n(r.recent_installed);
    recentlyActivated += n(r.recent_activated);
  }

  const ageingRow = ageingRows[0] ?? { stagnant_count: 0, stagnant_value: 0, issued_not_installed: 0 };

  return {
    stockValue: { total: stockValueTotal, byLocation },
    contractorExposure: {
      totalHeldValue,
      totalUnaccountedValue,
      totalPendingRecovery,
      blockedCount,
      top: contractors.slice(0, TOP_CONTRACTORS),
    },
    serialsLifecycle: {
      byStatus,
      installed: byStatus['installed'] ?? 0,
      activated: byStatus['activated'] ?? 0,
      recentlyInstalled,
      recentlyActivated,
    },
    ageing: {
      thresholdDays: THRESHOLD_DAYS,
      stagnantStockCount: n(ageingRow.stagnant_count),
      stagnantStockValue: n(ageingRow.stagnant_value),
      serialsIssuedNotInstalled: n(ageingRow.issued_not_installed),
    },
  };
}
