/**
 * API Route: /api/activate/sync-oes-to-qfield
 *
 * Purpose: Sync OES activation data to QFieldCloud as a labeled point layer
 * Method: POST
 *
 * This endpoint:
 * 1. Fetches OES data from database
 * 2. Converts to GeoJSON with drop number labels
 * 3. Uploads to QFieldCloud as "OES Report" layer
 * 4. Points appear on map with DR numbers visible
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';

import https from 'https';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';

// Configure Neon transport based on NEON_USE_HTTP env var
const useHttpTransport = process.env.NEON_USE_HTTP === 'true';

if (!useHttpTransport) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    neonConfig.webSocketConstructor = ws;
  } catch {
    // ws not available, will use HTTP
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

// QFieldCloud Configuration
const QFIELD_API_URL = process.env.QFIELD_API_URL || 'https://qfield.fibreflow.app/api/v1';
const QFIELD_API_TOKEN = process.env.QFIELD_API_TOKEN || 'YmFcDD4fNHu5P0j2i2xCn5AVt7JjmSnJOVHntObwCHHlE35nAE0C9LuNF9N0coTk5gNLcUsvYRUb0GH0ZJT2bGcyej5Y3apeVsPS';

// Default project ID - OES_Project_Progress (updated Jan 2026)
const DEFAULT_PROJECT_ID = 'ad3b1035-ddb3-42a3-8077-175f9400b38a';

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
 * Delete existing OES Report layer
 */
async function deleteExistingLayer(projectId: string): Promise<void> {
  try {
    // Get existing layers
    const layers = await qfieldApiRequest(`/projects/${projectId}/layers/`);

    // Find OES Report layer
    const oesLayer = layers.find((l: any) =>
      l.name === 'OES Report' || l.name === 'oes_report' || l.name.includes('OES')
    );

    if (oesLayer) {
      log.info('OESSync', `Deleting existing OES layer: ${oesLayer.name}`);
      await qfieldApiRequest(
        `/projects/${projectId}/layers/${oesLayer.id}/`,
        'DELETE'
      );
    }
  } catch (error) {
    log.warn('OESSync', 'No existing OES layer to delete', error);
  }
}

/**
 * Create and upload OES Report layer to QFieldCloud
 */
async function uploadOESLayer(
  projectId: string,
  geojson: GeoJSONFeatureCollection
): Promise<any> {
  try {
    // Create layer with GeoJSON data
    const layerData = {
      name: 'OES Report',
      datasource: 'oes_report.geojson',
      layer_type: 'vector',
      geometry_type: 'Point',
      crs: 'EPSG:4326',
      style: {
        // Style configuration for labels
        label: {
          enabled: true,
          field: 'label', // Use the label field for display
          size: 10,
          color: '#000000',
          halo: true,
          halo_color: '#FFFFFF',
          halo_size: 1
        },
        symbol: {
          type: 'simple',
          color: '#FF0000',
          size: 6,
          outline_color: '#000000',
          outline_width: 1
        }
      },
      data: geojson
    };

    // Upload layer
    const result = await qfieldApiRequest(
      `/projects/${projectId}/layers/`,
      'POST',
      layerData
    );

    return result;
  } catch (error) {
    throw new Error(`Failed to upload OES layer: ${error}`);
  }
}

/**
 * Alternative: Upload as GeoPackage (more robust)
 */
async function uploadAsGeoPackage(
  projectId: string,
  features: OESPoint[]
): Promise<void> {
  // This would require creating a GeoPackage file
  // Using ogr2ogr or similar tool
  // For now, we'll use GeoJSON approach above
  log.info('OESSync', 'GeoPackage upload not yet implemented, using GeoJSON');
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
      projectId = DEFAULT_PROJECT_ID,
      reportDate,
      teamFilter,
      statusFilter = 'Active' // Only show active drops by default
    } = req.body;

    log.info('OESSync', 'Starting OES to QFieldCloud sync', { projectId, reportDate, teamFilter });

    // Step 1: Fetch OES data from database
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

    // Step 2: Convert to GeoJSON with labels
    const features: GeoJSONFeature[] = oesPoints.map(point => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [point.longitude, point.latitude] // GeoJSON uses [lon, lat]
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

    // Step 3: Delete existing OES layer (if any)
    await deleteExistingLayer(projectId);

    // Step 4: Upload new OES layer to QFieldCloud
    const uploadResult = await uploadOESLayer(projectId, geojson);

    log.info('OESSync', 'Successfully uploaded OES layer to QFieldCloud', uploadResult);

    // Step 5: Trigger project sync (optional - ensures mobile devices get update)
    try {
      await qfieldApiRequest(
        `/projects/${projectId}/sync/`,
        'POST'
      );
      log.info('OESSync', 'Triggered project sync');
    } catch (syncError) {
      log.warn('OESSync', 'Project sync trigger failed (non-critical)', syncError);
    }

    return res.status(200).json({
      success: true,
      message: 'OES data successfully synced to QFieldCloud',
      totalPoints: features.length,
      projectId,
      layerName: 'OES Report',
      uploadResult
    });

  } catch (error) {
    log.error('OESSync', 'Sync failed', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync OES data to QFieldCloud'
    });
  }
}
export default withAuth(withRole('admin')(handler));
