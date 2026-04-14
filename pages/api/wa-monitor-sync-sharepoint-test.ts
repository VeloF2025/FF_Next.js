/**
 * WA Monitor SharePoint Sync Test API
 * POST /api/wa-monitor-sync-sharepoint-test
 *
 * Test endpoint that syncs a specific date's drops to SharePoint
 * Used for testing the sync system with historical data
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/modules/wa-monitor/lib/apiResponse';
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

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Get daily drops for a specific date
 */
async function getDailyDropsForDate(date: string): Promise<Array<{ date: string; project: string; count: number }>> {
  const sql = getDbConnection();
  try {
    const rows = await sql`
      SELECT
        DATE(COALESCE(whatsapp_message_date, created_at)) as date,
        COALESCE(project, 'Unknown') as project,
        COUNT(*) as count
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at)) = ${date}
      GROUP BY DATE(COALESCE(whatsapp_message_date, created_at)), project
      ORDER BY project ASC
    `;

    return rows.map((row: any) => ({
      date: row.date,
      project: row.project,
      count: parseInt(row.count, 10),
    }));
  } catch (error) {
    log.error('waMonitor', { action: 'getDailyDropsForDate', date, error });
    throw new Error('Failed to get daily drops for date');
  }
}

/**
 * Find the next available row in the worksheet
 */
async function findNextRow(
  accessToken: string,
  config: SharePointConfig
): Promise<number> {
  const rangeUrl = `${GRAPH_API_BASE}/drives/${config.driveId}/items/${config.fileId}/workbook/worksheets/${config.worksheetName}/range(address='B1:B2000')`;

  const response = await fetch(rangeUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get range: ${response.statusText}`);
  }

  const data = await response.json();
  const values = data.values || [];

  // Find last non-empty row
  let lastRow = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0]) {
      lastRow = i + 1;
    }
  }

  return lastRow + 1; // Next available row
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
      log.error('wa-monitor-sync-sharepoint-test', { error: error instanceof Error ? error.message : String(error) });
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

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
    const timeout = setTimeout(() => controller.abort(), 30000);

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
  }, 3, 2000);
}

/**
 * Write daily drops to SharePoint with retry logic
 */
async function syncToSharePoint(
  accessToken: string,
  config: SharePointConfig,
  drops: Array<{ date: string; project: string; count: number }>
): Promise<{ succeeded: number; failed: number }> {
  const nextRow = await findNextRow(accessToken, config);

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i]!;
    const rowNum = nextRow + i;

    try {
      await writeRowWithRetry(accessToken, config, rowNum, drop);
      succeeded++;
      log.debug('waMonitor', { action: 'writeRowSuccess', project: drop.project, count: drop.count, rowNum });
    } catch (error: any) {
      failed++;
      log.error('waMonitor', { action: 'writeRowFailed', project: drop.project, rowNum, error });
    }

    if (i < drops.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return { succeeded, failed };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // Get test date from request body (default to yesterday)
    const { testDate } = req.body;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateToTest = testDate || yesterday.toISOString().split('T')[0];

    log.debug('waMonitor', { action: 'testSharePointSync', testDate: dateToTest });

    // Get SharePoint configuration
    const config = getSharePointConfig();
    if (!config) {
      return apiResponse.validationError(res, {
        sharepoint: 'SharePoint configuration missing. Check environment variables.',
      });
    }

    // Get drops for the test date
    const dailyDrops = await getDailyDropsForDate(dateToTest);

    if (dailyDrops.length === 0) {
      return apiResponse.success(res, {
        testDate: dateToTest,
        synced: 0,
        message: `No drops found for ${dateToTest}`,
      });
    }

    // Get access token
    const accessToken = await getAccessToken(config);

    // Sync to SharePoint
    const result = await syncToSharePoint(accessToken, config, dailyDrops);

    const message = result.failed === 0
      ? `✅ Test successful: Synced ${result.succeeded}/${dailyDrops.length} project(s) for ${dateToTest}`
      : `⚠️ Partial success: ${result.succeeded}/${dailyDrops.length} synced (${result.failed} failed) for ${dateToTest}`;

    return apiResponse.success(res, {
      testDate: dateToTest,
      succeeded: result.succeeded,
      failed: result.failed,
      total: dailyDrops.length,
      message,
      drops: dailyDrops,
    });

  } catch (error: any) {
    log.error('waMonitor', { action: 'testSharePointSync', error });
    return apiResponse.internalError(res, error, 'Test sync failed');
  }
}

export default withAuth(handler);
