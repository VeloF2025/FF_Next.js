/**
 * Fibertime OES Sync Service — nightly pull from SharePoint into OES pipeline.
 * Sites: LAW, MAM, MOA, TEM, TEM-3, ETW-1, ETW-2. Final file has no numeric suffix.
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
  FibertimeAuthExpiredError,
  type SpFileItem,
} from '@/lib/sharepoint/fibertime-sp-client';

const logger = createLogger('services:fibertime-oes-sync');

// ============================================================================
// CONSTANTS
// ============================================================================

// Site = SharePoint folder name under "OES Report/Sites/". Fibertime splits
// Etwatwa into per-POP folders (ETW-1, ETW-2, …); the bare "ETW" and "ETW-3"
// folders return 403 (no grant for reporting@), so we list only the readable
// ETW-1/ETW-2 folders. Report-side aggregation rolls all ETW-* into one
// "Etwatwa" row (see src/lib/oes-report/queries.ts).
export const ACTIVE_SITES = ['LAW', 'MAM', 'MOA', 'TEM', 'TEM-3', 'ETW-1', 'ETW-2'] as const;
export type Site = (typeof ACTIVE_SITES)[number];

// Retry tuning. Fibertime sometimes publishes the per-site OES files a few
// minutes AFTER our cron fires (files land ~22:35–22:41 SAST — the 2026-07-14
// timing race). Re-check any site still `not_available` a couple of times before
// giving up, so a late upload imports within the same run. A hard wall-clock
// budget keeps the whole run under the cron's `curl -m 300`: retries stop early
// rather than sleep past DEFAULT_MAX_TOTAL_MS (2 passes × 90s ≈ 3 min of waiting,
// leaving headroom for the actual SharePoint fetch + import work).
const DEFAULT_MAX_RETRY_PASSES = 2;
const DEFAULT_RETRY_DELAY_MS = 90_000;
const DEFAULT_MAX_TOTAL_MS = 240_000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

export interface SyncSummary {
  imported: number;
  skipped: number;
  notAvailable: number;
  errors: number;
  /** Number of extra re-check passes that ran (0 = every site resolved on pass 1). */
  retryPasses: number;
}

export interface SyncReport {
  date: string;
  sites: SiteResult[];
  durationMs: number;
  summary: SyncSummary;
}

export interface RunOesSyncOptions {
  /** Extra re-check passes for sites still `not_available` (late SharePoint upload). Default 2. */
  maxRetryPasses?: number;
  /** Delay between retry passes in ms. Default 90_000; pass 0 in tests. */
  retryDelayMs?: number;
  /** Hard wall-clock budget in ms; retries stop rather than sleep past it. Default 240_000. */
  maxTotalMs?: number;
  /**
   * Per-site sync fn — injectable so the retry/detection orchestration can be
   * unit-tested without the SharePoint/DB stack. Defaults to the real syncSite.
   */
  syncOne?: (site: Site, date: string) => Promise<SiteResult>;
}

// ============================================================================
// FILE SELECTION
// ============================================================================

/**
 * Finds the FINAL OES file (no numeric suffix) for a given site and YYYYMMDD date.
 * Drafts look like `oes_status_report_LAW_20260411 1.xlsx` — those are excluded.
 */
export function findTodaysFile(
  files: SpFileItem[],
  site: Site,
  date: string
): SpFileItem | null {
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
    // Auth expiry is a hard failure — bubble up so the API can return 503
    if (error instanceof FibertimeAuthExpiredError) throw error;
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Site sync failed', { site, date, error: errMsg });
    return { site, status: 'error', error: errMsg };
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Sync one set of sites a single time. Handles the auth-expiry abort rule:
 * listFolderFiles is the FIRST SharePoint call in syncSite, so a fulfilled
 * outcome (imported / skipped / not_available) proves the session is valid. A
 * real expiry 403s on EVERY folder, so no site can be fulfilled — abort only
 * when we saw an auth rejection AND not a single site listed successfully. A 403
 * on one folder while others succeed (e.g. a forbidden ETW POP) is a per-site
 * permission gap, recorded per-site rather than aborting the run.
 */
async function syncSitesOnce(
  sites: readonly Site[],
  date: string,
  syncOne: (site: Site, date: string) => Promise<SiteResult>
): Promise<SiteResult[]> {
  const outcomes = await Promise.allSettled(sites.map(site => syncOne(site, date)));

  const sessionLikelyValid = outcomes.some(o => o.status === 'fulfilled');
  const authRejection = outcomes.find(
    (o): o is PromiseRejectedResult =>
      o.status === 'rejected' && o.reason instanceof FibertimeAuthExpiredError
  );
  if (authRejection && !sessionLikelyValid) {
    throw authRejection.reason;
  }

  return outcomes.map((outcome, idx) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    const site = sites[idx] as Site;
    const errMsg =
      outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    logger.error('Unexpected site sync rejection', { site, error: errMsg });
    return { site, status: 'error' as const, error: errMsg };
  });
}

