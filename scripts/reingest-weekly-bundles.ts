/**
 * Re-ingest historical FT weekly billing folders into Neon.
 *
 * Walks every `WE<date>/` subfolder under a root, classifies the top-level
 * files (ignoring nested duplicates that some weeks have under
 * `<Project>/<files>` paths), then runs the SAME bundleProcessor that the
 * upload-weekly-bundle API uses, and writes the rows to the same tables.
 *
 * Why a CLI instead of the browser:
 *   - 33 historical weeks × 4 projects × 4 files = 500+ files. Doing this
 *     through a UI is fragile and slow.
 *   - The processor is unchanged (single source of truth) — only the I/O
 *     wrapper differs.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/reingest-weekly-bundles.ts <root> [--dry-run]
 *
 * Example:
 *   DATABASE_URL=$NEON_URL npx tsx scripts/reingest-weekly-bundles.ts \
 *     /tmp/fibertime-weekly --dry-run
 *
 * The script is idempotent: every UPSERT keys on (week_ending, project) /
 * (week_ending, project_id, zone_no) etc, so re-running overwrites cleanly.
 */

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import {
  classifyFile,
  groupFilesByProject,
  processProjectGroup,
  type BundleFile,
  type ProjectBundleResult,
} from '@/modules/billing/services/bundleProcessor';
import { fetchBillableProjects } from '@/modules/billing/services/resolveProjectName';

// ─── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const root = args.find((a) => !a.startsWith('--'));

