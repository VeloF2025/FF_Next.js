/**
 * GET /api/my/stores/field-intake — serials taken in from a scanned carton
 * that the stock sheet has never listed.
 *
 * These were issued to real technicians from real boxes before the SharePoint
 * workbook listed them (migration 515). Each one is a claim the workbook has
 * not yet corroborated, so they are listed oldest-first: age is the signal
 * that a consignment was never captured, not that anything is wrong with the
 * handout.
 *
 * A row leaves this list when the importer confirms it (serialIntake.ts sets
 * source_confirmed_at), which happens automatically on the next 4-hourly sync
 * once someone adds the consignment to the workbook.
 *
 * Gated to stores roles: it names technicians and warehouses.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';

/** Days after which an unconfirmed intake is treated as overdue. */
export const INTAKE_OVERDUE_DAYS = 7;

async function handleGet(_req: NextApiRequest, res: NextApiResponse) {
  const rows = await sql`
    SELECT s.serial_number,
           s.intake_carton_id,
           s.intake_at,
           s.status,
           i.item_name  AS stock_item_name,
           l.name       AS location_name,
           st.first_name || ' ' || st.last_name AS taken_in_by,
           EXTRACT(DAY FROM NOW() - s.intake_at)::int AS days_waiting
    FROM stock_serials s
    LEFT JOIN stock_items i     ON i.id  = s.stock_item_id
    LEFT JOIN stock_locations l ON l.id  = s.current_location_id
    LEFT JOIN staff st          ON st.id = s.intake_by_staff_id
    WHERE s.provenance = 'field_intake'
      AND s.source_confirmed_at IS NULL
    ORDER BY s.intake_at ASC NULLS LAST
    LIMIT 500
  `;

  // Grouped by carton, because that is the unit a person can act on: chasing
  // one missing consignment beats chasing nine unrelated serials.
  const cartons = new Map<string, { cartonId: string | null; serials: number; oldestDays: number }>();
  for (const r of rows) {
    const key = (r.intake_carton_id as string | null) ?? '(no carton id)';
    const days = (r.days_waiting as number | null) ?? 0;
    const existing = cartons.get(key);
    if (existing) {
      existing.serials += 1;
      existing.oldestDays = Math.max(existing.oldestDays, days);
    } else {
      cartons.set(key, {
        cartonId: r.intake_carton_id as string | null,
        serials: 1,
        oldestDays: days,
      });
    }
  }

  const summary = [...cartons.values()].sort((a, b) => b.oldestDays - a.oldestDays);

  return apiResponse.success(res, {
    serials: rows,
    cartons: summary,
    total: rows.length,
    overdue: rows.filter(
      (r) => ((r.days_waiting as number | null) ?? 0) >= INTAKE_OVERDUE_DAYS,
    ).length,
    overdueDays: INTAKE_OVERDUE_DAYS,
  });
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  return handleGet(req, res);
});
