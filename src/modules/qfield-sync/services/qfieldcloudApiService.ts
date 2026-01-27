/**
 * QFieldCloud API Service
 * Handles all interactions with the QFieldCloud API
 */

import https from 'https';
import { Pool } from 'pg';

// QFieldCloud API Configuration
const QFIELD_API_URL = process.env.QFIELD_API_URL || 'https://qfield.fibreflow.app/api/v1';
const QFIELD_API_TOKEN = process.env.QFIELD_API_TOKEN || 'Y0x05qOAhdHfxPgZAZ5FzM8LgOSDlne1OTEyRoO7zQjoxYbhtpTKDHJlsrZ4Q0jJ7I6JMzA3uMn01Q2vMLxB2ox6L6DT4zYxzHj8';

// QFieldCloud Database Direct Access (for faster queries)
const qfieldPool = new Pool({
  host: '100.96.203.105',
  port: 5433,
  database: 'qfieldcloud_db',
  user: 'qfieldcloud_db_admin',
  password: 'c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753',
  ssl: false,
  connectionTimeoutMillis: 5000,
});

// Generic API request helper
export async function qfieldApiRequest(endpoint: string, method = 'GET', data: any = null): Promise<any> {
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
      timeout: 10000,
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
          reject(new Error(`API error: ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Fetch projects from QFieldCloud
 */
export async function getProjects() {
  try {
    // Use database query for faster access
    const result = await qfieldPool.query(`
      SELECT
        id,
        name,
        owner_id,
        created_at,
        updated_at
      FROM core_project
      ORDER BY updated_at DESC
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching projects from QFieldCloud DB:', error);
    // Fallback to API if database fails
    return qfieldApiRequest('/projects/');
  }
}

/**
 * Fetch layers for a specific project
 */
export async function getProjectLayers(projectId: string) {
  try {
    // Try database first for layer information
    const result = await qfieldPool.query(`
      SELECT
        l.id,
        l.name,
        l.datasource,
        l.layer_type,
        l.created_at,
        l.updated_at,
        COUNT(f.id) as feature_count
      FROM core_layer l
      LEFT JOIN core_feature f ON f.layer_id = l.id
      WHERE l.project_id = $1
      GROUP BY l.id, l.name, l.datasource, l.layer_type, l.created_at, l.updated_at
      ORDER BY l.name
    `, [projectId]);

    return result.rows;
  } catch (error) {
    console.error('Error fetching layers from DB:', error);
    // Fallback to API
    return qfieldApiRequest(`/projects/${projectId}/layers/`);
  }
}

/**
 * Fetch features from a specific layer
 */
export async function getLayerFeatures(projectId: string, layerName: string) {
  try {
    // Query features directly from database
    const result = await qfieldPool.query(`
      SELECT
        f.id,
        f.feature_id,
        f.data,
        f.geometry,
        f.created_at,
        f.updated_at,
        l.name as layer_name
      FROM core_feature f
      JOIN core_layer l ON f.layer_id = l.id
      WHERE l.project_id = $1 AND l.name = $2
      ORDER BY f.updated_at DESC
    `, [projectId, layerName]);

    return result.rows;
  } catch (error) {
    console.error('Error fetching features from DB:', error);
    // Fallback to API
    return qfieldApiRequest(`/projects/${projectId}/layers/${layerName}/features/`);
  }
}

/**
 * Fetch poles data from QFieldCloud
 */
export async function getQFieldPoles(projectId?: string) {
  try {
    let query = `
      SELECT
        f.feature_id,
        f.data->>'pole_number' as pole_number,
        f.data->>'pole_id' as pole_id,
        f.data->>'type' as pole_type,
        CAST(f.data->>'height' as FLOAT) as height,
        f.data->>'material' as material,
        f.data->>'status' as status,
        f.data->>'installation_date' as installation_date,
        ST_Y(f.geometry::geometry) as latitude,
        ST_X(f.geometry::geometry) as longitude,
        f.data->>'address' as address,
        f.data->>'notes' as notes,
        f.data->>'photos' as photos,
        f.created_at,
        f.updated_at
      FROM core_feature f
      JOIN core_layer l ON f.layer_id = l.id
      WHERE l.name IN ('poles', 'Poles', 'POLES')
    `;

    const params: any[] = [];
    if (projectId) {
      query += ' AND l.project_id = $1';
      params.push(projectId);
    }

    query += ' ORDER BY f.updated_at DESC LIMIT 500';

    const result = await qfieldPool.query(query, params);

    return result.rows.map(row => ({
      ...row,
      source: 'qfieldcloud',
      image_count: row.photos ? JSON.parse(row.photos).length : 0
    }));
  } catch (error) {
    console.error('Error fetching poles from QFieldCloud:', error);
    throw error;
  }
}

/**
 * Fetch drops data from QFieldCloud
 */
export async function getQFieldDrops(projectId?: string) {
  try {
    let query = `
      SELECT
        f.feature_id,
        f.data->>'drop_number' as drop_number,
        f.data->>'drop_id' as drop_id,
        f.data->>'pole_number' as pole_number,
        f.data->>'address' as address,
        f.data->>'customer_name' as customer_name,
        f.data->>'cable_length' as cable_length,
        f.data->>'installation_date' as installation_date,
        f.data->>'status' as status,
        f.data->>'qc_status' as qc_status,
        f.data->>'notes' as notes,
        f.data->>'photos' as photos,
        ST_Y(f.geometry::geometry) as latitude,
        ST_X(f.geometry::geometry) as longitude,
        f.created_at,
        f.updated_at
      FROM core_feature f
      JOIN core_layer l ON f.layer_id = l.id
      WHERE l.name IN ('drops', 'Drops', 'DROPS', 'service_drops', 'Service Drops')
    `;

    const params: any[] = [];
    if (projectId) {
      query += ' AND l.project_id = $1';
      params.push(projectId);
    }

    query += ' ORDER BY f.updated_at DESC LIMIT 500';

    const result = await qfieldPool.query(query, params);

    return result.rows.map(row => ({
      ...row,
      source: 'qfieldcloud',
      metadata: {
        field_verified: true,
        photos_taken: row.photos ? JSON.parse(row.photos).length : 0,
        gps_captured: row.latitude && row.longitude ? true : false
      }
    }));
  } catch (error) {
    console.error('Error fetching drops from QFieldCloud:', error);
    throw error;
  }
}

/**
 * Fetch fiber cables data from QFieldCloud
 */
export async function getQFieldCables(projectId?: string) {
  try {
    let query = `
      SELECT
        f.feature_id,
        f.data->>'cable_id' as cable_id,
        f.data->>'segment_id' as segment_id,
        f.data->>'cable_type' as cable_type,
        f.data->>'cable_size' as cable_size,
        f.data->>'from_chamber' as from_chamber,
        f.data->>'to_chamber' as to_chamber,
        f.data->>'from_point' as from_point,
        f.data->>'to_point' as to_point,
        CAST(f.data->>'length' as FLOAT) as length_m,
        CAST(f.data->>'distance' as FLOAT) as distance,
        f.data->>'installation_date' as installation_date,
        f.data->>'installation_status' as installation_status,
        f.data->>'status' as status,
        f.data->>'contractor' as contractor,
        ST_AsGeoJSON(f.geometry::geometry) as route_geometry,
        ST_Length(f.geometry::geometry) as calculated_length,
        f.created_at,
        f.updated_at
      FROM core_feature f
      JOIN core_layer l ON f.layer_id = l.id
      WHERE l.name IN ('fiber_cables', 'Fiber Cables', 'FIBER_CABLES', 'fibre_segments', 'Fibre Segments')
    `;

    const params: any[] = [];
    if (projectId) {
      query += ' AND l.project_id = $1';
      params.push(projectId);
    }

    query += ' ORDER BY f.updated_at DESC LIMIT 500';

    const result = await qfieldPool.query(query, params);

    return result.rows.map(row => ({
      cable_id: row.cable_id || row.segment_id,
      cable_type: row.cable_type,
      cable_size: row.cable_size,
      from_chamber: row.from_chamber || row.from_point,
      to_chamber: row.to_chamber || row.to_point,
      length_m: row.length_m || row.distance || row.calculated_length,
      installation_date: row.installation_date,
      installation_status: row.installation_status || row.status,
      contractor: row.contractor,
      route_geometry: row.route_geometry,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source: 'qfieldcloud'
    }));
  } catch (error) {
    console.error('Error fetching cables from QFieldCloud:', error);
    throw error;
  }
}

/**
 * Get sync status between QFieldCloud and FibreFlow
 */
export async function getSyncStatus(projectId?: string) {
  try {
    const [poles, drops, cables] = await Promise.all([
      getQFieldPoles(projectId),
      getQFieldDrops(projectId),
      getQFieldCables(projectId)
    ]);

    return {
      poles: {
        total: poles.length,
        lastSync: poles[0]?.updated_at || null
      },
      drops: {
        total: drops.length,
        lastSync: drops[0]?.updated_at || null
      },
      cables: {
        total: cables.length,
        lastSync: cables[0]?.updated_at || null
      },
      lastFullSync: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error getting sync status:', error);
    throw error;
  }
}

export default {
  getProjects,
  getProjectLayers,
  getLayerFeatures,
  getQFieldPoles,
  getQFieldDrops,
  getQFieldCables,
  getSyncStatus
};