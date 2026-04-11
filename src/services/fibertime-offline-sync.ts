/**
 * Fibertime Offline ONT Sync Service — nightly pull from SharePoint.
 * Sites: LAW, MAM, MOA, TEM. File: offline_ont_report_{SITE}_{YYYYMMDD}.xlsx
 * Uses listFolderFilesAlt (GetFolderByServerRelativeUrl) — Path API returns 403.
 * DB helpers live in fibertime-offline-db.ts.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '@/lib/logger';
import { pool } from '@/lib/db';
import { parseOfflineOntExcel } from '@/lib/sharepoint/offlineOntParser';
import {
  listFolderFilesAlt,
  downloadFileBuffer,
  FibertimeAuthExpiredError,
  type SpFileItem,
} from '@/lib/sharepoint/fibertime-sp-client';
import {
  upsertOfflineRows,
  detectRecoveries,
  createOfflineTickets,
} from './fibertime-offline-db';
import type { OfflineSite } from './fibertime-offline-db';

export { SITE_MAINTENANCE_TEAMS } from './fibertime-offline-db';
export type { OfflineSite } from './fibertime-offline-db';

const logger = createLogger('services:fibertime-offline-sync');

// ============================================================================
// CONSTANTS
// ============================================================================

export const OFFLINE_SITES = ['LAW', 'MAM', 'MOA', 'TEM'] as const;

// ============================================================================
// TYPES
// ============================================================================

export interface OfflineSiteResult {
  site: OfflineSite;
  status: 'imported' | 'skipped' | 'not_available' | 'error';
  filename?: string;
  rows?: number;
  inserted?: number;
  updated?: number;
  matched?: number;
  unmatched?: number;
  tickets_created?: number;
  error?: string;
}

export interface OfflineSyncReport {
  date: string;
  sites: OfflineSiteResult[];
  durationMs: number;
}

interface ImportResult {
  rows: number;
  inserted: number;
  updated: number;
  matched: number;
  unmatched: number;
  tickets_created: number;
}

// ============================================================================
// FILE SELECTION
// ============================================================================

/**
 * Finds the FINAL offline ONT file (no numeric suffix) for a site + YYYYMMDD date.
 * Drafts look like `offline_ont_report_LAW_20260411 1.xlsx` — excluded.
 */
export function findTodaysOfflineFile(
  files: SpFileItem[],
  site: string,
  date: string
): SpFileItem | null {
  const expectedName = `offline_ont_report_${site}_${date}.xlsx`;
  return files.find(f => f.name === expectedName) ?? null;
}

// ============================================================================
// DUPLICATE CHECK
// ============================================================================

/**
 * Returns true if a file with this name has already been imported into
 * offline_import_batches.
 */
