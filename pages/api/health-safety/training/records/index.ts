/**
 * H&S Worker Training Records API
 *
 * GET  /api/health-safety/training/records - List worker training with competency status
 * POST /api/health-safety/training/records - Create a worker training record
 *
 * Filters (GET): contractor_id, staff_id, team_member_id, project_id, status
 * (current|expiring_soon|expired). A worker is EITHER staff or a team member.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { computeAndPersistContractorTrainingScore } from '@/modules/health-safety/services/trainingService';
import { EXPIRING_SOON_DAYS } from '@/modules/health-safety/types/training.types';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

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
    log.error('[H&S Training Records API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { contractor_id, staff_id, team_member_id, project_id, status } = req.query;

  // Single query with all filters folded into the WHERE via NULL-guards, so we
  // avoid a combinatorial explosion of explicit branches while staying clear of
  // conditional SQL fragments (each ${} is a bound value, never a fragment).
  const cid = typeof contractor_id === 'string' ? contractor_id : null;
  const sid = typeof staff_id === 'string' ? staff_id : null;
  const tmid = typeof team_member_id === 'string' ? team_member_id : null;
  const pid = typeof project_id === 'string' ? project_id : null;
  const st = typeof status === 'string' ? status : null;

  const records = await sql`
    SELECT
      wt.*,
      tt.code AS training_code,
      tt.name AS training_name,
      tt.is_statutory,
      (wt.expiry_date - CURRENT_DATE) AS days_to_expiry,
      CASE
        WHEN wt.expiry_date IS NULL THEN 'current'
        WHEN wt.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN wt.expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS}) THEN 'expiring_soon'
        ELSE 'current'
      END AS competency_status,
      -- Serialize pure date columns as plain YYYY-MM-DD text (last-column-wins
      -- over the wt.* copies) so node-pg does not parse them into a local-TZ
      -- Date that renders one day early on the SAST server. Display only —
      -- the classification/arithmetic above uses the raw date columns.
      wt.completed_date::text AS completed_date,
      wt.expiry_date::text AS expiry_date
    FROM hs_worker_training wt
    JOIN hs_training_types tt ON tt.id = wt.training_type_id
    WHERE (${cid}::uuid IS NULL OR wt.contractor_id = ${cid}::uuid)
      AND (${sid}::uuid IS NULL OR wt.staff_id = ${sid}::uuid)
      AND (${tmid}::uuid IS NULL OR wt.team_member_id = ${tmid}::uuid)
      AND (${pid}::uuid IS NULL OR wt.project_id = ${pid}::uuid)
      AND (
        ${st}::text IS NULL OR
        CASE
          WHEN wt.expiry_date IS NULL THEN 'current'
          WHEN wt.expiry_date < CURRENT_DATE THEN 'expired'
          WHEN wt.expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS}) THEN 'expiring_soon'
          ELSE 'current'
        END = ${st}::text
      )
    ORDER BY wt.expiry_date ASC NULLS LAST, wt.completed_date DESC
  `;

  const stats = {
    total: records.length,
    current: records.filter((r) => r.competency_status === 'current').length,
    expiring_soon: records.filter((r) => r.competency_status === 'expiring_soon').length,
    expired: records.filter((r) => r.competency_status === 'expired').length,
  };

  return apiResponse.success(res, { records, stats });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const userId = user?.id ?? null;
  const {
    training_type_id,
    staff_id,
    team_member_id,
    contractor_id,
    project_id,
    completed_date,
    expiry_date,
    certificate_url,
    certificate_number,
    issued_by,
    notes,
  } = req.body;
  let { worker_name } = req.body;

  if (!training_type_id || !completed_date) {
    return apiResponse.badRequest(res, 'training_type_id and completed_date are required');
  }
  const hasStaff = typeof staff_id === 'string' && staff_id.length > 0;
  const hasTeamMember = typeof team_member_id === 'string' && team_member_id.length > 0;
  if (hasStaff === hasTeamMember) {
    return apiResponse.badRequest(res, 'Exactly one of staff_id or team_member_id is required');
  }
  // Surface an out-of-order date as a 400 rather than letting the DB CHECK
  // (expiry_date >= completed_date) turn it into a 500.
  if (expiry_date && completed_date && String(expiry_date) < String(completed_date)) {
    return apiResponse.badRequest(res, 'expiry_date cannot be before completed_date');
  }

  // Resolve the training type — needed to snapshot statutory flag and to derive
  // expiry from validity_months when the caller does not pass an explicit date.
  const [type] = await sql`
    SELECT id, name, validity_months FROM hs_training_types WHERE id = ${training_type_id} LIMIT 1
  `;
  if (!type) {
    return apiResponse.badRequest(res, 'Unknown training_type_id');
  }

  // Derive worker_name from the source record if the caller did not supply one.
  if (!worker_name) {
    if (hasStaff) {
      const [s] = await sql`SELECT first_name, last_name FROM staff WHERE id = ${staff_id} LIMIT 1`;
      if (!s) return apiResponse.badRequest(res, 'Unknown staff_id');
      worker_name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
    } else {
      const [m] = await sql`SELECT first_name, last_name FROM team_members WHERE id = ${team_member_id} LIMIT 1`;
      if (!m) return apiResponse.badRequest(res, 'Unknown team_member_id');
      worker_name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim();
    }
  }
  if (!worker_name) {
    return apiResponse.badRequest(res, 'worker_name could not be resolved — provide it explicitly');
  }

  // Explicit expiry wins; otherwise derive it in SQL from the type's validity
  // cadence (date math server-side avoids client TZ drift); a type with no
  // validity_months yields NULL = competency never expires.
  const rows = await sql`
    INSERT INTO hs_worker_training (
      training_type_id, staff_id, team_member_id, contractor_id,
      worker_name, project_id, completed_date, expiry_date,
      certificate_url, certificate_number, issued_by, notes, created_by
    ) VALUES (
      ${training_type_id},
      ${hasStaff ? staff_id : null},
      ${hasTeamMember ? team_member_id : null},
      ${contractor_id || null},
      ${worker_name},
      ${project_id || null},
      ${completed_date},
      COALESCE(
        ${expiry_date || null}::date,
        CASE WHEN ${type.validity_months ?? null}::int IS NOT NULL
          THEN (${completed_date}::date + make_interval(months => ${type.validity_months ?? 0}))::date
          ELSE NULL END
      ),
      ${certificate_url || null},
      ${certificate_number || null},
      ${issued_by || null},
      ${notes || null},
      ${userId}
    )
    RETURNING *, completed_date::text AS completed_date, expiry_date::text AS expiry_date
  `;
  const record = rows[0]!;

  await logHsActivity({
    activityType: 'worker_training_recorded',
    entityType: 'worker_training',
    entityId: record.id as string,
    description: `Training recorded: ${type.name} for ${worker_name}`,
    metadata: {
      training_type_id,
      contractor_id: contractor_id || null,
      expiry_date: record.expiry_date,
    },
    user,
  });

  // Keep the contractor gate score fresh the moment training changes.
  if (contractor_id) {
    await computeAndPersistContractorTrainingScore(contractor_id);
  }

  return apiResponse.created(res, record);
}

export default withHsPermission(handler);
