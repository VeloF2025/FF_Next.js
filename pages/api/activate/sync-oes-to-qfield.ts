/**
 * API Route: /api/activate/sync-oes-to-qfield
 *
 * Purpose: Sync OES activation data to QFieldCloud as a GeoJSON file
 * Method: POST
 *
 * This endpoint:
 * 1. Fetches OES data from database
 * 2. Converts to GeoJSON with drop number labels
 * 3. Uploads to QFieldCloud via /files/ API as "OES FF DD-MM-YYYY.geojson"
 * 4. Syncs to all sync-enabled projects (or specific project if provided)
 *
 * Note: The GeoJSON file needs to be manually added as a layer in QGIS project
 * after first sync to configure styling. Subsequent syncs update the data.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import https from 'https';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// QFieldCloud Configuration
const QFIELD_API_URL = process.env.QFIELD_API_URL || 'https://qfield.fibreflow.app/api/v1';
const QFIELD_API_TOKEN = process.env.QFIELD_API_TOKEN || '2VbfhkUAfPHw7s7zAtMsyRTFF0xU00JtQRKyF3vzTxZtRODF4FLbzEc91f7PRhCIQvc48WLkC3TowKruYgFHIgm9ewk1VGb0JIQp';

// Fallback project ID if no default is set in DB
const FALLBACK_PROJECT_ID = 'ad3b1035-ddb3-42a3-8077-175f9400b38a';

/**
 * Get all sync-enabled QField project IDs from database.
 * If a specific projectId is provided, only sync to that one.
 * Otherwise sync to all active + sync_enabled projects.
 * Falls back to hardcoded value if DB query fails.
 */
async function getSyncTargetProjectIds(specificProjectId?: string): Promise<string[]> {
  if (specificProjectId) {
    return [specificProjectId];
  }

  try {
    const result = await pool.query(
      'SELECT qfield_project_id FROM qfield_projects WHERE is_active = true AND sync_enabled = true ORDER BY is_default DESC'
    );
    if (result.rows.length > 0) {
      return result.rows.map((r: any) => r.qfield_project_id);
    }
  } catch {
    log.warn('OESSync', 'Failed to query QField projects from DB, using fallback');
  }
  return [FALLBACK_PROJECT_ID];
}

interface OESPoint {
  drop_number: string;
  serial_number: string;
  activation_date: string;
  team: string;
  ont_rx_sig_dbm: number;
  current_ont_rx: number;
  status: string;
  latitude: number;
  longitude: number;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  properties: {
    drop_number: string;
    serial_number: string;
    activation_date: string;
    team: string;
    ont_rx_sig_dbm: number;
    current_ont_rx: number;
    status: string;
    label: string; // For displaying drop number on map
  };
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
  crs?: {
    type: 'name';
    properties: {
      name: string;
    };
  };
}

/**
 * Make API request to QFieldCloud
 */
