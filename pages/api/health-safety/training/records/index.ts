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
import { blankToNull } from '@/modules/health-safety/services/inputNormalize';
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
      wt.id, wt.training_type_id, wt.staff_id, wt.team_member_id, wt.contractor_id,
      wt.worker_name, wt.project_id, wt.notes,
      wt.created_by, wt.created_at, wt.updated_at,
      wt.verification_status, wt.verified_at, wt.rejection_reason,
      wt.revoked_at, wt.revocation_reason,
      -- Whether a file exists, never where it is: the binary is reachable only
      -- through the permission-checked download route. The legacy free-text
      -- location column is deliberately absent from this projection.
      --
      -- certificate_number and issued_by are absent too. They are the same two
      -- values the staff-document side protects behind
      -- people.staff.training-certificates:view (document_number /
      -- issuing_authority); returning them to every projects.health-safety
      -- reader would gate the identical data two different ways. The design
      -- enumerates what a broad H&S reader may see: worker, competency,
      -- completion and expiry dates, verification and competency status.
      (wt.staff_document_id IS NOT NULL) AS "hasCertificate",
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
      -- Serialize the pure date columns as plain YYYY-MM-DD text so node-pg
      -- does not parse them into a local-TZ Date that renders one day early on
      -- the SAST server. (They used to be last-column-wins overrides of the
      -- star projection; the projection is now explicit, so these are the only
      -- source.) Display only — the classification above uses the raw columns.
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

  // Counted over VERIFIED rows only. Competency status answers "is it in date",
  // which a pending submission can satisfy while counting for nothing — so a
  // headline over every row reads ten unchecked uploads as ten competencies,
  // the exact misreading this feature exists to prevent. The unverified rows
  // are still returned and still rendered, with their own badge.
  const verified = records.filter((r) => r.verification_status === 'verified');
  const stats = {
    total: verified.length,
    current: verified.filter((r) => r.competency_status === 'current').length,
    expiring_soon: verified.filter((r) => r.competency_status === 'expiring_soon').length,
    expired: verified.filter((r) => r.competency_status === 'expired').length,
    awaiting_verification: records.filter((r) => r.verification_status === 'pending').length,
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
  // A contractor worker's certificate with no contractor_id is invisible to
  // the contractor training rollup, so it would never affect the compliance
  // gate that the record exists to drive.
  const normalizedContractorId = blankToNull(contractor_id);
  if (hasTeamMember && !normalizedContractorId) {
    return apiResponse.badRequest(
      res,
      'contractor_id is required for a contractor worker — without it the record cannot reach any compliance gate'
    );
  }
  // Surface an out-of-order date as a 400 rather than letting the DB CHECK
  // (expiry_date >= completed_date) turn it into a 500.
  if (expiry_date && completed_date && String(expiry_date) < String(completed_date)) {
    return apiResponse.badRequest(res, 'expiry_date cannot be before completed_date');
  }

  // Resolve the training type — needed to snapshot statutory flag and to derive
  // expiry from validity_months when the caller does not pass an explicit date.
  const [type] = await sql`
    SELECT id, name, validity_months, requires_certificate
    FROM hs_training_types WHERE id = ${training_type_id} LIMIT 1
  `;
  if (!type) {
    return apiResponse.badRequest(res, 'Unknown training_type_id');
  }

  // A competency that needs a certificate needs the certificate, not a typed
  // claim that one exists. Those go through the upload flow, which stores the
  // file and leaves the record pending until somebody verifies it.
  if (type.requires_certificate) {
    return apiResponse.badRequest(
      res,
      `${type.name} requires a certificate. Upload it at /health-safety/training/certificates/new instead of recording it by hand.`,
      { uploadRoute: '/health-safety/training/certificates/new' }
    );
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
  // No certificate_url column: free-text certificate locations are not accepted
  // any more, and one supplied in the request body is ignored rather than
  // stored. verification_status is 'verified' because a no-certificate record is
  // its own evidence — leaving it pending would mean it counted for nothing and
  // nobody would ever be asked to approve it.
  const rows = await sql`
    INSERT INTO hs_worker_training (
      training_type_id, staff_id, team_member_id, contractor_id,
      worker_name, project_id, completed_date, expiry_date,
      certificate_number, issued_by, notes, created_by, verification_status
    ) VALUES (
      ${training_type_id},
      ${hasStaff ? staff_id : null},
      ${hasTeamMember ? team_member_id : null},
      ${normalizedContractorId},
      ${worker_name},
      ${project_id || null},
      ${completed_date},
      COALESCE(
        ${expiry_date || null}::date,
        CASE WHEN ${type.validity_months ?? null}::int IS NOT NULL
          THEN (${completed_date}::date + make_interval(months => ${type.validity_months ?? 0}))::date
          ELSE NULL END
      ),
      ${certificate_number || null},
      ${issued_by || null},
      ${notes || null},
      ${userId},
      'verified'
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
      contractor_id: normalizedContractorId,
      expiry_date: record.expiry_date,
    },
    user,
  });

  // Keep the contractor gate score fresh the moment training changes.
  if (normalizedContractorId) {
    await computeAndPersistContractorTrainingScore(normalizedContractorId);
  }

  return apiResponse.created(res, record);
}

export default withHsPermission(handler);
