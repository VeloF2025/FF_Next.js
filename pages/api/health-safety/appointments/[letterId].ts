/**
 * H&S Appointment Letter detail API
 *
 * GET    /api/health-safety/appointments/[letterId] - Full letter (incl. signature image)
 * PATCH  /api/health-safety/appointments/[letterId] - Edit (while draft) or SIGN (drawn)
 * DELETE /api/health-safety/appointments/[letterId] - Delete a letter
 *
 * Signing captures the DRAWN signature image (client-drawn mark) plus the §4.5
 * audit metadata (signed_at/by/ip), all derived server-side, and locks the
 * letter to 'signed'. A signed letter's fields can no longer be edited.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { captureESignature } from '@/modules/health-safety/services/esignature';

const sql = neon(process.env.DATABASE_URL!);

// A drawn signature is a PNG data URL. Cap it so a client cannot post megabytes
// into a row; a legitimate signature canvas is well under this.
const MAX_SIGNATURE_BYTES = 500_000;
const DATA_URL_RE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

function validSignatureImage(value: unknown): value is string {
  return typeof value === 'string' && DATA_URL_RE.test(value) && value.length <= MAX_SIGNATURE_BYTES;
}

const EDITABLE_FIELDS = ['appointer_name', 'appointer_designation', 'appointee_name', 'appointee_designation', 'scope', 'appointment_date', 'effective_from', 'notes'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { letterId } = req.query;
  if (!letterId || typeof letterId !== 'string') {
    return apiResponse.badRequest(res, 'letterId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(letterId, res);
      case 'PATCH':
        return handlePatch(letterId, req, res);
      case 'DELETE':
        return handleDelete(letterId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
    }
  } catch (error) {
    log.error('[H&S Appointment Detail API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(letterId: string, res: NextApiResponse) {
  const [letter] = await sql`
    SELECT l.*, p.project_name, c.company_name AS contractor_name
    FROM hs_appointment_letters l
    LEFT JOIN projects p ON p.id = l.project_id
    LEFT JOIN contractors c ON c.id = l.contractor_id
    WHERE l.id = ${letterId}
  `;
  if (!letter) {
    return apiResponse.notFound(res, 'Appointment letter', letterId);
  }
  return apiResponse.success(res, { letter });
}

async function handlePatch(letterId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const [letter] = await sql`SELECT id, status, reference_number FROM hs_appointment_letters WHERE id = ${letterId}`;
  if (!letter) {
    return apiResponse.notFound(res, 'Appointment letter', letterId);
  }

  const { signature_image, signature_name } = req.body;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);
  const isSigning = has('signature_image');

  // A signed letter is a finished legal record — no field edits, no re-sign.
  // 409 (conflict with current state), not 400 (the request itself is well-formed).
  if (letter.status === 'signed') {
    return apiResponse.conflict(res, 'A signed appointment letter cannot be modified — delete and re-issue if needed');
  }

  if (isSigning) {
    if (!validSignatureImage(signature_image)) {
      return apiResponse.badRequest(res, 'signature_image must be a PNG data URL under 500KB');
    }
    // Drawn mark is client-supplied; the audit metadata is server-derived.
    const sig = captureESignature(req, typeof signature_name === 'string' ? signature_name : '', user, new Date());
    const rows = await sql`
      UPDATE hs_appointment_letters
      SET status = 'signed', signature_image = ${signature_image},
          signature_name = ${sig.signature_name || null}, signed_at = ${sig.signed_at}::timestamptz,
          signed_by = ${sig.signed_by}, signed_ip = ${sig.signed_ip}, updated_at = NOW()
      WHERE id = ${letterId}
      RETURNING id, reference_number, status
    `;
    await logHsActivity({
      activityType: 'appointment_letter_signed',
      entityType: 'appointment_letter',
      entityId: letterId,
      description: `Appointment letter signed: ${letter.reference_number}`,
      user,
    });
    return apiResponse.success(res, rows[0]);
  }

  // Plain field edit (draft only).
  const { appointer_name, appointer_designation, appointee_name, appointee_designation, scope, appointment_date, effective_from, notes } = req.body;
  if (has('appointee_name') && (typeof appointee_name !== 'string' || !appointee_name.trim())) {
    return apiResponse.badRequest(res, 'appointee_name cannot be empty');
  }
  const touched = EDITABLE_FIELDS.some((f) => has(f));
  if (!touched) {
    return apiResponse.badRequest(res, 'No editable fields supplied');
  }

  const rows = await sql`
    UPDATE hs_appointment_letters
    SET
      appointer_name = CASE WHEN ${has('appointer_name')} THEN ${appointer_name ?? null} ELSE appointer_name END,
      appointer_designation = CASE WHEN ${has('appointer_designation')} THEN ${appointer_designation ?? null} ELSE appointer_designation END,
      appointee_name = COALESCE(${has('appointee_name') && typeof appointee_name === 'string' ? appointee_name.trim() : null}, appointee_name),
      appointee_designation = CASE WHEN ${has('appointee_designation')} THEN ${appointee_designation ?? null} ELSE appointee_designation END,
      scope = CASE WHEN ${has('scope')} THEN ${scope ?? null} ELSE scope END,
      appointment_date = CASE WHEN ${has('appointment_date')} THEN ${appointment_date || null}::date ELSE appointment_date END,
      effective_from = CASE WHEN ${has('effective_from')} THEN ${effective_from || null}::date ELSE effective_from END,
      notes = CASE WHEN ${has('notes')} THEN ${notes ?? null} ELSE notes END,
      updated_at = NOW()
    WHERE id = ${letterId}
    RETURNING *
  `;

  await logHsActivity({
    activityType: 'appointment_letter_updated',
    entityType: 'appointment_letter',
    entityId: letterId,
    description: `Appointment letter updated: ${letter.reference_number}`,
    user,
  });

  return apiResponse.success(res, rows[0]);
}

async function handleDelete(letterId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  // Deleting is deliberately the correction path for a signed letter (a signed
  // letter can't be edited — the PATCH lock message points here to re-issue).
  // The activity log records whether a signed statutory record was removed so
  // the deletion of a legal artefact is always auditable.
  const rows = await sql`DELETE FROM hs_appointment_letters WHERE id = ${letterId} RETURNING id, reference_number, (status = 'signed') AS was_signed`;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Appointment letter', letterId);
  }
  await logHsActivity({
    activityType: 'appointment_letter_deleted',
    entityType: 'appointment_letter',
    entityId: letterId,
    description: `Appointment letter deleted: ${rows[0]!.reference_number}${rows[0]!.was_signed ? ' (was signed)' : ''}`,
    metadata: { was_signed: rows[0]!.was_signed === true },
    user,
  });
  return apiResponse.success(res, { deleted: true, id: letterId });
}

export default withAuth(handler);
