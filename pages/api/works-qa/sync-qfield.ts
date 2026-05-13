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

// Civil checklist_step -> slot key (steps 1-7)
const CIVIL_STEP_MAP: Record<number, string> = {
  1: 'civil_01',
  2: 'civil_02',
  3: 'civil_03',
  4: 'civil_04',
  5: 'civil_05',
  6: 'civil_06',
  7: 'civil_07',
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

    // project_id from the client is a FibreFlow project ID. qfield_photo_validations stores
    // QField project IDs; translate via qfield_project_links so we pull every QField project
    // mapped to this FibreFlow project.
    const qResult = await pool.query<QFieldRow>(`
      SELECT q.feature_id, q.photo_key, q.checklist_step, q.work_type, q.vlm_confidence, q.vlm_feedback
      FROM qfield_photo_validations q
      INNER JOIN qfield_project_links l ON l.qfield_project_id = q.project_id
      WHERE l.fibreflow_project_id = $1::uuid
        AND q.feature_type = 'pole'
        ${poleFilter ? poleFilter.replace('feature_id', 'q.feature_id') : ''}
    `, params);

    let synced = 0;
    let skipped = 0;

    for (const row of qResult.rows) {
      const poleLabel = row.feature_id;
      if (!poleLabel) { skipped++; continue; }

      const slotKey = resolveSlotKey(row.checklist_step, row.work_type);
      if (!slotKey) { skipped++; continue; }

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
        // Slot already populated — don't overwrite
        skipped++;
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

    return apiResponse.success(res, { synced, skipped });
  } catch (err) {
    log.error('works-qa/sync-qfield', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.sync', 'create')(handler));
