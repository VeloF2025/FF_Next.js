#!/usr/bin/env node
/**
 * One-shot + cron-friendly backfill: pulls QField photos from
 * qfield_photo_validations into pole_qa_photos for every FibreFlow project
 * that has at least one qfield_project_link. Mirrors the slot mapping
 * and "skip-if-populated → push to unassigned" behaviour of
 * /api/works-qa/sync-qfield so a cron run and a UI sync stay in step.
 *
 * Usage:
 *   node scripts/backfill-works-qa-from-qfield.js                 # all projects
 *   node scripts/backfill-works-qa-from-qfield.js --project <uuid> # single FF project
 *
 * Safe to re-run (idempotent on photo_key). Reports per-project counts.
 */

// Load DATABASE_URL from .env.local without requiring the dotenv package
// (script runs from worktrees that may not have node_modules installed).
const fs = require('fs');
const path = require('path');
try {
  const envFile = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.replace(/^["']|["']$/g, '');
  }
} catch { /* .env.local optional when DATABASE_URL is already exported */ }
const { Pool } = require('pg');

const CIVIL_STEP_MAP = {
  1: 'civil_step_01_key',
  2: 'civil_step_02_key',
  3: 'civil_step_03_key',
  4: 'civil_step_04_key',
  5: 'civil_step_05_key',
  6: 'civil_step_06_key',
  7: 'civil_step_07_key',
  8: 'optical_dome_08_key', // pole tag also surfaces here for civil/pole_installation
};

const OPTICAL_STEP_MAP = {
  1: 'optical_dome_01_key',
  2: 'optical_dome_02_key',
  3: 'optical_dome_03_key',
  4: 'optical_dome_04_key',
  5: 'optical_dome_05_key',
  6: 'optical_dome_06_key',
  7: 'optical_dome_07_key',
  8: 'optical_dome_08_key',
  11: 'main_joint_11_key',
  12: 'main_joint_12_key',
  13: 'main_joint_13_key',
  14: 'main_joint_14_key',
  15: 'main_joint_15_key',
  16: 'main_joint_16_key',
};

const OPTICAL_WORK_TYPES = new Set(['dome_joint', 'optical', 'activation', 'joint']);

const SLOT_KEY_BY_COLUMN = {
  civil_step_01_key: 'civil_01', civil_step_02_key: 'civil_02', civil_step_03_key: 'civil_03',
  civil_step_04_key: 'civil_04', civil_step_05_key: 'civil_05', civil_step_06_key: 'civil_06',
  civil_step_07_key: 'civil_07',
  optical_dome_01_key: 'dome_01', optical_dome_02_key: 'dome_02', optical_dome_03_key: 'dome_03',
  optical_dome_04_key: 'dome_04', optical_dome_05_key: 'dome_05', optical_dome_06_key: 'dome_06',
  optical_dome_07_key: 'dome_07', optical_dome_08_key: 'dome_08',
  main_joint_11_key: 'main_joint_11', main_joint_12_key: 'main_joint_12',
  main_joint_13_key: 'main_joint_13', main_joint_14_key: 'main_joint_14',
  main_joint_15_key: 'main_joint_15', main_joint_16_key: 'main_joint_16',
};

const SLOT_COLUMNS = Object.keys(SLOT_KEY_BY_COLUMN);

function resolveColumn(step, workType) {
  if (step === null || step === undefined) return null;
  const isOptical = workType ? OPTICAL_WORK_TYPES.has(workType) : false;
  return (isOptical ? OPTICAL_STEP_MAP[step] : CIVIL_STEP_MAP[step]) ?? null;
}

async function syncProject(pool, projectId) {
  // Translate qfield_photo_validations.project_id (external QField uuid stored as
  // uuid in this column) through qfield_projects.qfield_project_id (varchar) to
  // qfield_projects.id, then join qfield_project_links by qfield_projects.id.
  // Without this two-hop translation, photos belonging to aliased qfield_projects
  // rows (id != qfield_project_id) are invisible to this backfill. See
  // sync-qfield.ts for the matching API-side translation.
  const { rows } = await pool.query(
    `SELECT q.feature_id, q.photo_key, q.checklist_step, q.work_type, q.vlm_confidence, q.vlm_feedback
     FROM qfield_photo_validations q
     INNER JOIN qfield_projects qp ON qp.qfield_project_id = q.project_id::text
     INNER JOIN qfield_project_links l ON l.qfield_project_id = qp.id
     WHERE l.fibreflow_project_id = $1::uuid
       AND q.feature_type = 'pole'
       AND q.feature_id IS NOT NULL`,
    [projectId]
  );

  let synced = 0, unassigned = 0, skipped = 0;

  for (const r of rows) {
    const poleLabel = r.feature_id;
    const colName = resolveColumn(r.checklist_step, r.work_type);

    // Ensure pole row exists (zone/PON from sow_poles when available)
    await pool.query(
      `INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
       SELECT $1::uuid, $2, sp.zone_no, sp.pon_no
       FROM (SELECT 1) one
       LEFT JOIN sow_poles sp ON sp.project_id = $1::uuid AND sp.pole_number = $2
       ON CONFLICT (project_id, pole_label) DO UPDATE
         SET zone_no = COALESCE(pole_qa_photos.zone_no, EXCLUDED.zone_no),
             pon_no  = COALESCE(pole_qa_photos.pon_no,  EXCLUDED.pon_no)`,
      [projectId, poleLabel]
    );

    if (!colName) {
      const u = await pushUnassigned(pool, projectId, poleLabel, r.photo_key);
      if (u) unassigned++;
      continue;
    }

    const slotKey = SLOT_KEY_BY_COLUMN[colName];
    // NULL upstream confidence = never scored → write a pending marker so the UI
    // shows "Awaiting AI" (not a red fail) and the works-qa-vlm-score step picks
    // it up. Mirrors src/modules/works-qa/services/syncQfieldCore.ts.
    const vlmEntry = r.vlm_confidence !== null
      ? JSON.stringify({
          [slotKey]: {
            valid: Number(r.vlm_confidence) >= 0.6,
            confidence: Number(r.vlm_confidence),
            feedback: r.vlm_feedback ?? 'Synced from QField',
            scored: true,
          },
        })
      : JSON.stringify({ [slotKey]: { scored: false } });

    // Try to fill if empty
    const filled = await pool.query(
      `UPDATE pole_qa_photos
       SET ${colName} = $1,
           vlm_results = vlm_results || $2::jsonb,
           updated_at = NOW()
       WHERE project_id = $3::uuid AND pole_label = $4 AND ${colName} IS NULL`,
      [r.photo_key, vlmEntry, projectId, poleLabel]
    );

    if ((filled.rowCount ?? 0) > 0) {
      synced++;
    } else {
      // Slot already populated — surface the photo in the unassigned bucket
      const current = await pool.query(
        `SELECT ${colName} AS v FROM pole_qa_photos WHERE project_id = $1::uuid AND pole_label = $2`,
        [projectId, poleLabel]
      );
      const same = current.rows[0]?.v === r.photo_key;
      if (same) { skipped++; continue; }
      const u = await pushUnassigned(pool, projectId, poleLabel, r.photo_key);
      if (u) unassigned++; else skipped++;
    }
  }

  return { synced, unassigned, skipped, considered: rows.length };
}

// Extract a stable "logical path" from a qfield photo key: everything after
// `/files/` minus the version suffix. Two keys differing only in project id
// or version (e.g. an audit-project versioned key vs a primary-project
// unversioned twin) share the same logical path, so we can dedup by it.
const LOGICAL_PATH_RE = `regexp_replace(k, '^.*?/files/(.*?)(/v[0-9]{14}-[a-f0-9]+)?$', '\\1')`;

async function pushUnassigned(pool, projectId, poleLabel, photoKey) {
  // Build the list of slot keys for the same pole as a flat array.
  // We compare on logical_path so a key under a different qfield project
  // (or with/without version suffix) for the same underlying photo dedups.
  const slotColArray = `ARRAY[${SLOT_COLUMNS.map(c => `qa.${c}`).join(', ')}, NULL]`;
  const r = await pool.query(
    `UPDATE pole_qa_photos qa
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
           || ${slotColArray}
         ) AS k
         WHERE k IS NOT NULL AND k <> ''
           AND ${LOGICAL_PATH_RE}
             = regexp_replace($3, '^.*?/files/(.*?)(/v[0-9]{14}-[a-f0-9]+)?$', '\\1')
       )`,
    [projectId, poleLabel, photoKey]
  );
  return (r.rowCount ?? 0) > 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const projIdx = argv.indexOf('--project');
  const onlyProject = projIdx >= 0 ? argv[projIdx + 1] : null;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const projects = onlyProject
    ? [{ project_id: onlyProject, project_name: '(specified)' }]
    : (await pool.query(
        `SELECT DISTINCT p.id AS project_id, p.project_name
         FROM projects p
         INNER JOIN qfield_project_links l ON l.fibreflow_project_id = p.id
         ORDER BY p.project_name`
      )).rows;

  if (projects.length === 0) {
    console.log('No FF projects with qfield_project_links — nothing to sync.');
    await pool.end();
    return;
  }

  console.log(`Syncing ${projects.length} project(s)…\n`);
  const totals = { synced: 0, unassigned: 0, skipped: 0, considered: 0 };

  for (const p of projects) {
    process.stdout.write(`  ${p.project_name.padEnd(24)} `);
    try {
      const r = await syncProject(pool, p.project_id);
      console.log(`considered=${r.considered}  synced=${r.synced}  unassigned=${r.unassigned}  skipped=${r.skipped}`);
      totals.synced += r.synced;
      totals.unassigned += r.unassigned;
      totals.skipped += r.skipped;
      totals.considered += r.considered;
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nTotal: considered=${totals.considered}  synced=${totals.synced}  unassigned=${totals.unassigned}  skipped=${totals.skipped}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
