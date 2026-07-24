/**
 * H&S Appointment Letters API
 *
 * GET  /api/health-safety/appointments - List letters (filters: project_id,
 *      contractor_id, letter_type)
 * POST /api/health-safety/appointments - Create a draft appointment letter
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { letterTypeDef } from '@/modules/health-safety/types/appointment.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('[H&S Appointments API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
  const contractorId = typeof req.query.contractor_id === 'string' ? req.query.contractor_id : null;
  const letterType = typeof req.query.letter_type === 'string' ? req.query.letter_type : null;

  // signature_image (a large data URL) is excluded from the list for weight —
  // signed status is surfaced via a boolean instead.
  const letters = await sql`
    SELECT
      l.id, l.letter_type, l.reference_number, l.project_id, l.contractor_id,
      l.appointer_name, l.appointee_name, l.appointee_designation, l.appointment_date,
      l.effective_from, l.status, l.signature_name, l.signed_at,
      (l.signature_image IS NOT NULL) AS has_signature,
      p.project_name, c.company_name AS contractor_name
    FROM hs_appointment_letters l
    LEFT JOIN projects p ON p.id = l.project_id
    LEFT JOIN contractors c ON c.id = l.contractor_id
    WHERE (${projectId}::uuid IS NULL OR l.project_id = ${projectId}::uuid)
      AND (${contractorId}::uuid IS NULL OR l.contractor_id = ${contractorId}::uuid)
      AND (${letterType}::text IS NULL OR l.letter_type = ${letterType}::text)
    ORDER BY l.created_at DESC
  `;

  return apiResponse.success(res, { letters });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const {
    letter_type, project_id, contractor_id, appointer_name, appointer_designation,
    appointee_name, appointee_designation, scope, appointment_date, effective_from, notes,
  } = req.body;

  const typeDef = letterTypeDef(letter_type);
  if (!typeDef) {
    return apiResponse.badRequest(res, 'A valid letter_type is required');
  }
  if (!appointee_name || typeof appointee_name !== 'string' || !appointee_name.trim()) {
    return apiResponse.badRequest(res, 'appointee_name is required');
  }

  // Human-readable reference: APPT-YYYYMMDD-NNN (MAX+1, delete-safe).
  const now = new Date();
  const ymd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  const prefix = `APPT-${ymd}-`;
  const seqRows = await sql`
    SELECT COALESCE(MAX((split_part(reference_number, '-', 3))::int), 0) + 1 AS next_seq
    FROM hs_appointment_letters WHERE reference_number LIKE ${prefix + '%'}
  `;
  const reference = `${prefix}${String(Number(seqRows[0]?.next_seq ?? 1)).padStart(3, '0')}`;

  const rows = await sql`
    INSERT INTO hs_appointment_letters (
      letter_type, reference_number, project_id, contractor_id,
      appointer_name, appointer_designation, appointee_name, appointee_designation,
      scope, appointment_date, effective_from, status, notes, created_by
    ) VALUES (
      ${letter_type}, ${reference}, ${project_id || null}, ${contractor_id || null},
      ${appointer_name || null}, ${appointer_designation || null}, ${appointee_name.trim()}, ${appointee_designation || null},
      ${scope || typeDef.defaultScope}, ${appointment_date || null}, ${effective_from || null}, 'draft', ${notes || null}, ${user?.id ?? null}
    )
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'appointment_letter_created',
    entityType: 'appointment_letter',
    entityId: rows[0]!.id as string,
    description: `Appointment letter drafted: ${reference} (${typeDef.label}) for ${appointee_name.trim()}`,
    metadata: { letter_type, project_id: project_id || null },
    user,
  });

  return apiResponse.created(res, rows[0]);
}

export default withAuth(handler);
