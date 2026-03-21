/**
 * WA Monitor SharePoint Sync API
 * POST /api/wa-monitor-sync-sharepoint
 *
 * Syncs daily drops per project to SharePoint (NeonDbase sheet)
 * Columns: A = date, B = project, C = total no of drops submitted
 *
 * SharePoint URL: https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/EYm7g0w6Y1dFgGB_m4YlBxgBeVJpoDXAYjdvK-ZfgHoOqA
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/modules/wa-monitor/lib/apiResponse';
import { getDailyDropsPerProject } from '@/modules/wa-monitor/services/waMonitorService';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

// Database connection - initialized lazily at runtime
function getDbConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

// Microsoft Graph API configuration
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

interface SharePointConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId: string;
  fileId: string;
  worksheetName: string;
}

/**
 * Get SharePoint configuration from environment variables
 */
function getSharePointConfig(): SharePointConfig | null {
  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;
  const siteId = process.env.SHAREPOINT_SITE_ID;
  const driveId = process.env.SHAREPOINT_DRIVE_ID;
  const fileId = process.env.SHAREPOINT_FILE_ID;
  const worksheetName = process.env.SHAREPOINT_WORKSHEET_NAME || 'NeonDbase';

  if (!tenantId || !clientId || !clientSecret || !siteId || !driveId || !fileId) {
    return null;
  }

  return { tenantId, clientId, clientSecret, siteId, driveId, fileId, worksheetName };
}

/**
 * Get OAuth access token for Microsoft Graph API
 */
async function getAccessToken(config: SharePointConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  // Add timeout for OAuth request (30s - critical for SA network latency)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.statusText}`);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error: any) {
    log.error('wa-monitor-sync-sharepoint', { error: error instanceof Error ? error.message : String(error) });
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('OAuth token request timed out after 30 seconds');
    }
    throw error;
  }
}

/**
 * Get the next available row using database counter
 * Eliminates need to query large Excel file (which times out)
 */
async function getNextRow(config: SharePointConfig): Promise<number> {
  const sql = getDbConnection();
  try {
    const [row] = await sql`
      SELECT last_row_written
      FROM sharepoint_sync_state
      WHERE sheet_name = ${config.worksheetName}
    `;

    if (!row) {
      // Initialize if not exists
      await sql`
        INSERT INTO sharepoint_sync_state (sheet_name, last_row_written)
        VALUES (${config.worksheetName}, 1)
      `;
      return 2; // Next row after header
    }

    return row.last_row_written + 1;
  } catch (error) {
    log.error('waMonitor', { action: 'getNextRow', error });
    throw new Error('Failed to get next row number');
  }
}

/**
 * Update the last row written to database
 */
async function updateLastRow(worksheetName: string, lastRow: number, syncDate: string): Promise<void> {
  const sql = getDbConnection();
  try {
    await sql`
      UPDATE sharepoint_sync_state
      SET last_row_written = ${lastRow},
          last_sync_date = ${syncDate}::date,
          updated_at = NOW()
      WHERE sheet_name = ${worksheetName}
    `;
  } catch (error) {
    log.error('waMonitor', { action: 'updateLastRow', worksheetName, lastRow, error });
    // Don't throw - this is not critical, we can continue
  }
}

/**
 * Retry logic with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Don't retry on final attempt
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      log.debug('waMonitor', { action: 'retryWithBackoff', attempt: attempt + 1, maxRetries, delay });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Write single row to SharePoint with retry
 */
async function writeRowWithRetry(
  accessToken: string,
  config: SharePointConfig,
  rowNum: number,
  data: { date: string; project: string; count: number }
): Promise<void> {
  const rangeAddr = `A${rowNum}:C${rowNum}`;
  const updateUrl = `${GRAPH_API_BASE}/drives/${config.driveId}/items/${config.fileId}/workbook/worksheets/${config.worksheetName}/range(address='${rangeAddr}')`;

  await retryWithBackoff(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout (large Excel file)

    try {
      const response = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [[data.date, data.project, data.count]] }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeout);
      throw error;
    }
  }, 3, 2000); // 3 retries, 2s base delay
}

/**
 * Write daily drops to SharePoint with retry logic
 */
async function syncToSharePoint(
  accessToken: string,
  config: SharePointConfig,
  drops: Array<{ date: string; project: string; count: number }>
): Promise<{ succeeded: number; failed: number }> {
  // Get next available row from database (fast!)
  const nextRow = await getNextRow(config);

  let succeeded = 0;
  let failed = 0;
  let lastWrittenRow = nextRow - 1;
  const syncDate = drops[0]?.date || new Date().toISOString().split('T')[0];

  // Write each project's data with retry
  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i];
    const rowNum = nextRow + i;

    try {
      await writeRowWithRetry(accessToken, config, rowNum, drop);
      succeeded++;
      lastWrittenRow = rowNum;
      log.debug('waMonitor', { action: 'writeRowSuccess', project: drop.project, count: drop.count, rowNum });
    } catch (error: any) {
      failed++;
      log.error('waMonitor', { action: 'writeRowFailed', project: drop.project, rowNum, error });
    }

    // Rate limiting - wait 1s between writes
    if (i < drops.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Update database with last row written (for next sync)
  if (succeeded > 0) {
    await updateLastRow(config.worksheetName, lastWrittenRow, syncDate);
    log.debug('waMonitor', { action: 'updateLastRowSuccess', worksheetName: config.worksheetName, lastWrittenRow, syncDate });
  }

  return { succeeded, failed };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // Get SharePoint configuration
    const config = getSharePointConfig();
    if (!config) {
      return apiResponse.validationError(res, {
        sharepoint: 'SharePoint configuration missing. Check environment variables.',
      });
    }

    // Get date from request body (optional, defaults to today)
    const { date } = req.body || {};

    // Get daily drops for specified date or today
    const dailyDrops = await getDailyDropsPerProject(date);

    if (dailyDrops.length === 0) {
      const dateStr = date || new Date().toISOString().split('T')[0];
      return apiResponse.success(res, {
        synced: 0,
        message: `No drops to sync for ${dateStr}`,
        date: dateStr,
      });
    }

    // Get access token
    const accessToken = await getAccessToken(config);

    // Sync to SharePoint with retry logic
    const result = await syncToSharePoint(accessToken, config, dailyDrops);

    // Determine response based on results
    const message = result.failed === 0
      ? `Successfully synced ${result.succeeded}/${dailyDrops.length} project(s) to SharePoint`
      : `Synced ${result.succeeded}/${dailyDrops.length} project(s) (${result.failed} failed)`;

    return apiResponse.success(res, {
      succeeded: result.succeeded,
      failed: result.failed,
      total: dailyDrops.length,
      message,
      date: new Date().toISOString().split('T')[0],
      projects: dailyDrops, // Include project details for email
    });

  } catch (error: any) {
    log.error('waMonitor', { action: 'syncToSharePoint', error });
    return apiResponse.internalError(res, error, 'Failed to sync to SharePoint');
  }
}

export default withAuth(getAccessToken);
