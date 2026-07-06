import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';
import { computePoleSummary, plantedOnlyPoleSummary, type PoleOverviewRow } from '@/modules/works-qa/utils/pole-overview';

// Field-confirmed-planted statuses are every QField civil-audit Status except an
// explicit removal/cancel or a not-yet-planted marker — a planted pole physically
// exists in the field even if its QA photos haven't been captured yet (e.g.
// "Q/A Failed" still means the pole is in the ground). Project GPKGs carry two
// removal spellings ("Pole Removed/Canceled" — Mohadin/Etwatwa/Lawley; and
// "Pole Canceled / Removed" — Mamelodi/Thembisa) plus a pre-plant marker
// ("To be Planted" — Thembisa POP1); all are excluded here. Kept as a deny-list
// rather than an allow-list so a new/unknown Status defaults to "planted" (the
// safe assumption for the funnel: a stray status surfaces as a planted row rather
// than silently vanishing).
const NOT_PLANTED_STATUSES = [
  'Pole Removed/Canceled',
  'Pole Canceled / Removed',
  'To be Planted',
];

// SLOT_META is a trusted in-code constant (no user input), so its column/key
// names are safe to interpolate. Returning a bounded `present_slots` array (≤22
// short keys) instead of the raw jsonb keeps this 30s-polled endpoint light.
const PRESENT_SLOTS_EXPR = `ARRAY_REMOVE(ARRAY[
        ${SLOT_META.map(s => `CASE WHEN ${s.dbColumn} IS NOT NULL THEN '${s.key}' END`).join(',\n        ')}
      ], NULL)`;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id, zone_no, pon_no } = req.query;
  if (!project_id || typeof project_id !== 'string') return apiResponse.badRequest(res, 'project_id required');

  try {
    const params: (string | number)[] = [project_id];
    const filters: string[] = [];

    // Zone → PON scope filters, applied identically to both row sources below.
    // zone_no and pon_no are columns on both pole_qa_photos and poles.
    if (zone_no && typeof zone_no === 'string') {
      if (!/^\d+$/.test(zone_no)) return apiResponse.badRequest(res, 'zone_no must be a number');
      params.push(parseInt(zone_no, 10));
      filters.push(`zone_no = $${params.length}`);
    }
    if (pon_no && typeof pon_no === 'string') {
      const ponNum = parseInt(pon_no, 10);
      if (isNaN(ponNum)) return apiResponse.badRequest(res, 'pon_no must be a number');
      params.push(ponNum);
      filters.push(`pon_no = $${params.length}`);
    }
    const scopeFilter = filters.map(f => `AND ${f}`).join(' ');

    // Two row sources, unioned in JS so the per-slot derivation (computePoleSummary)
    // stays pure and unit-tested:
    //   1. photographed — pole_qa_photos rows (full QA dots/status). Source of truth
    //      for "QA'd"; also covers planted poles whose field_status hasn't synced.
    //   2. planted-only — poles.field_status confirms planted but no pole_qa_photos
    //      row exists yet → surfaces the planted→QA'd gap (Phase 2 funnel).
    // The union is essential: listing planted-only would drop photographed poles
    // that lack a field_status (e.g. projects not yet ingested → empty table).
    const photoQuery = pool.query(`
      SELECT
        id, pole_label, zone_no, pon_no, approved_at, slot_approvals,
        COALESCE(array_length(main_joint_tray_keys, 1), 0) AS tray_count,
        COALESCE(array_length(unassigned_photo_keys, 1), 0) AS unassigned_count,
        ${PRESENT_SLOTS_EXPR} AS present_slots,
        COALESCE(ARRAY(
          SELECT e.key FROM jsonb_each(COALESCE(vlm_results, '{}'::jsonb)) AS e(key, value)
           WHERE (e.value->>'valid')::boolean = false AND e.value->>'overridden_by' IS NULL
        ), '{}'::text[]) AS vlm_fail_keys,
        COALESCE((
          SELECT COUNT(*)::int
            FROM snags s
           WHERE s.pole_qa_photo_id = pole_qa_photos.id
             AND s.source = 'works_qa'
             AND s.status NOT IN ('verified','closed')
        ), 0) AS outstanding_snag_count,
        EXISTS (
          SELECT 1 FROM snags s
          WHERE s.pole_qa_photo_id = pole_qa_photos.id
            AND s.category = 'verification'
            AND s.status = 'open'
        ) AS has_open_verification_snag,
        EXISTS (
          SELECT 1 FROM snags s
          WHERE s.pole_qa_photo_id = pole_qa_photos.id
            AND s.category = 'verification'
            AND s.status = 'verified'
        ) AS has_verified_planted
      FROM pole_qa_photos
      WHERE project_id = $1::uuid ${scopeFilter}
      ORDER BY pon_no ASC NULLS LAST, pole_label ASC
    `, params);

    // Planted poles (field_status) with no QA photos yet. NOT EXISTS against
    // pole_qa_photos keeps the two sets disjoint so the union never double-counts.
    const plantedParams: (string | number | string[])[] = [...params, NOT_PLANTED_STATUSES];
    const plantedQuery = pool.query(`
      SELECT pole_number, zone_no, pon_no, field_status
      FROM poles
      WHERE project_id = $1::uuid ${scopeFilter}
        AND field_status IS NOT NULL
        AND field_status <> ALL($${plantedParams.length}::text[])
        AND NOT EXISTS (
          SELECT 1 FROM pole_qa_photos q
          WHERE q.project_id = poles.project_id
            AND q.pole_label = poles.pole_number
        )
      ORDER BY pon_no ASC NULLS LAST, pole_number ASC
    `, plantedParams);

    const [photoResult, plantedResult] = await Promise.all([photoQuery, plantedQuery]);

    const photographed = photoResult.rows.map(r => computePoleSummary(r as PoleOverviewRow));
    const plantedRows = plantedResult.rows as Array<{
      pole_number: string;
      zone_no: number | null;
      pon_no: number | null;
      field_status: string | null;
    }>;
    const plantedOnly = plantedRows.map(r => plantedOnlyPoleSummary({
      pole_number: r.pole_number,
      zone_no: r.zone_no,
      pon_no: r.pon_no,
      field_status: r.field_status,
    }));

    // pon_no asc (NULLS LAST), then pole_label asc — matches each query's ORDER BY
    // so photographed and planted-only rows interleave predictably.
    const summaries = [...photographed, ...plantedOnly].sort((a, b) => {
      if (a.pon_no !== b.pon_no) {
        if (a.pon_no === null) return 1;
        if (b.pon_no === null) return -1;
        return a.pon_no - b.pon_no;
      }
      return a.pole_label.localeCompare(b.pole_label);
    });
    return apiResponse.success(res, summaries);
  } catch (err) {
    log.error('works-qa/poles', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
