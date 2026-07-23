/**
 * H&S remediation — resolve the audits stranded by the empty-wizard bug.
 *
 * Background (2026-07-23 audit, docs/plans/health-safety-e2e-goal.md §2/§8.2):
 * before the multi-template seeding fix, "Start New Audit" on a project whose
 * hs_project_config.template_id was NULL created an audit with ZERO
 * hs_audit_responses — an un-completable "0/0" wizard. 8 real audits stalled
 * this way since March 2026 (Mahikeng ×3, Phalaborwa ×4, Thembisa ×1 — the
 * Thembisa one has 5 responses from a template-configured window).
 *
 * With the seeding fix merged, NULL template_id now means "all active
 * templates" — the live configs need NO data change. This script only deals
 * with the stranded audits: it marks them status='cancelled' (abandoned) so
 * they stop rendering as forever-in-progress.
 *
 * Targets: hs_project_audits WHERE status='in_progress' AND created_at >=
 * 2026-03-01 AND the project is one of the real configured projects. The ~42
 * status-mixed rows from 2026-01-22 belong to deleted demo projects and are
 * NOT touched.
 *
 * DRY-RUN by default — prints the rows it would cancel. Run with --execute
 * to apply. Requires Hein's go-ahead (Confirmation Gate §8.2).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/backfill-hs-audit-scope.ts            # dry-run
 *   DATABASE_URL=postgresql://... npx tsx scripts/backfill-hs-audit-scope.ts --execute
 */

import { Pool } from 'pg';

/**
 * The exact 8 stranded audits, identified in the 2026-07-23 audit and pinned
 * by id so the script can never catch a legitimate audit started after the
 * seeding fix shipped. The Thembisa audit has 5 responses — it is still one
 * of the 8 the plan proposes to abandon (§8.2), included deliberately.
 */
const STRANDED_AUDIT_IDS = [
  'faf10bd8-e27d-4e9f-8045-ac56bd1c23c6', // Thembisa POP 1, 2026-03-31, 5 responses
  '86eebc08-5070-4f53-9d07-57f927226e21', // Phalaborwa - Ben Farm, 2026-06-22
  '8179b708-fe4b-4df8-a274-a4f5696a4cc6', // Phalaborwa - Ben Farm, 2026-06-22
  'a445fa0d-2d7f-48ef-912d-4d4c289502dd', // Mahikeng, 2026-07-13
  '924bb2b8-1f7b-4ed3-ade9-dfe0d390f9dd', // Mahikeng, 2026-07-14
  'bcc68853-6974-4a85-8c95-783459c037db', // Mahikeng, 2026-07-14
  '34583bc3-0d53-4727-bbbf-031627d40445', // Phalaborwa - Ben Farm, 2026-07-14
  '96ac579d-6c6f-4b9d-baf6-02aa41980dc6', // Phalaborwa - Ben Farm, 2026-07-14
];

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const { rows: targets } = await pool.query(
      `
      SELECT a.id, p.project_name, a.status, a.created_at::date AS created,
             (SELECT count(*) FROM hs_audit_responses r WHERE r.audit_id = a.id)::int AS responses
      FROM hs_project_audits a
      JOIN projects p ON p.id = a.project_id
      WHERE a.id = ANY($1::uuid[])
      ORDER BY a.created_at
    `,
      [STRANDED_AUDIT_IDS]
    );

    process.stdout.write(`Stranded audits (pinned by id, ${STRANDED_AUDIT_IDS.length} known): found ${targets.length}\n`);
    for (const t of targets) {
      process.stdout.write(
        `  ${t.id}  ${String(t.project_name).padEnd(24)} created ${t.created}  responses=${t.responses}\n`
      );
    }

    const { rows: configs } = await pool.query(`
      SELECT p.project_name, c.template_id, c.audit_frequency, c.next_audit_due::date AS next_due
      FROM hs_project_config c JOIN projects p ON p.id = c.project_id
      WHERE c.is_active ORDER BY p.project_name
    `);
    process.stdout.write('\nActive configs (NULL template_id now means "all active templates" — no change needed):\n');
    for (const c of configs) {
      process.stdout.write(
        `  ${String(c.project_name).padEnd(24)} template=${c.template_id ?? 'NULL (all categories)'}  ${c.audit_frequency}  next_due=${c.next_due}\n`
      );
    }

    if (!execute) {
      process.stdout.write('\nDRY-RUN — no changes applied. Re-run with --execute after Hein approves (gate §8.2).\n');
      return;
    }

    const { rowCount } = await pool.query(
      `UPDATE hs_project_audits
       SET status = 'cancelled', notes = COALESCE(notes || E'\\n', '') || 'Abandoned: stranded by pre-2026-07 empty-wizard bug (goal §8.2 backfill)'
       WHERE id = ANY($1::uuid[]) AND status = 'in_progress'`,
      [STRANDED_AUDIT_IDS]
    );
    process.stdout.write(`\nCancelled ${rowCount} stranded audits.\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`backfill-hs-audit-scope failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
