/**
 * /api/staff/attendance-presets — Pulse · saved Search filters (PRD-061 Phase B).
 *
 * GET                   list current user's presets, newest-edited first.
 * POST   { name, filter, is_default? }              create
 * PATCH  { id, name?, filter?, is_default? }        update (any subset)
 * DELETE { id }                                     delete
 *
 * Per-user isolation (FR-PRESET-05): every operation is scoped by
 * `user_id = $authUser`. Reading or mutating someone else's preset
 * returns 404 — never reveals that a different user's row exists.
 *
 * Default uniqueness (FR-PRESET-06) is enforced by the partial unique
 * index `(user_id) WHERE is_default = true`. Setting a new default is
 * a transactional `UPDATE … is_default=false` + `UPDATE … is_default=true`
 * so the index can never fire.
 *
 * RBAC: write requires `people.staff.attendance.search` (FR-PRESET-07);
 * the same key implicitly covers read since the API key matches the
 * page that consumes it. No new permission key in this PR.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { sql, transaction } from '@/lib/db-pool';

/**
 * On-disk preset shape (persisted form). filter is opaque jsonb on the
 * server — the Search page is responsible for round-tripping it back to
 * its querystring. Versioned so a future shape change can migrate forward.
 */
interface PresetRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  name: string;
  filter_json: unknown;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface PresetDto {
  id: string;
  name: string;
  filter: unknown;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const NAME_MIN = 1;
const NAME_MAX = 60;

/** Currently-supported filter_json schema version. */
const FILTER_SHAPE_VERSION = 1;

function toDto(row: PresetRow): PresetDto {
  return {
    id: row.id,
    name: row.name,
    filter: row.filter_json,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Server-side filter validation — the persisted JSON should always carry
 * a version field. If the client sends one without `v`, we stamp it with
 * the current shape version. We don't validate the inner shape here; the
 * Search page is the single consumer and reapplies its own parser.
 */
function normaliseFilter(filter: unknown): Record<string, unknown> {
  if (!isPlainObject(filter)) {
    throw new ValidationError('filter must be a JSON object');
  }
  const v = typeof filter.v === 'number' ? filter.v : FILTER_SHAPE_VERSION;
  return { ...filter, v };
}

function validateName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new ValidationError('name must be a string');
  }
  const trimmed = raw.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    throw new ValidationError(`name must be between ${NAME_MIN} and ${NAME_MAX} characters`);
  }
  return trimmed;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listPresets(userId: string): Promise<PresetDto[]> {
  const rows = await sql<PresetRow>`
    SELECT id, user_id, name, filter_json, is_default,
           created_at::text AS created_at,
           updated_at::text AS updated_at
    FROM attendance_search_presets
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, updated_at DESC
  `;
  return rows.map(toDto);
}

/**
 * Insert a new preset. If the caller flags is_default, we clear any
 * existing default in the same transaction so the partial unique index
 * never fires. Returns the inserted row.
 */
async function createPreset(
  userId: string,
  name: string,
  filter: Record<string, unknown>,
  isDefault: boolean
): Promise<PresetDto> {
  return transaction(async (txn) => {
    if (isDefault) {
      await txn.query(
        `UPDATE attendance_search_presets
            SET is_default = false, updated_at = NOW()
          WHERE user_id = $1 AND is_default = true`,
        [userId]
      );
    }
    const rows = await txn.query<PresetRow>(
      `INSERT INTO attendance_search_presets (user_id, name, filter_json, is_default)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id, user_id, name, filter_json, is_default,
                 created_at::text AS created_at, updated_at::text AS updated_at`,
      [userId, name, JSON.stringify(filter), isDefault]
    );
    return toDto(rows[0]!);
  });
}

interface UpdateInput {
  id: string;
  name?: string;
  filter?: Record<string, unknown>;
  isDefault?: boolean;
}

/**
 * Update any subset of (name, filter, is_default). All four legs of the
 * "set as default" coin (set true, set false, leave alone, no-op when
 * already default) collapse into the single transactional clear+set
 * pattern. Returns null when the preset is not found OR not owned by
 * the caller — the route translates both to 404 to avoid information
 * leakage about other users' presets.
 */
async function updatePreset(userId: string, input: UpdateInput): Promise<PresetDto | null> {
  return transaction(async (txn) => {
    const ownerRows = await txn.query<{ id: string }>(
      `SELECT id FROM attendance_search_presets WHERE id = $1 AND user_id = $2`,
      [input.id, userId]
    );
    if (ownerRows.length === 0) return null;

    if (input.isDefault === true) {
      await txn.query(
        `UPDATE attendance_search_presets
            SET is_default = false, updated_at = NOW()
          WHERE user_id = $1 AND is_default = true AND id <> $2`,
        [userId, input.id]
      );
    }

    // Build the SET clause from the present fields only — a PATCH that
    // mutates nothing should still bump updated_at so the order in the
    // listing reflects the user's recent activity.
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    if (typeof input.name === 'string') {
      params.push(input.name);
      sets.push(`name = $${params.length}`);
    }
    if (input.filter !== undefined) {
      params.push(JSON.stringify(input.filter));
      sets.push(`filter_json = $${params.length}::jsonb`);
    }
    if (typeof input.isDefault === 'boolean') {
      params.push(input.isDefault);
      sets.push(`is_default = $${params.length}`);
    }
    params.push(input.id);
    params.push(userId);
    const idIdx = params.length - 1;
    const userIdx = params.length;

    const rows = await txn.query<PresetRow>(
      `UPDATE attendance_search_presets
          SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND user_id = $${userIdx}
        RETURNING id, user_id, name, filter_json, is_default,
                  created_at::text AS created_at, updated_at::text AS updated_at`,
      params
    );
    return rows[0] ? toDto(rows[0]) : null;
  });
}

async function deletePreset(userId: string, presetId: string): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    DELETE FROM attendance_search_presets
    WHERE id = ${presetId} AND user_id = ${userId}
    RETURNING id
  `;
  return rows.length > 0;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const user = (req as AuthenticatedNextApiRequest).user;
  if (!user?.id) {
    apiResponse.unauthorized(res);
    return;
  }
  const userId = user.id;

  try {
    if (req.method === 'GET') {
      const presets = await listPresets(userId);
      apiResponse.success(res, { presets });
      return;
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = validateName(body.name);
      const filter = normaliseFilter(body.filter);
      const isDefault = body.is_default === true;
      const created = await createPreset(userId, name, filter, isDefault);
      apiResponse.created(res, { preset: created });
      return;
    }

    if (req.method === 'PATCH') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const id = typeof body.id === 'string' ? body.id : '';
      if (!UUID_RE.test(id)) {
        apiResponse.badRequest(res, 'id must be a UUID');
        return;
      }
      const update: UpdateInput = { id };
      if (body.name !== undefined) update.name = validateName(body.name);
      if (body.filter !== undefined) update.filter = normaliseFilter(body.filter);
      if (typeof body.is_default === 'boolean') update.isDefault = body.is_default;
      const updated = await updatePreset(userId, update);
      if (!updated) {
        apiResponse.notFound(res, 'Preset', id);
        return;
      }
      apiResponse.success(res, { preset: updated });
      return;
    }

    if (req.method === 'DELETE') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const idFromBody = typeof body.id === 'string' ? body.id : '';
      const idFromQuery = typeof req.query.id === 'string' ? req.query.id : '';
      const id = idFromBody || idFromQuery;
      if (!UUID_RE.test(id)) {
        apiResponse.badRequest(res, 'id must be a UUID');
        return;
      }
      const ok = await deletePreset(userId, id);
      if (!ok) {
        apiResponse.notFound(res, 'Preset', id);
        return;
      }
      apiResponse.success(res, { id });
      return;
    }

    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST', 'PATCH', 'DELETE']);
  } catch (err) {
    if (err instanceof ValidationError) {
      apiResponse.badRequest(res, err.message);
      return;
    }
    log.error('[attendance-presets] failed', {
      userId,
      method: req.method,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.search', 'view')(handler)
);
