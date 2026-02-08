/**
 * OLT Auto-Detect Service
 *
 * Automatically detects OLT serial mismatches by comparing OES activation data
 * against the cached 1Map onemap_properties table. Cache misses are queued
 * for live 1Map API lookup.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { logActivity } from '@/modules/activate/services/activityLogService';

function isUpsSerial(serial: string | null): boolean {
  return !!serial && serial.toUpperCase().startsWith('GU18');
}

interface AutoDetectResult {
  runId: number;
  totalOesRows: number;
  cacheHits: number;
  cacheMisses: number;
  matches: number;
  mismatchesNote2: number;
  mismatchesNote4: number;
  upsSwaps: number;
  duplicatesSkipped: number;
  apiLookupsQueued: number;
  alreadyVerified: number;
}

interface JoinedRow {
  drop_number: string;
  oes_serial: string;
  team: string | null;
  onemap_serial: string | null;
  onemap_ups: string | null;
  has_onemap_row: boolean;
}

/**
 * Run auto-detection for a given OES import batch.
 * Compares OES serials against cached 1Map data, inserts mismatches,
 * and queues cache misses for API lookup.
 */
export async function runAutoDetect(oesBatchId: string): Promise<AutoDetectResult> {
  const client = await pool.connect();

  try {
    // Create tracking run
    const runResult = await client.query(
      `INSERT INTO olt_auto_detect_runs (oes_batch_id, total_oes_rows)
       VALUES ($1, 0) RETURNING id`,
      [oesBatchId]
    );
    const runId = runResult.rows[0].id;

    log.info('OltAutoDetect', `Run #${runId} started for batch ${oesBatchId}`);

    // Create synthetic import record for linking mismatch records
    const importResult = await client.query(
      `INSERT INTO olt_report_imports
        (filename, project, total_records, match_count, mismatch_count, imported_by)
       VALUES ($1, NULL, 0, 0, 0, NULL)
       RETURNING id`,
      [`Auto-detect: OES Batch ${oesBatchId.slice(0, 8)}`]
    );
    const importId = importResult.rows[0].id;

    // Single JOIN: OES activations vs deduplicated 1Map cache
    // onemap_properties has duplicate drop_numbers (up to 42x), so use DISTINCT ON
    const joinResult = await client.query<JoinedRow>(
      `SELECT
         oa.drop_number,
         oa.serial_number AS oes_serial,
         oa.team,
         op.ont_barcode AS onemap_serial,
         op.ups_serial AS onemap_ups,
         (op.id IS NOT NULL) AS has_onemap_row
       FROM oes_activations oa
       LEFT JOIN (
         SELECT DISTINCT ON (UPPER(drop_number))
           id, drop_number, ont_barcode, ups_serial
         FROM onemap_properties
         WHERE drop_number IS NOT NULL AND drop_number != 'no drop allocated'
         ORDER BY UPPER(drop_number), updated_at DESC NULLS LAST
       ) op ON UPPER(oa.drop_number) = UPPER(op.drop_number)
       WHERE oa.import_batch_id = $1
         AND oa.serial_number IS NOT NULL
         AND oa.serial_number != ''`,
      [oesBatchId]
    );

    const rows = joinResult.rows;
    const totalOesRows = rows.length;

    log.info('OltAutoDetect', `Run #${runId}: ${totalOesRows} OES rows to process`);

    // Update total count
    await client.query(
      `UPDATE olt_auto_detect_runs SET total_oes_rows = $1 WHERE id = $2`,
      [totalOesRows, runId]
    );

    // Load ALL existing DR+serial combos from queue (skip re-queuing)
    // Includes completed (already verified), pending, and processing items
    const prevQueued = await client.query(
      `SELECT drop_number, UPPER(oes_serial) as oes_serial, status, mismatch_type
       FROM olt_onemap_lookup_queue`
    );
    const verifiedMap = new Map<string, string>();
    for (const pv of prevQueued.rows) {
      const key = `${pv.drop_number}|${pv.oes_serial}`;
      // Completed items have a known mismatch_type; pending/processing are 'queued'
      if (pv.status === 'completed') {
        verifiedMap.set(key, pv.mismatch_type || 'unknown');
      } else if (!verifiedMap.has(key)) {
        verifiedMap.set(key, 'queued');
      }
    }

    let cacheHits = 0;
    let cacheMisses = 0;
    let matches = 0;
    let mismatchesNote2 = 0;
    let mismatchesNote4 = 0;
    let upsSwaps = 0;
    let duplicatesSkipped = 0;
    let alreadyVerified = 0;

    // Collect inserts for batch processing
    const mismatchInserts: Array<{
      importId: string;
      dropNumber: string;
      oltSerial: string;
      wrongOneMapSerial: string | null;
      fixStatus: string;
      hasUpsSwap: boolean;
      oesSource: string;
      oesBatchId: string;
    }> = [];

    const queueInserts: Array<{
      dropNumber: string;
      oesSerial: string;
      team: string | null;
    }> = [];

    for (const row of rows) {
      const oesSerial = row.oes_serial.trim().toUpperCase();
      const oneMapSerial = row.onemap_serial?.trim().toUpperCase() || null;

      // Skip if already in queue (pending/processing) or verified (completed)
      const verifyKey = `${row.drop_number}|${oesSerial}`;
      if (verifiedMap.has(verifyKey)) {
        const prevType = verifiedMap.get(verifyKey)!;
        if (prevType === 'match') matches++;
        // 'queued' = still pending in queue from a previous run, skip re-queuing
        alreadyVerified++;
        continue;
      }

      if (!row.has_onemap_row) {
        // No 1Map row at all -> queue for API
        cacheMisses++;
        mismatchesNote2++;
        queueInserts.push({
          dropNumber: row.drop_number,
          oesSerial: row.oes_serial,
          team: row.team,
        });
        continue;
      }

      // Has 1Map row
      cacheHits++;

      if (!oneMapSerial) {
        // 1Map cache row exists but ONT barcode is empty -> queue for API
        cacheMisses++;
        queueInserts.push({
          dropNumber: row.drop_number,
          oesSerial: row.oes_serial,
          team: row.team,
        });
        continue;
      }

      if (oesSerial === oneMapSerial) {
        // Match
        matches++;
        continue;
      }

      // Mismatch: check for UPS swap
      const hasUpsSwap = isUpsSerial(oneMapSerial);
      if (hasUpsSwap) {
        upsSwaps++;
      }

      mismatchesNote4++;
      mismatchInserts.push({
        importId: importId,
        dropNumber: row.drop_number,
        oltSerial: row.oes_serial,
        wrongOneMapSerial: row.onemap_serial,
        fixStatus: 'pending',
        hasUpsSwap,
        oesSource: 'cache',
        oesBatchId,
      });
    }

    // Batch insert mismatches with duplicate handling
    const BATCH_SIZE = 500;
    for (let i = 0; i < mismatchInserts.length; i += BATCH_SIZE) {
      const batch = mismatchInserts.slice(i, i + BATCH_SIZE);
      const inserted = await insertMismatchBatch(client, batch);
      duplicatesSkipped += batch.length - inserted;
    }

    // Batch insert queue items
    if (queueInserts.length > 0) {
      for (let i = 0; i < queueInserts.length; i += BATCH_SIZE) {
        const batchItems = queueInserts.slice(i, i + BATCH_SIZE);
        const batchVals: string[] = [];
        const batchParams: (string | null)[] = [];
        let bIdx = 1;

        for (const q of batchItems) {
          batchVals.push(`($${bIdx}, $${bIdx + 1}, $${bIdx + 2}, $${bIdx + 3})`);
          batchParams.push(q.dropNumber, q.oesSerial, oesBatchId, q.team);
          bIdx += 4;
        }

        await client.query(
          `INSERT INTO olt_onemap_lookup_queue (drop_number, oes_serial, oes_batch_id, team)
           VALUES ${batchVals.join(', ')}`,
          batchParams
        );
      }
    }

    // Update import record stats
    await client.query(
      `UPDATE olt_report_imports
       SET total_records = $1, match_count = $2, mismatch_count = $3
       WHERE id = $4`,
      [totalOesRows, matches, mismatchesNote2 + mismatchesNote4, importId]
    );

    // Update run tracking
    const apiLookupsQueued = queueInserts.length;
    await client.query(
      `UPDATE olt_auto_detect_runs
       SET cache_hits = $1, cache_misses = $2, matches = $3,
           mismatches_note2 = $4, mismatches_note4 = $5, ups_swaps = $6,
           duplicates_skipped = $7, api_lookups_queued = $8,
           status = CASE WHEN $8 > 0 THEN 'processing_queue' ELSE 'completed' END,
           completed_at = CASE WHEN $8 = 0 THEN NOW() ELSE NULL END
       WHERE id = $9`,
      [cacheHits, cacheMisses, matches, mismatchesNote2, mismatchesNote4,
       upsSwaps, duplicatesSkipped, apiLookupsQueued, runId]
    );

    const result: AutoDetectResult = {
      runId,
      totalOesRows,
      cacheHits,
      cacheMisses,
      matches,
      mismatchesNote2,
      mismatchesNote4,
      upsSwaps,
      duplicatesSkipped,
      apiLookupsQueued,
      alreadyVerified,
    };

    log.info('OltAutoDetect', `Run #${runId} cache phase complete`, result);
    return result;
  } catch (error) {
    log.error('OltAutoDetect', 'Auto-detect failed', { oesBatchId, error });
    // Update run tracking with error status
    try {
      await client.query(
        `UPDATE olt_auto_detect_runs
         SET status = 'error', error_message = $1, completed_at = NOW()
         WHERE id = (SELECT id FROM olt_auto_detect_runs
                     WHERE oes_batch_id = $2 ORDER BY id DESC LIMIT 1)`,
        [error instanceof Error ? error.message : 'Unknown error', oesBatchId]
      );
    } catch { /* best effort */ }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Insert a batch of mismatch records with duplicate handling.
 * Returns the number of actually inserted records.
 */
async function insertMismatchBatch(
  client: ReturnType<Pool['connect']> extends Promise<infer T> ? T : never,
  batch: Array<{
    importId: string;
    dropNumber: string;
    oltSerial: string;
    wrongOneMapSerial: string | null;
    fixStatus: string;
    hasUpsSwap: boolean;
    oesSource: string;
    oesBatchId: string;
  }>
): Promise<number> {
  let inserted = 0;

  for (const item of batch) {
    // Check for existing record (same logic as import.ts duplicate handling)
    const existing = await client.query(
      `SELECT id, fix_status, olt_serial
       FROM olt_mismatch_records
       WHERE drop_number = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [item.dropNumber]
    );

    if (existing.rows.length > 0) {
      const ex = existing.rows[0];

      if (ex.fix_status === 'fixed') {
        const existingSerial = ex.olt_serial?.toUpperCase();
        const newSerial = item.oltSerial.toUpperCase();

        if (existingSerial === newSerial) {
          // Same serial, already fixed -> skip
          continue;
        }

        // Different serial after fix -> needs reinvestigation
        await client.query(
          `INSERT INTO olt_mismatch_records
            (import_id, drop_number, olt_serial, wrong_onemap_serial, fix_status,
             has_ups_swap, detection_source, oes_batch_id, onemap_source)
           VALUES ($1, $2, $3, $4, 'needs_reinvestigation', $5, 'auto', $6, $7)`,
          [item.importId, item.dropNumber, item.oltSerial, item.wrongOneMapSerial,
           item.hasUpsSwap, item.oesBatchId, item.oesSource]
        );

        await logActivity(
          item.dropNumber,
          'INVESTIGATE',
          {
            message: `Auto-detected new serial mismatch after previous fix. Previous: ${existingSerial}, New: ${newSerial}`,
            source: 'olt_auto_detect',
          },
          'system'
        ).catch(() => { /* non-critical */ });

        inserted++;
        continue;
      }

      if (ex.fix_status === 'pending' || ex.fix_status === 'empty_serial'
          || ex.fix_status === 'not_found') {
        // Already tracked -> update serial data
        await client.query(
          `UPDATE olt_mismatch_records
           SET olt_serial = $1, wrong_onemap_serial = $2,
               has_ups_swap = $3, detection_source = 'auto',
               oes_batch_id = $4, onemap_source = $5
           WHERE id = $6`,
          [item.oltSerial, item.wrongOneMapSerial, item.hasUpsSwap,
           item.oesBatchId, item.oesSource, ex.id]
        );
        continue;
      }
      // For other statuses (needs_reinvestigation etc), allow new insert
    }

    // New record
    await client.query(
      `INSERT INTO olt_mismatch_records
        (import_id, drop_number, olt_serial, wrong_onemap_serial, fix_status,
         has_ups_swap, detection_source, oes_batch_id, onemap_source)
       VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7, $8)`,
      [item.importId, item.dropNumber, item.oltSerial, item.wrongOneMapSerial,
       item.fixStatus, item.hasUpsSwap, item.oesBatchId, item.oesSource]
    );
    inserted++;
  }

  return inserted;
}

export type { AutoDetectResult };
