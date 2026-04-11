/**
 * POST /api/billing/upload-weekly-bundle
 *
 * Accepts a multi-file drop of the entire WE<date>/ folder for one or more
 * projects and processes everything in one request:
 *
 *   - FT payment summary PDF          (<Project> WE<date>.pdf)
 *   - Deduction notes XLSX            (<Project> WE<date> notes.xlsx)      [optional]
 *   - Zone uptake PDF                 (<Project>_installation uptake per zone_<code>.pdf)
 *   - Zone + PON uptake PDF           (<Project>_installation uptake per zone per pon_<code>.pdf)
 *
 * Files are auto-grouped by project (via PDF "Site" field, else filename).
 * Each project group is resolved against `projects` ∧ active CPO, parsed,
 * reconciled (FT total ONTs ≈ uptake grand total installed), then either
 * previewed or committed.
 *
 * action=preview → parse only, return per-project results
 * action=import  → write ft_weekly_billing + ft_billing_deductions +
 *                  project_weekly_zone_uptake + project_weekly_zone_pon_uptake
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, type Fields, type Files } from 'formidable';
import fs from 'fs';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import {
  classifyFile,
  groupFilesByProject,
  processProjectGroup,
  type BundleFile,
  type ClassifiedFile,
  type ProjectBundleResult,
} from '@/modules/billing/services/bundleProcessor';
import { fetchBillableProjects } from '@/modules/billing/services/resolveProjectName';

const logger = createLogger('api/billing/upload-weekly-bundle');

export const config = {
  api: { bodyParser: false },
  maxDuration: 120,
};

// ─── Form parser ────────────────────────────────────────────────────────────

function parseForm(req: NextApiRequest): Promise<{ fields: Fields; files: Files }> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024,
      multiples: true,
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function flattenFiles(filesField: Files['files']): BundleFile[] {
  if (!filesField) return [];
  const arr = Array.isArray(filesField) ? filesField : [filesField];
  return arr.map((f) => ({
    originalName: f.originalFilename ?? 'unknown',
    filepath: f.filepath,
    mimetype: f.mimetype ?? null,
    size: f.size,
  }));
}

function cleanupFiles(files: BundleFile[]): void {
  for (const f of files) {
    try { fs.unlinkSync(f.filepath); } catch { /* already gone */ }
  }
}

// ─── Response types ────────────────────────────────────────────────────────

interface ProjectResponsePreview {
  projectHint: string;
  resolved: {
    matched: boolean;
    projectId: string | null;
    projectName: string | null;
    candidates: { id: string; name: string }[];
  };
  files: { name: string; kind: string }[];
  summary: ReturnType<typeof serializeSummary>;
  deductionCount: number;
  zoneRowCount: number;
  ponRowCount: number;
  reconcile: ProjectBundleResult['reconcile'];
  parseWarnings: string[];
  fatalError: string | null;
}

interface ProjectResponseImport extends ProjectResponsePreview {
  billingWeekId: string | null;
  pricePerDrop: number | null;
  invoiceSubtotal: number | null;
  invoiceTotal: number | null;
  status: 'imported' | 'skipped' | 'error';
  statusReason: string | null;
}

function serializeSummary(summary: ProjectBundleResult['summary']) {
  if (!summary) return null;
  return {
    weekEnding: summary.weekEnding,
    site: summary.site,
    contractor: summary.contractor,
    areaManager: summary.areaManager,
    totalOnts: summary.totalOnts,
    claimable: summary.claimable,
    note1Count: summary.note1Count,
    note2Count: summary.note2Count,
    note3Count: summary.note3Count,
    note4Count: summary.note4Count,
    note5Count: summary.note5Count,
    preProvisionsCount: summary.preProvisionsCount,
    totalClaimableForPayment: summary.totalClaimableForPayment,
    lowerThanLinkBudgetCount: summary.lowerThanLinkBudgetCount,
  };
}

