/**
 * API Route: /api/activate/sync-oes-to-qfield
 *
 * Purpose: Sync OES activation data AND remaining drops to QFieldCloud as GeoJSON files
 * Method: POST
 *
 * This endpoint creates TWO layers:
 * 1. OES FF DD-MM-YYYY.geojson - Activated drops (in oes_activations) - ORANGE dots
 * 2. Remaining Drops DD-MM-YYYY.geojson - Unactivated drops (NOT in oes_activations) - GREEN dots
 *
 * Coordinate Source: drops table (Neon DB) - NOT OES/Nokia coordinates
 * This ensures our layers match the manual GPKG imports which also use drops coords.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import https from 'https';
import { createLogger } from '@/lib/logger';

const log = createLogger('OESSync');
import { withAuth, withRole } from '@/lib/auth';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';

// QFieldCloud Configuration
const QFIELD_API_URL = process.env.QFIELD_API_URL || 'https://qfield.fibreflow.app/api/v1';
const QFIELD_API_TOKEN = process.env.QFIELD_API_TOKEN;

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
    log.warn('Failed to query QField projects from DB, using fallback');
  }
  return [FALLBACK_PROJECT_ID];
}

// South Africa bounding box for coordinate validation
const SA_BOUNDS = {
  minLat: -35,
  maxLat: -22,
  minLon: 16,
  maxLon: 33,
};

interface OESPoint {
  drop_number: string;
  serial_number: string;
  activation_date: string;
  team: string;
  ont_rx_sig_dbm: number;
  current_ont_rx: number;
  status: string;
  // Coordinates from drops table (source of truth)
  latitude: number;
  longitude: number;
}

interface RemainingDrop {
  drop_number: string;
  project_name: string | null;
  address: string | null;
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
            log.error('JSON parse error', { error: e instanceof Error ? e.message : String(e) });
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
 * Uses the report_date from the OES import form
 * Example: "OES FF 27-01-2026.geojson" for Jan 27, 2026
 */
function getOESReportFilename(reportDate: Date): string {
  const yyyy = String(reportDate.getFullYear());
  const mm = String(reportDate.getMonth() + 1).padStart(2, '0');
  const dd = String(reportDate.getDate()).padStart(2, '0');
  return `OES FF ${dd}-${mm}-${yyyy}.geojson`;
}

/**
 * Generate Remaining Drops filename with date: "Remaining Drops DD-MM-YYYY.geojson"
 */
function getRemainingDropsFilename(reportDate: Date): string {
  const yyyy = String(reportDate.getFullYear());
  const mm = String(reportDate.getMonth() + 1).padStart(2, '0');
  const dd = String(reportDate.getDate()).padStart(2, '0');
  return `Remaining Drops ${dd}-${mm}-${yyyy}.geojson`;
}

/**
 * Delete existing OES Report file from QFieldCloud
 */
