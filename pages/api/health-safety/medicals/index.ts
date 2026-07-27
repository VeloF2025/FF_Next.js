/**
 * H&S Worker Medical Fitness API
 *
 * GET  /api/health-safety/medicals - List medical records with fitness status
 * POST /api/health-safety/medicals - Record a worker Certificate of Fitness
 *
 * Filters (GET): contractor_id, staff_id, team_member_id, project_id, outcome,
 * status (current|expiring_soon|expired), latest_only (true = one row per
 * worker, the same view the compliance gate scores).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import {
  EXPIRING_SOON_DAYS,
  MEDICAL_VALIDITY_MONTHS,
  MEDICAL_OUTCOMES,
  type MedicalOutcome,
} from '@/modules/health-safety/types/medical.types';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    log.error('[H&S Medicals API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { contractor_id, staff_id, team_member_id, project_id, status, outcome, latest_only } =
    req.query;

  // Every filter is folded into the WHERE via a NULL-guard so there is exactly
  // one query shape — the Neon shim binds each ${} as a value, never as a SQL
  // fragment, so conditional fragments are not an option here.
  // Pre-validate the uuid filters: without this a malformed id reaches the
  // ${...}::uuid cast and Postgres raises, turning a caller mistake into a 500.
  const uuidFilters = { contractor_id, staff_id, team_member_id, project_id };
  for (const [name, value] of Object.entries(uuidFilters)) {
    if (typeof value === 'string' && value !== '' && !UUID_RE.test(value)) {
      return apiResponse.badRequest(res, `${name} must be a uuid`);
    }
  }
  const asUuid = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  const cid = asUuid(contractor_id);
  const sid = asUuid(staff_id);
  const tmid = asUuid(team_member_id);
  const pid = asUuid(project_id);
  const st = typeof status === 'string' ? status : null;
  const oc = typeof outcome === 'string' ? outcome : null;
  // `latest_only` collapses superseded certificates to one row per worker — the
  // exact view the compliance gate scores. Ranking every row and filtering on
  // the flag keeps this a single query shape (the Neon shim cannot take a
  // conditional SQL fragment) and lets the list mark superseded rows for free.
  const latestOnly = latest_only === 'true';

  const records = await sql`
    WITH ranked AS (
      SELECT
        m.*,
        -- Partitioned by (contractor, worker), NOT by worker alone, so that
        -- ?contractor_id=X&latest_only=true returns exactly the rows the gate
        -- scores for X (medicalService applies DISTINCT ON per worker AFTER
        -- filtering to the contractor). Ranking globally would let a
        -- certificate submitted under a different contractor mark X's own
        -- current certificate as superseded, and the list would then disagree
        -- with the gate panel. Backed by hs_worker_medicals_worker_latest_idx.
        ROW_NUMBER() OVER (
          PARTITION BY m.contractor_id, COALESCE(m.staff_id, m.team_member_id)
          ORDER BY m.exam_date DESC, m.created_at DESC
        ) = 1 AS is_latest
      FROM hs_worker_medicals m
    )
    SELECT
      wm.*,
      (wm.expiry_date - CURRENT_DATE) AS days_to_expiry,
      CASE
        WHEN wm.expiry_date IS NULL THEN 'current'
        WHEN wm.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN wm.expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS}) THEN 'expiring_soon'
        ELSE 'current'
      END AS medical_status,
      -- Serialize pure date columns as plain YYYY-MM-DD text (last-column-wins
      -- over the wm.* copies) so node-pg does not parse them into a local-TZ
      -- Date that renders one day early on the SAST server. Display only —
      -- the classification/arithmetic above uses the raw date columns.
      wm.exam_date::text AS exam_date,
      wm.expiry_date::text AS expiry_date
    FROM ranked wm
    WHERE (${latestOnly}::boolean IS NOT TRUE OR wm.is_latest)
      AND (${cid}::uuid IS NULL OR wm.contractor_id = ${cid}::uuid)
      AND (${sid}::uuid IS NULL OR wm.staff_id = ${sid}::uuid)
      AND (${tmid}::uuid IS NULL OR wm.team_member_id = ${tmid}::uuid)
      AND (${pid}::uuid IS NULL OR wm.project_id = ${pid}::uuid)
      AND (${oc}::text IS NULL OR wm.outcome = ${oc}::text)
      AND (
        ${st}::text IS NULL OR
        CASE
          WHEN wm.expiry_date IS NULL THEN 'current'
          WHEN wm.expiry_date < CURRENT_DATE THEN 'expired'
          WHEN wm.expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS}) THEN 'expiring_soon'
          ELSE 'current'
        END = ${st}::text
      )
    ORDER BY wm.expiry_date ASC NULLS LAST, wm.exam_date DESC
  `;

  const stats = {
    total: records.length,
    current: records.filter((r) => r.medical_status === 'current').length,
    expiring_soon: records.filter((r) => r.medical_status === 'expiring_soon').length,
    expired: records.filter((r) => r.medical_status === 'expired').length,
    unfit: records.filter((r) => r.outcome === 'unfit').length,
    restricted: records.filter((r) => r.outcome === 'fit_with_restriction').length,
  };

  return apiResponse.success(res, { records, stats });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const userId = user?.id ?? null;
  const {
    staff_id,
    team_member_id,
    contractor_id,
    project_id,
    exam_date,
    expiry_date,
    restrictions,
    practitioner,
    practice_number,
    certificate_number,
    certificate_url,
    notes,
  } = req.body;
  let { worker_name } = req.body;
  const outcome: MedicalOutcome = req.body.outcome || 'fit';

  if (!exam_date) {
    return apiResponse.badRequest(res, 'exam_date is required');
  }
  if (!MEDICAL_OUTCOMES[outcome]) {
    return apiResponse.badRequest(
      res,
      `outcome must be one of: ${Object.keys(MEDICAL_OUTCOMES).join(', ')}`
    );
  }
  const hasStaff = typeof staff_id === 'string' && staff_id.length > 0;
  const hasTeamMember = typeof team_member_id === 'string' && team_member_id.length > 0;
  if (hasStaff === hasTeamMember) {
    return apiResponse.badRequest(res, 'Exactly one of staff_id or team_member_id is required');
  }
  // Surface each DB CHECK as a 400 rather than letting it become a 500.
  if (expiry_date && String(expiry_date) < String(exam_date)) {
    return apiResponse.badRequest(res, 'expiry_date cannot be before exam_date');
  }
  if (outcome === 'fit_with_restriction' && !String(restrictions ?? '').trim()) {
    return apiResponse.badRequest(
      res,
      'restrictions must be stated when outcome is fit_with_restriction'
    );
  }

  // Derive worker_name from the source record if the caller did not supply one.
  if (!worker_name) {
    if (hasStaff) {
      const [s] = await sql`SELECT first_name, last_name FROM staff WHERE id = ${staff_id} LIMIT 1`;
      if (!s) return apiResponse.badRequest(res, 'Unknown staff_id');
      worker_name = `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim();
    } else {
      const [m] =
        await sql`SELECT first_name, last_name FROM team_members WHERE id = ${team_member_id} LIMIT 1`;
      if (!m) return apiResponse.badRequest(res, 'Unknown team_member_id');
      worker_name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim();
    }
  }
  if (!worker_name) {
    return apiResponse.badRequest(res, 'worker_name could not be resolved — provide it explicitly');
  }

  // Explicit expiry wins; otherwise derive the standard 12-month COF validity in
  // SQL (date math server-side avoids client TZ drift).
  const rows = await sql`
    INSERT INTO hs_worker_medicals (
      staff_id, team_member_id, contractor_id, worker_name, project_id,
      exam_date, expiry_date, outcome, restrictions, practitioner,
      practice_number, certificate_number, certificate_url, notes, created_by
    ) VALUES (
      ${hasStaff ? staff_id : null},
      ${hasTeamMember ? team_member_id : null},
      ${contractor_id || null},
      ${worker_name},
      ${project_id || null},
      ${exam_date},
      COALESCE(
        ${expiry_date || null}::date,
        (${exam_date}::date + make_interval(months => ${MEDICAL_VALIDITY_MONTHS}))::date
      ),
      ${outcome},
      ${restrictions || null},
      ${practitioner || null},
      ${practice_number || null},
      ${certificate_number || null},
      ${certificate_url || null},
      ${notes || null},
      ${userId}
    )
    RETURNING *, exam_date::text AS exam_date, expiry_date::text AS expiry_date
  `;
  const record = rows[0]!;

  await logHsActivity({
    activityType: 'worker_medical_recorded',
    entityType: 'worker_medical',
    entityId: record.id as string,
    description: `Medical fitness recorded: ${MEDICAL_OUTCOMES[outcome].label} for ${worker_name}`,
    metadata: {
      contractor_id: contractor_id || null,
      outcome,
      expiry_date: record.expiry_date,
    },
    user,
  });

  return apiResponse.created(res, record);
}

export default withHsPermission(handler);