if (!root) {
  console.error('Usage: npx tsx scripts/reingest-weekly-bundles.ts <root> [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Root is not a directory: ${root}`);
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const uploadedBy = process.env.USER ?? 'reingest-cli';

// ─── Helpers ───────────────────────────────────────────────────────────────

interface WeekDir {
  name: string;
  fullPath: string;
}

/** Find every WE<date> subfolder under root, sorted oldest → newest. */
function findWeekDirs(rootPath: string): WeekDir[] {
  return fs.readdirSync(rootPath)
    .filter((name) => /^WE\d{6}$/i.test(name))
    .map((name) => ({ name, fullPath: path.join(rootPath, name) }))
    .filter((d) => fs.statSync(d.fullPath).isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * List ONLY top-level files in a week dir.
 *
 * Some weeks have nested `<Project>/<files>` subfolders that are duplicates
 * of the top-level files (older copies from a re-organisation). We
 * deliberately skip those — top-level is canonical.
 */
function listTopLevelFiles(weekDir: string): BundleFile[] {
  return fs.readdirSync(weekDir)
    .map((name) => ({ name, full: path.join(weekDir, name) }))
    .filter((f) => fs.statSync(f.full).isFile())
    .filter((f) => /\.(pdf|xlsx)$/i.test(f.name))
    .map((f) => ({
      originalName: f.name,
      filepath: f.full,
      mimetype: null,
      size: fs.statSync(f.full).size,
    }));
}

// ─── Per-project DB writer (mirrors upload-weekly-bundle.ts importProjectResult) ──

interface ImportOutcome {
  project: string;
  status: 'imported' | 'skipped' | 'error';
  reason?: string;
  pricePerDrop?: number | null;
  invoiceTotal?: number | null;
  deductions?: number;
  zones?: number;
  pons?: number;
}

async function importProjectResult(r: ProjectBundleResult): Promise<ImportOutcome> {
  if (!r.resolution.matched || !r.resolution.project || !r.summary) {
    return {
      project: r.projectHint,
      status: 'skipped',
      reason: !r.summary
        ? 'No FT payment PDF in bundle'
        : `Could not resolve "${r.resolution.rawInput}"`,
    };
  }

  const projectId = r.resolution.project.id;
  const canonicalName = r.resolution.project.name;
  const summary = r.summary;

  try {
    // Price lookup
    const priceRes = await pool.query<{ price_per_drop: string }>(
      `SELECT cpo.price_per_drop
         FROM client_purchase_orders cpo
        WHERE cpo.project_id = $1
          AND cpo.status = 'active'
        ORDER BY cpo.created_at DESC
        LIMIT 1`,
      [projectId],
    );
    const pricePerDrop = priceRes.rows[0]?.price_per_drop
      ? parseFloat(priceRes.rows[0].price_per_drop)
      : null;
    const taxRate = 15.0;
    const invoiceSubtotal =
      pricePerDrop !== null
        ? summary.totalClaimableForPayment * pricePerDrop
        : null;
    const invoiceTotal =
      invoiceSubtotal !== null ? invoiceSubtotal * (1 + taxRate / 100) : null;

    const pdfFilename =
      r.files.find((f) => f.kind === 'ft-payment-pdf')?.originalName ?? null;
    const notesFilename =
      r.files.find((f) => f.kind === 'notes-xlsx')?.originalName ?? null;

    if (dryRun) {
      return {
        project: canonicalName,
        status: 'imported',
        pricePerDrop,
        invoiceTotal,
        deductions: r.deductions.length,
        zones: r.zoneUptake?.zones.length ?? 0,
        pons: r.zonePonUptake?.pons.length ?? 0,
      };
    }

    // ── Upsert ft_weekly_billing ───────────────────────────────────────────
    const upsert = await pool.query<{ id: string }>(
      `INSERT INTO ft_weekly_billing (
         week_ending, project, ft_total_onts, ft_previously_invoiced, ft_claimable,
         ft_note1_count, ft_note2_count, ft_note3_count, ft_note4_count, ft_note5_count,
         ft_pre_provisions_count, ft_total_claimable, price_per_drop, tax_rate,
         invoice_subtotal, invoice_total, pdf_filename, notes_xlsx_filename,
         uploaded_by, site, contractor, area_manager, lower_than_link_budget_count,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19,
         $20, $21, $22, $23, NOW()
       )
       ON CONFLICT (week_ending, project) DO UPDATE SET
         ft_total_onts                = EXCLUDED.ft_total_onts,
         ft_previously_invoiced       = EXCLUDED.ft_previously_invoiced,
         ft_claimable                 = EXCLUDED.ft_claimable,
         ft_note1_count               = EXCLUDED.ft_note1_count,
         ft_note2_count               = EXCLUDED.ft_note2_count,
         ft_note3_count               = EXCLUDED.ft_note3_count,
         ft_note4_count               = EXCLUDED.ft_note4_count,
         ft_note5_count               = EXCLUDED.ft_note5_count,
         ft_pre_provisions_count      = EXCLUDED.ft_pre_provisions_count,
         ft_total_claimable           = EXCLUDED.ft_total_claimable,
         price_per_drop               = EXCLUDED.price_per_drop,
         tax_rate                     = EXCLUDED.tax_rate,
         invoice_subtotal             = EXCLUDED.invoice_subtotal,
         invoice_total                = EXCLUDED.invoice_total,
         pdf_filename                 = EXCLUDED.pdf_filename,
         notes_xlsx_filename          = EXCLUDED.notes_xlsx_filename,
         uploaded_by                  = EXCLUDED.uploaded_by,
         site                         = EXCLUDED.site,
         contractor                   = EXCLUDED.contractor,
         area_manager                 = EXCLUDED.area_manager,
         lower_than_link_budget_count = EXCLUDED.lower_than_link_budget_count,
         updated_at                   = NOW()
       RETURNING id`,
      [
        summary.weekEnding,
        canonicalName,
        summary.totalOnts,
        summary.previouslyInvoiced,
        summary.claimable,
        summary.note1Count,
        summary.note2Count,
        summary.note3Count,
        summary.note4Count,
        summary.note5Count,
        summary.preProvisionsCount,
        summary.totalClaimableForPayment,
        pricePerDrop,
        taxRate,
        invoiceSubtotal,
        invoiceTotal,
        pdfFilename,
        notesFilename,
        uploadedBy,
        summary.site,
        summary.contractor,
        summary.areaManager,
        summary.lowerThanLinkBudgetCount,
      ],
    );

    const billingWeekId = upsert.rows[0]?.id;
    if (!billingWeekId) throw new Error('Upsert returned no id');

    // ── Deductions ─────────────────────────────────────────────────────────
    if (r.deductions.length > 0) {
      await pool.query(
        `DELETE FROM ft_billing_deductions WHERE billing_week_id = $1`,
        [billingWeekId],
      );
      const drNumbers   = r.deductions.map((d) => d.drNumber);
      const notes       = r.deductions.map((d) => d.note);
      const serials     = r.deductions.map((d) => d.serialNumber ?? null);
      const teams       = r.deductions.map((d) => d.team ?? null);
      const reasons     = r.deductions.map((d) => d.reason ?? null);
      const weekEndArr  = r.deductions.map(() => summary.weekEnding);
      const projArr     = r.deductions.map(() => canonicalName);
      const weekIdArr   = r.deductions.map(() => billingWeekId);

      await pool.query(
        `INSERT INTO ft_billing_deductions
           (billing_week_id, week_ending, project, dr_number, deduction_note,
            serial_number, team, deduction_reason)
         SELECT
           UNNEST($1::uuid[]), UNNEST($2::date[]), UNNEST($3::varchar[]),
           UNNEST($4::varchar[]), UNNEST($5::varchar[]), UNNEST($6::varchar[]),
           UNNEST($7::varchar[]), UNNEST($8::text[])
         ON CONFLICT (billing_week_id, dr_number, deduction_note) DO UPDATE SET
           serial_number    = EXCLUDED.serial_number,
           team             = EXCLUDED.team,
           deduction_reason = EXCLUDED.deduction_reason`,
        [weekIdArr, weekEndArr, projArr, drNumbers, notes, serials, teams, reasons],
      );
    }

    // ── Zone uptake (bulk UNNEST) ─────────────────────────────────────────
    if (r.zoneUptake && r.zoneUptake.zones.length > 0) {
      await pool.query(
        `DELETE FROM project_weekly_zone_uptake
          WHERE week_ending = $1 AND project_id = $2`,
        [summary.weekEnding, projectId],
      );
      const zones = r.zoneUptake.zones;
      await pool.query(
        `INSERT INTO project_weekly_zone_uptake
           (week_ending, project_id, project_name, zone_no,
            planned_drops, installed, pct_installed, uploaded_by)
         SELECT
           $1::date, $2::uuid, $3::varchar, UNNEST($4::int[]),
           UNNEST($5::int[]), UNNEST($6::int[]), UNNEST($7::numeric[]), $8::varchar`,
        [
          summary.weekEnding,
          projectId,
          canonicalName,
          zones.map((z) => z.zoneNo),
          zones.map((z) => z.plannedDrops),
          zones.map((z) => z.installed),
          zones.map((z) => z.pctInstalled),
          uploadedBy,
        ],
      );
    }

    // ── Zone+PON uptake ────────────────────────────────────────────────────
    if (r.zonePonUptake && r.zonePonUptake.pons.length > 0) {
      await pool.query(
        `DELETE FROM project_weekly_zone_pon_uptake
          WHERE week_ending = $1 AND project_id = $2`,
        [summary.weekEnding, projectId],
      );
      const pons = r.zonePonUptake.pons;
      await pool.query(
        `INSERT INTO project_weekly_zone_pon_uptake
           (week_ending, project_id, project_name, zone_no, pon_no,
            planned_drops, installed, pct_installed, uploaded_by)
         SELECT
           $1::date, $2::uuid, $3::varchar, UNNEST($4::int[]), UNNEST($5::int[]),
           UNNEST($6::int[]), UNNEST($7::int[]), UNNEST($8::numeric[]), $9::varchar`,
        [
          summary.weekEnding,
          projectId,
          canonicalName,
          pons.map((p) => p.zoneNo),
          pons.map((p) => p.ponNo),
          pons.map((p) => p.plannedDrops),
          pons.map((p) => p.installed),
          pons.map((p) => p.pctInstalled),
          uploadedBy,
        ],
      );
    }

    return {
      project: canonicalName,
      status: 'imported',
      pricePerDrop,
      invoiceTotal,
      deductions: r.deductions.length,
      zones: r.zoneUptake?.zones.length ?? 0,
      pons: r.zonePonUptake?.pons.length ?? 0,
    };
  } catch (err) {
    return {
      project: canonicalName,
      status: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== FT Weekly Re-ingest ===`);
  console.log(`Root:      ${root}`);
  console.log(`Dry run:   ${dryRun}`);

  const billable = await fetchBillableProjects();
  console.log(`Projects:  ${billable.length} billable in DB`);

  const weeks = findWeekDirs(root!);
  console.log(`Weeks:     ${weeks.length} found\n`);

  let totalProjects = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const week of weeks) {
    const files = listTopLevelFiles(week.fullPath);
    if (files.length === 0) {
      console.log(`${week.name}  ⊘ (no files)`);
      continue;
    }
    const classified = files.map(classifyFile);
    const groups = groupFilesByProject(classified, billable);

    const lines: string[] = [];
    for (const group of groups) {
      const result = await processProjectGroup(
        group,
        (p) => fs.readFileSync(p),
        billable,
      );
      const outcome = await importProjectResult(result);
      totalProjects++;
      const icon =
        outcome.status === 'imported' ? '✓'
        : outcome.status === 'skipped' ? '⊘'
        : '✗';
      const detail =
        outcome.status === 'imported'
          ? `inv=${outcome.invoiceTotal != null ? `R${Math.round(outcome.invoiceTotal).toLocaleString()}` : '—'} ded=${outcome.deductions} z=${outcome.zones} p=${outcome.pons}`
          : (outcome.reason ?? '');
      lines.push(`  ${icon} ${outcome.project.padEnd(18)} ${detail}`);
      if (outcome.status === 'imported') totalImported++;
      else if (outcome.status === 'skipped') totalSkipped++;
      else totalErrors++;
    }
    console.log(`${week.name}  (${groups.length} project${groups.length === 1 ? '' : 's'})`);
    for (const l of lines) console.log(l);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total projects processed: ${totalProjects}`);
  console.log(`  ✓ imported: ${totalImported}`);
  console.log(`  ⊘ skipped:  ${totalSkipped}`);
  console.log(`  ✗ errors:   ${totalErrors}`);
  if (dryRun) console.log('\n(dry-run — no DB writes happened)');

  await pool.end();
  process.exit(totalErrors > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
