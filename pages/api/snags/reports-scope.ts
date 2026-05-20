/**
 * POST /api/snags/reports-scope — scoped snag PDF generator.
 *
 * Validates body → queries snags (by pole/PON/zone, date, severity, category)
 * → reserves report number → renders HTML → puppeteer PDF → VF Storage upload
 * → persists snag_reports row → returns 201 with the row.
 *
 * Permission: construction-qa.snags.reports (create action).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql, transaction } from '@/lib/db-pool';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { vfStorage } from '@/services/vfStorageAdapter';
import { generateScopeReportNumber } from '@/modules/construction-qa/services/reportNumberGenerator';
import {
  renderScopeSnagReportHtml,
  type SnagReportMeta,
} from '@/modules/construction-qa/services/snagReportRenderer';
import { runSnagScopeQuery } from '@/modules/construction-qa/services/snagScopeQuery';

// ── Request body shape ─────────────────────────────────────────────────────────

interface ScopeBody {
  project_id: string;
  scope: 'pole' | 'pon' | 'zone';
  zones?: number[];
  pons?: number[];
  poles?: string[];
  from_date?: string;
  to_date?: string;
  severities?: ('minor' | 'major' | 'critical')[];
  categories?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns an ISO date string N days before now. */
function isoMinus(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Returns a validation error message or null when the body is valid. */
function validateScopeBody(b: ScopeBody): string | null {
  if (!b.project_id) return 'project_id is required';
  if (!['pole', 'pon', 'zone'].includes(b.scope)) return 'scope must be pole|pon|zone';
  if (b.scope === 'pole' && (!b.poles || b.poles.length === 0))
    return 'poles[] required when scope=pole';
  if (b.scope === 'pon' && (!b.pons || b.pons.length === 0))
    return 'pons[] required when scope=pon';
  if (b.scope === 'zone' && (!b.zones || b.zones.length === 0))
    return 'zones[] required when scope=zone';
  return null;
}

// ── Handler ────────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const body = req.body as ScopeBody;
  const validationError = validateScopeBody(body);
  if (validationError) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, validationError);
  }

  // Apply defaults for optional filters.
  const fromDate = body.from_date ?? isoMinus(30);
  const toDate = body.to_date ?? isoMinus(0);
  const severities = body.severities ?? ['minor', 'major', 'critical'];
  const categories = body.categories ?? null;

  // Coerce undefined OR empty array to null so Postgres can apply IS NULL
  // checks. The dialog sends [] for non-active scope dimensions (e.g. when
  // scope=zone it sends pons:[] / poles:[]) — without this coercion the
  // `${arr}::int[] IS NULL` branch is false and `= ANY('{}'::int[])` matches
  // zero rows, silently filtering out every snag.
  const zones: number[] | null = body.zones && body.zones.length > 0 ? body.zones : null;
  const pons: number[] | null = body.pons && body.pons.length > 0 ? body.pons : null;
  const poles: string[] | null = body.poles && body.poles.length > 0 ? body.poles : null;

  // ── 1. Fetch snags matching scope ──────────────────────────────────────────

  const rows = await runSnagScopeQuery({
    project_id: body.project_id,
    zones,
    pons,
    poles,
    from_date: fromDate,
    to_date: toDate,
    severities,
    categories,
  });

  if (rows.length === 0) {
    return apiResponse.error(
      res,
      ErrorCode.BAD_REQUEST,
      'No snags match the requested scope',
    );
  }

  // ── 2. Look up project name ────────────────────────────────────────────────

  const projectRows = await sql<{ project_name: string }>`
    SELECT project_name FROM projects WHERE id = ${body.project_id} LIMIT 1
  `;
  if (projectRows.length === 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Project not found');
  }
  const projectName = projectRows[0]!.project_name;

  // ── 3. Resolve auth context ────────────────────────────────────────────────

  const authReq = req as unknown as AuthenticatedNextApiRequest;
  const userId = authReq.user?.id ?? null;
  const generatedBy = authReq.user?.email ?? authReq.user?.id ?? 'system';

  // ── 4. Reserve unique report number ────────────────────────────────────────

  const today = new Date();
  const reportNumber = await generateScopeReportNumber(body.project_id, today);

  // ── 5. Build report metadata and render HTML ───────────────────────────────

  const meta: SnagReportMeta = {
    reportNumber,
    projectName,
    scope: body.scope,
    zones: zones ?? [],
    pons: pons ?? [],
    poles: poles ?? [],
    fromDate,
    toDate,
    severities,
    categories: categories ?? ['photo_quality', 'pole_quality', 'verification', 'other'],
    generatedAt: today.toISOString(),
    generatedBy,
  };

  log.info('reports-scope.rendering', { reportNumber, rowCount: rows.length });
  const html = await renderScopeSnagReportHtml(meta, rows);

  // ── 6. Generate PDF with puppeteer ─────────────────────────────────────────

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const out = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });
    pdfBuffer = Buffer.from(out);
  } finally {
    await browser.close();
  }

  // ── 7. Upload PDF to VF Storage ────────────────────────────────────────────

  const uploadResult = await vfStorage.uploadFile(
    pdfBuffer,
    'snag-reports',
    body.project_id,
    `${reportNumber}.pdf`,
  );
  log.info('reports-scope.uploaded', {
    reportNumber,
    url: uploadResult.url,
    size: uploadResult.size,
  });

  // ── 8. Persist snag_reports row — cleanup orphaned PDF on failure ──────────

  let inserted: Record<string, unknown>;
  try {
    inserted = await transaction(async (txn) => {
      // txn.query<T> returns T[] directly (per TxnClient interface in db-pool.ts)
      const r = await txn.query(
        `INSERT INTO snag_reports
           (project_id, report_number, source, audit_date,
            scope, scope_zone_nos, scope_pon_nos, scope_poles,
            scope_from_date, scope_to_date, scope_severities, scope_categories,
            pdf_url, generated_by, generated_at, total_findings)
         VALUES ($1, $2, 'scope', CURRENT_DATE,
                 $3, $4, $5, $6,
                 $7, $8, $9, $10,
                 $11, $12, NOW(), $13)
         RETURNING *`,
        [
          body.project_id,
          reportNumber,
          body.scope,
          zones,    // INT[] — preserves all selected zones
          pons,     // INT[] — preserves all selected PONs
          poles ?? null,
          fromDate,
          toDate,
          severities,
          categories,
          uploadResult.url,
          userId,
          rows.length,
        ],
      );
      return r[0] as Record<string, unknown>;
    });
  } catch (insertErr) {
    log.error('reports-scope.insert_failed', {
      reportNumber,
      error: insertErr instanceof Error ? insertErr.message : String(insertErr),
    });
    // Best-effort cleanup of orphaned PDF from VF Storage.
    try {
      await vfStorage.deleteFile('snag-reports', body.project_id, `${reportNumber}.pdf`);
    } catch (cleanupErr) {
      log.warn('reports-scope.pdf_cleanup_failed', {
        reportNumber,
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
    throw insertErr;
  }

  return apiResponse.created(res, inserted);
}

// ── Export with auth middleware ────────────────────────────────────────────────

export default withAuth(withPermission('construction-qa.snags.reports', 'create')(handler));
