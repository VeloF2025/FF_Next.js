/**
 * Offline ONT DB helpers — upsert, recovery detection, NOC ticket creation.
 *
 * Extracted from fibertime-offline-sync.ts to stay within the 300-line limit.
 * These functions are only consumed by the sync service.
 */

import { createLogger } from '@/lib/logger';
import { pool } from '@/lib/db';
import type { OfflineOntRow } from '@/lib/sharepoint/offlineOntParser';

const logger = createLogger('services:fibertime-offline-db');

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maps each Offline ONT site to its NOC maintenance team UUID. */
export const SITE_MAINTENANCE_TEAMS = {
  LAW: '0c15b3b9-a878-4fef-8291-772dcd1460c3',
  MAM: 'ed032579-91ad-45e2-9e25-c41c5f9217dd',
  MOA: 'e3dd6115-c874-4bdb-a5f5-091f472bef1e',
  TEM: '827cf861-c798-4e4d-812d-79ff2f2b750f',
} as const;

export type OfflineSite = keyof typeof SITE_MAINTENANCE_TEAMS;

// ============================================================================
// TYPES
// ============================================================================

type DropRow = {
  id: string; drop_number: string; ont_serial: string | null;
  latitude: number | null; longitude: number | null;
};

type OesRow = {
  id: string; drop_number: string; serial_number: string | null;
  latitude: number | null; longitude: number | null;
};

export interface UpsertStats {
  inserted: number;
  updated: number;
  matched_drops: number;
  matched_oes: number;
  unmatched: number;
}

// ============================================================================
// UPSERT
// ============================================================================

const BATCH_SIZE = 500;
/** Number of positional parameters per row in the INSERT. */
const COL_COUNT = 18;

/**
 * Batch-upsert offline ONT rows into offline_devices.
 * Plain INSERT — idempotency is handled at batch level (isAlreadyImported check).
 * The unique constraint on offline_devices is multi-column; batch-level guards prevent re-import.
 */
export async function upsertOfflineRows(
  rows: OfflineOntRow[],
  batchId: string,
  dropsMap: Map<string, DropRow>,
  oesMap: Map<string, OesRow>,
  reportDate: string
): Promise<UpsertStats> {
  let inserted = 0;
  const updated = 0;
  let matched_drops = 0;
  let matched_oes = 0;
  let unmatched = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const placeholders: string[] = [];
    const values: (string | number | boolean | null)[] = [];

    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j]!;
      const drop = dropsMap.get(row.drop_number);
      const oes  = oesMap.get(row.drop_number);

      let matchStatus = 'unmatched';
      let dropId: string | null = null;
      let oesId: string | null = null;
      let expectedSerial: string | null = null;
      let serialMismatch = false;

      if (drop) {
        matchStatus = 'matched_drops';
        dropId = drop.id;
        matched_drops++;
      }
      if (oes) {
        if (matchStatus === 'unmatched') {
          matchStatus = 'matched_oes';
          matched_oes++;
        }
        oesId = oes.id;
        expectedSerial = oes.serial_number;
        if (oes.serial_number && row.serial_number && row.serial_number !== oes.serial_number) {
          serialMismatch = true;
        }
      }
      if (matchStatus === 'unmatched') unmatched++;

      const offset = j * COL_COUNT;
      placeholders.push(
        `(${Array.from({ length: COL_COUNT }, (_, k) => `$${offset + k + 1}`).join(', ')})`
      );
      values.push(
        batchId, row.drop_number, row.serial_number, row.area.toLowerCase(),
        row.ont_address, row.olt_rack, row.olt_shelf, row.olt_slot, row.olt_port, row.olt_ont,
        row.reason, row.last_event_time,
        dropId, oesId, matchStatus, expectedSerial, serialMismatch,
        reportDate
      );
    }

    const chunkResult = await pool.query(
      `INSERT INTO offline_devices (
         import_batch_id, drop_number, serial_number, area_code,
         ont_address, olt_rack, olt_shelf, olt_slot, olt_port, olt_ont,
         last_down_reason, last_inform_date,
         drop_id, oes_activation_id, match_status,
         expected_serial, serial_mismatch,
         report_date
       ) VALUES ${placeholders.join(', ')}`,
      values
    );
    inserted += chunkResult.rowCount ?? 0;

    logger.info('Upsert batch complete', {
      processed: Math.min(i + BATCH_SIZE, rows.length),
      total: rows.length,
    });
  }

  return { inserted, updated, matched_drops, matched_oes, unmatched };
}

