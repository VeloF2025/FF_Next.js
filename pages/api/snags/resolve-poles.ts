/**
 * Pole Resolution API
 *
 * GET  /api/snags/resolve-poles?projectId=X&poleRef=PH258B
 *   — Search poles by numeric suffix extracted from a TQR pole reference.
 *   — Returns up to 20 candidate poles for manual selection.
 *
 * POST /api/snags/resolve-poles
 *   — Body: { snag_id, pole_id }
 *   — Manually link a snag to a specific pole.
 *   — Updates snag.pole_ids, zone_id, pon_id from the pole record.
 *
 * Strategy: TQR refs (PH258B, CO4) → extract numeric → ILIKE match in poles table.
 * WORKING: Numeric suffix extraction + ILIKE search against poles table.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { PoleCandidate, Snag } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// Numeric suffix extractor
// ============================================================

/**
 * Extract the leading numeric portion from a TQR pole reference.
 * Examples: 'PH258B' → '258', 'CO4' → '4', 'ETW123' → '123'.
 * Returns null if no digits found.
 */
function extractNumeric(poleRef: string): string | null {
  const match = poleRef.match(/\d+/);
  return match ? match[0] : null;
}

// ============================================================
// Handler
// ============================================================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      return await handleGet(req, res);
    }
    if (req.method === 'POST') {
      return await handlePost(req, res);
    }
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET', 'POST']);
  } catch (error) {
    log.error('ResolvePoles: handler error', { error });
    return apiResponse.internalError(res, error);
  }
}

// ============================================================
// GET — search pole candidates for a TQR reference
// ============================================================

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { projectId, poleRef } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'projectId is required');
  }
  if (!poleRef || typeof poleRef !== 'string') {
    return apiResponse.badRequest(res, 'poleRef is required');
  }

  const numeric = extractNumeric(poleRef.trim());
  if (!numeric) {
    // Reference has no digits — cannot resolve automatically
    log.info('ResolvePoles: no numeric part in poleRef', { poleRef });
    return apiResponse.success(res, [] as PoleCandidate[]);
  }

  const pattern = `%${numeric}%`;

  const rows = await sql`
    SELECT id, pole_number, zone_no, pon_no
    FROM poles
    WHERE project_id = ${projectId}
      AND pole_number ILIKE ${pattern}
    ORDER BY pole_number
    LIMIT 20
  ` as PoleCandidate[];

  log.info('ResolvePoles: search complete', {
    poleRef,
    numeric,
    candidates: rows.length,
  });

  return apiResponse.success(res, rows);
}

// ============================================================
// POST — manually link a snag to a specific pole
// ============================================================

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as { snag_id?: string; pole_id?: string };

  if (!body.snag_id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snag_id is required');
  }
  if (!body.pole_id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'pole_id is required');
  }

  // Fetch the target pole
  const poleRows = await sql`
    SELECT id, zone_id, pon_id, zone_no, pon_no
    FROM poles
    WHERE id = ${body.pole_id}
  ` as Array<{ id: string; zone_id: string | null; pon_id: string | null; zone_no: number | null; pon_no: number | null }>;

  if (poleRows.length === 0) {
    return apiResponse.notFound(res, 'Pole', body.pole_id);
  }
  const pole = poleRows[0]!;

  // Verify snag exists
  const snagCheck = await sql`
    SELECT id FROM snags WHERE id = ${body.snag_id}
  ` as Array<{ id: string }>;

  if (snagCheck.length === 0) {
    return apiResponse.notFound(res, 'Snag', body.snag_id);
  }

  // Update snag with resolved pole data
  const updatedRows = await sql`
    UPDATE snags
    SET
      pole_ids  = ARRAY[${body.pole_id}::uuid],
      zone_id   = ${pole.zone_id},
      pon_id    = ${pole.pon_id},
      updated_at = NOW()
    WHERE id = ${body.snag_id}
    RETURNING *
  ` as Snag[];

  if (!updatedRows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to link snag to pole');
  }

  log.info('ResolvePoles: snag linked to pole', {
    snagId: body.snag_id,
    poleId: body.pole_id,
    zoneId: pole.zone_id,
    ponId: pole.pon_id,
  });

  return apiResponse.success(res, updatedRows[0]);
}

export default withAuth(handler);