export async function isAlreadyImported(filename: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM offline_import_batches WHERE filename = $1 LIMIT 1',
    [filename]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// IMPORT PIPELINE
// ============================================================================

/** Full pipeline: parse → batch → match → upsert → recover → tickets. */
export async function importOfflineFromBuffer(
  filename: string,
  buffer: Buffer,
  site: OfflineSite,
  reportDate: string
): Promise<ImportResult> {
  const tmpPath = path.join(os.tmpdir(), filename);

  try {
    fs.writeFileSync(tmpPath, buffer);
    logger.info('Temp file written', { tmpPath, sizeBytes: buffer.length });

    const { rows, warnings, sheetName } = parseOfflineOntExcel(tmpPath);
    logger.info('Offline ONT Excel parsed', {
      filename, sheetName, rows: rows.length, warnings,
    });

    if (rows.length === 0) {
      throw new Error('Offline ONT file contained 0 data rows after parsing');
    }

    // Create import batch record
    const batchResult = await pool.query<{ id: string }>(
      `INSERT INTO offline_import_batches (filename, report_date, total_rows)
       VALUES ($1, $2::date, $3) RETURNING id`,
      [filename, reportDate, rows.length]
    );
    const batchId = batchResult.rows[0]?.id;
    if (!batchId) throw new Error('Failed to create import batch');

    // Fetch drops for matching
    const dropNumbers = rows.map(r => r.drop_number);
    const dropsResult = await pool.query<{
      id: string; drop_number: string; ont_serial: string | null;
      latitude: number | null; longitude: number | null;
    }>(
      `SELECT id, drop_number, ont_serial, latitude, longitude
       FROM drops WHERE drop_number = ANY($1)`,
      [dropNumbers]
    );
    const dropsMap = new Map(dropsResult.rows.map(d => [d.drop_number, d]));

    // Fetch OES activations for serial validation
    const oesResult = await pool.query<{
      id: string; drop_number: string; serial_number: string | null;
      latitude: number | null; longitude: number | null;
    }>(
      `SELECT id, drop_number, serial_number, latitude, longitude
       FROM oes_activations WHERE drop_number = ANY($1)`,
      [dropNumbers]
    );
    const oesMap = new Map(oesResult.rows.map(o => [o.drop_number, o]));

    logger.info('Match data loaded', { dropMatches: dropsMap.size, oesMatches: oesMap.size });

    // Upsert offline_devices rows
    const upsertStats = await upsertOfflineRows(rows, batchId, dropsMap, oesMap, reportDate);

    // Update batch stats
    await pool.query(
      `UPDATE offline_import_batches
       SET matched_drops = $1, matched_oes = $2, unmatched = $3 WHERE id = $4`,
      [upsertStats.matched_drops, upsertStats.matched_oes, upsertStats.unmatched, batchId]
    );

    // Recovery detection
    const recovered = await detectRecoveries(reportDate);
    if (recovered > 0) {
      logger.info('Recovery detection complete', { recovered, reportDate });
    }

    // NOC ticket creation for matched, still-offline devices
    const ticketsCreated = await createOfflineTickets(site, reportDate);

    logger.info('Offline ONT import complete', {
      site, reportDate, rows: rows.length, ...upsertStats, ticketsCreated,
    });

    return {
      rows: rows.length,
      inserted: upsertStats.inserted,
      updated: upsertStats.updated,
      matched: upsertStats.matched_drops + upsertStats.matched_oes,
      unmatched: upsertStats.unmatched,
      tickets_created: ticketsCreated,
    };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (cleanupErr) {
      logger.warn('Failed to clean up temp file', {
        tmpPath,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
  }
}

// ============================================================================
// PER-SITE SYNC
// ============================================================================

/** Syncs offline ONT data for one site. Returns an OfflineSiteResult. */
export async function syncOfflineSite(
  site: OfflineSite,
  date: string
): Promise<OfflineSiteResult> {
  const folderPath = `Offline ONT Report/Sites/${site}`;
  logger.info('Syncing offline ONT site', { site, date, folderPath });

  try {
    const files = await listFolderFilesAlt(folderPath);
    const targetFile = findTodaysOfflineFile(files, site, date);

    if (!targetFile) {
      logger.info('No final offline ONT file found for today', { site, date });
      return { site, status: 'not_available' };
    }

    const alreadyImported = await isAlreadyImported(targetFile.name);
    if (alreadyImported) {
      logger.info('File already imported, skipping', { site, filename: targetFile.name });
      return { site, status: 'skipped', filename: targetFile.name };
    }

    logger.info('Downloading offline ONT file', { site, filename: targetFile.name, sizeBytes: targetFile.size });

    const buffer = await downloadFileBuffer(targetFile.id);
    const result = await importOfflineFromBuffer(targetFile.name, buffer, site, date);

    return { site, status: 'imported', filename: targetFile.name, ...result };
  } catch (error: unknown) {
    if (error instanceof FibertimeAuthExpiredError) throw error;
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Offline ONT site sync failed', { site, date, error: errMsg });
    return { site, status: 'error', error: errMsg };
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Run the nightly offline ONT sync for all 4 active sites.
 * @param date - YYYYMMDD (defaults to today SAST / UTC+2)
 */
export async function runOfflineSync(date?: string): Promise<OfflineSyncReport> {
  const reportDate =
    date ??
    new Date(Date.now() + 2 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

  logger.info('Starting Fibertime offline ONT sync', { date: reportDate, sites: OFFLINE_SITES });

  const startMs = Date.now();
  const outcomes = await Promise.allSettled(
    OFFLINE_SITES.map(site => syncOfflineSite(site, reportDate))
  );

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected' && outcome.reason instanceof FibertimeAuthExpiredError) {
      throw outcome.reason;
    }
  }

  const results: OfflineSiteResult[] = outcomes.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    const site = OFFLINE_SITES[idx] as OfflineSite;
    const errMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    logger.error('Unexpected offline site sync rejection', { site, error: errMsg });
    return { site, status: 'error' as const, error: errMsg };
  });

  const report: OfflineSyncReport = { date: reportDate, sites: results, durationMs: Date.now() - startMs };

  logger.info('Fibertime offline ONT sync complete', {
    date: reportDate,
    imported:  results.filter(r => r.status === 'imported').length,
    skipped:   results.filter(r => r.status === 'skipped').length,
    errors:    results.filter(r => r.status === 'error').length,
    durationMs: report.durationMs,
  });

  return report;
}
