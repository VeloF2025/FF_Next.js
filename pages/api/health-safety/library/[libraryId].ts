/**
 * H&S Safety Library entry detail API
 *
 * GET    /api/health-safety/library/[libraryId] - Fetch one entry
 * PATCH  /api/health-safety/library/[libraryId] - Update an entry
 * DELETE /api/health-safety/library/[libraryId] - Delete an entry
 *
 * Superseding an entry is a PATCH to is_active = false, which keeps it for the
 * audit trail; DELETE is for genuine mistakes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import {
  REVIEW_DUE_SOON_DAYS,
  SAFETY_LIBRARY_TYPES,
  type SafetyLibraryContentType,
} from '@/modules/health-safety/types/library.types';
import { blankToNull, isSafeDocumentUrl } from '@/modules/health-safety/services/inputNormalize';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { libraryId } = req.query;
  if (!libraryId || typeof libraryId !== 'string') {
    return apiResponse.badRequest(res, 'libraryId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(libraryId, res);
      case 'PATCH':
        return handlePatch(libraryId, req, res);
      case 'DELETE':
        return handleDelete(libraryId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', [
          'GET',
          'PATCH',
          'DELETE',
        ]);
    }
  } catch (error) {
    log.error('[H&S Safety Library Entry API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(libraryId: string, res: NextApiResponse) {
  const [entry] = await sql`
    SELECT
      l.*,
      p.project_name,
      (l.review_date - CURRENT_DATE) AS days_to_review,
      CASE
        WHEN l.review_date IS NULL THEN 'no_review'
        WHEN l.review_date < CURRENT_DATE THEN 'review_overdue'
        WHEN l.review_date <= CURRENT_DATE + make_interval(days => ${REVIEW_DUE_SOON_DAYS}) THEN 'review_due_soon'
        ELSE 'current'
      END AS review_status,
      l.effective_date::text AS effective_date,
      l.review_date::text AS review_date
    FROM hs_safety_library l
    LEFT JOIN projects p ON p.id = l.project_id
    WHERE l.id = ${libraryId}
    LIMIT 1
  `;

  if (!entry) {
    return apiResponse.notFound(res, 'Safety library entry', libraryId);
  }
  return apiResponse.success(res, entry);
}

async function handlePatch(libraryId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);

  // Read-merge-validate-write rather than in-SQL has-key juggling: both
  // invariants worth guarding (review_date vs effective_date, and chemical
  // fields being msds-only) span more than one column, so they can only be
  // checked against the RESULTING row, not against the patch in isolation.
  const [existing] = await sql`
    SELECT *, effective_date::text AS effective_date, review_date::text AS review_date,
           updated_at::text AS updated_at_token
    FROM hs_safety_library WHERE id = ${libraryId} LIMIT 1
  `;
  if (!existing) {
    return apiResponse.notFound(res, 'Safety library entry', libraryId);
  }

  // A field changes only when the caller includes its key; an explicit null
  // clears it. A plain `??` would make it impossible to ever blank a field.
  const has = (k: string) => Object.prototype.hasOwnProperty.call(req.body, k);
  const pick = <T>(k: string, current: T): T => (has(k) ? (req.body[k] ?? null) : current);

  // Every value below is normalised through blankToNull FIRST and then both
  // validated and written in that normalised form. Guarding on a trimmed value
  // while binding the raw one is what lets `supplier: "  "` read as "cleared"
  // at the guard and still reach Postgres as a non-NULL string, violating
  // hs_safety_library_chemical_fields_msds_only as a 500 instead of a 400.
  const text = (k: string, current: unknown) => blankToNull(pick(k, current));

  const contentType = pick<SafetyLibraryContentType>(
    'content_type',
    existing.content_type as SafetyLibraryContentType
  );
  const title = text('title', existing.title);
  const effectiveDate = text('effective_date', existing.effective_date);
  const reviewDate = text('review_date', existing.review_date);
  const projectId = text('project_id', existing.project_id);
  const fileUrl = text('file_url', existing.file_url);
  const chemical = {
    supplier: text('supplier', existing.supplier),
    ghs_hazard_class: text('ghs_hazard_class', existing.ghs_hazard_class),
    storage_location: text('storage_location', existing.storage_location),
  };

  if (!SAFETY_LIBRARY_TYPES[contentType]) {
    return apiResponse.badRequest(
      res,
      `content_type must be one of: ${Object.keys(SAFETY_LIBRARY_TYPES).join(', ')}`
    );
  }
  if (!title) {
    return apiResponse.badRequest(res, 'title cannot be blank');
  }
  if (reviewDate && effectiveDate && reviewDate < effectiveDate) {
    return apiResponse.badRequest(res, 'review_date cannot be before effective_date');
  }
  if (projectId && !UUID_RE.test(projectId)) {
    return apiResponse.badRequest(res, 'project_id must be a uuid');
  }
  if (fileUrl && !isSafeDocumentUrl(fileUrl)) {
    return apiResponse.badRequest(res, 'file_url must be an http(s) or same-origin link');
  }
  // Guards the RESULTING row, so switching an MSDS to a procedure without also
  // clearing the chemical columns is a 400 rather than a DB CHECK 500.
  const retainedChemicalFields = Object.entries(chemical)
    .filter(([, v]) => v !== null)
    .map(([k]) => k);
  if (
    !SAFETY_LIBRARY_TYPES[contentType].has_chemical_fields &&
    retainedChemicalFields.length > 0
  ) {
    return apiResponse.badRequest(
      res,
      `${retainedChemicalFields.join(', ')} apply only to a Safety Data Sheet — clear them before changing the content type`
    );
  }

  // Optimistic concurrency, same guard as medicals/[medicalId].ts: every omitted
  // key is written back from the snapshot read above, so without this two
  // concurrent PATCHes touching different fields would have the later one
  // silently revert the earlier. Compared as ::text because timestamptz carries
  // microseconds and a JS Date only milliseconds.
  const rows = await sql`
    UPDATE hs_safety_library
    SET
      content_type = ${contentType},
      title = ${title},
      reference = ${text('reference', existing.reference)},
      version = ${text('version', existing.version)},
      project_id = ${projectId}::uuid,
      file_url = ${fileUrl},
      file_name = ${text('file_name', existing.file_name)},
      effective_date = ${effectiveDate}::date,
      review_date = ${reviewDate}::date,
      notes = ${text('notes', existing.notes)},
      is_active = ${pick('is_active', existing.is_active)},
      supplier = ${chemical.supplier},
      ghs_hazard_class = ${chemical.ghs_hazard_class},
      storage_location = ${chemical.storage_location},
      updated_at = NOW()
    WHERE id = ${libraryId}
      AND updated_at::text = ${existing.updated_at_token}
    RETURNING *, effective_date::text AS effective_date, review_date::text AS review_date
  `;
  if (rows.length === 0) {
    // Zero rows means the token no longer matches — the row was either edited
    // or deleted since the SELECT above, so the message must cover both.
    return apiResponse.conflict(
      res,
      'This library entry was changed or removed by someone else while you were editing it — reload and reapply your change'
    );
  }
  const entry = rows[0]!;

  await logHsActivity({
    activityType: 'safety_library_entry_updated',
    entityType: 'safety_library',
    entityId: entry.id as string,
    description: `Safety library entry updated: ${entry.title}`,
    metadata: { content_type: entry.content_type, is_active: entry.is_active },
    user,
  });

  return apiResponse.success(res, entry);
}

async function handleDelete(libraryId: string, req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);

  const rows = await sql`
    DELETE FROM hs_safety_library WHERE id = ${libraryId}
    RETURNING id, title, content_type
  `;
  if (rows.length === 0) {
    return apiResponse.notFound(res, 'Safety library entry', libraryId);
  }
  const entry = rows[0]!;

  await logHsActivity({
    activityType: 'safety_library_entry_deleted',
    entityType: 'safety_library',
    entityId: entry.id as string,
    description: `Safety library entry deleted: ${entry.title}`,
    user,
  });

  return apiResponse.success(res, { deleted: true, id: entry.id });
}

export default withHsPermission(handler);
