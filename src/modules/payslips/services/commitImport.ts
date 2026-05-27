/**
 * Commit phase of the combined-PDF importer.
 *
 * Order of operations is critical for data integrity:
 *
 *   1. Validate all pages have a resolution (match or skip).
 *   2. Upload all per-page PDFs in parallel via Promise.allSettled.
 *      If any upload fails, delete the successful ones and abort — no DB
 *      writes happen, no orphan files left on VF Storage.
 *   3. Inside a single ACID transaction:
 *      - Upsert payslip rows (one per non-skipped, non-noop page).
 *      - Insert / refresh skip rows for HR-flagged skips.
 *      - Resolve any prior skips that this commit fulfilled.
 *      - Persist payroll_code mappings the user opted into.
 *      If the transaction throws, all DB state rolls back AND the just-uploaded
 *      PDFs are deleted to keep storage clean.
 *   4. Only after a successful transaction, delete the OLD hashed PDFs that
 *      were replaced. Best-effort — orphan-tolerant rather than data-losing.
 */

import { sql, transaction } from '@/lib/db-pool';
import { log } from '@/lib/logger';

import { vfStorage } from '@/services/vfStorageAdapter';
import {
  periodToDateRange,
  type ExtractedPayslipPage,
} from '../pdfSplitter';
import type {
  ExistingPayslipSummary,
  ManualMapping,
  SkipRequest,
} from '../types';
import type { StaffMatchResult } from '../staffMatcher';

export interface CommitImportInput {
  pages: ExtractedPayslipPage[];
  matches: Map<number, StaffMatchResult>;
  existingByStaff: Map<string, ExistingPayslipSummary>;
  period: string;
  importedByUserId: string;
  manualMappings: ManualMapping[];
  skipRequests: SkipRequest[];
  forceReimport: boolean;
}

export interface CommitImportResult {
  insertedCount: number;
  updatedCount: number;
  unchangedSkipped: number;
  manualSkippedCount: number;
  payrollCodesSaved: number;
}

type PagePlan = 'skip' | 'import' | 'noop';

interface UploadedPdf {
  page: number;
  url: string;
  filename: string;
}

/**
 * Validate, upload, and commit. Throws with a user-friendly message on
 * validation failure (route should map to 400). Throws Error('upload failed')
 * after rolling back on any upload error. Throws the original DB error on
 * transaction failure (also after rollback + storage cleanup).
 */