async function qfieldApiRequest(
  endpoint: string,
  method: string = 'GET',
  data: any = null
): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, QFIELD_API_URL);

    const options: https.RequestOptions = {
      method,
      headers: {
        'Authorization': `Token ${QFIELD_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      rejectUnauthorized: false,
      timeout: 30000,
    };

    const req = https.request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`QFieldCloud API error: ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('QFieldCloud request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Upload file to QFieldCloud via multipart form data
 * Uses the /files/{project_id}/{filename} endpoint
 */
async function uploadFileToQFieldCloud(
  projectId: string,
  filename: string,
  content: string,
  contentType: string = 'application/geo+json'
): Promise<{ success: boolean; status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const boundary = `----FormBoundary${Date.now()}`;
    const fileBuffer = Buffer.from(content, 'utf-8');

    // Build multipart form data
    const formParts: Buffer[] = [];

    // File part
    formParts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
    ));
    formParts.push(fileBuffer);
    formParts.push(Buffer.from('\r\n'));

    // End boundary
    formParts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(formParts);

    const url = new URL(`/api/v1/files/${projectId}/${filename}/`, 'https://qfield.fibreflow.app');

    const options: https.RequestOptions = {
      method: 'POST',
      headers: {
        'Authorization': `Token ${QFIELD_API_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      rejectUnauthorized: false,
      timeout: 60000, // 60 second timeout for file upload
    };

    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        resolve({
          success: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          body: responseBody,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('QFieldCloud file upload timeout'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Delete file from QFieldCloud
 */
async function deleteFileFromQFieldCloud(
  projectId: string,
  filename: string
): Promise<{ success: boolean; status: number }> {
  return new Promise((resolve) => {
    const url = new URL(`/api/v1/files/${projectId}/${filename}/`, 'https://qfield.fibreflow.app');

    const options: https.RequestOptions = {
      method: 'DELETE',
      headers: {
        'Authorization': `Token ${QFIELD_API_TOKEN}`,
      },
      rejectUnauthorized: false,
      timeout: 30000,
    };

    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        resolve({
          success: res.statusCode !== undefined && (res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 404),
          status: res.statusCode || 0,
        });
      });
    });

    req.on('error', () => resolve({ success: false, status: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, status: 0 });
    });

    req.end();
  });
}

/**
 * Generate OES Report filename with date: "OES FF DD-MM-YYYY.geojson"
 * Example: "OES FF 28-01-2026.geojson" for Jan 28, 2026
 */
function getOESReportFilename(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `OES FF ${dd}-${mm}-${yyyy}.geojson`;
}

/**
 * Delete existing OES Report file from QFieldCloud
 */
async function deleteExistingOESFile(projectId: string, filename: string): Promise<void> {
  try {
    const result = await deleteFileFromQFieldCloud(projectId, filename);
    if (result.success && result.status !== 404) {
      log.info('OESSync', `Deleted existing OES file from project ${projectId}`);
    }
  } catch (error) {
    log.warn('OESSync', 'Error deleting OES file (may not exist)', error);
  }
}

/**
 * Upload OES Report GeoJSON file to QFieldCloud
 */
async function uploadOESFile(
  projectId: string,
  geojson: GeoJSONFeatureCollection,
  filename: string
): Promise<{ success: boolean; message: string }> {
  const geojsonContent = JSON.stringify(geojson, null, 2);

  log.info('OESSync', `Uploading ${filename} to project ${projectId} (${geojsonContent.length} bytes)`);

  const result = await uploadFileToQFieldCloud(
    projectId,
    filename,
    geojsonContent,
    'application/geo+json'
  );

  if (result.success) {
    return { success: true, message: `Uploaded ${filename}` };
  } else {
    throw new Error(`Upload failed: ${result.status} - ${result.body}`);
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      projectId: specificProjectId,
      reportDate,
      teamFilter,
      statusFilter = 'Active' // Only show active drops by default
    } = req.body;

    // Get target projects: specific one if provided, otherwise all sync-enabled
    const targetProjectIds = await getSyncTargetProjectIds(specificProjectId);

    log.info('OESSync', `Starting OES sync to ${targetProjectIds.length} QField project(s)`, {
      targetProjectIds, reportDate, teamFilter,
    });

    // Step 1: Fetch OES data from database (once for all projects)
    let query = `
      SELECT
        oes.drop_number,
        oes.serial_number,
        oes.activation_date::text,
        oes.team,
        oes.ont_rx_sig_dbm,
        oes.current_ont_rx,
        oes.status,
        oes.latitude,
        oes.longitude
      FROM oes_activations oes
      WHERE oes.latitude IS NOT NULL
        AND oes.longitude IS NOT NULL
        AND oes.latitude != 0
        AND oes.longitude != 0
    `;

    const queryParams: any[] = [];
    let paramIndex = 1;

    if (reportDate) {
      query += ` AND DATE(oes.activation_date) = $${paramIndex}`;
      queryParams.push(reportDate);
      paramIndex++;
    }

    if (teamFilter) {
      query += ` AND oes.team = $${paramIndex}`;
      queryParams.push(teamFilter);
      paramIndex++;
    }

    if (statusFilter && statusFilter !== 'All') {
      query += ` AND oes.status = $${paramIndex}`;
      queryParams.push(statusFilter);
      paramIndex++;
    }

    query += ' ORDER BY oes.drop_number';

    const result = await pool.query(query, queryParams);
    const oesPoints: OESPoint[] = result.rows;

    log.info('OESSync', `Found ${oesPoints.length} OES points with valid coordinates`);

    if (oesPoints.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No OES points found with valid coordinates',
        totalPoints: 0
      });
    }

    // Step 2: Convert to GeoJSON with labels (once for all projects)
    // IMPORTANT: Coordinates must be numbers, not strings (GeoJSON spec requirement)
    const features: GeoJSONFeature[] = oesPoints.map(point => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(point.longitude), Number(point.latitude)] // GeoJSON uses [lon, lat] as NUMBERS
      },
      properties: {
        drop_number: point.drop_number,
        serial_number: point.serial_number,
        activation_date: point.activation_date,
        team: point.team,
        ont_rx_sig_dbm: point.ont_rx_sig_dbm || -40,
        current_ont_rx: point.current_ont_rx || -40,
        status: point.status,
        label: point.drop_number // This is what will be displayed on the map
      }
    }));

    const geojson: GeoJSONFeatureCollection = {
      type: 'FeatureCollection',
      features,
      crs: {
        type: 'name',
        properties: {
          name: 'EPSG:4326'
        }
      }
    };

    log.info('OESSync', `Created GeoJSON with ${features.length} features`);

    // Generate filename with today's date: "OES FF DD-MM-YYYY.geojson"
    const oesFilename = getOESReportFilename();
    log.info('OESSync', `Using filename: ${oesFilename}`);

    // Step 3: Sync to each target project
    const syncResults: { projectId: string; success: boolean; error?: string }[] = [];

    for (const pid of targetProjectIds) {
      try {
        log.info('OESSync', `Syncing to project ${pid}...`);

        // Delete existing OES file (if any)
        await deleteExistingOESFile(pid, oesFilename);

        // Upload new OES GeoJSON file
        await uploadOESFile(pid, geojson, oesFilename);

        // Update last_synced_at in FibreFlow DB
        try {
          await pool.query(
            'UPDATE qfield_projects SET last_synced_at = NOW() WHERE qfield_project_id = $1',
            [pid]
          );
        } catch {
          log.warn('OESSync', `Failed to update last_synced_at for ${pid} (non-critical)`);
        }

        syncResults.push({ projectId: pid, success: true });
        log.info('OESSync', `Successfully synced to project ${pid}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        syncResults.push({ projectId: pid, success: false, error: errorMsg });
        log.error('OESSync', `Failed to sync to project ${pid}`, err);
      }
    }

    const successCount = syncResults.filter(r => r.success).length;
    const failCount = syncResults.filter(r => !r.success).length;

    return res.status(200).json({
      success: successCount > 0,
      message: `OES data synced to ${successCount}/${targetProjectIds.length} QField project(s)${failCount > 0 ? ` (${failCount} failed)` : ''}`,
      totalPoints: features.length,
      syncResults,
      filename: oesFilename,
    });

  } catch (error) {
    log.error('OESSync', 'Sync failed', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync OES data to QFieldCloud'
    });
  }
}
export default withAuth(withRole('admin')(handler));
