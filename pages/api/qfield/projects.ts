import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { Pool } from 'pg';
import https from 'https';

// QFieldCloud Database (on dev VPS - has all the projects)
const qfieldPool = new Pool({
  host: '72.61.166.168',
  port: 5433,
  database: 'qfieldcloud_db',
  user: 'qfieldcloud_db_admin',
  password: 'c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753',
  ssl: false,
  connectionTimeoutMillis: 5000,
});

// QFieldCloud API Configuration (for creating projects)
const QFIELD_API_URL = process.env.QFIELD_API_URL || 'https://qfield.fibreflow.app/api/v1';
const QFIELD_API_TOKEN = process.env.QFIELD_API_TOKEN || 'YmFcDD4fNHu5P0j2i2xCn5AVt7JjmSnJOVHntObwCHHlE35nAE0C9LuNF9N0coTk5gNLcUsvYRUb0GH0ZJT2bGcyej5Y3apeVsPS';

// Helper to make QFieldCloud API requests
function qfieldRequest(endpoint: string, method = 'GET', data: any = null): Promise<any> {
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

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // GET - List all projects from QFieldCloud Database
  if (req.method === 'GET') {
    try {
      // Query QFieldCloud database directly (faster than API)
      const result = await qfieldPool.query(`
        SELECT
          id,
          name,
          owner_id,
          created_at
        FROM core_project
        ORDER BY created_at DESC
      `);

      res.status(200).json({
        success: true,
        projects: result.rows,
      });
    } catch (error: any) {
      console.error('Error fetching projects from QFieldCloud DB:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  // POST - Create new project
  else if (req.method === 'POST') {
    try {
      const { name, description } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Project name is required'
        });
      }

      // Create project via QFieldCloud API
      const project = await qfieldRequest('/projects/', 'POST', {
        name: name.trim(),
        description: description?.trim() || `OES Sync - ${name.trim()}`,
        is_public: false,
      });

      res.status(200).json({
        success: true,
        project,
      });
    } catch (error: any) {
      console.error('Error creating project:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

export default withAuth(handler);
