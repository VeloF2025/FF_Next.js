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

async function handleGet(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { id, type, status, search, includeStats } = req.query;

  // Single technician lookup by ID
  if (id) {
    const result = await pool.query(
      `SELECT
        wc.id,
        COALESCE(wc.formal_name, wc.wa_display_name, wc.sender_phone) as name,
        wc.sender_phone as phone,
        wc.role as type,
        wc.team as contractor,
        CASE WHEN wc.is_active THEN 'active' ELSE 'inactive' END as status,
        wc.projects,
        wc.notes,
        wc.staff_id,
        wc.created_at,
        wc.updated_at
      FROM wa_contacts wc
      WHERE wc.id = $1`,
      [String(id)]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Technician', String(id));
    }

    return apiResponse.success(res, result.rows[0]);
  }

  // Build query for list with optional stats
  let query = `
    SELECT
      wc.id,
      COALESCE(wc.formal_name, wc.wa_display_name, wc.sender_phone) as name,
      wc.sender_phone as phone,
      wc.role as type,
      wc.team as contractor,
      CASE WHEN wc.is_active THEN 'active' ELSE 'inactive' END as status
  `;

  if (includeStats === 'true') {
    query += `,
      COALESCE(stats.total_submissions, 0)::INTEGER as total_submissions,
      COALESCE(stats.first_pass_rate, 0)::INTEGER as first_pass_rate,
      COALESCE(stats.serial_compliance, 0)::INTEGER as serial_compliance_rate,
      stats.last_active::TEXT as last_active_date
    `;
  }

  query += ` FROM wa_contacts wc`;

  if (includeStats === 'true') {
    // Note: qa_photo_reviews uses user_name as the identifier (sender_phone is often empty)
    // wa_contacts.sender_phone stores the user_name value from qa_photo_reviews
    query += `
      LEFT JOIN (
        SELECT
          qpr.user_name as identifier,
          COUNT(*) as total_submissions,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE upr.submission_count = 1) / NULLIF(COUNT(*), 0)
          ) as first_pass_rate,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL) / NULLIF(COUNT(*), 0)
          ) as serial_compliance,
          MAX(qpr.created_at) as last_active
        FROM qa_photo_reviews qpr
        LEFT JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        WHERE qpr.user_name IS NOT NULL
        GROUP BY qpr.user_name
      ) stats ON wc.sender_phone = stats.identifier
    `;
  }

  const conditions: string[] = [];
  const params: (string | boolean)[] = [];
  let paramIndex = 1;

  if (type && type !== 'all') {
    conditions.push(`wc.role = $${paramIndex++}`);
    params.push(String(type));
  }

  if (status && status !== 'all') {
    const isActive = status === 'active';
    conditions.push(`wc.is_active = $${paramIndex++}`);
    params.push(isActive);
  }

  if (search) {
    conditions.push(`(
      wc.formal_name ILIKE $${paramIndex} OR
      wc.wa_display_name ILIKE $${paramIndex} OR
      wc.sender_phone ILIKE $${paramIndex} OR
      wc.team ILIKE $${paramIndex}
    )`);
    params.push(`%${String(search)}%`);
    paramIndex++;
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  if (includeStats === 'true') {
    query += ` ORDER BY COALESCE(stats.total_submissions, 0) DESC, name`;
  } else {
    query += ` ORDER BY name`;
  }

  const result = await pool.query(query, params);

  const technicians: TechnicianSummary[] = result.rows.map(row => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    type: row.type as TechnicianType,
    contractor: row.contractor,
    status: row.status as TechnicianStatus,
    totalSubmissions: row.total_submissions ?? 0,
    firstPassRate: row.first_pass_rate ?? 0,
    serialComplianceRate: row.serial_compliance_rate ?? 0,
    lastActiveDate: row.last_active_date,
  }));

  return apiResponse.success(res, { technicians, total: technicians.length });
}

async function handlePost(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { name, phone, type, contractor, projects, notes } = req.body;

  if (!phone) {
    return apiResponse.badRequest(res, 'phone is required');
  }

  // Check if already exists
  const existing = await pool.query(
    'SELECT id FROM wa_contacts WHERE sender_phone = $1',
    [phone]
  );

  if (existing.rows.length > 0) {
    return apiResponse.conflict(res, 'Technician with this phone already exists');
  }

  const result = await pool.query(
    `INSERT INTO wa_contacts (
      sender_phone, formal_name, role, team, projects, notes, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
    [
      phone,
      name || null,
      type || 'activator',
      contractor || null,
      projects || [],
      notes || null,
      req.user?.username || 'api',
    ]
  );

  log.info('TechniciansAPI', `Created technician: ${name || phone}`, { type, phone });

  return apiResponse.created(res, { id: result.rows[0].id });
}

async function handlePut(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { id, name, type, contractor, projects, status, notes } = req.body;

  if (!id) {
    return apiResponse.badRequest(res, 'id is required');
  }

  const updates: string[] = [];
  const values: (string | boolean | string[] | null)[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`formal_name = $${paramIndex++}`);
    values.push(name);
  }
  if (type !== undefined) {
    updates.push(`role = $${paramIndex++}`);
    values.push(type);
  }
  if (contractor !== undefined) {
    updates.push(`team = $${paramIndex++}`);
    values.push(contractor);
  }
  if (projects !== undefined) {
    updates.push(`projects = $${paramIndex++}`);
    values.push(projects);
  }
  if (status !== undefined) {
    updates.push(`is_active = $${paramIndex++}`);
    values.push(status === 'active');
  }
  if (notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    values.push(notes);
  }

  if (updates.length === 0) {
    return apiResponse.badRequest(res, 'No fields to update');
  }

  updates.push(`updated_by = $${paramIndex++}`);
  values.push(req.user?.username || 'api');

  values.push(id);

  const result = await pool.query(
    `UPDATE wa_contacts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id`,
    values
  );

  if (result.rows.length === 0) {
    return apiResponse.notFound(res, 'Technician', id);
  }

  log.info('TechniciansAPI', `Updated technician: ${id}`, { by: req.user?.username });

  return apiResponse.success(res, { updated: true, id });
}

export default withAuth(handler);
