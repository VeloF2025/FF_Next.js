/**
 * OneMap Sync Service
 *
 * Syncs installation data from 1Map GIS API to onemap schema tables.
 * Handles full and incremental syncs with checksum-based change detection.
 */

import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { OneMapClient, OneMapRecord, createOneMapClient } from './oneMapClient';
import crypto from 'crypto';

const logger = createLogger({ module: 'oneMapSync' });

// Types
export interface SyncOptions {
  siteCode?: string;      // Specific site to sync (null = all enabled)
  maxPages?: number;      // Limit pages per site (for testing)
  dryRun?: boolean;       // Don't write to DB
  fullSync?: boolean;     // Force full sync (ignore checksums)
}

export interface SyncResult {
  siteCode: string;
  siteName: string;
  success: boolean;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsFailed: number;
  durationSeconds: number;
  error?: string;
}

export interface SyncSummary {
  startedAt: Date;
  completedAt: Date;
  totalDurationSeconds: number;
  sites: SyncResult[];
  totalFetched: number;
  totalCreated: number;
  totalUpdated: number;
  totalUnchanged: number;
  totalFailed: number;
}

// Get SQL client
function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable required');
  }
  return neon(databaseUrl);
}

/**
 * Generate MD5 checksum for change detection
 */
function generateChecksum(record: OneMapRecord): string {
  const relevantData = {
    drp: record.drp,
    pole: record.pole,
    status: record.status,
    address: record.address,
    latitude: record.latitude,
    longitude: record.longitude,
    modified: record.modified,
  };
  return crypto.createHash('md5').update(JSON.stringify(relevantData)).digest('hex');
}

/**
 * Get enabled sites from database
 */
async function getEnabledSites(sql: ReturnType<typeof neon>, siteCode?: string) {
  if (siteCode) {
    const sites = await sql`
      SELECT id, site_code, site_name, project_id
      FROM onemap.sites
      WHERE site_code = ${siteCode} AND enabled = true
    `;
    return sites;
  }

  const sites = await sql`
    SELECT id, site_code, site_name, project_id
    FROM onemap.sites
    WHERE enabled = true
    ORDER BY site_code
  `;
  return sites;
}

/**
 * Get existing installation checksums for a site
 */
async function getExistingChecksums(sql: ReturnType<typeof neon>, siteId: string): Promise<Map<string, string>> {
  const rows = await sql`
    SELECT dr_number, checksum
    FROM onemap.drops
    WHERE site_id = ${siteId}::uuid
  `;

  const checksums = new Map<string, string>();
  for (const row of rows) {
    checksums.set(row.dr_number, row.checksum || '');
  }
  return checksums;
}

/**
 * Upsert installation record
 */
async function upsertInstallation(
  sql: ReturnType<typeof neon>,
  siteId: string,
  record: OneMapRecord,
  checksum: string
): Promise<'created' | 'updated' | 'unchanged'> {
  const lat = record.latitude ? parseFloat(String(record.latitude)) : null;
  const lng = record.longitude ? parseFloat(String(record.longitude)) : null;

  // Check if exists
  const existing = await sql`
    SELECT id, checksum FROM onemap.drops
    WHERE site_id = ${siteId}::uuid AND dr_number = ${record.drp}
  `;

  if (existing.length === 0) {
    // Insert new
    await sql`
      INSERT INTO onemap.drops (
        site_id, dr_number, latitude, longitude, address,
        current_status, current_stage, pole_number, section_code, pon_code,
        checksum, last_synced_at
      ) VALUES (
        ${siteId}::uuid,
        ${record.drp},
        ${lat},
        ${lng},
        ${record.address || null},
        ${record.status || null},
        ${record.stage || null},
        ${record.pole || null},
        ${record.section || null},
        ${record.pon || null},
        ${checksum},
        NOW()
      )
    `;
    return 'created';
  }

  // Check if changed
  if (existing[0].checksum === checksum) {
    return 'unchanged';
  }

  // Update existing
  await sql`
    UPDATE onemap.drops SET
      latitude = ${lat},
      longitude = ${lng},
      address = ${record.address || null},
      current_status = ${record.status || null},
      current_stage = ${record.stage || null},
      pole_number = ${record.pole || null},
      section_code = ${record.section || null},
      pon_code = ${record.pon || null},
      checksum = ${checksum},
      last_synced_at = NOW(),
      updated_at = NOW()
    WHERE site_id = ${siteId}::uuid AND dr_number = ${record.drp}
  `;
  return 'updated';
}

