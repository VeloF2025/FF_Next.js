/**
 * Works-QA ⇄ QField sync core.
 *
 * Pulls ingested QField photo validations (`qfield_photo_validations`) into the
 * Works-QA pole table (`pole_qa_photos`), mapping each photo's checklist_step +
 * work_type to a slot column. Extracted from `pages/api/works-qa/sync-qfield.ts`
 * so the same logic backs BOTH the RBAC-protected endpoint AND the headless CLI
 * (`scripts/works-qa-sync.ts`) that the ingest cron runs — see the design spec
 * docs/superpowers/specs/2026-07-14-worksqa-qfield-ingest-automation-design.md.
 *
 * The pool is injected (pg.Pool) so the endpoint passes `@/lib/db` and the CLI
 * passes its own pool. Behaviour is unchanged from the original endpoint.
 */
import type { Pool } from 'pg';
import { log } from '@/lib/logger';
import { SLOT_META, getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

const ALLOWED_PHOTO_COLUMNS = new Set(SLOT_META.map((s) => s.dbColumn));

// Civil checklist_step -> slot key (steps 1-8). Step 8 (Pole Label) maps to its
// own civil slot (civil_08, migration 388).
const CIVIL_STEP_MAP: Record<number, string> = {
  1: 'civil_01',
  2: 'civil_02',
  3: 'civil_03',
  4: 'civil_04',
  5: 'civil_05',
  6: 'civil_06',
  7: 'civil_07',
  8: 'civil_08',
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

export function resolveSlotKey(checklist_step: number | null, work_type: string | null): string | null {
  if (checklist_step === null || checklist_step === undefined) return null;
  const isOptical = work_type ? OPTICAL_WORK_TYPES.has(work_type) : false;
  const slotKey = isOptical
    ? (OPTICAL_STEP_MAP[checklist_step] ?? null)
    : (CIVIL_STEP_MAP[checklist_step] ?? null);
  return slotKey;
}

// Resolve the pole label an optical ('joint') validation belongs to. Optical rows
// are keyed one of two ways depending on the project:
//   1. Dome/splice label — "MAM.STS.16.DIS.DM.P.A352-C2P11.L5" belongs to pole
//      "MAM.P.A352". The discipline segment varies (STS distribution / AGG
//      aggregation / FTS feeder), so we match ".DM.P.<pole>" generically rather
//      than hard-coding ".STS.". Dome-on-manhole labels ".DM.MH.<x>" have no pole
//      and stay null (Works QA is pole-centric).
//   2. Pole label directly — Lawley/Mohadin key optical rows by "LAW.P.B078" with
//      no dome wrapper; pass those straight through.
// Returns null when neither shape matches (corrupt / placeholder labels).
const DOME_LABEL_RE = /^(\w+)\..*?\.DM\.P\.([A-Za-z0-9]+)/;
const POLE_LABEL_RE = /^(\w+\.P\.[A-Za-z0-9]+)/;
export function domeLabelToPole(label: string | null): string | null {
  if (!label) return null;
  const m = DOME_LABEL_RE.exec(label);
  if (m) return `${m[1]}.P.${m[2]}`;
  const p = POLE_LABEL_RE.exec(label);
  return p ? p[1]! : null;
}

interface QFieldRow {
  feature_id: string | null;
  feature_type: 'pole' | 'joint' | null;
  photo_key: string;
  checklist_step: number | null;
  work_type: string | null;
  vlm_confidence: number | null;
  vlm_feedback: string | null;
}

export interface SyncQfieldResult {
  synced: number;
  skipped: number;
  unassigned: number;
  unmappedDomeLabels: number;
}

/**
 * Sync one FibreFlow project's QField photo validations into pole_qa_photos.
 *
 * @param pool       pg.Pool (endpoint passes @/lib/db; CLI passes its own).
 * @param projectId  FibreFlow project UUID.
 * @param poleLabel  Optional single-pole filter (resolved pole label, not dome label).
 */
export async function syncQfieldForProject(
  pool: Pool,
  projectId: string,
  poleLabel?: string | null,
): Promise<SyncQfieldResult> {
  // poleLabel filter is applied in-process (loop below), not in SQL: optical
  // ('joint') rows are keyed by dome label, so a SQL `feature_id = poleLabel` would
  // drop ALL optical photos for the pole. Two-hop join translates the EXTERNAL
  // QField UUID (q.project_id) → qfield_projects.id → the FF project, which handles
  // both id==qfield_project_id rows and aliased rows (Etwatwa/Tonga/HT_ audits/…);
  // without it those projects' photos are invisible to this sync (migration 376).
  const params: (string | null)[] = [projectId];
  const qResult = await pool.query<QFieldRow>(
    `
      SELECT q.feature_id, q.feature_type, q.photo_key, q.checklist_step, q.work_type, q.vlm_confidence, q.vlm_feedback
      FROM qfield_photo_validations q
      INNER JOIN qfield_projects qp ON qp.qfield_project_id = q.project_id::text
      INNER JOIN qfield_project_links l ON l.qfield_project_id = qp.id
      WHERE l.fibreflow_project_id = $1::uuid
        -- 'pole' = civil photos (keyed by pole label); 'joint' = optical/dome photos
        -- (keyed by dome label, mapped back to the pole below). Without 'joint' the
        -- optical Dome/Main-Joint slots never sync — every pole's optical photos were
        -- invisible on works-qa until this was added.
        AND q.feature_type IN ('pole', 'joint')
    `,
    params,
  );

  let synced = 0;
  let skipped = 0;
  let unassigned = 0;
  let unmappedDomeLabels = 0;

  // Push a photo into the per-pole `unassigned_photo_keys` bucket. Idempotent: only
  // appends if the key isn't already in a slot column, the tray array, or the bucket.
  const pushToUnassigned = async (pl: string, photoKey: string): Promise<void> => {
    // Ensure pole row exists first (sync may hit a pole with no slots yet).
    await pool.query(
      `
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        SELECT $1::uuid, $2, sp.zone_no, sp.pon_no
        FROM (SELECT 1) one
        LEFT JOIN sow_poles sp ON sp.project_id = $1::uuid AND sp.pole_number = $2
        ON CONFLICT (project_id, pole_label) DO NOTHING
      `,
      [projectId, pl],
    );

    // Dedup by logical_path (filename portion after /files/, ignoring qfield
    // project id and version suffix). Otherwise a key under one qfield project
    // and the same photo under another qfield project would both land in the
    // bucket — see migration 373 for the cleanup of the original incident.
    const upd = await pool.query(
      `
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
                qa.civil_step_07_key, qa.civil_step_08_key,
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
      `,
      [projectId, pl, photoKey],
    );
    if ((upd.rowCount ?? 0) > 0) unassigned += 1;
  };

  for (const row of qResult.rows) {
    // Civil rows are keyed by the pole label directly; optical/dome ('joint')
    // rows are keyed by the dome label and must be mapped back to the pole.
    const pl =
      row.feature_type === 'joint' ? domeLabelToPole(row.feature_id) : row.feature_id;
    if (!pl) {
      // A joint row whose dome label doesn't parse can't be attached to a pole —
      // count it so unexpected optical-sync gaps are diagnosable, not silent.
      if (row.feature_type === 'joint') unmappedDomeLabels++;
      skipped++;
      continue;
    }
    // Honour an optional single-pole filter for BOTH civil and optical rows
    // (the resolved pole label, not the raw dome label).
    if (poleLabel && pl !== poleLabel) {
      skipped++;
      continue;
    }

    const slotKey = resolveSlotKey(row.checklist_step, row.work_type);
    // No slot mapping for this step/work_type combo — surface the photo in
    // the per-pole unassigned bucket so reviewers can place it manually.
    if (!slotKey) {
      await pushToUnassigned(pl, row.photo_key);
      continue;
    }

    const slotMeta = getSlotMeta(slotKey);
    if (!slotMeta) {
      skipped++;
      continue;
    }

    // Upsert the pole row; copy zone/PON from sow_poles by pole_number match so the
    // pole list and PON filter have something to group on.
    await pool.query(
      `
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        SELECT $1::uuid, $2, sp.zone_no, sp.pon_no
        FROM (SELECT 1) one
        LEFT JOIN sow_poles sp
          ON sp.project_id = $1::uuid
         AND sp.pole_number = $2
        ON CONFLICT (project_id, pole_label) DO UPDATE
        SET zone_no = COALESCE(pole_qa_photos.zone_no, EXCLUDED.zone_no),
            pon_no  = COALESCE(pole_qa_photos.pon_no,  EXCLUDED.pon_no)
      `,
      [projectId, pl],
    );

    // Fetch current value of the slot column to check if it's already set
    const colName = slotMeta.dbColumn;
    if (!ALLOWED_PHOTO_COLUMNS.has(colName)) {
      skipped++;
      continue;
    }
    const colCheckResult = await pool.query<{ col_val: string | null }>(
      `SELECT ${colName} AS col_val FROM pole_qa_photos WHERE project_id = $1::uuid AND pole_label = $2`,
      [projectId, pl],
    );

    if (colCheckResult.rows.length === 0) {
      skipped++;
      continue;
    }

    if (colCheckResult.rows[0]!.col_val !== null) {
      // Slot already populated — don't overwrite a manual upload or earlier sync,
      // but keep the extra photo visible in the unassigned bucket so retakes /
      // duplicates aren't silently dropped.
      if (colCheckResult.rows[0]!.col_val !== row.photo_key) {
        await pushToUnassigned(pl, row.photo_key);
      }
      continue;
    }

    // Build VLM result entry. A row with no upstream confidence has never been
    // scored — write a pending marker (scored:false, no `valid`) so the UI shows
    // "Awaiting AI", NOT a red fail. The new works-qa-vlm-score step fills these
    // in on a later run. A row that DOES carry a confidence (legacy pre-2026-03
    // data) keeps its real pass/fail.
    const vlmEntry = row.vlm_confidence !== null
      ? JSON.stringify({
          [slotKey]: {
            valid: Number(row.vlm_confidence) >= 0.6,
            confidence: Number(row.vlm_confidence),
            feedback: row.vlm_feedback ?? 'Synced from QField',
            scored: true,
          },
        })
      : JSON.stringify({ [slotKey]: { scored: false } });

    await pool.query(
      `
        UPDATE pole_qa_photos
        SET ${colName} = $1,
            vlm_results = vlm_results || $2::jsonb,
            updated_at = NOW()
        WHERE project_id = $3::uuid AND pole_label = $4 AND ${colName} IS NULL
      `,
      [row.photo_key, vlmEntry, projectId, pl],
    );

    synced++;
  }

  if (unmappedDomeLabels > 0) {
    log.warn('works-qa/sync-qfield: optical rows with unparseable dome labels', {
      project_id: projectId,
      unmappedDomeLabels,
    });
  }

  return { synced, skipped, unassigned, unmappedDomeLabels };
}
