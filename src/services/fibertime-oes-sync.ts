/**
 * Fibertime OES Sync Service — nightly pull from SharePoint into OES pipeline.
 * Sites: LAW, MAM, MOA, TEM (ETW excluded). Final file has no numeric suffix.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '@/lib/logger';
import { pool } from '@/lib/db';
import { parseOESExcel } from '@/modules/activate/services/oes/oesExcelParser';
import {
  createImportBatch,
  upsertActivations,
  importPPData,
} from '@/modules/activate/services/oes/oesImportService';
import {
  loadExistingUnifiedSet,
  processUnifiedRecords,
} from '@/modules/activate/services/oes/oesUnifiedRecordsService';
import {
  triggerQFieldSync,
  triggerSharePointSync,
  triggerOltAutoDetect,
  triggerSerialVerificationRecompute,
  triggerVlmLearning,
  triggerPpActivationCheck,
  triggerOntSwapConfirmation,
} from '@/modules/activate/services/oes/oesPostImportService';
import {
  listFolderFiles,
  downloadFileBuffer,
  type DriveItem,
} from '@/lib/graph/fibertime-sharepoint';

const logger = createLogger('services:fibertime-oes-sync');

// ============================================================================
// CONSTANTS
// ============================================================================

export const ACTIVE_SITES = ['LAW', 'MAM', 'MOA', 'TEM'] as const;
export type Site = (typeof ACTIVE_SITES)[number];

// ============================================================================
// TYPES
// ============================================================================

export interface SiteResult {
  site: Site;
  status: 'imported' | 'skipped' | 'not_available' | 'error';
  filename?: string;
  rows?: number;
  inserted?: number;
  updated?: number;
  matched?: number;
  unmatched?: number;
  error?: string;
}

export interface SyncReport {
  date: string;
  sites: SiteResult[];
  durationMs: number;
}

// ============================================================================
// FILE SELECTION
// ============================================================================

/**
 * Finds the FINAL OES file (no numeric suffix) for a given site and YYYYMMDD date.
 * Drafts look like `oes_status_report_LAW_20260411 1.xlsx` — those are excluded.
 */
export function findTodaysFile(
  files: DriveItem[],
  site: Site,
  date: string
): DriveItem | null {
  const expectedName = `oes_status_report_${site}_${date}.xlsx`;
  return files.find(f => f.name === expectedName) ?? null;
}

// ============================================================================
// DUPLICATE CHECK
// ============================================================================

/**
 * Returns true if a file with this name has already been imported.
 */