/**
 * Log sync to sync_log table
 */
async function logSync(
  sql: ReturnType<typeof neon>,
  result: SyncResult,
  syncType: 'full' | 'incremental',
  startedAt: Date
) {
  await sql`
    INSERT INTO onemap.sync_log (
      sync_type, site_code, records_fetched, records_created,
      records_updated, records_unchanged, records_failed,
      duration_seconds, status, error_message, started_at, completed_at
    ) VALUES (
      ${syncType},
      ${result.siteCode},
      ${result.recordsFetched},
      ${result.recordsCreated},
      ${result.recordsUpdated},
      ${result.recordsUnchanged},
      ${result.recordsFailed},
      ${result.durationSeconds},
      ${result.success ? 'success' : 'failed'},
      ${result.error || null},
      ${startedAt.toISOString()},
      NOW()
    )
  `;
}

/**
 * Update site sync timestamp
 */
async function updateSiteSyncTime(
  sql: ReturnType<typeof neon>,
  siteId: string,
  syncType: 'full' | 'incremental',
  totalInstallations: number
) {
  if (syncType === 'full') {
    await sql`
      UPDATE onemap.sites SET
        last_full_sync = NOW(),
        total_drops = ${totalInstallations},
        updated_at = NOW()
      WHERE id = ${siteId}::uuid
    `;
  } else {
    await sql`
      UPDATE onemap.sites SET
        last_incremental_sync = NOW(),
        total_drops = ${totalInstallations},
        updated_at = NOW()
      WHERE id = ${siteId}::uuid
    `;
  }
}

/**
 * Sync a single site from 1Map
 */
export async function syncSite(
  client: OneMapClient,
  site: { id: string; site_code: string; site_name: string; project_id: string | null },
  options: SyncOptions = {}
): Promise<SyncResult> {
  const sql = getSql();
  const startedAt = new Date();
  const { dryRun = false, maxPages, fullSync = false } = options;

  const result: SyncResult = {
    siteCode: site.site_code,
    siteName: site.site_name,
    success: false,
    recordsFetched: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    recordsFailed: 0,
    durationSeconds: 0,
  };

  try {
    logger.info(`Starting sync for ${site.site_name} (${site.site_code})`);

    // Get existing checksums for incremental sync
    const existingChecksums = fullSync
      ? new Map<string, string>()
      : await getExistingChecksums(sql, site.id);

    // Fetch from 1Map
    const records = await client.getAllInstallations(site.site_code, {
      maxPages,
      onProgress: (page, totalPages, count) => {
        process.stdout.write(`\r  📄 ${site.site_code}: Page ${page}/${totalPages} (${count} records)`);
      },
    });

    console.log(''); // New line after progress
    result.recordsFetched = records.length;

    if (dryRun) {
      logger.info(`DRY RUN: Would process ${records.length} records for ${site.site_code}`);
      result.success = true;
      result.durationSeconds = (Date.now() - startedAt.getTime()) / 1000;
      return result;
    }

    // Process each record
    for (const record of records) {
      if (!record.drp) {
        result.recordsFailed++;
        continue;
      }

      try {
        const checksum = generateChecksum(record);
        const action = await upsertInstallation(sql, site.id, record, checksum);

        switch (action) {
          case 'created':
            result.recordsCreated++;
            break;
          case 'updated':
            result.recordsUpdated++;
            break;
          case 'unchanged':
            result.recordsUnchanged++;
            break;
        }
      } catch (err) {
        logger.error(`Failed to upsert ${record.drp}`, { error: err });
        result.recordsFailed++;
      }
    }

    // Update site metadata
    const totalInstallations = await sql`
      SELECT COUNT(*) as count FROM onemap.drops WHERE site_id = ${site.id}::uuid
    `;
    await updateSiteSyncTime(sql, site.id, fullSync ? 'full' : 'incremental', parseInt(totalInstallations[0].count));

    result.success = true;
    result.durationSeconds = (Date.now() - startedAt.getTime()) / 1000;

    // Log to sync_log
    await logSync(sql, result, fullSync ? 'full' : 'incremental', startedAt);

    logger.info(`Sync completed for ${site.site_code}`, {
      fetched: result.recordsFetched,
      created: result.recordsCreated,
      updated: result.recordsUpdated,
      unchanged: result.recordsUnchanged,
      failed: result.recordsFailed,
      duration: `${result.durationSeconds.toFixed(1)}s`,
    });

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.durationSeconds = (Date.now() - startedAt.getTime()) / 1000;
    logger.error(`Sync failed for ${site.site_code}`, { error });

    // Log failure
    await logSync(sql, result, fullSync ? 'full' : 'incremental', startedAt);
  }

  return result;
}

