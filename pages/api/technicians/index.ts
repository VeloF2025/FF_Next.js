/**
 * API Route: /api/technicians
 * 
 * Technician Directory - List, Create, Update technicians
 * These are field technicians (activators/installers), NOT internal staff.
 * 
 * GET - List technicians with optional filters
 * POST - Create new technician
 * 
 * @author Jarvis
 * @date 2026-02-01
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { Technician, TechnicianSummary, TechnicianFilters } from '@/types/technician.types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') ? { rejectUnauthorized: false } : undefined,
});

// Ensure technicians table exists
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS technicians (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      email VARCHAR(255),
      type VARCHAR(20) NOT NULL CHECK (type IN ('activator', 'installer')),
      wa_sender_jid VARCHAR(100),
      wa_group_jid VARCHAR(100),
      onemap_installer_name VARCHAR(255),
      contractor VARCHAR(255),
      projects TEXT[] DEFAULT '{}',
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
      notes TEXT,
      discovered_from VARCHAR(20) CHECK (discovered_from IN ('whatsapp', 'onemap', 'manual')),
      discovered_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_technicians_phone ON technicians(phone);
    CREATE INDEX IF NOT EXISTS idx_technicians_wa_sender_jid ON technicians(wa_sender_jid);
    CREATE INDEX IF NOT EXISTS idx_technicians_type ON technicians(type);
    CREATE INDEX IF NOT EXISTS idx_technicians_status ON technicians(status);
  `);
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    await ensureTable();

    if (req.method === 'GET') {
      return handleGet(req, res);
    } else if (req.method === 'POST') {
      return handlePost(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    log.error('TechniciansAPI', 'Request failed', { error });
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    });
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { type, status, contractor, project, search, includeStats } = req.query;

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];
  let paramIndex = 1;

  if (type && typeof type === 'string') {
    whereClause += ` AND t.type = $${paramIndex++}`;
    params.push(type);
  }

  if (status && typeof status === 'string') {
    whereClause += ` AND t.status = $${paramIndex++}`;
    params.push(status);
  }

  if (contractor && typeof contractor === 'string') {
    whereClause += ` AND t.contractor = $${paramIndex++}`;
    params.push(contractor);
  }

  if (project && typeof project === 'string') {
    whereClause += ` AND $${paramIndex++} = ANY(t.projects)`;
    params.push(project);
  }

  if (search && typeof search === 'string') {
    whereClause += ` AND (t.name ILIKE $${paramIndex} OR t.phone ILIKE $${paramIndex} OR t.contractor ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  // If includeStats is true, join with performance data
  if (includeStats === 'true') {
    const query = `
      WITH tech_stats AS (
        SELECT 
          COALESCE(t.wa_sender_jid, t.phone) as identifier,
          COUNT(DISTINCT qpr.drop_number) as total_submissions,
          COUNT(DISTINCT qpr.drop_number) FILTER (WHERE upr.submission_count = 1) as first_pass,
          COUNT(DISTINCT qpr.drop_number) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as ont_scanned,
          MAX(upr.created_at) as last_active
        FROM technicians t
        LEFT JOIN qa_photo_reviews qpr ON (
          qpr.wa_sender_jid = t.wa_sender_jid 
          OR RIGHT(REGEXP_REPLACE(qpr.sender_phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(t.phone, '[^0-9]', '', 'g'), 10)
        )
        LEFT JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        GROUP BY COALESCE(t.wa_sender_jid, t.phone)
      )
      SELECT 
        t.*,
        COALESCE(ts.total_submissions, 0)::int as total_submissions,
        CASE WHEN ts.total_submissions > 0 
          THEN ROUND((ts.first_pass::numeric / ts.total_submissions) * 100)
          ELSE 0 END as first_pass_rate,
        CASE WHEN ts.total_submissions > 0 
          THEN ROUND((ts.ont_scanned::numeric / ts.total_submissions) * 100)
          ELSE 0 END as serial_compliance_rate,
        ts.last_active::text as last_active_date
      FROM technicians t
      LEFT JOIN tech_stats ts ON ts.identifier = COALESCE(t.wa_sender_jid, t.phone)
      ${whereClause}
      ORDER BY COALESCE(ts.total_submissions, 0) DESC, t.name
    `;
    
    const result = await pool.query(query, params);
    
    const technicians: TechnicianSummary[] = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      type: row.type,
      contractor: row.contractor,
      status: row.status,
      totalSubmissions: row.total_submissions || 0,
      firstPassRate: row.first_pass_rate || 0,
      serialComplianceRate: row.serial_compliance_rate || 0,
      lastActiveDate: row.last_active_date,
    }));
    
    return res.status(200).json({ technicians });
  }

  // Simple list without stats
  const query = `
    SELECT * FROM technicians t
    ${whereClause}
    ORDER BY t.name
  `;
  
  const result = await pool.query(query, params);
  
  return res.status(200).json({ technicians: result.rows });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { name, phone, email, type, waSenderJid, waGroupJid, onemapInstallerName, contractor, projects, notes } = req.body;

  if (!name || !type) {
    return res.status(400).json({ error: 'name and type are required' });
  }

  if (!['activator', 'installer'].includes(type)) {
    return res.status(400).json({ error: 'type must be "activator" or "installer"' });
  }

  const result = await pool.query(
    `INSERT INTO technicians (
      name, phone, email, type, wa_sender_jid, wa_group_jid, 
      onemap_installer_name, contractor, projects, notes, discovered_from
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
    RETURNING *`,
    [name, phone, email, type, waSenderJid, waGroupJid, onemapInstallerName, contractor, projects || [], notes]
  );

  log.info('TechniciansAPI', `Created technician: ${name}`, { type, phone });

  return res.status(201).json({ technician: result.rows[0] });
}

export default withAuth(handler);
