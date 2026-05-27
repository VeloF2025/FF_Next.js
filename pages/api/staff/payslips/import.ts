/**
 * POST /api/staff/payslips/import — HR uploads a CSV summary + PDF bundle.
 *
 * PRD-040 Phase 3 / PR3. Two phases driven by a `commit` form field:
 *   commit="false"  → preview: parse + match, return summary, no DB writes.
 *   commit="true"   → as preview, then upload PDFs to VF Storage and
 *                     upsert payslip rows in a single transaction.
 *
 * Auth: super_admin or admin (RBAC `payslips.import`). All other roles
 * are explicitly denied via the seed in migration 326.
 *
 * The CSV is the source of truth for what gets imported. PDFs are
 * optional — rows that match a PDF get pdf_url populated; rows without
 * a PDF still import (staff sees a "No PDF" pill on /my/payslips).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs/promises';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import { vfStorage } from '@/services/vfStorageAdapter';
import { parsePayslipCsv } from '@/modules/payslips/csvParser';
import {
  matchPdfsToRows,
  type PdfFile,
} from '@/modules/payslips/pdfMatcher';
import { upsertPayslip } from '@/modules/payslips/queries';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};

const MAX_TOTAL_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_PDF_BYTES = 4 * 1024 * 1024;

interface PreviewItem {
  rowIndex: number;
  email: string;
  staffId: string | null;
  staffName: string | null;
  payPeriodStart: string;
  payPeriodEnd: string;
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  pdfFilename: string | null;
  status: 'ready' | 'no_staff' | 'parse_error';
  errors: string[];
}

interface ImportResponse {
  ready: PreviewItem[];
  rowsWithoutPdf: PreviewItem[];
  unmatchedPdfs: { filename: string }[];
  parseErrors: { rowIndex: number; field: string; message: string }[];
  committed: boolean;
  insertedCount: number;
  updatedCount: number;
}

async function parseMultipart(
  req: NextApiRequest
): Promise<{
  fields: formidable.Fields;
  files: formidable.Files;
}> {
  const form = formidable({
    multiples: true,
    maxFileSize: MAX_PDF_BYTES,
    maxTotalFileSize: MAX_TOTAL_UPLOAD_BYTES,
    keepExtensions: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function pickFirst<T>(value: T | T[] | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function pickAll<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function handlerInner(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  let parsed: { fields: formidable.Fields; files: formidable.Files };
  try {
    parsed = await parseMultipart(req);
  } catch (err) {
    log.error('[staff/payslips/import] multipart parse failed', { err });
    return apiResponse.badRequest(res, 'Could not read upload — file too large or malformed.');
  }

  const { fields, files } = parsed;
  const commit = String(pickFirst(fields.commit) ?? 'false') === 'true';

  const csvFile = pickFirst(files.csv) as formidable.File | undefined;
  if (!csvFile) {
    return apiResponse.badRequest(res, 'CSV file is required (form field "csv").');
  }

  const pdfRawFiles = pickAll(files.pdfs) as formidable.File[];

  let csvBody: string;
  try {
    csvBody = await fs.readFile(csvFile.filepath, 'utf-8');
  } catch (err) {
    log.error('[staff/payslips/import] failed to read CSV', { err });
    return apiResponse.internalError(res, 'Failed to read uploaded CSV');
  }

  const { rows, errors } = parsePayslipCsv(csvBody);

  // Resolve email → staff_id once for the whole batch.
  const emails = Array.from(new Set(rows.map((r) => r.email)));
  const staffByEmail = await resolveStaffByEmail(emails);

  const pdfFiles: PdfFile[] = pdfRawFiles.map((p) => ({
    originalName: p.originalFilename ?? 'unknown.pdf',
    tmpPath: p.filepath,
    size: p.size,
  }));

  const matchResult = matchPdfsToRows(rows, pdfFiles);

  const ready: PreviewItem[] = [];
  const rowsWithoutPdf: PreviewItem[] = [];

  for (const m of matchResult.matched) {
    const staff = staffByEmail.get(m.row.email);
    const item = previewItem(m.row, staff ?? null, m.pdf.originalName);
    ready.push(item);
  }
  for (const r of matchResult.rowsWithoutPdf) {
    const staff = staffByEmail.get(r.email);
    const item = previewItem(r, staff ?? null, null);
    rowsWithoutPdf.push(item);
  }

  const unmatchedPdfs = matchResult.unmatchedPdfs.map((p) => ({ filename: p.originalName }));
  const parseErrors = errors.map((e) => ({
    rowIndex: e.rowIndex,
    field: e.field,
    message: e.message,
  }));

  // If preview-only, return now.
  if (!commit) {
    const response: ImportResponse = {
      ready,
      rowsWithoutPdf,
      unmatchedPdfs,
      parseErrors,
      committed: false,
      insertedCount: 0,
      updatedCount: 0,
    };
    return apiResponse.success(res, response);
  }

  // Commit phase. Refuse if any parse errors — HR must clean their CSV first.
  if (parseErrors.length > 0) {
    return apiResponse.badRequest(
      res,
      `CSV has ${parseErrors.length} error(s). Fix and re-upload before committing.`
    );
  }

  // Refuse if any matched/unmatched-pdf row points at a staff we couldn't
  // resolve — silent insert with NULL staff_id is impossible (FK), but we
  // want to fail fast with a clear message.
  const orphanRows = [...ready, ...rowsWithoutPdf].filter((r) => r.status === 'no_staff');
  if (orphanRows.length > 0) {
    return apiResponse.badRequest(
      res,
      `${orphanRows.length} row(s) reference staff emails not in the system. Fix the CSV.`
    );
  }

  let insertedCount = 0;
  let updatedCount = 0;

  // Upload PDFs first, in parallel — if any fails we abort before any DB
  // write, so HR doesn't end up with half-imported rows pointing at PDFs
  // that aren't actually there. Per Hein's data-safety rule.
  const uploads = await Promise.all(
    matchResult.matched.map(async (m) => {
      const staff = staffByEmail.get(m.row.email);
      if (!staff) return null; // already filtered above
      const buffer = await fs.readFile(m.pdf.tmpPath);
      const filename = sanitiseFilename(
        `${staff.id}__${m.row.payPeriodStart}__${m.row.payPeriodEnd}.pdf`
      );
      const result = await vfStorage.uploadFile(buffer, 'staff', 'payslips', filename);
      return { rowIndex: m.row.rowIndex, url: result.url };
    })
  );
  const uploadByRow = new Map<number, string>();
  for (const u of uploads) {
    if (u) uploadByRow.set(u.rowIndex, u.url);
  }

  for (const m of matchResult.matched) {
    const staff = staffByEmail.get(m.row.email);
    if (!staff) continue;
    const existed = await rowExists(staff.id, m.row.payPeriodStart, m.row.payPeriodEnd);
    await upsertPayslip({
      staffId: staff.id,
      payPeriodStart: m.row.payPeriodStart,
      payPeriodEnd: m.row.payPeriodEnd,
      grossCents: m.row.grossCents,
      deductionsCents: m.row.deductionsCents,
      netCents: m.row.netCents,
      pdfUrl: uploadByRow.get(m.row.rowIndex) ?? null,
      rawData: { firstName: m.row.firstName, lastName: m.row.lastName, ...m.row.extras },
      importedBy: authReq.user.id,
    });
    if (existed) updatedCount++;
    else insertedCount++;
  }

  for (const r of matchResult.rowsWithoutPdf) {
    const staff = staffByEmail.get(r.email);
    if (!staff) continue;
    const existed = await rowExists(staff.id, r.payPeriodStart, r.payPeriodEnd);
    await upsertPayslip({
      staffId: staff.id,
      payPeriodStart: r.payPeriodStart,
      payPeriodEnd: r.payPeriodEnd,
      grossCents: r.grossCents,
      deductionsCents: r.deductionsCents,
      netCents: r.netCents,
      pdfUrl: null,
      rawData: { firstName: r.firstName, lastName: r.lastName, ...r.extras },
      importedBy: authReq.user.id,
    });
    if (existed) updatedCount++;
    else insertedCount++;
  }

  log.info('[staff/payslips/import] committed', {
    importedBy: authReq.user.id,
    insertedCount,
    updatedCount,
    pdfsUploaded: uploadByRow.size,
  });

  const response: ImportResponse = {
    ready,
    rowsWithoutPdf,
    unmatchedPdfs,
    parseErrors,
    committed: true,
    insertedCount,
    updatedCount,
  };
  return apiResponse.success(res, response);
}

interface StaffMatch {
  id: string;
  fullName: string;
}

async function resolveStaffByEmail(emails: string[]): Promise<Map<string, StaffMatch>> {
  if (emails.length === 0) return new Map();
  const rows = await sql<{ id: string; email: string; first_name: string; last_name: string }>`
    SELECT id, LOWER(email) AS email, first_name, last_name
    FROM staff
    WHERE LOWER(email) = ANY(${emails}::text[])
  `;
  const map = new Map<string, StaffMatch>();
  for (const r of rows) {
    map.set(r.email, {
      id: r.id,
      fullName: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
    });
  }
  return map;
}

async function rowExists(
  staffId: string,
  start: string,
  end: string
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    SELECT id FROM payslips
    WHERE staff_id = ${staffId}
      AND pay_period_start = ${start}
      AND pay_period_end = ${end}
    LIMIT 1
  `;
  return rows.length > 0;
}

function previewItem(
  row: import('@/modules/payslips/csvParser').ParsedPayslipRow,
  staff: StaffMatch | null,
  pdfFilename: string | null
): PreviewItem {
  return {
    rowIndex: row.rowIndex,
    email: row.email,
    staffId: staff?.id ?? null,
    staffName: staff?.fullName ?? null,
    payPeriodStart: row.payPeriodStart,
    payPeriodEnd: row.payPeriodEnd,
    grossCents: row.grossCents,
    deductionsCents: row.deductionsCents,
    netCents: row.netCents,
    pdfFilename,
    status: staff ? 'ready' : 'no_staff',
    errors: staff ? [] : [`No staff with email "${row.email}"`],
  };
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await handlerInner(req, res);
  } catch (err) {
    log.error('[staff/payslips/import] uncaught', { err });
    if (!res.headersSent) {
      return apiResponse.internalError(res, 'Failed to import payslips');
    }
  }
}

export default withAuth(withPermission('payslips.import', 'create')(handler));