// ─── Handler ───────────────────────────────────────────────────────────────

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  let bundleFiles: BundleFile[] = [];

  try {
    const { fields, files } = await parseForm(req);
    const action = (Array.isArray(fields.action) ? fields.action[0] : fields.action) as string | undefined;

    if (!action || (action !== 'preview' && action !== 'import')) {
      return apiResponse.badRequest(res, 'action must be "preview" or "import"');
    }

    bundleFiles = flattenFiles(files.files);
    if (bundleFiles.length === 0) {
      return apiResponse.badRequest(res, 'At least one file is required (field: files)');
    }

    // Classify + group
    const classified: ClassifiedFile[] = bundleFiles.map((f) =>
      classifyFile(f),
    );
    const billable = await fetchBillableProjects();
    const groups = groupFilesByProject(classified, billable);

    // Process each group
    const results: ProjectBundleResult[] = [];
    for (const group of groups) {
      const result = await processProjectGroup(
        group,
        (p) => fs.readFileSync(p),
        billable,
      );
      results.push(result);
    }

    // ── PREVIEW ───────────────────────────────────────────────────────────
    if (action === 'preview') {
      const previewRes = results.map((r) => toPreviewResponse(r));
      cleanupFiles(bundleFiles);
      return res.status(200).json({
        success: true,
        action: 'preview',
        projects: previewRes,
      });
    }

    // ── IMPORT ────────────────────────────────────────────────────────────
    const uploadedBy = req.user?.email ?? req.user?.name ?? 'unknown';
    const importRes: ProjectResponseImport[] = [];

    for (const r of results) {
      importRes.push(await importProjectResult(r, uploadedBy));
    }

    cleanupFiles(bundleFiles);
    return res.status(200).json({
      success: true,
      action: 'import',
      projects: importRes,
    });
  } catch (error) {
    cleanupFiles(bundleFiles);
    const message = error instanceof Error ? error.message : 'Bundle upload failed';
    logger.error('upload-weekly-bundle failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

function toPreviewResponse(r: ProjectBundleResult): ProjectResponsePreview {
  return {
    projectHint: r.projectHint,
    resolved: {
      matched: r.resolution.matched,
      projectId: r.resolution.project?.id ?? null,
      projectName: r.resolution.project?.name ?? null,
      candidates: r.resolution.candidates.map((c) => ({ id: c.id, name: c.name })),
    },
    files: r.files.map((f) => ({ name: f.originalName, kind: f.kind })),
    summary: serializeSummary(r.summary),
    deductionCount: r.deductions.length,
    zoneRowCount: r.zoneUptake?.zones.length ?? 0,
    ponRowCount: r.zonePonUptake?.pons.length ?? 0,
    reconcile: r.reconcile,
    parseWarnings: r.parseWarnings,
    fatalError: r.fatalError,
  };
}

/**
 * Write one project group to the DB: ft_weekly_billing + ft_billing_deductions
 * + project_weekly_zone_uptake + project_weekly_zone_pon_uptake. Returns the
 * per-project response with status/error details.
 */
async function importProjectResult(
  r: ProjectBundleResult,
  uploadedBy: string,
): Promise<ProjectResponseImport> {
  const base = toPreviewResponse(r);

  // Guard: unresolved project → skip with a clear reason
  if (!r.resolution.matched || !r.resolution.project || !r.summary) {
    return {
      ...base,
      billingWeekId: null,
      pricePerDrop: null,
      invoiceSubtotal: null,
      invoiceTotal: null,
      status: 'skipped',
      statusReason: !r.summary
        ? 'No FT payment PDF in bundle — skipping DB write'
        : `Could not resolve "${r.resolution.rawInput}" to a billable project`,
    };
  }

  const projectId = r.resolution.project.id;
  const canonicalName = r.resolution.project.name;
  const summary = r.summary;

  try {
    // Look up price_per_drop from active CPO
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

    if (pricePerDrop === null) {
      r.parseWarnings.push(
        `No active CPO for "${canonicalName}" — row saved but invoice total will be null until a CPO is added.`,
      );
    }

    const taxRate = 15.0;
    const invoiceSubtotal =
      pricePerDrop !== null
        ? summary.totalClaimableForPayment * pricePerDrop
        : null;
    const invoiceTotal =
      invoiceSubtotal !== null
        ? invoiceSubtotal * (1 + taxRate / 100)
        : null;

    const pdfFilename =
      r.files.find((f) => f.kind === 'ft-payment-pdf')?.originalName ?? null;
    const notesFilename =
      r.files.find((f) => f.kind === 'notes-xlsx')?.originalName ?? null;

    // ── Upsert ft_weekly_billing ──────────────────────────────────────────
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

    // ── Upsert deductions ────────────────────────────────────────────────
    if (r.deductions.length > 0) {
      await pool.query(
        `DELETE FROM ft_billing_deductions WHERE billing_week_id = $1`,
        [billingWeekId],
      );
      const drNumbers     = r.deductions.map((d) => d.drNumber);
      const notes         = r.deductions.map((d) => d.note);
      const serials       = r.deductions.map((d) => d.serialNumber ?? null);
      const teams         = r.deductions.map((d) => d.team ?? null);
      const reasons       = r.deductions.map((d) => d.reason ?? null);
      const weekEndingArr = r.deductions.map(() => summary.weekEnding);
      const projectArr    = r.deductions.map(() => canonicalName);
      const weekIdArr     = r.deductions.map(() => billingWeekId);

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
        [weekIdArr, weekEndingArr, projectArr, drNumbers, notes, serials, teams, reasons],
      );
    }

    // ── Upsert zone uptake ───────────────────────────────────────────────
    if (r.zoneUptake && r.zoneUptake.zones.length > 0) {
      await pool.query(
        `DELETE FROM project_weekly_zone_uptake
          WHERE week_ending = $1 AND project_id = $2`,
        [summary.weekEnding, projectId],
      );
      for (const z of r.zoneUptake.zones) {
        await pool.query(
          `INSERT INTO project_weekly_zone_uptake
             (week_ending, project_id, project_name, zone_no,
              planned_drops, installed, pct_installed, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            summary.weekEnding,
            projectId,
            canonicalName,
            z.zoneNo,
            z.plannedDrops,
            z.installed,
            z.pctInstalled,
            uploadedBy,
          ],
        );
      }
    }

    // ── Upsert zone+PON uptake ───────────────────────────────────────────
    if (r.zonePonUptake && r.zonePonUptake.pons.length > 0) {
      await pool.query(
        `DELETE FROM project_weekly_zone_pon_uptake
          WHERE week_ending = $1 AND project_id = $2`,
        [summary.weekEnding, projectId],
      );
      for (const p of r.zonePonUptake.pons) {
        await pool.query(
          `INSERT INTO project_weekly_zone_pon_uptake
             (week_ending, project_id, project_name, zone_no, pon_no,
              planned_drops, installed, pct_installed, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            summary.weekEnding,
            projectId,
            canonicalName,
            p.zoneNo,
            p.ponNo,
            p.plannedDrops,
            p.installed,
            p.pctInstalled,
            uploadedBy,
          ],
        );
      }
    }

    logger.info('Bundle imported', {
      project: canonicalName,
      weekEnding: summary.weekEnding,
      deductions: r.deductions.length,
      zones: r.zoneUptake?.zones.length ?? 0,
      pons: r.zonePonUptake?.pons.length ?? 0,
    });

    return {
      ...base,
      billingWeekId,
      pricePerDrop,
      invoiceSubtotal,
      invoiceTotal,
      status: 'imported',
      statusReason: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    logger.error('per-project import failed', { project: canonicalName, error: message });
    return {
      ...base,
      billingWeekId: null,
      pricePerDrop: null,
      invoiceSubtotal: null,
      invoiceTotal: null,
      status: 'error',
      statusReason: message,
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withAuth(withRole('manager')(handler as any));
