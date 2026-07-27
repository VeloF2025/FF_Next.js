/**
 * H&S Worker Medical Fitness detail API
 *
 * GET    /api/health-safety/medicals/[medicalId] - Fetch one record
 * PATCH  /api/health-safety/medicals/[medicalId] - Update a record
 * DELETE /api/health-safety/medicals/[medicalId] - Delete a record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import {
  EXPIRING_SOON_DAYS,
  MEDICAL_OUTCOMES,
  type MedicalOutcome,
} from '@/modules/health-safety/types/medical.types';
import { blankToNull } from '@/modules/health-safety/services/inputNormalize';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { medicalId } = req.query;
  if (!medicalId || typeof medicalId !== 'string') {
    return apiResponse.badRequest(res, 'medicalId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(medicalId, res);
      case 'PATCH':
        return handlePatch(medicalId, req, res);
      case 'DELETE':
        return handleDelete(medicalId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', [
          'GET',
          'PATCH',
          'DELETE',
        ]);
    }
  } catch (error) {
    log.error('[H&S Medical Record API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(medicalId: string, res: NextApiResponse) {
  const [record] = await sql`
    SELECT
      wm.*,
      (wm.expiry_date - CURRENT_DATE) AS days_to_expiry,
      CASE
        WHEN wm.expiry_date IS NULL THEN 'current'
        WHEN wm.expiry_date < CURRENT_DATE THEN 'expired'
        WHEN wm.expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS}) THEN 'expiring_soon'
        ELSE 'current'
      END AS medical_status,
      wm.exam_date::text AS exam_date,
      wm.expiry_date::text AS expiry_date
    FROM hs_worker_medicals wm
    WHERE wm.id = ${medicalId}
    LIMIT 1
  `;

  if (!record) {
    return apiResponse.notFound(res, 'Medical record', medicalId);
  }
  return apiResponse.success(res, record);
}

async function handlePatch(medicalId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);

  // Read-merge-validate-write rather than in-SQL has-key juggling: the
  // outcome/restrictions invariant (a "fit with restriction" verdict must state
  // the restriction) spans two columns, so it can only be checked against the
  // RESULTING row, not against the patch in isolation.
  const [existing] = await sql`
    SELECT *, exam_date::text AS exam_date, expiry_date::text AS expiry_date,
           updated_at::text AS updated_at_token
    FROM hs_worker_medicals WHERE id = ${medicalId} LIMIT 1
  `;
  if (!existing) {
    return apiResponse.notFound(res, 'Medical record', medicalId);
  }

  // A field changes only when the caller includes its key; an explicit null
  // clears it. A plain `??` would make it impossible to ever blank a field.
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);
  const pick = <T>(k: string, current: T): T => (has(k) ? (req.body[k] ?? null) : current);

  // exam_date is NOT NULL in the schema, so unlike every other field here an
  // explicit null cannot mean "clear it" — reject it rather than silently
  // falling back to the existing value and reporting success.
  if (has('exam_date') && !req.body.exam_date) {
    return apiResponse.badRequest(res, 'exam_date cannot be cleared');
  }
  // Normalised before use and bound in that same form: an empty string reaching
  // `${...}::date` or `${...}::uuid` is a Postgres cast error, i.e. a 500 where
  // the caller should have seen the field simply cleared.
  const examDate = String(pick('exam_date', existing.exam_date)).trim();
  const expiryDate = blankToNull(pick('expiry_date', existing.expiry_date));
  const projectId = blankToNull(pick('project_id', existing.project_id));
  const outcome = pick<MedicalOutcome>('outcome', existing.outcome as MedicalOutcome);
  const restrictions = blankToNull(pick('restrictions', existing.restrictions));

  if (!MEDICAL_OUTCOMES[outcome]) {
    return apiResponse.badRequest(
      res,
      `outcome must be one of: ${Object.keys(MEDICAL_OUTCOMES).join(', ')}`
    );
  }
  if (expiryDate && String(expiryDate) < examDate) {
    return apiResponse.badRequest(res, 'expiry_date cannot be before exam_date');
  }
  if (outcome === 'fit_with_restriction' && !String(restrictions ?? '').trim()) {
    return apiResponse.badRequest(
      res,
      'restrictions must be stated when outcome is fit_with_restriction'
    );
  }

  // Optimistic concurrency. Every omitted key is written back from the snapshot
  // read above, so without this guard two concurrent PATCHes that each touch a
  // different field would have the later one silently revert the earlier one.
  // Comparing updated_at::text (not the Date) keeps the round-trip lossless —
  // timestamptz has microsecond precision, a JS Date only milliseconds.
  const rows = await sql`
    UPDATE hs_worker_medicals
    SET
      exam_date = ${examDate}::date,
      expiry_date = ${expiryDate}::date,
      outcome = ${outcome},
      restrictions = ${restrictions},
      practitioner = ${blankToNull(pick('practitioner', existing.practitioner))},
      practice_number = ${blankToNull(pick('practice_number', existing.practice_number))},
      certificate_number = ${blankToNull(pick('certificate_number', existing.certificate_number))},
      certificate_url = ${blankToNull(pick('certificate_url', existing.certificate_url))},
      project_id = ${projectId}::uuid,
      notes = ${pick('notes', existing.notes)},
      updated_at = NOW()
    WHERE id = ${medicalId}
      AND updated_at::text = ${existing.updated_at_token}
    RETURNING *, exam_date::text AS exam_date, expiry_date::text AS expiry_date
  `;
  if (rows.length === 0) {
    // Zero rows means the token no longer matches — the row was either edited
    // or deleted since the SELECT above, so the message must cover both.
    return apiResponse.conflict(
      res,
      'This medical record was changed or removed by someone else while you were editing it — reload and reapply your change'
    );
  }
  const record = rows[0]!;

  await logHsActivity({
    activityType: 'worker_medical_updated',
    entityType: 'worker_medical',
    entityId: record.id as string,
    description: `Medical record updated for ${record.worker_name}`,
    metadata: { outcome: record.outcome, expiry_date: record.expiry_date },
    user,
  });

  return apiResponse.success(res, record);
}

async function handleDelete(medicalId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);

  const rows = await sql`
    DELETE FROM hs_worker_medicals WHERE id = ${medicalId}
    RETURNING id, worker_name, contractor_id
  `;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Medical record', medicalId);
  }
  const record = rows[0]!;

  await logHsActivity({
    activityType: 'worker_medical_deleted',
    entityType: 'worker_medical',
    entityId: record.id as string,
    description: `Medical record deleted for ${record.worker_name}`,
    user,
  });

  return apiResponse.success(res, { deleted: true, id: record.id });
}

export default withHsPermission(handler);
