/**
 * OES Unified Records Service — manages dr_photo_unified_reviews during OES import:
 * create OES-only records, update existing with latest activation data, detect serial swaps.
 */

import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import type { OESRow } from './oesExcelParser';

const logger = createLogger('oes/oesUnifiedRecordsService');

export interface UnifiedRecordsResult {
  oesOnlyCreated: number;
  oesSerialUpdated: number;
  serialSwapsDetected: number;
  oesOnlyDRs: OESRow[];
}

/** Return the set of drop numbers that already have a unified review record. */
export async function loadExistingUnifiedSet(dropNumbers: string[]): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT drop_number FROM dr_photo_unified_reviews WHERE drop_number = ANY($1)`,
    [dropNumbers]
  );
  return new Set(result.rows.map((r: { drop_number: string }) => r.drop_number));
}

/** Insert unified review records for DRs that appear in OES but never via WhatsApp. */
async function createOesOnlyRecords(oesOnlyDRs: OESRow[]): Promise<number> {
  if (oesOnlyDRs.length === 0) return 0;

  // Lookup project for each DR from the drops table (source of truth)
  const oesOnlyDropNumbers = oesOnlyDRs.map(r => r.drop_number);
  const projectLookupResult = await pool.query(
    `SELECT d.drop_number, p.project_name
     FROM drops d
     JOIN projects p ON d.project_id = p.id
     WHERE d.drop_number = ANY($1)`,
    [oesOnlyDropNumbers]
  );
  const drToProject = new Map<string, string>();
  projectLookupResult.rows.forEach((r: { drop_number: string; project_name: string }) => {
    drToProject.set(r.drop_number, r.project_name);
  });
  logger.info(`Found project mapping for ${drToProject.size}/${oesOnlyDRs.length} DRs`);

  const OES_BATCH_SIZE = 100;
  let created = 0;

  for (let i = 0; i < oesOnlyDRs.length; i += OES_BATCH_SIZE) {
    const chunk = oesOnlyDRs.slice(i, i + OES_BATCH_SIZE);
    const values: (string | boolean | null)[] = [];
    const placeholders: string[] = [];

    chunk.forEach((row, idx) => {
      const offset = idx * 6;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, TRUE, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
      values.push(
        row.drop_number,
        'OES Import',
        drToProject.get(row.drop_number) ?? null,
        row.activation_datetime ?? row.activation_date,
        row.serial_number,
        row.team
      );
    });

    try {
      await pool.query(
        `INSERT INTO dr_photo_unified_reviews (drop_number, photo_source, project, is_oes_only, oes_activated_at, oes_serial, oes_team)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (drop_number) DO NOTHING`,
        values
      );
      created += chunk.length;
    } catch (err) {
      logger.error(`Error creating OES-only unified records at batch ${i}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return created;
}

