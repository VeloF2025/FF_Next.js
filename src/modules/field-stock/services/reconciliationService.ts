/**
 * Reconciliation Service
 * Provides daily stock reconciliation reports per technician
 * Part of the 4-stage Site Stock Tracking System
 *
 * Stage 4: Daily Reconciliation - End of day accountability
 *
 * Calculation:
 * Unaccounted = Issued - Installed - Returned
 *
 * Tables involved:
 * - stock_pickings: Items issued to technicians
 * - stock_consumptions: Items consumed at installations
 * - stock_serials: Serial status tracking
 * - qa_photo_reviews: Installation records with serials
 * - contractor_stock_accountability: Blocking status
 */

import { neon, NeonQueryFunction } from '@/lib/db-neon';

// ==================== TYPES ====================

export interface ReconciliationQuery {
  date: string; // YYYY-MM-DD
  project?: string;
  technicianId?: string;
}

export interface TechnicianReconciliation {
  id: string;
  name: string;
  contractorId?: string;
  contractorName?: string;
  issued_count: number;
  issued_serials: string[];
  installed_count: number;
  installed_serials: string[];
  returned_count: number;
  returned_serials: string[];
  unaccounted_count: number;
  unaccounted_serials: string[];
  unaccounted_value: number;
  is_blocked: boolean;
  pending_recovery: number;
}

export interface ReconciliationSummary {
  total_issued: number;
  total_installed: number;
  total_returned: number;
  total_unaccounted: number;
  unaccounted_value: number;
  technician_count: number;
}

export interface DailyReconciliationResponse {
  date: string;
  technicians: TechnicianReconciliation[];
  summary: ReconciliationSummary;
}

// ==================== DATABASE CONNECTION ====================

function getDbConnection(): NeonQueryFunction<false, false> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

// ==================== ACCOUNTABILITY THRESHOLDS ====================

const UNACCOUNTED_COUNT_THRESHOLD = 3; // > 3 items triggers blocking
const UNACCOUNTED_VALUE_THRESHOLD = 5000; // > R5000 triggers blocking

// ==================== SERVICE FUNCTIONS ====================

/**
 * Get daily reconciliation report for all technicians or filtered subset
 */
