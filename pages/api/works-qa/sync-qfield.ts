import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META, getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

const ALLOWED_PHOTO_COLUMNS = new Set(SLOT_META.map(s => s.dbColumn));

interface SyncBody {
  project_id?: string;
  pole_label?: string;
}

// Civil checklist_step -> slot key (steps 1-7).
// Step 8 (Pole Label / pole tag) is also produced for civil/pole_installation jobs.
// Share dome_08 since both disciplines record the same Pole ID photo and there is
// no civil step 8 — without this, pole-tag photos uploaded from the field were
// silently dropped (root cause of MOA.P.A830 missing photos, May 2026).
const CIVIL_STEP_MAP: Record<number, string> = {
  1: 'civil_01',
  2: 'civil_02',
  3: 'civil_03',
  4: 'civil_04',
  5: 'civil_05',
  6: 'civil_06',
  7: 'civil_07',
  8: 'dome_08',
};

// Optical checklist_step -> slot key (steps 1-8 = dome, 11-16 = joint)
const OPTICAL_STEP_MAP: Record<number, string> = {
  1: 'dome_01',
  2: 'dome_02',
  3: 'dome_03',
  4: 'dome_04',
  5: 'dome_05',
  6: 'dome_06',
  7: 'dome_07',
  8: 'dome_08',
  11: 'main_joint_11',
  12: 'main_joint_12',
  13: 'main_joint_13',
  14: 'main_joint_14',
  15: 'main_joint_15',
  16: 'main_joint_16',
};

// Optical work types — anything dome/joint/optical/activation-related
const OPTICAL_WORK_TYPES = new Set(['dome_joint', 'optical', 'activation', 'joint']);

function resolveSlotKey(checklist_step: number | null, work_type: string | null): string | null {
  if (checklist_step === null || checklist_step === undefined) return null;
  const isOptical = work_type ? OPTICAL_WORK_TYPES.has(work_type) : false;
  const slotKey = isOptical
    ? (OPTICAL_STEP_MAP[checklist_step] ?? null)
    : (CIVIL_STEP_MAP[checklist_step] ?? null);
  return slotKey;
}

interface QFieldRow {
  feature_id: string | null;
  photo_key: string;
  checklist_step: number | null;
  work_type: string | null;
  vlm_confidence: number | null;
  vlm_feedback: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { project_id, pole_label } = req.body as SyncBody;
  if (!project_id) return apiResponse.badRequest(res, 'project_id required');