async function logOesActivationActivity(oesOnlyDRs: OESRow[]): Promise<void> {
  const OES_BATCH_SIZE = 100;

  for (let i = 0; i < oesOnlyDRs.length; i += OES_BATCH_SIZE) {
    const chunk = oesOnlyDRs.slice(i, i + OES_BATCH_SIZE);
    const actValues: (string | null)[] = [];
    const actPlaceholders: string[] = [];

    chunk.forEach((row, idx) => {
      const offset = idx * 4;
      actPlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}::jsonb, $${offset + 4})`);
      actValues.push(
        row.drop_number,
        'oes_activated',
        JSON.stringify({
          activation_date: row.activation_date,
          activation_datetime: row.activation_datetime,
          serial_number: row.serial_number,
          team: row.team,
          olt_address: row.olt_address,
          source: 'OES Import',
        }),
        'system'
      );
    });

    try {
      await pool.query(
        `INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor)
         VALUES ${actPlaceholders.join(', ')}`,
        actValues
      );
    } catch (err) {
      logger.error('Error adding activity log entries', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

interface ExistingSerials {
  oes_serial: string | null;
  ont_serial_scanned: string | null;
}

interface SwapEntry {
  drop_number: string;
  event_data: string;
}

/** Update existing unified records with OES data; detect + log serial swaps. */
async function updateExistingRecords(existingToUpdate: OESRow[]): Promise<{ updated: number; swapsDetected: number }> {
  if (existingToUpdate.length === 0) return { updated: 0, swapsDetected: 0 };

  const UPDATE_BATCH_SIZE = 100;
  let oesSerialUpdated = 0;
  let serialSwapsDetected = 0;

  for (let i = 0; i < existingToUpdate.length; i += UPDATE_BATCH_SIZE) {
    const chunk = existingToUpdate.slice(i, i + UPDATE_BATCH_SIZE);
    const dropNumbersChunk = chunk.map(r => r.drop_number);

    // Pre-fetch existing serials for swap detection
    const existingSerials = new Map<string, ExistingSerials>();
    try {
      const existingResult = await pool.query(
        `SELECT drop_number, oes_serial, ont_serial_scanned
         FROM dr_photo_unified_reviews
         WHERE drop_number = ANY($1::text[])`,
        [dropNumbersChunk]
      );
      existingResult.rows.forEach((r: { drop_number: string; oes_serial: string | null; ont_serial_scanned: string | null }) => {
        existingSerials.set(r.drop_number, { oes_serial: r.oes_serial, ont_serial_scanned: r.ont_serial_scanned });
      });
    } catch (err) {
      logger.error(`Error fetching existing serials at batch ${i}`, { error: err instanceof Error ? err.message : String(err) });
    }

    // Build swap/mismatch activity entries
    const swapActivityEntries: SwapEntry[] = [];

    for (const row of chunk) {
      const existing = existingSerials.get(row.drop_number);
      if (!existing) continue;

      const newOesSerial = row.serial_number?.trim() ?? '';
      const oldOesSerial = existing.oes_serial?.trim() ?? '';
      const scannedSerial = existing.ont_serial_scanned?.trim() ?? '';

      if (oldOesSerial && newOesSerial && oldOesSerial.toUpperCase() !== newOesSerial.toUpperCase()) {
        swapActivityEntries.push({
          drop_number: row.drop_number,
          event_data: JSON.stringify({
            event: 'OES_SERIAL_CHANGED',
            old_oes_serial: oldOesSerial,
            new_oes_serial: newOesSerial,
            ont_serial_scanned: scannedSerial || null,
            source: 'OES Import',
            note: 'OES serial changed between imports - possible ONT replacement on network',
          }),
        });
        serialSwapsDetected++;
      }

      if (newOesSerial && scannedSerial && newOesSerial.toUpperCase() !== scannedSerial.toUpperCase()) {
        swapActivityEntries.push({
          drop_number: row.drop_number,
          event_data: JSON.stringify({
            event: 'SERIAL_MISMATCH_DETECTED',
            oes_serial: newOesSerial,
            ont_serial_scanned: scannedSerial,
            source: 'OES Import',
            note: 'OES serial differs from 1Map/WA scanned serial - possible swap or scan error',
          }),
        });
      }
    }

    const activationTimes = chunk.map(r => r.activation_datetime ?? r.activation_date);
    const serials = chunk.map(r => r.serial_number);
    const teams = chunk.map(r => r.team);

    try {
      await pool.query(
        `UPDATE dr_photo_unified_reviews u
         SET
           oes_activated_at = data.activation_time::timestamp,
           oes_serial = data.serial,
           oes_team = data.team,
           serial_swap_detected = CASE
             WHEN u.ont_serial_scanned IS NOT NULL AND u.ont_serial_scanned != ''
                  AND data.serial IS NOT NULL AND data.serial != ''
                  AND UPPER(TRIM(u.ont_serial_scanned)) != UPPER(TRIM(data.serial))
             THEN TRUE ELSE u.serial_swap_detected END,
           serial_swap_detected_at = CASE
             WHEN u.ont_serial_scanned IS NOT NULL AND u.ont_serial_scanned != ''
                  AND data.serial IS NOT NULL AND data.serial != ''
                  AND UPPER(TRIM(u.ont_serial_scanned)) != UPPER(TRIM(data.serial))
                  AND (u.serial_swap_detected IS NULL OR u.serial_swap_detected = FALSE)
             THEN NOW() ELSE u.serial_swap_detected_at END,
           serial_swap_details = CASE
             WHEN u.ont_serial_scanned IS NOT NULL AND u.ont_serial_scanned != ''
                  AND data.serial IS NOT NULL AND data.serial != ''
                  AND UPPER(TRIM(u.ont_serial_scanned)) != UPPER(TRIM(data.serial))
             THEN jsonb_build_object(
               'oes_serial', data.serial,
               'scanned_serial', u.ont_serial_scanned,
               'detected_at', NOW()::text,
               'source', 'OES Import'
             )::text ELSE u.serial_swap_details END,
           updated_at = NOW()
         FROM (
           SELECT
             unnest($1::text[]) as drop_number,
             unnest($2::text[]) as activation_time,
             unnest($3::text[]) as serial,
             unnest($4::text[]) as team
         ) data
         WHERE u.drop_number = data.drop_number`,
        [dropNumbersChunk, activationTimes, serials, teams]
      );
      oesSerialUpdated += chunk.length;
    } catch (err) {
      logger.error(`Error updating existing unified records at batch ${i}`, { error: err instanceof Error ? err.message : String(err) });
    }

    if (swapActivityEntries.length > 0) {
      try {
        const actValues: (string | null)[] = [];
        const actParams: string[] = [];
        swapActivityEntries.forEach((entry, idx) => {
          const offset = idx * 3;
          actParams.push(`($${offset + 1}, 'SERIAL_SWAP', $${offset + 2}::jsonb, $${offset + 3})`);
          actValues.push(entry.drop_number, entry.event_data, 'system:oes-import');
        });
        await pool.query(
          `INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor)
           VALUES ${actParams.join(', ')}`,
          actValues
        );
      } catch (err) {
        logger.error('Error logging serial swap activities', { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  logger.info(`Updated ${oesSerialUpdated} existing unified records, detected ${serialSwapsDetected} serial swaps`);
  return { updated: oesSerialUpdated, swapsDetected: serialSwapsDetected };
}

/** Orchestrate all unified review changes from an OES import. */
export async function processUnifiedRecords(oesRows: OESRow[], existingUnifiedSet: Set<string>): Promise<UnifiedRecordsResult> {
  const oesOnlyDRs = oesRows.filter(row => !existingUnifiedSet.has(row.drop_number));
  const existingToUpdate = oesRows.filter(row => existingUnifiedSet.has(row.drop_number));
  let oesOnlyCreated = 0;
  let oesSerialUpdated = 0;
  let serialSwapsDetected = 0;

  if (oesOnlyDRs.length > 0) {
    logger.info(`Creating ${oesOnlyDRs.length} unified records for OES-only DRs`);
    oesOnlyCreated = await createOesOnlyRecords(oesOnlyDRs);
    logger.info(`Created ${oesOnlyCreated} OES-only unified records; logging activity`);
    await logOesActivationActivity(oesOnlyDRs);
  }

  if (existingToUpdate.length > 0) {
    logger.info(`Updating ${existingToUpdate.length} existing unified records with OES activation data`);
    const updateResult = await updateExistingRecords(existingToUpdate);
    oesSerialUpdated = updateResult.updated;
    serialSwapsDetected = updateResult.swapsDetected;
  }

  return { oesOnlyCreated, oesSerialUpdated, serialSwapsDetected, oesOnlyDRs };
}