/**
 * Run the nightly OES sync for every site in ACTIVE_SITES.
 *
 * Sites that come back `not_available` are re-checked a bounded number of times
 * (see {@link RunOesSyncOptions}) to self-heal a late SharePoint upload. If the
 * run still ingests nothing, a WARN is emitted so the silent-failure class that
 * hid the 2026-07-14 timing race can be alerted on.
 *
 * @param date    - YYYYMMDD (defaults to today SAST / UTC+2)
 * @param options - retry tuning + injectable per-site sync (for tests)
 */
export async function runOesSync(
  date?: string,
  options: RunOesSyncOptions = {}
): Promise<SyncReport> {
  // Default to today in SAST (UTC+2)
  const reportDate =
    date ??
    new Date(Date.now() + 2 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

  const maxRetryPasses = options.maxRetryPasses ?? DEFAULT_MAX_RETRY_PASSES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxTotalMs = options.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
  const syncOne = options.syncOne ?? syncSite;

  logger.info('Starting Fibertime OES sync', { date: reportDate, sites: ACTIVE_SITES });
  const startMs = Date.now();

  // Pass 1 — every site.
  const resultBySite = new Map<Site, SiteResult>();
  for (const r of await syncSitesOnce(ACTIVE_SITES, reportDate, syncOne)) {
    resultBySite.set(r.site, r);
  }

  // Retry passes — re-check only sites still `not_available`. Fibertime sometimes
  // uploads the day's file a few minutes after our cron fires; a bounded wait lets
  // that late upload import within the same run instead of failing silently.
  let retryPasses = 0;
  for (let pass = 1; pass <= maxRetryPasses; pass++) {
    const pending = ACTIVE_SITES.filter(s => resultBySite.get(s)?.status === 'not_available');
    if (pending.length === 0) break;

    // Deadline guard: never sleep past the run budget (the cron wraps this in
    // `curl -m 300`). Stopping early keeps the report + completion/detection logs;
    // getting killed mid-run would lose them — the silent failure we're fixing.
    const elapsedMs = Date.now() - startMs;
    if (retryDelayMs > 0 && elapsedMs + retryDelayMs > maxTotalMs) {
      logger.warn('OES sync: retry budget exhausted — stopping re-checks early', {
        pass,
        pending,
        elapsedMs,
        maxTotalMs,
      });
      break;
    }

    retryPasses = pass;
    logger.info('OES sync: sites still not_available — waiting to re-check (late upload?)', {
      pass,
      pending,
      retryDelayMs,
    });
    if (retryDelayMs > 0) await delay(retryDelayMs);

    try {
      for (const r of await syncSitesOnce(pending, reportDate, syncOne)) {
        resultBySite.set(r.site, r);
      }
    } catch (err) {
      // A session that expires mid-run (only reachable once retries stretch the
      // wall-clock) must NOT discard the sites that already imported on pass 1:
      // keep the accumulated results and stop retrying. Pass 1 still hard-aborts
      // a session that was invalid from the very start (see syncSitesOnce).
      if (err instanceof FibertimeAuthExpiredError) {
        logger.warn('OES sync: session expired during retry — keeping earlier results', {
          pass,
          pending,
        });
        break;
      }
      throw err;
    }
  }

  const results: SiteResult[] = ACTIVE_SITES.map(
    s => resultBySite.get(s) ?? { site: s, status: 'error' as const, error: 'no result' }
  );

  const summary: SyncSummary = {
    imported: results.filter(r => r.status === 'imported').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    notAvailable: results.filter(r => r.status === 'not_available').length,
    errors: results.filter(r => r.status === 'error').length,
    retryPasses,
  };

  const report: SyncReport = {
    date: reportDate,
    sites: results,
    durationMs: Date.now() - startMs,
    summary,
  };

  // Detection: a run that ingested NOTHING new and has no evidence the day's data
  // was already imported earlier (skipped) is a silent-failure signal — the class
  // that hid the 2026-07-14 timing race for a week. Surface it loudly so drift can
  // be alerted on instead of passing as a green `success:true`.
  if (summary.imported === 0 && summary.skipped === 0) {
    logger.warn(
      'OES sync imported 0 sites — no OES data ingested. Check Fibertime SharePoint upload timing vs the cron schedule.',
      { date: reportDate, ...summary, sites: results.map(r => ({ site: r.site, status: r.status })) }
    );
  }

  logger.info('Fibertime OES sync complete', {
    date: reportDate,
    ...summary,
    durationMs: report.durationMs,
  });

  return report;
}