export async function getDailyReconciliation(
  query: ReconciliationQuery
): Promise<DailyReconciliationResponse> {
  const sql = getDbConnection();

  // Build date range for the query (full day)
  const dateStart = `${query.date}T00:00:00.000Z`;
  const dateEnd = `${query.date}T23:59:59.999Z`;

  // Get all issued serials for the date (from stock_pickings)
  // Note: stock_picking_lines has serial_ids (UUID array), need to join with stock_serials
  const issuedQuery = query.technicianId
    ? sql`
        SELECT
          sp.technician_id,
          sp.technician_name,
          sp.contractor_id,
          ss.serial_number,
          si.standard_cost
        FROM stock_pickings sp
        JOIN stock_picking_lines spl ON spl.picking_id = sp.id
        LEFT JOIN stock_serials ss ON ss.id = ANY(spl.serial_ids)
        LEFT JOIN stock_items si ON si.id = spl.stock_item_id
        WHERE sp.picking_type = 'issue'
          AND sp.status = 'done'
          AND sp.created_at >= ${dateStart}
          AND sp.created_at <= ${dateEnd}
          AND sp.technician_id = ${query.technicianId}
      `
    : sql`
        SELECT
          sp.technician_id,
          sp.technician_name,
          sp.contractor_id,
          ss.serial_number,
          si.standard_cost
        FROM stock_pickings sp
        JOIN stock_picking_lines spl ON spl.picking_id = sp.id
        LEFT JOIN stock_serials ss ON ss.id = ANY(spl.serial_ids)
        LEFT JOIN stock_items si ON si.id = spl.stock_item_id
        WHERE sp.picking_type = 'issue'
          AND sp.status = 'done'
          AND sp.created_at >= ${dateStart}
          AND sp.created_at <= ${dateEnd}
      `;

  const issuedItems = await issuedQuery;

  // Get all installed serials for the date (from stock_consumptions linked to qa_photo_reviews)
  const installedQuery = query.technicianId
    ? sql`
        SELECT
          sc.consumed_by_id AS technician_id,
          sc.consumed_by_name AS technician_name,
          sc.serial_number,
          si.standard_cost
        FROM stock_consumptions sc
        LEFT JOIN stock_items si ON si.id = sc.stock_item_id
        WHERE sc.consumption_date >= ${dateStart}
          AND sc.consumption_date <= ${dateEnd}
          AND sc.consumed_by_id = ${query.technicianId}
      `
    : sql`
        SELECT
          sc.consumed_by_id AS technician_id,
          sc.consumed_by_name AS technician_name,
          sc.serial_number,
          si.standard_cost
        FROM stock_consumptions sc
        LEFT JOIN stock_items si ON si.id = sc.stock_item_id
        WHERE sc.consumption_date >= ${dateStart}
          AND sc.consumption_date <= ${dateEnd}
      `;

  const installedItems = await installedQuery;

  // Get returned serials for the date (from stock_pickings with type='return')
  // Note: stock_picking_lines has serial_ids (UUID array), need to join with stock_serials
  const returnedQuery = query.technicianId
    ? sql`
        SELECT
          sp.technician_id,
          sp.technician_name,
          ss.serial_number,
          si.standard_cost
        FROM stock_pickings sp
        JOIN stock_picking_lines spl ON spl.picking_id = sp.id
        LEFT JOIN stock_serials ss ON ss.id = ANY(spl.serial_ids)
        LEFT JOIN stock_items si ON si.id = spl.stock_item_id
        WHERE sp.picking_type = 'return'
          AND sp.status = 'done'
          AND sp.created_at >= ${dateStart}
          AND sp.created_at <= ${dateEnd}
          AND sp.technician_id = ${query.technicianId}
      `
    : sql`
        SELECT
          sp.technician_id,
          sp.technician_name,
          ss.serial_number,
          si.standard_cost
        FROM stock_pickings sp
        JOIN stock_picking_lines spl ON spl.picking_id = sp.id
        LEFT JOIN stock_serials ss ON ss.id = ANY(spl.serial_ids)
        LEFT JOIN stock_items si ON si.id = spl.stock_item_id
        WHERE sp.picking_type = 'return'
          AND sp.status = 'done'
          AND sp.created_at >= ${dateStart}
          AND sp.created_at <= ${dateEnd}
      `;

  const returnedItems = await returnedQuery;

  // Get contractor blocking status
  // Note: contractor_stock_accountability uses contractor_id, not technician_id
  const blockingStatus = await sql`
    SELECT
      contractor_id,
      is_blocked,
      unaccounted_count AS pending_recovery
    FROM contractor_stock_accountability
  `;

  // Build technician map
  const technicianMap = new Map<
    string,
    {
      id: string;
      name: string;
      contractorId?: string;
      contractorName?: string;
      issued_serials: string[];
      issued_prices: number[];
      installed_serials: string[];
      returned_serials: string[];
      is_blocked: boolean;
      pending_recovery: number;
    }
  >();

  // Process issued items
  for (const item of issuedItems) {
    const techId = item.technician_id;
    if (!techId) continue;

    if (!technicianMap.has(techId)) {
      const blocking = blockingStatus.find((b) => (b as { contractor_id: string }).contractor_id === item.contractor_id);
      technicianMap.set(techId, {
        id: techId,
        name: item.technician_name || 'Unknown',
        contractorId: item.contractor_id || undefined,
        issued_serials: [],
        issued_prices: [],
        installed_serials: [],
        returned_serials: [],
        is_blocked: blocking?.is_blocked || false,
        pending_recovery: blocking?.pending_recovery || 0,
      });
    }

    const tech = technicianMap.get(techId)!;
    if (item.serial_number) {
      tech.issued_serials.push(item.serial_number);
      tech.issued_prices.push(item.standard_cost || 1750); // Default price if not set
    }
  }

  // Process installed items
  for (const item of installedItems) {
    const techId = item.technician_id;
    if (!techId) continue;

    if (!technicianMap.has(techId)) {
      const blocking = blockingStatus.find((b) => (b as { contractor_id: string }).contractor_id === item.contractor_id);
      technicianMap.set(techId, {
        id: techId,
        name: item.technician_name || 'Unknown',
        issued_serials: [],
        issued_prices: [],
        installed_serials: [],
        returned_serials: [],
        is_blocked: blocking?.is_blocked || false,
        pending_recovery: blocking?.pending_recovery || 0,
      });
    }

    const tech = technicianMap.get(techId)!;
    if (item.serial_number) {
      tech.installed_serials.push(item.serial_number);
    }
  }

  // Process returned items
  for (const item of returnedItems) {
    const techId = item.technician_id;
    if (!techId) continue;

    const tech = technicianMap.get(techId);
    if (tech && item.serial_number) {
      tech.returned_serials.push(item.serial_number);
    }
  }

  // Calculate unaccounted for each technician
  const technicians: TechnicianReconciliation[] = [];

  for (const [, tech] of technicianMap) {
    const installedSet = new Set(tech.installed_serials);
    const returnedSet = new Set(tech.returned_serials);

    const unaccounted_serials: string[] = [];
    let unaccounted_value = 0;

    for (let i = 0; i < tech.issued_serials.length; i++) {
      const serial = tech.issued_serials[i] ?? '';
      const price = tech.issued_prices[i] ?? 1750;

      if (!installedSet.has(serial) && !returnedSet.has(serial)) {
        unaccounted_serials.push(serial);
        unaccounted_value += price;
      }
    }

    // Check if should be blocked based on thresholds
    const shouldBeBlocked =
      unaccounted_serials.length > UNACCOUNTED_COUNT_THRESHOLD ||
      unaccounted_value > UNACCOUNTED_VALUE_THRESHOLD;

    technicians.push({
      id: tech.id,
      name: tech.name,
      contractorId: tech.contractorId,
      contractorName: tech.contractorName,
      issued_count: tech.issued_serials.length,
      issued_serials: tech.issued_serials,
      installed_count: tech.installed_serials.length,
      installed_serials: tech.installed_serials,
      returned_count: tech.returned_serials.length,
      returned_serials: tech.returned_serials,
      unaccounted_count: unaccounted_serials.length,
      unaccounted_serials,
      unaccounted_value,
      is_blocked: tech.is_blocked || shouldBeBlocked,
      pending_recovery: tech.pending_recovery,
    });
  }

  // Filter by project if specified (requires linking through qa_photo_reviews)
  // For now, project filtering is handled at the API level if needed

  // Calculate summary totals
  const summary: ReconciliationSummary = {
    total_issued: technicians.reduce((sum, t) => sum + t.issued_count, 0),
    total_installed: technicians.reduce((sum, t) => sum + t.installed_count, 0),
    total_returned: technicians.reduce((sum, t) => sum + t.returned_count, 0),
    total_unaccounted: technicians.reduce((sum, t) => sum + t.unaccounted_count, 0),
    unaccounted_value: technicians.reduce((sum, t) => sum + t.unaccounted_value, 0),
    technician_count: technicians.length,
  };

  return {
    date: query.date,
    technicians,
    summary,
  };
}

// ==================== SERVICE OBJECT (for mocking in tests) ====================

export const reconciliationService = {
  getDailyReconciliation,
};
