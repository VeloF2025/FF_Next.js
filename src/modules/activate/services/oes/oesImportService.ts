/**
 * OES Import Service
 *
 * Core database operations for importing OES activation data:
 * - Create import batches
 * - Upsert oes_activations records
 * - Update drops.oes_confirmed
 * - Import PP DATA pre-provision records
 */

import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import type { OESRow, PPRow } from './oesExcelParser';

const logger = createLogger('oes/oesImportService');

export interface ImportBatchResult {
  batchId: string;
  dropsMap: Map<string, string>;
  existingCount: number;
}

export interface ImportActivationsResult {
  inserted: number;
  updated: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

// ============================================================================
// BATCH MANAGEMENT
// ============================================================================

/**
 * Create a new OES import batch record and load the drops map
 * for matching drop numbers to drop IDs.
 */
export async function createImportBatch(
  filename: string | null,
  reportDate: string | null,
  totalRows: number,
  dropNumbers: string[]
): Promise<ImportBatchResult> {
  const batchResult = await pool.query(
    `INSERT INTO oes_import_batches (filename, report_date, total_rows)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [filename, reportDate || new Date().toISOString().split('T')[0], totalRows]
  );
  const batchId = batchResult.rows[0].id as string;

  const dropsResult = await pool.query(
    `SELECT id, drop_number FROM drops WHERE drop_number = ANY($1)`,
    [dropNumbers]
  );
  const dropsMap = new Map<string, string>(
    dropsResult.rows.map((d: { drop_number: string; id: string }) => [d.drop_number, d.id])
  );
  logger.info(`Found ${dropsMap.size} matching drops`);

  const countBefore = await pool.query(`SELECT COUNT(*) as count FROM oes_activations`);
  const existingCount = parseInt(countBefore.rows[0].count, 10);
  logger.info(`Existing OES records: ${existingCount}`);

  return { batchId, dropsMap, existingCount };
}

// ============================================================================
// ACTIVATIONS UPSERT
// ============================================================================

/**
 * Batch-upsert OES activations rows (chunks of 500) and update
 * drops.oes_confirmed for matched rows.
 * Returns counts for the HTTP response.
 */
export async function upsertActivations(
  oesRows: OESRow[],
  batchId: string,
  dropsMap: Map<string, string>,
  existingCount: number
): Promise<ImportActivationsResult> {
  const BATCH_SIZE = 500;
  const errors: string[] = [];

  for (let i = 0; i < oesRows.length; i += BATCH_SIZE) {
    const chunk = oesRows.slice(i, i + BATCH_SIZE);

    // 16 columns per row (Stack Ref removed Jan 2027)
    const values: (string | number | null)[] = [];
    const placeholders: string[] = [];

    chunk.forEach((row, idx) => {
      const dropId = dropsMap.get(row.drop_number) ?? null;
      const offset = idx * 16;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, ` +
        `$${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, ` +
        `$${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16})`
      );
      values.push(
        row.drop_number, dropId, row.serial_number, row.activation_date,
        row.activation_datetime, row.olt_address, row.ont_rx_sig_dbm,
        row.link_budget_ont_olt_db, row.olt_rx_sig_dbm, row.link_budget_olt_ont_db,
        row.status, row.latitude, row.longitude, row.current_ont_rx, row.team, batchId
      );
    });

    try {
      await pool.query(
        `INSERT INTO oes_activations (
           drop_number, drop_id, serial_number, activation_date, activation_datetime, olt_address,
           ont_rx_sig_dbm, link_budget_ont_olt_db, olt_rx_sig_dbm, link_budget_olt_ont_db,
           status, latitude, longitude, current_ont_rx, team, import_batch_id
         ) VALUES ${placeholders.join(', ')}
         ON CONFLICT (drop_number) DO UPDATE SET
           drop_id = COALESCE(EXCLUDED.drop_id, oes_activations.drop_id),
           serial_number = EXCLUDED.serial_number,
           activation_date = EXCLUDED.activation_date,
           activation_datetime = COALESCE(EXCLUDED.activation_datetime, oes_activations.activation_datetime),
           olt_address = EXCLUDED.olt_address,
           ont_rx_sig_dbm = EXCLUDED.ont_rx_sig_dbm,
           link_budget_ont_olt_db = EXCLUDED.link_budget_ont_olt_db,
           olt_rx_sig_dbm = EXCLUDED.olt_rx_sig_dbm,
           link_budget_olt_ont_db = EXCLUDED.link_budget_olt_ont_db,
           status = EXCLUDED.status,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           current_ont_rx = EXCLUDED.current_ont_rx,
           team = EXCLUDED.team,
           import_batch_id = EXCLUDED.import_batch_id,
           updated_at = NOW()`,
        values
      );
    } catch (chunkError) {
      const errMsg = chunkError instanceof Error ? chunkError.message : 'Unknown error';
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${errMsg}`);
      logger.error(`Batch error at row ${i}`, { error: errMsg });
    }

    logger.info(`Processed ${Math.min(i + BATCH_SIZE, oesRows.length)}/${oesRows.length}`);
  }

  // Calculate inserted vs updated
  const countAfter = await pool.query(`SELECT COUNT(*) as count FROM oes_activations`);
  const newCount = parseInt(countAfter.rows[0].count, 10);
  const inserted = newCount - existingCount;
  const updated = Math.max(0, oesRows.length - inserted);
  logger.info(`After import: ${newCount} records (${inserted} new, ${updated} updated)`);

  // Update drops.oes_confirmed for matched drop numbers
  const matchedDropNumbers = oesRows
    .filter(r => dropsMap.has(r.drop_number))
    .map(r => r.drop_number);

  if (matchedDropNumbers.length > 0) {
    await pool.query(
      `UPDATE drops
       SET oes_confirmed = true, oes_confirmed_at = NOW()
       WHERE drop_number = ANY($1)`,
      [matchedDropNumbers]
    );
  }

  const matched = dropsMap.size;
  const unmatched = oesRows.length - matched;

  // Persist batch statistics
  await pool.query(
    `UPDATE oes_import_batches SET matched_drops = $1, unmatched_drops = $2 WHERE id = $3`,
    [matched, unmatched, batchId]
  );

  return { inserted, updated, matched, unmatched, errors };
}

// ============================================================================
// PP DATA IMPORT
// ============================================================================

/**
 * Import PP DATA rows into oes_pp_data with local resolution.
 * Non-blocking — errors are caught and logged.
 */
export async function importPPData(ppRows: PPRow[], filename: string): Promise<void> {
  try {
    logger.info('Importing PP DATA sheet', { rows: ppRows.length });

    const batchResult = await pool.query(
      `INSERT INTO oes_pp_import_batches (filename, total_rows, imported_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [filename, ppRows.length, 'oes_import_auto']
    );
    const batchId = batchResult.rows[0].id as string;

    const BATCH_SIZE = 500;
    for (let i = 0; i < ppRows.length; i += BATCH_SIZE) {
      const chunk = ppRows.slice(i, i + BATCH_SIZE);
      const values: (string | number | null)[] = [];
      const placeholders: string[] = [];

      chunk.forEach((row, idx) => {
        const offset = idx * 4;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}::date, $${offset + 4})`);
        values.push(row.serial_number, row.project, row.date_registered, batchId);
      });

      await pool.query(
        `INSERT INTO oes_pp_data (serial_number, project, date_registered, import_batch_id)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (serial_number, project) DO UPDATE SET
           date_registered = COALESCE(EXCLUDED.date_registered, oes_pp_data.date_registered),
           import_batch_id = EXCLUDED.import_batch_id,
           updated_at = NOW()
         WHERE oes_pp_data.resolution_status = 'not_found'`,
        values
      );
    }

    // Run local resolution — 3 sequential UPDATE queries
    const oesMatch = await pool.query(`
      UPDATE oes_pp_data pp SET resolution_status = 'located_oes',
        resolved_drop_number = oa.drop_number, resolved_source = 'oes_activations',
        resolved_details = jsonb_build_object('activation_date', oa.activation_date::text, 'status', oa.status, 'team', oa.team),
        resolved_at = NOW(), updated_at = NOW()
      FROM oes_activations oa WHERE pp.serial_number = oa.serial_number AND pp.resolution_status = 'not_found'
    `);

    const unifiedMatch = await pool.query(`
      UPDATE oes_pp_data pp SET resolution_status = 'located_unified',
        resolved_drop_number = ur.drop_number, resolved_source = 'dr_photo_unified_reviews',
        resolved_details = jsonb_build_object('matched_field',
          CASE WHEN ur.oes_serial = pp.serial_number THEN 'oes_serial' ELSE 'ont_serial_scanned' END, 'project', ur.project),
        resolved_at = NOW(), updated_at = NOW()
      FROM dr_photo_unified_reviews ur
      WHERE (ur.oes_serial = pp.serial_number OR ur.ont_serial_scanned = pp.serial_number) AND pp.resolution_status = 'not_found'
    `);

    let onemapMatches = 0;
    try {
      const onemapMatch = await pool.query(`
        UPDATE oes_pp_data pp SET resolution_status = 'located_onemap',
          resolved_drop_number = op.drop_number, resolved_source = 'onemap_properties',
          resolved_details = jsonb_build_object('site', op.site, 'pole', op.pole),
          resolved_at = NOW(), updated_at = NOW()
        FROM onemap_properties op WHERE op.ont_barcode = pp.serial_number AND pp.resolution_status = 'not_found'
      `);
      onemapMatches = onemapMatch.rowCount ?? 0;
    } catch (err) {
      logger.warn('PP DATA resolution: onemap_properties query failed (may not have ont_barcode column)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const totalResolved = (oesMatch.rowCount ?? 0) + (unifiedMatch.rowCount ?? 0) + onemapMatches;

    await pool.query(
      `UPDATE oes_pp_import_batches SET located_count = $1, unlocated_count = $2 WHERE id = $3`,
      [totalResolved, ppRows.length - totalResolved, batchId]
    );

    logger.info('PP DATA import complete', {
      total: ppRows.length,
      resolved: totalResolved,
      oes: oesMatch.rowCount ?? 0,
      unified: unifiedMatch.rowCount ?? 0,
      onemap: onemapMatches,
    });
  } catch (err) {
    logger.error('PP DATA import failed (non-blocking)', { error: err instanceof Error ? err.message : String(err) });
  }
}