export async function runCommitImport(
  input: CommitImportInput
): Promise<CommitImportResult> {
  const {
    pages,
    matches,
    existingByStaff,
    period,
    importedByUserId,
    manualMappings,
    skipRequests,
    forceReimport,
  } = input;

  const range = periodToDateRange(period);
  if (!range) throw new Error(`Invalid period "${period}".`);

  const skipByPage = new Map(skipRequests.map((s) => [s.page, s]));

  // Decide per-page action.
  const planByPage = new Map<number, PagePlan>();
  for (const page of pages) {
    if (skipByPage.has(page.page)) {
      planByPage.set(page.page, 'skip');
      continue;
    }
    const match = matches.get(page.page);
    if (!match?.staffId) {
      throw new Error(
        `page ${page.page} has no staff assigned and was not skipped`
      );
    }
    if (forceReimport) {
      planByPage.set(page.page, 'import');
      continue;
    }
    const existing = existingByStaff.get(match.staffId);
    if (!existing) {
      planByPage.set(page.page, 'import');
      continue;
    }
    const sameAmounts =
      existing.grossCents === (page.totalEarningsCents ?? 0) &&
      existing.deductionsCents === (page.totalDeductionsCents ?? 0) &&
      existing.netCents === (page.nettPayCents ?? 0);
    planByPage.set(page.page, sameAmounts ? 'noop' : 'import');
  }

  const importPages = pages.filter((p) => planByPage.get(p.page) === 'import');

  // Validate amounts are parseable on every page that's actually being imported.
  for (const p of importPages) {
    if (p.totalEarningsCents === null || p.nettPayCents === null) {
      throw new Error(
        `page ${p.page} has unparseable amounts (earnings or nett missing) — skip it or fix the source PDF`
      );
    }
  }

  // Upload PDFs in parallel; collect successes and failures.
  const uploads = await Promise.allSettled(
    importPages.map(async (page) => {
      const match = matches.get(page.page)!;
      const filename = sanitiseFilename(`${match.staffId}__${period}.pdf`);
      const result = await vfStorage.uploadFile(
        page.pdfBuffer,
        'staff',
        'payslips',
        filename
      );
      const stored: UploadedPdf = {
        page: page.page,
        url: result.url,
        filename: extractFilenameFromUrl(result.url) ?? filename,
      };
      return stored;
    })
  );

  const succeeded: UploadedPdf[] = [];
  const failed: { page: number; reason: string }[] = [];
  for (const u of uploads) {
    if (u.status === 'fulfilled') {
      succeeded.push(u.value);
    } else {
      const reason =
        u.reason instanceof Error ? u.reason.message : String(u.reason);
      failed.push({ page: -1, reason });
    }
  }

  if (failed.length > 0) {
    // Rollback the partial uploads.
    log.warn(
      '[payslips/commitImport] upload(s) failed — deleting partial successes',
      { failedCount: failed.length, succeededCount: succeeded.length }
    );
    await deletePdfs(succeeded.map((u) => u.filename));
    throw new Error(
      `Upload failed for ${failed.length} of ${importPages.length} page(s). No payslips were imported.`
    );
  }

  const urlByPage = new Map(succeeded.map((u) => [u.page, u.url]));

  // ─── ACID transaction ─────────────────────────────────────────────────
  let insertedCount = 0;
  let updatedCount = 0;
  let manualSkippedCount = 0;
  let payrollCodesSaved = 0;

  try {
    await transaction(async (txn) => {
      // 1. Upsert payslips.
      for (const page of importPages) {
        const match = matches.get(page.page)!;
        const existed = existingByStaff.has(match.staffId!);
        const rawData = JSON.stringify(rawDataFor(page));
        await txn.query(
          `
          INSERT INTO payslips (
            staff_id, pay_period_start, pay_period_end,
            gross_cents, deductions_cents, net_cents,
            pdf_url, raw_data, imported_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9
          )
          ON CONFLICT (staff_id, pay_period_start, pay_period_end) DO UPDATE
          SET gross_cents      = EXCLUDED.gross_cents,
              deductions_cents = EXCLUDED.deductions_cents,
              net_cents        = EXCLUDED.net_cents,
              pdf_url          = COALESCE(EXCLUDED.pdf_url, payslips.pdf_url),
              raw_data         = COALESCE(EXCLUDED.raw_data, payslips.raw_data),
              imported_at      = NOW(),
              imported_by      = EXCLUDED.imported_by
          `,
          [
            match.staffId,
            range.start,
            range.end,
            page.totalEarningsCents,
            page.totalDeductionsCents ?? 0,
            page.nettPayCents,
            urlByPage.get(page.page) ?? null,
            rawData,
            importedByUserId,
          ]
        );
        if (existed) updatedCount++;
        else insertedCount++;
      }

      // 2. Skip rows (idempotent on (period, emp_code)).
      for (const skip of skipRequests) {
        const page = pages.find((p) => p.page === skip.page);
        if (!page?.empCode) continue;
        await txn.query(
          `
          INSERT INTO payslip_import_skips (pay_period, emp_code, emp_name, raw_extracted, reason, skipped_by)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6::uuid)
          ON CONFLICT (pay_period, emp_code) DO UPDATE
          SET reason     = EXCLUDED.reason,
              skipped_by = EXCLUDED.skipped_by,
              skipped_at = NOW(),
              resolved_at = NULL,
              resolved_payslip_id = NULL
          `,
          [
            period,
            page.empCode,
            page.empName,
            JSON.stringify(rawDataFor(page)),
            skip.reason ?? 'Skipped on import',
            importedByUserId,
          ]
        );
        manualSkippedCount++;
      }

      // 3. Resolve any skip rows that this import fulfilled.
      for (const page of importPages) {
        if (!page.empCode) continue;
        await txn.query(
          `
          UPDATE payslip_import_skips
          SET resolved_at = NOW(),
              resolved_payslip_id = (
                SELECT id FROM payslips
                WHERE staff_id = $1
                  AND pay_period_start = $2
                  AND pay_period_end = $3
                LIMIT 1
              )
          WHERE pay_period = $4
            AND emp_code = $5
            AND resolved_at IS NULL
          `,
          [matches.get(page.page)!.staffId, range.start, range.end, period, page.empCode]
        );
      }

      // 4. payroll_code mappings the user opted into.
      for (const mapping of manualMappings) {
        if (!mapping.savePayrollCode) continue;
        const page = pages.find((p) => p.page === mapping.page);
        if (!page?.empCode) continue;
        const updated = await txn.query<{ id: string }>(
          `
          UPDATE staff
          SET payroll_code = $1
          WHERE id = $2::uuid
            AND (payroll_code IS NULL OR payroll_code <> $1)
          RETURNING id
          `,
          [page.empCode, mapping.staffId]
        );
        if (updated.length > 0) payrollCodesSaved++;
      }
    });
  } catch (txnErr) {
    log.error(
      '[payslips/commitImport] transaction failed — deleting just-uploaded PDFs',
      { err: txnErr instanceof Error ? txnErr.message : String(txnErr) }
    );
    await deletePdfs(succeeded.map((u) => u.filename));
    throw txnErr;
  }

  // 5. After a successful transaction, delete OLD hashed PDFs we replaced.
  // Best-effort — a single delete failure should not roll back a successful
  // import. Orphans are recoverable; rolling back a successful payroll import
  // because of a stale-file delete failure is not worth it.
  const oldFilenamesToDelete = importPages
    .map((page) => {
      const match = matches.get(page.page)!;
      const existing = existingByStaff.get(match.staffId!);
      return existing?.pdfStoredFilename ?? null;
    })
    .filter((f): f is string => f !== null);
  await deletePdfs(oldFilenamesToDelete);

  const unchangedSkipped = pages.filter(
    (p) => planByPage.get(p.page) === 'noop'
  ).length;

  return {
    insertedCount,
    updatedCount,
    unchangedSkipped,
    manualSkippedCount,
    payrollCodesSaved,
  };
}

async function deletePdfs(filenames: string[]): Promise<void> {
  for (const filename of filenames) {
    try {
      await vfStorage.deleteFile('staff', 'payslips', filename);
    } catch (err) {
      log.warn('[payslips/commitImport] delete failed (non-fatal)', {
        filename,
        err,
      });
    }
  }
}

function rawDataFor(page: ExtractedPayslipPage): Record<string, unknown> {
  return {
    empCode: page.empCode,
    empName: page.empName,
    idNumber: page.idNumber,
    paymentDate: page.paymentDate,
    sourcePage: page.page,
    totalEarningsCents: page.totalEarningsCents,
    totalDeductionsCents: page.totalDeductionsCents,
    nettPayCents: page.nettPayCents,
  };
}

function extractFilenameFromUrl(url: string): string | null {
  const m = url.match(/\/staff\/payslips\/([^/?#]+)$/);
  return m?.[1] ?? null;
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Re-export for the route handler.
export { sql };
