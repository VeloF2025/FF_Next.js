/**
 * POST /api/snags/reports-scope — scoped snag PDF generator.
 *
 * Validates body → queries snags (by pole/PON/zone, date, severity, category)
 * → reserves report number → renders HTML → puppeteer PDF → VF Storage upload
 * → persists snag_reports row → returns 201 with the row.
 *
 * Permission: construction-qa.snags.reports (view action).
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
  resolveSlotUrls,
  type SnagReportMeta,
  type SnagReportScopeRow,
} from '@/modules/construction-qa/services/snagReportRenderer';

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

  // Coerce undefined to null so Postgres can apply IS NULL checks.
  const zones: number[] | null = body.zones ?? null;
  const pons: number[] | null = body.pons ?? null;
  const poles: string[] | null = body.poles ?? null;

  // ── 1. Fetch snags matching scope ──────────────────────────────────────────

  // Cast required: SnagReportScopeRow doesn't extend SqlRow (Record<string, unknown>)
  const rows = (await sql`
    SELECT
      s.id,
      s.snag_number,
      s.category,
      s.severity,
      s.status,
      s.description,
      p.zone_no,
      p.pon_no,
      p.pole_label AS pole_number,
      s.pole_qa_photo_id,
      s.slot_key,
      s.created_at::text AS created_at,
      mt.ticket_uid      AS noc_ticket_uid
    FROM snags s
    LEFT JOIN pole_qa_photos p       ON p.id = s.pole_qa_photo_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    WHERE s.project_id = ${body.project_id}
      AND (${zones}::int[]  IS NULL OR p.zone_no    = ANY(${zones}::int[]))
      AND (${pons}::int[]   IS NULL OR p.pon_no     = ANY(${pons}::int[]))
      AND (${poles}::text[] IS NULL OR p.pole_label = ANY(${poles}::text[]))
      AND s.created_at >= ${fromDate}::date
      AND s.created_at <  (${toDate}::date + INTERVAL '1 day')
      AND s.severity = ANY(${severities}::text[])
      AND (${categories}::text[] IS NULL OR s.category = ANY(${categories}::text[]))
    ORDER BY
      p.zone_no    NULLS LAST,
      p.pon_no     NULLS LAST,
      p.pole_label NULLS LAST,
      s.created_at
  `) as unknown as SnagReportScopeRow[];

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
  const slotUrls = await resolveSlotUrls(rows);
  const html = await renderScopeSnagReportHtml(meta, rows, { slotUrls });

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

  // ── 8. Persist snag_reports row ────────────────────────────────────────────

  const inserted = await transaction(async (txn) => {
    // txn.query<T> returns T[] directly (per TxnClient interface in db-pool.ts)
    const r = await txn.query(
      `INSERT INTO snag_reports
         (project_id, report_number, source, audit_date,
          scope, scope_zone_no, scope_pon_no, scope_poles,
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
        // Scalar zone/pon only when a single value is selected; multi stored in JSON columns.
        zones && zones.length === 1 ? zones[0] : null,
        pons && pons.length === 1 ? pons[0] : null,
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
    return r[0];
  });

  return apiResponse.created(res, inserted);
}

// ── Export with auth middleware ────────────────────────────────────────────────

export default withAuth(withPermission('construction-qa.snags.reports', 'create')(handler));
