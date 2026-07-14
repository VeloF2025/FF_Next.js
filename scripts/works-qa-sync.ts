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
        WHERE p.status != 'archived'
        ORDER BY p.project_name
      `);
      targets = rows.map((r) => r.id);
      console.log(`Syncing ${targets.length} active linked project(s).`);
    } else {
      targets = [project!];
    }

    const totals: SyncQfieldResult = { synced: 0, skipped: 0, unassigned: 0, unmappedDomeLabels: 0 };
    for (const projectId of targets) {
      const r = await syncQfieldForProject(pool, projectId, pole);
      totals.synced += r.synced;
      totals.skipped += r.skipped;
      totals.unassigned += r.unassigned;
      totals.unmappedDomeLabels += r.unmappedDomeLabels;
      console.log(`  ${projectId}: synced=${r.synced} unassigned=${r.unassigned} skipped=${r.skipped}`);
    }

    console.log(`TOTAL: synced=${totals.synced} unassigned=${totals.unassigned} skipped=${totals.skipped} unmappedDomeLabels=${totals.unmappedDomeLabels}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('works-qa-sync failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