export async function isAlreadyImported(filename: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT id FROM oes_import_batches WHERE filename = $1 LIMIT 1',
    [filename]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// IMPORT
// ============================================================================

interface ImportResult {
  rows: number;
  inserted: number;
  updated: number;
  matched: number;
  unmatched: number;
}

/** Writes buffer to a temp file, runs the full OES pipeline, fires all post-import hooks. */
export async function importOesFromBuffer(
  filename: string,
  buffer: Buffer,
  reportDate: string
): Promise<ImportResult> {
  const tmpPath = path.join(os.tmpdir(), filename);

  try {
    fs.writeFileSync(tmpPath, buffer);
    logger.info('Temp file written', { tmpPath, sizeBytes: buffer.length });

    const parsed = parseOESExcel(tmpPath);
    logger.info('OES Excel parsed', {
      filename,
      rows: parsed.rows.length,
      warnings: parsed.warnings,
      headerMismatch: parsed.headerMismatch,
      ppRows: parsed.ppRows?.length ?? 0,
    });

    if (parsed.rows.length === 0) {
      throw new Error('OES file contained 0 data rows after parsing');
    }

    const dropNumbers = parsed.rows.map(r => r.drop_number);
    const { batchId, dropsMap, existingCount } = await createImportBatch(
      filename, reportDate, parsed.rows.length, dropNumbers
    );
    const activationsResult = await upsertActivations(parsed.rows, batchId, dropsMap, existingCount);
    const existingUnifiedSet = await loadExistingUnifiedSet(dropNumbers);
    await processUnifiedRecords(parsed.rows, existingUnifiedSet);

    const matchedDropNumbers = parsed.rows
      .filter(r => dropsMap.has(r.drop_number))
      .map(r => r.drop_number);

    // Fire-and-forget post-import hooks
    triggerQFieldSync({
      batchId,
      totalRows: parsed.rows.length,
      imported: activationsResult.inserted + activationsResult.updated,
      matched: activationsResult.matched,
      timestamp: new Date().toISOString(),
      reportDate,
    });
    triggerSharePointSync(matchedDropNumbers);
    triggerOltAutoDetect(batchId).catch(err => {
      logger.error('OLT auto-detect trigger failed', { error: err instanceof Error ? err.message : String(err) });
    });
    triggerSerialVerificationRecompute(matchedDropNumbers);
    triggerVlmLearning(matchedDropNumbers);
    triggerPpActivationCheck();
    triggerOntSwapConfirmation();

    if (parsed.ppRows && parsed.ppRows.length > 0) {
      importPPData(parsed.ppRows, filename).catch(err => {
        logger.error('PP DATA import failed', { error: err instanceof Error ? err.message : String(err) });
      });
    }

    return {
      rows: parsed.rows.length,
      inserted: activationsResult.inserted,
      updated: activationsResult.updated,
      matched: activationsResult.matched,
      unmatched: activationsResult.unmatched,
    };
  } finally {
    // Always clean up temp file
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
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

/** Syncs OES data for one site. Returns a SiteResult. */
export async function syncSite(site: Site, date: string): Promise<SiteResult> {
  const folderPath = `OES Report/Sites/${site}`;
  logger.info('Syncing site', { site, date, folderPath });

  try {
    const files = await listFolderFiles(folderPath);

    const targetFile = findTodaysFile(files, site, date);

    if (!targetFile) {
      logger.info('No final OES file found for today', { site, date });
      return { site, status: 'not_available' };
    }

    const alreadyImported = await isAlreadyImported(targetFile.name);
    if (alreadyImported) {
      logger.info('File already imported, skipping', { site, filename: targetFile.name });
      return { site, status: 'skipped', filename: targetFile.name };
    }

    logger.info('Downloading OES file', {
      site,
      filename: targetFile.name,
      sizeBytes: targetFile.size,
    });

    const buffer = await downloadFileBuffer(targetFile.id);
    const result = await importOesFromBuffer(targetFile.name, buffer, date);

    logger.info('Site import complete', { site, ...result });

    return {
      site,
      status: 'imported',
      filename: targetFile.name,
      ...result,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Site sync failed', { site, date, error: errMsg });
    return { site, status: 'error', error: errMsg };
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Run the nightly OES sync for all 4 active sites.
 * @param date - YYYYMMDD (defaults to today SAST / UTC+2)
 */
export async function runOesSync(date?: string): Promise<SyncReport> {
  // Default to today in SAST (UTC+2)
  const reportDate =
    date ??
    new Date(Date.now() + 2 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

  logger.info('Starting Fibertime OES sync', { date: reportDate, sites: ACTIVE_SITES });

  const startMs = Date.now();
  const sites = await Promise.allSettled(
    ACTIVE_SITES.map(site => syncSite(site, reportDate))
  );

  const results: SiteResult[] = sites.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    const site = ACTIVE_SITES[idx] as Site;
    const errMsg =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    logger.error('Unexpected site sync rejection', { site, error: errMsg });
    return { site, status: 'error' as const, error: errMsg };
  });

  const report: SyncReport = {
    date: reportDate,
    sites: results,
    durationMs: Date.now() - startMs,
  };

  const imported = results.filter(r => r.status === 'imported').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;

  logger.info('Fibertime OES sync complete', {
    date: reportDate,
    imported,
    skipped,
    errors,
    durationMs: report.durationMs,
  });

  return report;
}