// ============================================================================
// RECOVERY DETECTION
// ============================================================================

/**
 * Marks offline_devices records as recovered when OES now shows the drop as Active.
 * Scoped to rows with the given report_date that have not yet recovered.
 */
export async function detectRecoveries(reportDate: string): Promise<number> {
  const result = await pool.query(
    `UPDATE offline_devices od
     SET recovered_at = CURRENT_DATE,
         recovery_confirmed_by = 'oes_sync'
     FROM oes_activations oa
     WHERE od.drop_number = oa.drop_number
       AND oa.status ILIKE 'active'
       AND od.recovered_at IS NULL
       AND od.report_date = $1::date
     RETURNING od.id`,
    [reportDate]
  );
  return result.rowCount ?? 0;
}

// ============================================================================
// NOC TICKET CREATION
// ============================================================================

interface DeviceForTicket {
  id: string;
  drop_number: string;
  serial_number: string;
  reason: string;
  ont_address: string;
  project_id: string | null;
}

/**
 * Create NOC maintenance tickets for matched, still-offline devices that
 * don't yet have a ticket. Updates offline_devices with the created ticket IDs.
 * Returns the number of tickets created.
 */
export async function createOfflineTickets(
  site: OfflineSite,
  reportDate: string
): Promise<number> {
  const teamId = SITE_MAINTENANCE_TEAMS[site];

  const candidatesResult = await pool.query<DeviceForTicket>(
    `SELECT od.id, od.drop_number, od.serial_number,
            od.last_down_reason AS reason,
            COALESCE(od.ont_address, '') AS ont_address,
            d.project_id
     FROM offline_devices od
     LEFT JOIN drops d ON d.drop_number = od.drop_number
     WHERE od.report_date = $1::date
       AND od.match_status IN ('matched_drops', 'matched_oes')
       AND od.recovered_at IS NULL
       AND od.offline_ticket_id IS NULL
       AND od.area_code = $2`,
    [reportDate, site.toLowerCase()]
  );

  if (candidatesResult.rows.length === 0) return 0;

  let ticketsCreated = 0;

  for (const device of candidatesResult.rows) {
    try {
      const title = `Offline ONT: ${device.drop_number} — ${device.reason}`;
      const description =
        `ONT offline as of ${reportDate}. Reason: ${device.reason}. ` +
        `OLT: ${device.ont_address}. Reported by nightly offline sync.`;

      const ticketResult = await pool.query<{ id: string }>(
        `INSERT INTO maintenance_tickets (
           ticket_uid, source, title, description, type, status,
           dr_number, ont_serial, assigned_team_id, project_id, created_at, updated_at
         ) VALUES (
           generate_vf_ticket_uid(), 'offline_report', $1, $2, 'fault_repair', 'open',
           $3, $4, $5, $6, NOW(), NOW()
         ) RETURNING id`,
        [title, description, device.drop_number, device.serial_number, teamId, device.project_id]
      );

      const ticketId = ticketResult.rows[0]?.id;
      if (!ticketId) continue;

      await pool.query(
        `UPDATE offline_devices
         SET offline_ticket_id = $1,
             offline_ticket_created_at = NOW()
         WHERE id = $2`,
        [ticketId, device.id]
      );

      ticketsCreated++;
    } catch (ticketErr) {
      logger.error('Failed to create offline ticket', {
        drop_number: device.drop_number,
        error: ticketErr instanceof Error ? ticketErr.message : String(ticketErr),
      });
    }
  }

  return ticketsCreated;
}