/**
 * Sync all enabled sites from 1Map
 */
export async function syncAllSites(options: SyncOptions = {}): Promise<SyncSummary> {
  const sql = getSql();
  const startedAt = new Date();

  // Create 1Map client
  const client = createOneMapClient();
  await client.authenticate();

  // Get sites to sync
  const sites = await getEnabledSites(sql, options.siteCode);

  if (sites.length === 0) {
    throw new Error(options.siteCode
      ? `Site ${options.siteCode} not found or not enabled`
      : 'No enabled sites found'
    );
  }

  logger.info(`Starting sync for ${sites.length} site(s)`, {
    sites: sites.map(s => s.site_code),
  });

  const results: SyncResult[] = [];

  for (const site of sites) {
    const result = await syncSite(client, site, options);
    results.push(result);
  }

  const completedAt = new Date();

  const summary: SyncSummary = {
    startedAt,
    completedAt,
    totalDurationSeconds: (completedAt.getTime() - startedAt.getTime()) / 1000,
    sites: results,
    totalFetched: results.reduce((sum, r) => sum + r.recordsFetched, 0),
    totalCreated: results.reduce((sum, r) => sum + r.recordsCreated, 0),
    totalUpdated: results.reduce((sum, r) => sum + r.recordsUpdated, 0),
    totalUnchanged: results.reduce((sum, r) => sum + r.recordsUnchanged, 0),
    totalFailed: results.reduce((sum, r) => sum + r.recordsFailed, 0),
  };

  logger.info('Sync completed', {
    duration: `${summary.totalDurationSeconds.toFixed(1)}s`,
    sites: summary.sites.length,
    totalFetched: summary.totalFetched,
    totalCreated: summary.totalCreated,
    totalUpdated: summary.totalUpdated,
  });

  return summary;
}

/**
 * Get sync status for all sites
 */
export async function getSyncStatus() {
  const sql = getSql();

  const sites = await sql`
    SELECT
      s.site_code,
      s.site_name,
      s.enabled,
      s.total_drops,
      s.last_full_sync,
      s.last_incremental_sync,
      (SELECT COUNT(*) FROM onemap.drops i WHERE i.site_id = s.id) as current_count
    FROM onemap.sites s
    ORDER BY s.site_code
  `;

  const recentLogs = await sql`
    SELECT site_code, sync_type, status, records_fetched, records_created,
           records_updated, duration_seconds, started_at
    FROM onemap.sync_log
    WHERE started_at > NOW() - INTERVAL '7 days'
    ORDER BY started_at DESC
    LIMIT 20
  `;

  return { sites, recentLogs };
}
