/**
 * Backfill Offline ONT data from SharePoint
 *
 * Downloads and processes all historical Offline ONT report files from
 * SharePoint for dates from Feb 28 2026 onwards (Jan 19 – Feb 27 2026
 * were already imported manually; 25,391 rows).
 *
 * Run from the project root:
 *   FIBERTIME_SP_COOKIE_FILE=/home/velo/.fibertime-sp-cookies.json \
 *     npx tsx scripts/backfill-offline-ont.ts
 *
 * Optional env vars:
 *   BACKFILL_DRY_RUN=1   — list files but do not import
 *   BACKFILL_SITE=LAW    — process only one site
 */

import { createLogger } from '@/lib/logger';
import {
  listFolderFilesAlt,
  downloadFileBuffer,
} from '@/lib/sharepoint/fibertime-sp-client';
import type { SpFileItem } from '@/lib/sharepoint/fibertime-sp-client';
import {
  isAlreadyImported,
  importOfflineFromBuffer,
  OFFLINE_SITES,
} from '@/services/fibertime-offline-sync';
import type { OfflineSite } from '@/services/fibertime-offline-sync';

const logger = createLogger('scripts:backfill-offline-ont');

// ============================================================================
// CONFIG
// ============================================================================

/** Earliest date to backfill — everything <= this was imported manually. */
const CUTOFF_DATE = '20260227';

const DRY_RUN = process.env.BACKFILL_DRY_RUN === '1';
const SINGLE_SITE = process.env.BACKFILL_SITE as OfflineSite | undefined;

const SITES_TO_PROCESS: readonly OfflineSite[] = SINGLE_SITE
  ? [SINGLE_SITE]
  : OFFLINE_SITES;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extracts YYYYMMDD from an offline ONT filename.
 * Pattern: offline_ont_report_{SITE}_{YYYYMMDD}.xlsx
 * Returns null if the filename doesn't match the final-file pattern.
 */
function extractDateFromFilename(filename: string): string | null {
  const match = filename.match(/^offline_ont_report_[A-Z]+_(\d{8})\.xlsx$/);
  return match ? (match[1] ?? null) : null;
}

/**
 * Sort SpFileItems by the date embedded in their filename (ascending).
 */
function sortByDate(files: SpFileItem[]): SpFileItem[] {
  return [...files].sort((a, b) => {
    const da = extractDateFromFilename(a.name) ?? '';
    const db = extractDateFromFilename(b.name) ?? '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

// ============================================================================
// PER-SITE BACKFILL
// ============================================================================

interface SiteBackfillResult {
  site: OfflineSite;
  total_files: number;
  skipped_before_cutoff: number;
  skipped_already_imported: number;
  imported: number;
  errors: number;
}

async function backfillSite(site: OfflineSite): Promise<SiteBackfillResult> {
  const result: SiteBackfillResult = {
    site,
    total_files: 0,
    skipped_before_cutoff: 0,
    skipped_already_imported: 0,
    imported: 0,
    errors: 0,
  };

  const folderPath = `Offline ONT Report/Sites/${site}`;
  logger.info('Listing folder', { site, folderPath });

  const allFiles = await listFolderFilesAlt(folderPath);

  // Filter to final files only (no numeric suffix)
  const finalFiles = allFiles.filter(f => extractDateFromFilename(f.name) !== null);
  result.total_files = finalFiles.length;

  logger.info('Files found', { site, total: allFiles.length, final: finalFiles.length });

  if (finalFiles.length === 0) {
    logger.warn('No final files found for site', { site });
    return result;
  }

  // Sort oldest → newest
  const sorted = sortByDate(finalFiles);

  for (const file of sorted) {
    const fileDate = extractDateFromFilename(file.name);
    if (!fileDate) continue;

    // Skip dates already imported manually
    if (fileDate <= CUTOFF_DATE) {
      result.skipped_before_cutoff++;
      continue;
    }

    // Skip already imported
    const alreadyDone = await isAlreadyImported(file.name);
    if (alreadyDone) {
      logger.info('Already imported, skipping', { site, filename: file.name });
      result.skipped_already_imported++;
      continue;
    }

    if (DRY_RUN) {
      logger.info('[DRY RUN] Would import', { site, filename: file.name, date: fileDate });
      continue;
    }

    logger.info('Importing', { site, filename: file.name, date: fileDate, size: file.size });

    try {
      const buffer = await downloadFileBuffer(file.id);
      const importResult = await importOfflineFromBuffer(file.name, buffer, site, fileDate);

      logger.info('Import complete', {
        site,
        filename: file.name,
        date: fileDate,
        rows: importResult.rows,
        inserted: importResult.inserted,
        updated: importResult.updated,
        matched: importResult.matched,
        unmatched: importResult.unmatched,
        tickets_created: importResult.tickets_created,
      });

      result.imported++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Import failed', { site, filename: file.name, error: errMsg });
      result.errors++;
    }
  }

  return result;
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  logger.info('Starting Offline ONT backfill', {
    sites: SITES_TO_PROCESS,
    cutoff_date: CUTOFF_DATE,
    dry_run: DRY_RUN,
  });

  const startMs = Date.now();
  const siteResults: SiteBackfillResult[] = [];

  for (const site of SITES_TO_PROCESS) {
    try {
      const result = await backfillSite(site);
      siteResults.push(result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('Site backfill failed', { site, error: errMsg });
      siteResults.push({
        site,
        total_files: 0,
        skipped_before_cutoff: 0,
        skipped_already_imported: 0,
        imported: 0,
        errors: 1,
      });
    }
  }

  const durationMs = Date.now() - startMs;

  // Summary
  const totals = siteResults.reduce(
    (acc, r) => ({
      total_files: acc.total_files + r.total_files,
      skipped_before_cutoff: acc.skipped_before_cutoff + r.skipped_before_cutoff,
      skipped_already_imported: acc.skipped_already_imported + r.skipped_already_imported,
      imported: acc.imported + r.imported,
      errors: acc.errors + r.errors,
    }),
    { total_files: 0, skipped_before_cutoff: 0, skipped_already_imported: 0, imported: 0, errors: 0 }
  );

  logger.info('Backfill complete', {
    ...totals,
    durationMs,
    dry_run: DRY_RUN,
    per_site: siteResults,
  });

  if (totals.errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  logger.error('Backfill script fatal error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
