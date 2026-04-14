/**
 * WhatsApp Contacts API
 * /api/activate/wa-contacts
 *
 * Manages WhatsApp contact mappings for technician reporting
 *
 * Endpoints:
 * - GET /api/activate/wa-contacts - List all contacts
 * - GET /api/activate/wa-contacts?phone={phone} - Get by phone
 * - POST /api/activate/wa-contacts - Create new contact
 * - PUT /api/activate/wa-contacts - Update contact
 * - DELETE /api/activate/wa-contacts?id={id} - Delete contact
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';

const log = createLogger('WAContacts');

export interface WAContact {
  id: string;
  sender_phone: string;
  wa_display_name: string | null;
  formal_name: string | null;
  employee_id: string | null;
  team: string | null;
  role: string;
  projects: string[];
  staff_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined from stats
  submission_count?: number;
  last_submission?: string;
}

interface CreateContactInput {
  sender_phone: string;
  wa_display_name?: string;
  formal_name?: string;
  employee_id?: string;
  team?: string;
  role?: string;
  projects?: string[];
  staff_id?: string;
  is_active?: boolean;
  notes?: string;
}

interface UpdateContactInput extends Partial<CreateContactInput> {
  id: string;
}

async function getContacts(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { phone, team, active, include_stats } = req.query;

  try {
    let query = `
      SELECT
        wc.*,
        s.name as staff_name,
        s.position as staff_position
    `;

    // Optionally include submission stats
    if (include_stats === 'true') {
      query += `,
        COALESCE(stats.submission_count, 0) as submission_count,
        stats.last_submission
      `;
    }

    query += `
      FROM wa_contacts wc
      LEFT JOIN staff s ON wc.staff_id = s.id
    `;

    if (include_stats === 'true') {
      query += `
        LEFT JOIN (
          SELECT
            sender_phone,
            COUNT(*) as submission_count,
            MAX(created_at) as last_submission
          FROM qa_photo_reviews
          GROUP BY sender_phone
        ) stats ON wc.sender_phone = stats.sender_phone
      `;
    }

    const conditions: string[] = [];
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (phone) {
      conditions.push(`wc.sender_phone = $${paramIndex++}`);
      params.push(String(phone));
    }

    if (team) {
      conditions.push(`wc.team = $${paramIndex++}`);
      params.push(String(team));
    }

    if (active !== undefined) {
      conditions.push(`wc.is_active = $${paramIndex++}`);
      params.push(active === 'true');
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY COALESCE(wc.formal_name, wc.wa_display_name, wc.sender_phone)`;

    const result = await pool.query(query, params);

    // If single phone lookup, return single object
    if (phone && result.rows.length === 1) {
      return apiResponse.success(res, result.rows[0]);
    }

    return apiResponse.success(res, {
      contacts: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    log.error('Failed to fetch WA contacts', { error });
    return apiResponse.internalError(res, error,'Failed to fetch contacts');
  }
}

async function createContact(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const input: CreateContactInput = req.body;

  if (!input.sender_phone) {
    return apiResponse.badRequest(res, 'sender_phone is required');
  }

  try {
    // Check if already exists
    const existing = await pool.query(
      'SELECT id FROM wa_contacts WHERE sender_phone = $1',
      [input.sender_phone]
    );

    if (existing.rows.length > 0) {
      return apiResponse.conflict(res, 'Contact with this phone already exists');
    }

    const result = await pool.query(
      `INSERT INTO wa_contacts (
        sender_phone, wa_display_name, formal_name, employee_id,
        team, role, projects, staff_id, is_active, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        input.sender_phone,
        input.wa_display_name || null,
        input.formal_name || null,
        input.employee_id || null,
        input.team || null,
        input.role || 'activator',
        input.projects || [],
        input.staff_id || null,
        input.is_active !== false,
        input.notes || null,
        req.user?.email || 'api',
      ]
    );

    log.info('WA contact created', {
      phone: input.sender_phone,
      by: req.user?.email,
    });

    return apiResponse.created(res, result.rows[0]);
  } catch (error) {
    log.error('Failed to create WA contact', { error, input });
    return apiResponse.internalError(res, error,'Failed to create contact');
  }
}

async function updateContact(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const input: UpdateContactInput = req.body;

  if (!input.id) {
    return apiResponse.badRequest(res, 'id is required for update');
  }

  try {
    // Build dynamic update query
    const updates: string[] = [];
    const values: (string | boolean | string[] | null)[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, string> = {
      wa_display_name: 'wa_display_name',
      formal_name: 'formal_name',
      employee_id: 'employee_id',
      team: 'team',
      role: 'role',
      projects: 'projects',
      staff_id: 'staff_id',
      is_active: 'is_active',
      notes: 'notes',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in input && input[key as keyof UpdateContactInput] !== undefined) {
        updates.push(`${column} = $${paramIndex++}`);
        values.push(input[key as keyof UpdateContactInput] as string | boolean | string[] | null);
      }
    }

    if (updates.length === 0) {
      return apiResponse.badRequest(res, 'No fields to update');
    }

    updates.push(`updated_by = $${paramIndex++}`);
    values.push(req.user?.email || 'api');

    values.push(input.id);

    const result = await pool.query(
      `UPDATE wa_contacts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'WAContact', input.id);
    }

    log.info('WA contact updated', { id: input.id, by: req.user?.email });

    return apiResponse.success(res, result.rows[0]);
  } catch (error) {
    log.error('Failed to update WA contact', { error, input });
    return apiResponse.internalError(res, error,'Failed to update contact');
  }
}

async function deleteContact(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id) {
    return apiResponse.badRequest(res, 'id is required');
  }

  try {
    const result = await pool.query(
      'DELETE FROM wa_contacts WHERE id = $1 RETURNING id, sender_phone',
      [String(id)]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'WAContact', String(id));
    }

    log.info('WA contact deleted', {
      id,
      phone: result.rows[0].sender_phone,
      by: req.user?.email,
    });

    return apiResponse.success(res, { deleted: true, id });
  } catch (error) {
    log.error('Failed to delete WA contact', { error, id });
    return apiResponse.internalError(res, error,'Failed to delete contact');
  }
}

// GET /api/activate/wa-contacts/unmapped - Get phones without mapping
async function getUnmappedPhones(res: NextApiResponse) {
  try {
    const result = await pool.query(`
      SELECT
        qpr.sender_phone,
        qpr.user_name as wa_display_name,
        COUNT(*) as submission_count,
        MAX(qpr.created_at) as last_submission,
        ARRAY_AGG(DISTINCT qpr.project) FILTER (WHERE qpr.project IS NOT NULL) as projects
      FROM qa_photo_reviews qpr
      LEFT JOIN wa_contacts wc ON qpr.sender_phone = wc.sender_phone
      WHERE qpr.sender_phone IS NOT NULL
        AND qpr.sender_phone != ''
        AND wc.id IS NULL
      GROUP BY qpr.sender_phone, qpr.user_name
      ORDER BY submission_count DESC
    `);

    return apiResponse.success(res, {
      unmapped: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    log.error('Failed to fetch unmapped phones', { error });
    return apiResponse.internalError(res, error,'Failed to fetch unmapped phones');
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const authReq = req as AuthenticatedNextApiRequest;
  // Special endpoint for unmapped phones
  if (authReq.query.unmapped === 'true' && authReq.method === 'GET') {
    return getUnmappedPhones(res);
  }

  switch (authReq.method) {
    case 'GET':
      return getContacts(authReq, res);
    case 'POST':
      return createContact(authReq, res);
    case 'PUT':
      return updateContact(authReq, res);
    case 'DELETE':
      return deleteContact(authReq, res);
    default:
      return apiResponse.methodNotAllowed(res, authReq.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE']);
  }
}

export default withAuth(withRole('manager')(handler));
