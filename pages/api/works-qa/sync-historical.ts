/**
 * POST /api/works-qa/sync-historical
 *
 * Backfills `pole_qa_photos` from existing `construction_qa_*` data. For each
 * pole in the requested FibreFlow project:
 *   1. Picks the latest photo per (discipline, checklist_step) from
 *      construction_qa_photos joined to construction_qa_reviews.
 *   2. UPSERTs the matching slot column on pole_qa_photos (only fills nulls
 *      so a Works-QA manual upload is never clobbered).
 *   3. Merges the historical VLM result into pole_qa_photos.vlm_results.
 *   4. For any construction_qa_review with workflow_status='approved', sets
 *      the matching discipline approval flag (civil_approved / dome_approved
 *      / joint_approved) and copies qa_decision_at / manual_reviewed_by.
 *
 * Discipline + step → slot mapping follows the slot-keys utility:
 *   civil + 1-7    → civil_step_0{step}_key       / civil_approved
 *   optical + 1-8  → optical_dome_0{step}_key     / dome_approved
 *   optical + 11-16 → main_joint_{step}_key    / joint_approved
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';

const ALLOWED_PHOTO_COLUMNS = new Set(SLOT_META.map(s => s.dbColumn));

interface SyncBody {
  project_id?: string;
}

interface HistoricalRow {
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;
  discipline: 'civil' | 'optical';
  checklist_step: number;
  storage_key: string;
  vlm_valid: boolean | null;
  vlm_confidence: number | null;
  vlm_feedback: string | null;
  source: string;
}

function resolveSlot(discipline: string, step: number): { dbColumn: string; slotKey: string; approveColumn: 'civil_approved' | 'dome_approved' | 'joint_approved' } | null {
  if (discipline === 'civil' && step >= 1 && step <= 7) {
    const s = String(step).padStart(2, '0');
    return { dbColumn: `civil_step_${s}_key`, slotKey: `civil_${s}`, approveColumn: 'civil_approved' };
  }
  if (discipline === 'optical' && step >= 1 && step <= 8) {
    const s = String(step).padStart(2, '0');
    return { dbColumn: `optical_dome_${s}_key`, slotKey: `dome_${s}`, approveColumn: 'dome_approved' };
  }
  if (discipline === 'optical' && step >= 11 && step <= 16) {
    return { dbColumn: `main_joint_${step}_key`, slotKey: `main_joint_${step}`, approveColumn: 'joint_approved' };
  }
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { project_id } = req.body as SyncBody;
  if (!project_id) return apiResponse.badRequest(res, 'project_id required');

  try {
    // 1. Pull the latest photo per (pole_label, discipline, checklist_step)
    const photoResult = await pool.query<HistoricalRow>(`
      SELECT DISTINCT ON (r.feature_id, r.discipline, p.checklist_step)
        r.feature_id AS pole_label,
        r.zone_no,
        r.pon_no,
        r.discipline,
        p.checklist_step,
        p.storage_key,
        p.vlm_valid,
        p.vlm_confidence,
        p.vlm_feedback,
        p.source
      FROM construction_qa_reviews r
      INNER JOIN construction_qa_photos p ON p.review_id = r.id
      WHERE r.project_id = $1::uuid
        AND r.feature_type = 'pole'
        AND r.discipline IN ('civil', 'optical')
        AND p.checklist_step IS NOT NULL
        AND p.storage_key IS NOT NULL
        AND p.upload_status = 'available'
        AND ((r.discipline = 'civil' AND p.checklist_step BETWEEN 1 AND 7)
          OR (r.discipline = 'optical' AND p.checklist_step BETWEEN 1 AND 8)
          OR (r.discipline = 'optical' AND p.checklist_step BETWEEN 11 AND 16))
      ORDER BY r.feature_id, r.discipline, p.checklist_step,
               COALESCE(p.captured_at, p.created_at) DESC
    `, [project_id]);

    let slotsPopulated = 0;
    const polesUpserted = new Set<string>();

    for (const row of photoResult.rows) {
      const slot = resolveSlot(row.discipline, row.checklist_step);
      if (!slot) continue;
      if (!ALLOWED_PHOTO_COLUMNS.has(slot.dbColumn)) continue;

      const vlmEntry = JSON.stringify({
        [slot.slotKey]: {
          valid: row.vlm_valid ?? false,
          confidence: row.vlm_confidence !== null ? Number(row.vlm_confidence) : 0,
          feedback: row.vlm_feedback ?? `Historical photo (${row.source})`,
        },
      });

      // Insert if missing (zone/PON from review or sow_poles fallback)
      await pool.query(`
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        SELECT $1::uuid, $2, COALESCE($3::int, sp.zone_no), COALESCE($4::int, sp.pon_no)
        FROM (SELECT 1) one
        LEFT JOIN sow_poles sp ON sp.project_id = $1::uuid AND sp.pole_number = $2
        ON CONFLICT (project_id, pole_label) DO UPDATE
        SET zone_no = COALESCE(pole_qa_photos.zone_no, EXCLUDED.zone_no),
            pon_no  = COALESCE(pole_qa_photos.pon_no,  EXCLUDED.pon_no)
      `, [project_id, row.pole_label, row.zone_no, row.pon_no]);

      // Fill slot column only if empty (don't clobber manual uploads)
      const update = await pool.query(`
        UPDATE pole_qa_photos
        SET ${slot.dbColumn} = $1,
            vlm_results = vlm_results || $2::jsonb,
            updated_at = NOW()
        WHERE project_id = $3::uuid AND pole_label = $4 AND ${slot.dbColumn} IS NULL
      `, [row.storage_key, vlmEntry, project_id, row.pole_label]);

      if ((update.rowCount ?? 0) > 0) slotsPopulated += 1;
      polesUpserted.add(row.pole_label);
    }

    // 2. Carry approvals forward, one discipline at a time. Running both disciplines
    //    in a single `UPDATE...FROM` is non-deterministic when a pole has both civil
    //    and optical approvals — PostgreSQL picks one join row arbitrarily and the
    //    other discipline's flag silently doesn't update.
    const civilApprovals = await pool.query(`
      UPDATE pole_qa_photos qa
      SET civil_approved = TRUE,
          approved_at    = COALESCE(qa.approved_at, r.qa_decision_at, r.updated_at),
          approved_by    = COALESCE(qa.approved_by, r.qa_decision_by, 'construction-qa-historical'),
          updated_at     = NOW()
      FROM construction_qa_reviews r
      WHERE r.project_id = $1::uuid
        AND r.feature_type = 'pole'
        AND r.discipline = 'civil'
        AND r.workflow_status = 'approved'
        AND qa.project_id = r.project_id
        AND qa.pole_label = r.feature_id
    `, [project_id]);

    const opticalApprovals = await pool.query(`
      UPDATE pole_qa_photos qa
      SET dome_approved  = TRUE,
          joint_approved = TRUE,
          approved_at    = COALESCE(qa.approved_at, r.qa_decision_at, r.updated_at),
          approved_by    = COALESCE(qa.approved_by, r.qa_decision_by, 'construction-qa-historical'),
          updated_at     = NOW()
      FROM construction_qa_reviews r
      WHERE r.project_id = $1::uuid
        AND r.feature_type = 'pole'
        AND r.discipline = 'optical'
        AND r.workflow_status = 'approved'
        AND qa.project_id = r.project_id
        AND qa.pole_label = r.feature_id
    `, [project_id]);

    // 3. Pull historical step-0 photos (Uncategorized / Unrelated) that are
    //    linked to a pole but never got classified — surface them in the
    //    unassigned bucket so Johan can drag them to the right slot.
    const unassignedBackfill = await pool.query(`
      WITH step0_photos AS (
        SELECT r.feature_id AS pole_label, p.storage_key
        FROM construction_qa_reviews r
        INNER JOIN construction_qa_photos p ON p.review_id = r.id
        WHERE r.project_id = $1::uuid
          AND r.feature_type = 'pole'
          AND r.feature_id IS NOT NULL
          AND (p.checklist_step IS NULL OR p.checklist_step = 0)
          AND p.storage_key IS NOT NULL
          AND p.upload_status = 'available'
        GROUP BY r.feature_id, p.storage_key
      )
      UPDATE pole_qa_photos qa
      SET unassigned_photo_keys = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(qa.unassigned_photo_keys || ARRAY(
                SELECT storage_key FROM step0_photos s WHERE s.pole_label = qa.pole_label
              ))
            )
          ),
          updated_at = NOW()
      FROM (SELECT DISTINCT pole_label FROM step0_photos) src
      WHERE qa.project_id = $1::uuid
        AND qa.pole_label = src.pole_label
    `, [project_id]);

    return apiResponse.success(res, {
      poles_touched: polesUpserted.size,
      slots_populated: slotsPopulated,
      poles_unassigned_populated: unassignedBackfill.rowCount ?? 0,
      approvals_carried_forward: (civilApprovals.rowCount ?? 0) + (opticalApprovals.rowCount ?? 0),
    });
  } catch (err) {
    log.error('works-qa/sync-historical', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.sync', 'create')(handler));
