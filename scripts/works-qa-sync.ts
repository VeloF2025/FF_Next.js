/**
 * Works-QA ⇄ QField sync — headless CLI.
 *
 * Populates `pole_qa_photos` from `qfield_photo_validations` using the shared
 * core (src/modules/works-qa/services/syncQfieldCore.ts) — the same logic behind
 * the RBAC endpoint /api/works-qa/sync-qfield, but callable without an HTTP
 * session. The ingest cron (scripts/cron/worksqa-qfield-ingest.sh) runs this after
 * extract-gpkg-photos.py so newly-ingested photos reach the Works-QA dashboard
 * (crucial for aliased QField projects, which the dashboard's direct-join branch
 * cannot surface from qfield_photo_validations alone).
 *
 * Usage:
 *   DATABASE_URL=… tsx scripts/works-qa-sync.ts --project <ff_project_uuid> [--pole <label>]
 *   DATABASE_URL=… tsx scripts/works-qa-sync.ts --all-active
 *
 * --all-active syncs every non-archived FibreFlow project that has a QField link.
 */
import { Pool } from 'pg';
import { syncQfieldForProject, type SyncQfieldResult } from '@/modules/works-qa/services/syncQfieldCore';

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const allActive = process.argv.includes('--all-active');
  const project = argVal('--project');
  const pole = argVal('--pole') ?? null;

  if (!allActive && !project) {
    console.error('Usage: --project <ff_project_uuid> [--pole <label>]  |  --all-active');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  try {
    let targets: string[];
    if (allActive) {
      const { rows } = await pool.query<{ id: string; project_name: string }>(`
        SELECT DISTINCT p.id, p.project_name
        FROM projects p
        JOIN qfield_project_links l ON l.fibreflow_project_id = p.id
        -- IS DISTINCT FROM (not !=) so a NULL-status project is still included.
        WHERE p.status IS DISTINCT FROM 'archived'
        ORDER BY p.project_name
      `);
      targets = rows.map((r) => r.id);
      console.log(`Syncing ${targets.length} active linked project(s).`);
    } else {
      targets = [project!];
    }

    const totals: SyncQfieldResult = { synced: 0, skipped: 0, unassigned: 0, unmappedDomeLabels: 0 };
    const failures: Array<{ projectId: string; error: string }> = [];
    for (const projectId of targets) {
      // Per-project isolation: one project failing must NOT starve the rest of the
      // batch (the cron syncs all active projects; a single bad/locked project
      // shouldn't leave every alphabetically-later one un-synced until next run).
      try {
        const r = await syncQfieldForProject(pool, projectId, pole);
        totals.synced += r.synced;
        totals.skipped += r.skipped;
        totals.unassigned += r.unassigned;
        totals.unmappedDomeLabels += r.unmappedDomeLabels;
        // Surface unmapped dome labels per-project: syncQfieldCore's log.warn goes to
        // @/lib/logger's in-memory buffer, which is invisible from a tsx CLI/cron.
        const unmapped = r.unmappedDomeLabels > 0 ? ` unmappedDomeLabels=${r.unmappedDomeLabels}` : '';
        console.log(`  ${projectId}: synced=${r.synced} unassigned=${r.unassigned} skipped=${r.skipped}${unmapped}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ projectId, error: msg });
        console.error(`  ${projectId}: FAILED — ${msg}`);
      }
    }

    console.log(`TOTAL: synced=${totals.synced} unassigned=${totals.unassigned} skipped=${totals.skipped} unmappedDomeLabels=${totals.unmappedDomeLabels}`);
    if (failures.length > 0) {
      console.error(`FAILED ${failures.length}/${targets.length} project(s): ${failures.map((f) => f.projectId).join(', ')}`);
      process.exitCode = 1; // non-zero so the cron logs a WARNING with a record of failures
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('works-qa-sync failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
