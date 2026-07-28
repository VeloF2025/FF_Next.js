/**
 * H&S Safety Library API
 *
 * GET  /api/health-safety/library - List library entries with review status
 * POST /api/health-safety/library - Create a library entry
 *
 * Filters (GET): content_type, project_id, include_inactive, review_status
 * (current|review_due_soon|review_overdue|no_review). project_id is nullable on
 * the row — NULL means the entry applies company-wide.
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
    log.error('[H&S Safety Library API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { content_type, project_id, review_status, include_inactive } = req.query;

  // Every filter is folded into the WHERE via a NULL-guard so there is one
  // query shape — the Neon shim binds each ${} as a value, never as a SQL
  // fragment, so conditional fragments are not available here.
  const ct = typeof content_type === 'string' ? content_type : null;
  // Pre-validate the uuid filter: without this a malformed id reaches the
  // ${...}::uuid cast and Postgres raises, turning a caller mistake into a 500.
  if (typeof project_id === 'string' && project_id !== '' && !UUID_RE.test(project_id)) {
    return apiResponse.badRequest(res, 'project_id must be a uuid');
  }
  const pid = typeof project_id === 'string' && project_id !== '' ? project_id : null;
  const rs = typeof review_status === 'string' ? review_status : null;
  const includeInactive = include_inactive === 'true';

  const entries = await sql`
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
      -- Serialize pure date columns as plain YYYY-MM-DD text (last-column-wins
      -- over the l.* copies) so node-pg does not parse them into a local-TZ
      -- Date that renders one day early on the SAST server. Display only —
      -- the classification above uses the raw date column.
      l.effective_date::text AS effective_date,
      l.review_date::text AS review_date
    FROM hs_safety_library l
    LEFT JOIN projects p ON p.id = l.project_id
    WHERE (${includeInactive}::boolean IS TRUE OR l.is_active)
      AND (${ct}::text IS NULL OR l.content_type = ${ct}::text)
      AND (${pid}::uuid IS NULL OR l.project_id = ${pid}::uuid)
      AND (
        ${rs}::text IS NULL OR
        CASE
          WHEN l.review_date IS NULL THEN 'no_review'
          WHEN l.review_date < CURRENT_DATE THEN 'review_overdue'
          WHEN l.review_date <= CURRENT_DATE + make_interval(days => ${REVIEW_DUE_SOON_DAYS}) THEN 'review_due_soon'
          ELSE 'current'
        END = ${rs}::text
      )
    ORDER BY l.content_type, l.title
  `;

  const stats = {
    total: entries.length,
    msds: entries.filter((e) => e.content_type === 'msds').length,
    procedures: entries.filter((e) => e.content_type !== 'msds').length,
    review_overdue: entries.filter((e) => e.review_status === 'review_overdue').length,
    review_due_soon: entries.filter((e) => e.review_status === 'review_due_soon').length,
  };

  return apiResponse.success(res, { entries, stats });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const user = getAuthUser(req);
  const userId = user?.id ?? null;
  const {
    title,
    reference,
    version,
    project_id,
    file_url,
    file_name,
    effective_date,
    review_date,
    notes,
    supplier,
    ghs_hazard_class,
    storage_location,
  } = req.body;
  const contentType: SafetyLibraryContentType = req.body.content_type;

  // Normalise BEFORE validating, then bind these same values below. Deriving
  // "is this field empty?" at the guard but binding the raw input at the write
  // is what lets a whitespace-only value slip past the guard and violate the
  // hs_safety_library_chemical_fields_msds_only CHECK as a 500.
  const titleValue = blankToNull(title);
  const effectiveDate = blankToNull(effective_date);
  const reviewDate = blankToNull(review_date);
  const projectId = blankToNull(project_id);
  const fileUrl = blankToNull(file_url);
  const chemical = {
    supplier: blankToNull(supplier),
    ghs_hazard_class: blankToNull(ghs_hazard_class),
    storage_location: blankToNull(storage_location),
  };

  if (!SAFETY_LIBRARY_TYPES[contentType]) {
    return apiResponse.badRequest(
      res,
      `content_type must be one of: ${Object.keys(SAFETY_LIBRARY_TYPES).join(', ')}`
    );
  }
  if (!titleValue) {
    return apiResponse.badRequest(res, 'title is required');
  }
  // Surface each DB CHECK as a 400 rather than letting it become a 500.
  if (reviewDate && effectiveDate && reviewDate < effectiveDate) {
    return apiResponse.badRequest(res, 'review_date cannot be before effective_date');
  }
  if (projectId && !UUID_RE.test(projectId)) {
    return apiResponse.badRequest(res, 'project_id must be a uuid');
  }
  if (fileUrl && !isSafeDocumentUrl(fileUrl)) {
    return apiResponse.badRequest(res, 'file_url must be an http(s) or same-origin link');
  }
  const suppliedChemicalFields = Object.entries(chemical)
    .filter(([, v]) => v !== null)
    .map(([k]) => k);
  if (!SAFETY_LIBRARY_TYPES[contentType].has_chemical_fields && suppliedChemicalFields.length > 0) {
    return apiResponse.badRequest(
      res,
      `${suppliedChemicalFields.join(', ')} apply only to a Safety Data Sheet (content_type "msds")`
    );
  }

  const rows = await sql`
    INSERT INTO hs_safety_library (
      content_type, title, reference, version, project_id,
      file_url, file_name, effective_date, review_date, notes,
      supplier, ghs_hazard_class, storage_location, created_by
    ) VALUES (
      ${contentType},
      ${titleValue},
      ${blankToNull(reference)},
      ${blankToNull(version)},
      ${projectId}::uuid,
      ${fileUrl},
      ${blankToNull(file_name)},
      ${effectiveDate}::date,
      ${reviewDate}::date,
      ${blankToNull(notes)},
      ${chemical.supplier},
      ${chemical.ghs_hazard_class},
      ${chemical.storage_location},
      ${userId}
    )
    RETURNING *, effective_date::text AS effective_date, review_date::text AS review_date
  `;
  const entry = rows[0]!;

  await logHsActivity({
    activityType: 'safety_library_entry_created',
    entityType: 'safety_library',
    entityId: entry.id as string,
    description: `${SAFETY_LIBRARY_TYPES[contentType].label} added: ${entry.title}`,
    metadata: {
      content_type: contentType,
      project_id: project_id || null,
      review_date: entry.review_date,
    },
    user,
  });

  return apiResponse.created(res, entry);
}

export default withHsPermission(handler);
