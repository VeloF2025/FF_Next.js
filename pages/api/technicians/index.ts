/**
 * API Route: /api/technicians
 *
 * Technician Directory - List, Create, Update technicians
 * Uses wa_contacts table to map WhatsApp phone numbers to formal names.
 *
 * GET - List technicians with optional filters and stats
 * POST - Create new technician
 * PUT - Update technician
 *
 * @updated 2026-02-05 - Now uses wa_contacts table
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { log } from '@/lib/logger';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import type { TechnicianSummary, TechnicianType, TechnicianStatus } from '@/types/technician.types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      case 'PUT':
        return handlePut(req, res);
      default:
        return apiResponse.methodNotAllowed(res, ['GET', 'POST', 'PUT']);
    }
  } catch (error) {
    log.error('TechniciansAPI', 'Request failed', { error });
    return apiResponse.serverError(res, 'Internal server error');
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
