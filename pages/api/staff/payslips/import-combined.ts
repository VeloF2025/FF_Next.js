/**
 * POST /api/staff/payslips/import-combined — HR uploads the VIP combined
 * payslips PDF (one page per employee). Two phases:
 *
 *   commit="false" → preview: split, extract, auto-match, diff against
 *                    existing payslips, return per-row state.
 *   commit="true"  → as preview, plus: create casuals inline, skip rows
 *                    HR flagged, upload PDFs in parallel (rolled back on
 *                    failure), upsert payslips inside an ACID transaction.
 *
 * Auth: gated by `payslips.import` permission.
 *
 * The route is a thin orchestrator — business logic lives in
 * `src/modules/payslips/services/{previewImport,commitImport}.ts` and the
 * pure helpers live in `src/modules/payslips/{rowState,casualInput}.ts`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs/promises';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { withPermission } from '@/lib/auth/middleware';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

import { runPreviewImport } from '@/modules/payslips/services/previewImport';
import { runCommitImport } from '@/modules/payslips/services/commitImport';
import { createCasualStaff } from '@/modules/payslips/services/createCasual';
import { validateCasualInput } from '@/modules/payslips/casualInput';
import type { StaffMatchResult } from '@/modules/payslips/staffMatcher';
import type {
  CasualCreate,
  CombinedImportResponse,
  ManualMapping,
  SkipRequest,
} from '@/modules/payslips/types';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};

const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function parseMultipart(req: NextApiRequest): Promise<{
  fields: formidable.Fields;
  files: formidable.Files;
}> {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_PDF_BYTES,
    maxTotalFileSize: MAX_PDF_BYTES,
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
  return Array.isArray(value) ? value[0] : value;
}

function parseJsonField<T>(
  raw: string | undefined,
  validate: (v: unknown) => v is T
): { ok: true; value: T[] } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: true, value: [] };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { ok: false, error: 'expected JSON array' };
    return { ok: true, value: parsed.filter(validate) };
  } catch (err) {
    log.warn('[staff/payslips/import-combined] JSON parse failed', { err });
    return { ok: false, error: 'invalid JSON' };
  }
}

const isManualMapping = (v: unknown): v is ManualMapping =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as ManualMapping).page === 'number' &&
  typeof (v as ManualMapping).staffId === 'string';

const isCasualCreate = (v: unknown): v is CasualCreate =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as CasualCreate).page === 'number' &&
  typeof (v as CasualCreate).firstName === 'string' &&
  typeof (v as CasualCreate).lastName === 'string' &&
  typeof (v as CasualCreate).email === 'string' &&
  typeof (v as CasualCreate).phone === 'string';

const isSkipRequest = (v: unknown): v is SkipRequest =>
  typeof v === 'object' && v !== null && typeof (v as SkipRequest).page === 'number';

async function handlerInner(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  let parsed: { fields: formidable.Fields; files: formidable.Files };
  try {
    parsed = await parseMultipart(req);
  } catch (err) {
    log.error('[staff/payslips/import-combined] multipart parse failed', { err });
    return apiResponse.badRequest(
      res,
      'Could not read upload — file too large (>25 MB) or malformed.'
    );
  }

  const { fields, files } = parsed;
  const commit = String(pickFirst(fields.commit) ?? 'false') === 'true';
  const forceReimport =
    String(pickFirst(fields.forceReimport) ?? 'false') === 'true';

  const pdfFile = pickFirst(files.pdf) as formidable.File | undefined;
  if (!pdfFile) {
    return apiResponse.badRequest(res, 'PDF file is required (form field "pdf").');
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(pdfFile.filepath);
  } catch (err) {
    log.error('[staff/payslips/import-combined] failed to read PDF', { err });
    return apiResponse.internalError(res, err, 'Failed to read uploaded PDF');
  }

  const manualParse = parseJsonField(
    pickFirst(fields.manualMappings) as string | undefined,
    isManualMapping
  );
  if (!manualParse.ok)
    return apiResponse.badRequest(res, `manualMappings: ${manualParse.error}`);
  const manualMappings = manualParse.value;

  const casualParse = parseJsonField(
    pickFirst(fields.casualCreates) as string | undefined,
    isCasualCreate
  );
  if (!casualParse.ok)
    return apiResponse.badRequest(res, `casualCreates: ${casualParse.error}`);
  const casualCreates = casualParse.value;

  const skipParse = parseJsonField(
    pickFirst(fields.skipPages) as string | undefined,
    isSkipRequest
  );
  if (!skipParse.ok)
    return apiResponse.badRequest(res, `skipPages: ${skipParse.error}`);
  const skipRequests = skipParse.value;

  // For preview we just need the matches as-is; for commit we first create
  // any casuals so they can be wired into matches before the diff happens.
  let casualOverrides: Map<number, StaffMatchResult> | undefined;
  let casualsCreated = 0;
  let casualsByPage: Map<number, { staffId: string; staffName: string }> | undefined;
  if (commit && casualCreates.length > 0) {
    casualOverrides = new Map();
    casualsByPage = new Map();
    for (const create of casualCreates) {
      const validationError = validateCasualInput(create);
      if (validationError) {
        return apiResponse.badRequest(
          res,
          `casualCreates page ${create.page}: ${validationError}`
        );
      }
    }
  }

  let preview;
  try {
    preview = await runPreviewImport({ buffer, manualMappings });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Manual mapping')) {
      return apiResponse.badRequest(res, err.message);
    }
    log.error('[staff/payslips/import-combined] preview failed', { err });
    return apiResponse.badRequest(
      res,
      'Could not parse the PDF. Confirm this is the VIP "Velocity-payslips.pdf" export.'
    );
  }

  // If committing with casual creates, persist the staff rows now and overlay
  // the resulting matches. Each casual_create is its own one-row INSERT, so
  // there's no cross-row atomicity between casuals — that's acceptable since
  // the commit transaction only covers the payslip writes.
  if (commit && casualCreates.length > 0) {
    for (const create of casualCreates) {
      const page = preview.pages.find((p) => p.page === create.page);
      if (!page) {
        return apiResponse.badRequest(
          res,
          `casualCreates references page ${create.page} which is not in the PDF.`
        );
      }
      const result = await createCasualStaff(create, page.empCode);
      if (!result.ok) {
        return apiResponse.badRequest(
          res,
          `Could not create casual for page ${create.page}: ${result.error}`
        );
      }
      casualsCreated++;
      const fullName = `${create.firstName} ${create.lastName}`.trim();
      preview.matches.set(create.page, {
        staffId: result.id,
        staffName: fullName,
        staffEmail: create.email.toLowerCase(),
        method: 'payroll_code',
        confidence: 1,
      });
    }
    // Re-run the preview now that casuals exist so the response reflects them.
    casualOverrides = new Map(preview.matches);
    preview = await runPreviewImport({ buffer, manualMappings, casualMatchOverrides: casualOverrides });
    void casualsByPage; // tracker not needed — preview regen carries the truth
  }

  if (!commit) {
    const response: CombinedImportResponse = {
      period: preview.period,
      numPages: preview.numPages,
      pages: preview.previewRows,
      staffOptions: preview.staffOptions,
      periodSkips: preview.periodSkips,
      committed: false,
      insertedCount: 0,
      updatedCount: 0,
      unchangedSkipped: 0,
      manualSkippedCount: 0,
      casualsCreated: 0,
      payrollCodesSaved: 0,
    };
    return apiResponse.success(res, response);
  }

  // ─── Commit ────────────────────────────────────────────────────
  if (!preview.period) {
    return apiResponse.badRequest(
      res,
      'Could not determine the pay period from the PDF. Try a fresh export.'
    );
  }

  const skipPagesSet = new Set(skipRequests.map((s) => s.page));
  const orphanPages = preview.previewRows.filter(
    (r) => !r.match.staffId && !skipPagesSet.has(r.page)
  );
  if (orphanPages.length > 0) {
    return apiResponse.badRequest(
      res,
      `${orphanPages.length} page(s) still have no staff assigned and were not skipped. Map, create, or skip them.`
    );
  }

  let commitResult;
  try {
    commitResult = await runCommitImport({
      pages: preview.pages,
      matches: preview.matches,
      existingByStaff: preview.existingByStaff,
      period: preview.period,
      importedByUserId: authReq.user.id,
      manualMappings,
      skipRequests,
      forceReimport,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('Upload failed') || msg.startsWith('page ')) {
      return apiResponse.badRequest(res, msg);
    }
    log.error('[staff/payslips/import-combined] commit failed', { err });
    return apiResponse.internalError(res, err, 'Failed to import payslips');
  }

  log.info('[staff/payslips/import-combined] committed', {
    importedBy: authReq.user.id,
    period: preview.period,
    ...commitResult,
    casualsCreated,
    forceReimport,
  });

  const response: CombinedImportResponse = {
    period: preview.period,
    numPages: preview.numPages,
    pages: preview.previewRows,
    staffOptions: preview.staffOptions,
    periodSkips: preview.periodSkips,
    committed: true,
    casualsCreated,
    ...commitResult,
  };
  return apiResponse.success(res, response);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await handlerInner(req, res);
  } catch (err) {
    log.error('[staff/payslips/import-combined] uncaught', { err });
    if (!res.headersSent) {
      return apiResponse.internalError(res, err, 'Failed to import payslips');
    }
  }
}

export default withAuth(withPermission('payslips.import', 'create')(handler));

// Re-export shared types for client consumers.
export type {
  CombinedImportResponse,
  ManualMapping,
  CasualCreate,
  SkipRequest,
} from '@/modules/payslips/types';