async function deleteExistingOESFile(projectId: string, filename: string): Promise<void> {
  try {
    const result = await deleteFileFromQFieldCloud(projectId, filename);
    if (result.success && result.status !== 404) {
      log.info(`Deleted existing OES file from project ${projectId}`);
    }
  } catch (error) {
    log.warn('Error deleting OES file (may not exist)', { error });
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

  log.info(`Uploading ${filename} to project ${projectId} (${geojsonContent.length} bytes)`);

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
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
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

    log.info(`Starting OES sync to ${targetProjectIds.length} QField project(s)`, {
      targetProjectIds, reportDate, teamFilter,
    });

    // Step 1: Fetch OES data with coordinates from drops table (source of truth)
    // Join to drops table and use its coordinates - this matches the manual GPKG imports
    let query = `
      SELECT
        oes.drop_number,
        oes.serial_number,
        oes.activation_date::text,
        oes.team,
        oes.ont_rx_sig_dbm,
        oes.current_ont_rx,
        oes.status,
        d.latitude,
        d.longitude
      FROM oes_activations oes
      INNER JOIN drops d ON oes.drop_id = d.id
      WHERE d.latitude IS NOT NULL
        AND d.longitude IS NOT NULL
        AND d.latitude != 0
        AND d.longitude != 0
        -- Filter to South Africa bounding box
        AND d.latitude BETWEEN ${SA_BOUNDS.minLat} AND ${SA_BOUNDS.maxLat}
        AND d.longitude BETWEEN ${SA_BOUNDS.minLon} AND ${SA_BOUNDS.maxLon}
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

    log.info(`Found ${oesPoints.length} OES points with valid coordinates from drops table`);

    if (oesPoints.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No OES points found with valid coordinates',
        totalPoints: 0
      });
    }

    // Step 2: Convert to GeoJSON using drops table coordinates
    // IMPORTANT: Coordinates must be numbers, not strings (GeoJSON spec requirement)
    const features: GeoJSONFeature[] = oesPoints.map(point => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [Number(point.longitude), Number(point.latitude)] as [number, number]
      },
      properties: {
        drop_number: point.drop_number,
        serial_number: point.serial_number,
        activation_date: point.activation_date,
        team: point.team,
        ont_rx_sig_dbm: point.ont_rx_sig_dbm || -40,
        current_ont_rx: point.current_ont_rx || -40,
        status: point.status,
        label: point.drop_number
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

    log.info(`Created GeoJSON with ${features.length} features`);

    // Get the report date for the filename
    // Priority: 1) reportDate from request, 2) latest import batch report_date, 3) today
    let filenameDate: Date;
    if (reportDate) {
      filenameDate = new Date(reportDate);
    } else {
      // Get latest report_date from import batches
      const latestBatch = await pool.query(
        'SELECT report_date FROM oes_import_batches ORDER BY imported_at DESC LIMIT 1'
      );
      if (latestBatch.rows[0]?.report_date) {
        filenameDate = new Date(latestBatch.rows[0].report_date);
      } else {
        filenameDate = new Date();
      }
    }

    // Generate filenames with the report date
    const oesFilename = getOESReportFilename(filenameDate);
    const remainingFilename = getRemainingDropsFilename(filenameDate);
    log.info(`Using filenames: ${oesFilename}, ${remainingFilename}`);

    // Step 3: Fetch REMAINING drops (drops NOT in oes_activations)
    const remainingQuery = `
      SELECT
        d.drop_number,
        p.project_name,
        d.address,
        d.latitude,
        d.longitude
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE d.latitude IS NOT NULL
        AND d.longitude IS NOT NULL
        AND d.latitude != 0
        AND d.longitude != 0
        AND d.latitude BETWEEN ${SA_BOUNDS.minLat} AND ${SA_BOUNDS.maxLat}
        AND d.longitude BETWEEN ${SA_BOUNDS.minLon} AND ${SA_BOUNDS.maxLon}
        AND NOT EXISTS (
          SELECT 1 FROM oes_activations oes
          WHERE oes.drop_id = d.id
        )
      ORDER BY d.drop_number
    `;

    const remainingResult = await pool.query(remainingQuery);
    const remainingDrops: RemainingDrop[] = remainingResult.rows;

    log.info(`Found ${remainingDrops.length} remaining (unactivated) drops`);

    // Convert remaining drops to GeoJSON
    const remainingFeatures: GeoJSONFeature[] = remainingDrops.map(drop => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [Number(drop.longitude), Number(drop.latitude)] as [number, number]
      },
      properties: {
        drop_number: drop.drop_number,
        serial_number: '',
        activation_date: '',
        team: drop.project_name || 'Unknown',
        ont_rx_sig_dbm: 0,
        current_ont_rx: 0,
        status: 'Pending',
        label: drop.drop_number
      }
    }));

    const remainingGeojson: GeoJSONFeatureCollection = {
      type: 'FeatureCollection',
      features: remainingFeatures,
      crs: {
        type: 'name',
        properties: {
          name: 'EPSG:4326'
        }
      }
    };

    // Step 4: Sync both files to each target project
    const syncResults: { projectId: string; success: boolean; error?: string }[] = [];

    for (const pid of targetProjectIds) {
      try {
        log.info(`Syncing to project ${pid}...`);

        // Delete existing files (if any)
        await deleteExistingOESFile(pid, oesFilename);
        await deleteExistingOESFile(pid, remainingFilename);

        // Upload OES GeoJSON file (activated drops - orange)
        await uploadOESFile(pid, geojson, oesFilename);

        // Upload Remaining Drops GeoJSON file (unactivated - green)
        await uploadOESFile(pid, remainingGeojson, remainingFilename);

        // Update last_synced_at in FibreFlow DB
        try {
          await pool.query(
            'UPDATE qfield_projects SET last_synced_at = NOW() WHERE qfield_project_id = $1',
            [pid]
          );
        } catch {
          log.warn(`Failed to update last_synced_at for ${pid} (non-critical)`);
        }

        syncResults.push({ projectId: pid, success: true });
        log.info(`Successfully synced to project ${pid}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        syncResults.push({ projectId: pid, success: false, error: errorMsg });
        log.error(`Failed to sync to project ${pid}`, { error: err });
      }
    }

    const successCount = syncResults.filter(r => r.success).length;
    const failCount = syncResults.filter(r => !r.success).length;

    return res.status(200).json({
      success: successCount > 0,
      message: `Synced ${features.length} activated + ${remainingFeatures.length} remaining drops to ${successCount}/${targetProjectIds.length} project(s)`,
      activatedCount: features.length,
      remainingCount: remainingFeatures.length,
      totalPoints: features.length + remainingFeatures.length,
      syncResults,
      files: {
        activated: oesFilename,
        remaining: remainingFilename,
      },
    });

  } catch (error) {
    log.error('Sync failed', { error });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync OES data to QFieldCloud'
    });
  }
}
export default withAuth(withRole('admin')(handler));