  try {
    // Build query — filter by project_id and feature_type = 'pole'
    const params: (string | null)[] = [project_id];
    let poleFilter = '';
    if (pole_label) {
      params.push(pole_label);
      poleFilter = `AND feature_id = $${params.length}`;
    }

    // project_id from the client is a FibreFlow project ID. qfield_photo_validations.project_id
    // stores the EXTERNAL QField project UUID. Translate it through
    // qfield_projects.qfield_project_id to qfield_projects.id, then join
    // qfield_project_links by qfield_projects.id. The two-hop translation handles both
    // "id == qfield_project_id" rows (most projects) AND aliased rows where
    // qfield_projects.id was historically aliased to the FF project UUID
    // (FT_Etwatwa_POP_2, VT_Tonga, MAM Pole Audit (Offline), Grabouw QA, Grabouw
    // Drill Survey). Without the translation those projects' photos are invisible
    // to this sync — see migration 376 which links them safely now.
    const qResult = await pool.query<QFieldRow>(`
      SELECT q.feature_id, q.photo_key, q.checklist_step, q.work_type, q.vlm_confidence, q.vlm_feedback
      FROM qfield_photo_validations q
      INNER JOIN qfield_projects qp ON qp.qfield_project_id = q.project_id::text
      INNER JOIN qfield_project_links l ON l.qfield_project_id = qp.id
      WHERE l.fibreflow_project_id = $1::uuid
        AND q.feature_type = 'pole'
        ${poleFilter ? poleFilter.replace('feature_id', 'q.feature_id') : ''}
    `, params);

    let synced = 0;
    let skipped = 0;
    let unassigned = 0;

    // Push a photo into the per-pole `unassigned_photo_keys` bucket. Idempotent: only
    // appends if the key isn't already in a slot column, the tray array, or the bucket.
    const pushToUnassigned = async (poleLabel: string, photoKey: string): Promise<void> => {
      // Ensure pole row exists first (sync may hit a pole with no slots yet).
      await pool.query(`
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        SELECT $1::uuid, $2, sp.zone_no, sp.pon_no
        FROM (SELECT 1) one
        LEFT JOIN sow_poles sp ON sp.project_id = $1::uuid AND sp.pole_number = $2
        ON CONFLICT (project_id, pole_label) DO NOTHING
      `, [project_id, poleLabel]);

      // Dedup by logical_path (filename portion after /files/, ignoring qfield
      // project id and version suffix). Otherwise a key under one qfield project
      // and the same photo under another qfield project would both land in the
      // bucket — see migration 373 for the cleanup of the original incident.
      const upd = await pool.query(`
        UPDATE pole_qa_photos qa
        SET unassigned_photo_keys =
              COALESCE(qa.unassigned_photo_keys, '{}'::text[]) || ARRAY[$3::text],
            updated_at = NOW()
        WHERE qa.project_id = $1::uuid
          AND qa.pole_label = $2
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(
              COALESCE(qa.unassigned_photo_keys, '{}'::text[])
              || COALESCE(qa.main_joint_tray_keys,  '{}'::text[])
              || ARRAY[
                qa.civil_step_01_key, qa.civil_step_02_key, qa.civil_step_03_key,
                qa.civil_step_04_key, qa.civil_step_05_key, qa.civil_step_06_key,
                qa.civil_step_07_key,
                qa.optical_dome_01_key, qa.optical_dome_02_key, qa.optical_dome_03_key,
                qa.optical_dome_04_key, qa.optical_dome_05_key, qa.optical_dome_06_key,
                qa.optical_dome_07_key, qa.optical_dome_08_key,
                qa.main_joint_11_key, qa.main_joint_12_key, qa.main_joint_13_key,
                qa.main_joint_14_key, qa.main_joint_15_key, qa.main_joint_16_key
              ]
            ) AS k
            WHERE k IS NOT NULL AND k <> ''
              AND regexp_replace(k, '^.*?/files/(.*?)(/v[0-9]{14}-[a-f0-9]+)?$', '\\1')
                = regexp_replace($3, '^.*?/files/(.*?)(/v[0-9]{14}-[a-f0-9]+)?$', '\\1')
          )
      `, [project_id, poleLabel, photoKey]);
      if ((upd.rowCount ?? 0) > 0) unassigned += 1;
    }

    for (const row of qResult.rows) {
      const poleLabel = row.feature_id;
      if (!poleLabel) { skipped++; continue; }

      const slotKey = resolveSlotKey(row.checklist_step, row.work_type);
      // No slot mapping for this step/work_type combo — surface the photo in
      // the per-pole unassigned bucket so reviewers can place it manually.
      if (!slotKey) {
        await pushToUnassigned(poleLabel, row.photo_key);
        continue;
      }

      const slotMeta = getSlotMeta(slotKey);
      if (!slotMeta) { skipped++; continue; }

      // Upsert the pole row; copy zone/PON from sow_poles by pole_number match so the
      // pole list and PON filter have something to group on.
      await pool.query(`
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        SELECT $1::uuid, $2, sp.zone_no, sp.pon_no
        FROM (SELECT 1) one
        LEFT JOIN sow_poles sp
          ON sp.project_id = $1::uuid
         AND sp.pole_number = $2
        ON CONFLICT (project_id, pole_label) DO UPDATE
        SET zone_no = COALESCE(pole_qa_photos.zone_no, EXCLUDED.zone_no),
            pon_no  = COALESCE(pole_qa_photos.pon_no,  EXCLUDED.pon_no)
      `, [project_id, poleLabel]);

      // Fetch current value of the slot column to check if it's already set
      const colName = slotMeta.dbColumn;
      if (!ALLOWED_PHOTO_COLUMNS.has(colName)) { skipped++; continue; }
      const colCheckResult = await pool.query<{ col_val: string | null }>(
        `SELECT ${colName} AS col_val FROM pole_qa_photos WHERE project_id = $1::uuid AND pole_label = $2`,
        [project_id, poleLabel]
      );

      if (colCheckResult.rows.length === 0) { skipped++; continue; }

      if (colCheckResult.rows[0]!.col_val !== null) {
        // Slot already populated — don't overwrite a manual upload or earlier sync,
        // but keep the extra photo visible in the unassigned bucket so retakes /
        // duplicates aren't silently dropped.
        if (colCheckResult.rows[0]!.col_val !== row.photo_key) {
          await pushToUnassigned(poleLabel, row.photo_key);
        }
        continue;
      }

      // Build VLM result entry
      const confidence = row.vlm_confidence !== null ? Number(row.vlm_confidence) : 0;
      const vlmEntry = JSON.stringify({
        [slotKey]: {
          valid: confidence >= 0.6,
          confidence,
          feedback: row.vlm_feedback ?? 'Synced from QField',
        },
      });

      await pool.query(`
        UPDATE pole_qa_photos
        SET ${colName} = $1,
            vlm_results = vlm_results || $2::jsonb,
            updated_at = NOW()
        WHERE project_id = $3::uuid AND pole_label = $4 AND ${colName} IS NULL
      `, [row.photo_key, vlmEntry, project_id, poleLabel]);

      synced++;
    }

    return apiResponse.success(res, { synced, skipped, unassigned });
  } catch (err) {
    log.error('works-qa/sync-qfield', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.sync', 'create')(handler));
