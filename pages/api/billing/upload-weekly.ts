/**
 * POST /api/billing/upload-weekly
 * Upload FiberTime weekly payment summary PDF (+ optional deduction notes XLSX).
 * action=preview → parse only; action=import → upsert ft_weekly_billing + ft_billing_deductions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { IncomingForm, type Fields, type Files } from 'formidable';
import fs from 'fs';
import { createLogger } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import {
  parseFTPaymentPdf,
  parseNotesXlsx,
  type ParsedPaymentSummary,
  type ParsedDeduction,
} from '@/modules/billing/services/parseFTPaymentSummary';

const logger = createLogger('api/billing/upload-weekly');

// Disable body parser for file uploads; allow 60 s for PDF parsing
export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadPreviewResponse {
  success: true;
  action: 'preview';
  summary: ParsedPaymentSummary;
  deductionCount: number | null;
  parseWarnings: string[];
}

interface UploadImportResponse {
  success: true;
  action: 'import';
  billingWeekId: string;
  weekEnding: string;
  project: string;
  deductionCount: number;
  invoiceSubtotal: number | null;
  invoiceTotal: number | null;
  parseWarnings: string[];
}

// ─── Form Parser ─────────────────────────────────────────────────────────────

function parseForm(req: NextApiRequest): Promise<{ fields: Fields; files: Files }> {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50 MB
    });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  let pdfPath: string | null = null;
  let notesPath: string | null = null;

  try {
    const { fields, files } = await parseForm(req);

    // ── Extract fields ──────────────────────────────────────────────────────
    const action = (
      Array.isArray(fields.action) ? fields.action[0] : fields.action
    ) as string | undefined;
    const projectOverride = (
      Array.isArray(fields.project) ? fields.project[0] : fields.project
    ) as string | undefined;

    if (!action || (action !== 'preview' && action !== 'import')) {
      return apiResponse.badRequest(res, 'action must be "preview" or "import"');
    }

    // ── Resolve uploaded files ──────────────────────────────────────────────
    const pdfField = files.pdfFile;
    const pdfFile = Array.isArray(pdfField) ? pdfField[0] : pdfField;

    if (!pdfFile) {
      return apiResponse.badRequest(res, 'pdfFile is required');
    }
    pdfPath = pdfFile.filepath;

    const notesField = files.notesFile;
    const notesFile = notesField
      ? Array.isArray(notesField) ? notesField[0] : notesField
      : null;
    if (notesFile) notesPath = notesFile.filepath;

    // ── Parse PDF ───────────────────────────────────────────────────────────
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfFilename = pdfFile.originalFilename ?? 'payment-summary.pdf';
    const summary = await parseFTPaymentPdf(pdfBuffer, pdfFilename);

    // Apply project override (frontend field wins over PDF-extracted value)
    if (projectOverride?.trim()) {
      summary.project = projectOverride.trim();
    }
    if (!summary.project) {
      return apiResponse.badRequest(
        res,
        'Could not determine project from PDF filename. Provide "project" field.'
      );
    }

    // ── Parse deduction notes XLSX (optional) ───────────────────────────────
    let deductions: ParsedDeduction[] = [];
    let notesWarnings: string[] = [];

    if (notesPath) {
      const notesBuffer = fs.readFileSync(notesPath);
      const notesResult = await parseNotesXlsx(notesBuffer);
      deductions = notesResult.deductions;
      notesWarnings = notesResult.parseWarnings;
    }

    const allWarnings = [...summary.parseWarnings, ...notesWarnings];

    // ── PREVIEW ─────────────────────────────────────────────────────────────
    if (action === 'preview') {
      cleanupTempFiles(pdfPath, notesPath);
      const previewRes: UploadPreviewResponse = {
        success: true,
        action: 'preview',
        summary,
        deductionCount: notesPath ? deductions.length : null,
        parseWarnings: allWarnings,
      };
      return res.status(200).json(previewRes);
    }

    // ── IMPORT ──────────────────────────────────────────────────────────────
    // Lookup price_per_drop from the active CPO for this project
    const priceResult = await pool.query<{ price_per_drop: string }>(
      `SELECT cpo.price_per_drop
       FROM client_purchase_orders cpo
       JOIN projects p ON p.id = cpo.project_id
       WHERE p.project_name ILIKE $1
         AND cpo.status = 'active'
       ORDER BY cpo.created_at DESC
       LIMIT 1`,
      [summary.project]
    );

    const pricePerDrop = priceResult.rows[0]?.price_per_drop
      ? parseFloat(priceResult.rows[0].price_per_drop)
      : null;

    // Compute invoice amounts (null when no price found)
    const taxRate = 15.0;
    const invoiceSubtotal =
      pricePerDrop !== null
        ? summary.totalClaimableForPayment * pricePerDrop
        : null;
    const invoiceTotal =
      invoiceSubtotal !== null
        ? invoiceSubtotal * (1 + taxRate / 100)
        : null;

    logger.info('Importing FT weekly billing', {
      project: summary.project,
      weekEnding: summary.weekEnding,
      totalClaimable: summary.totalClaimableForPayment,
      pricePerDrop,
      deductionCount: deductions.length,
    });

    // ── Upsert ft_weekly_billing ────────────────────────────────────────────
    const upsertResult = await pool.query<{ id: string }>(
      `INSERT INTO ft_weekly_billing (
         week_ending,
         project,
         ft_total_onts,
         ft_previously_invoiced,
         ft_claimable,
         ft_note1_count,
         ft_note2_count,
         ft_note3_count,
         ft_note4_count,
         ft_note5_count,
         ft_pre_provisions_count,
         ft_total_claimable,
         price_per_drop,
         tax_rate,
         invoice_subtotal,
         invoice_total,
         pdf_filename,
         notes_xlsx_filename,
         uploaded_by,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW()
       )
       ON CONFLICT (week_ending, project) DO UPDATE SET
         ft_total_onts            = EXCLUDED.ft_total_onts,
         ft_previously_invoiced   = EXCLUDED.ft_previously_invoiced,
         ft_claimable             = EXCLUDED.ft_claimable,
         ft_note1_count           = EXCLUDED.ft_note1_count,
         ft_note2_count           = EXCLUDED.ft_note2_count,
         ft_note3_count           = EXCLUDED.ft_note3_count,
         ft_note4_count           = EXCLUDED.ft_note4_count,
         ft_note5_count           = EXCLUDED.ft_note5_count,
         ft_pre_provisions_count  = EXCLUDED.ft_pre_provisions_count,
         ft_total_claimable       = EXCLUDED.ft_total_claimable,
         price_per_drop           = EXCLUDED.price_per_drop,
         tax_rate                 = EXCLUDED.tax_rate,
         invoice_subtotal         = EXCLUDED.invoice_subtotal,
         invoice_total            = EXCLUDED.invoice_total,
         pdf_filename             = EXCLUDED.pdf_filename,
         notes_xlsx_filename      = EXCLUDED.notes_xlsx_filename,
         uploaded_by              = EXCLUDED.uploaded_by,
         updated_at               = NOW()
       RETURNING id`,
      [
        summary.weekEnding,
        summary.project,
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
        notesFile?.originalFilename ?? null,
        req.user?.email ?? req.user?.name ?? 'unknown',
      ]
    );

    const billingWeekId = upsertResult.rows[0]?.id;
    if (!billingWeekId) {
      throw new Error('Upsert into ft_weekly_billing returned no id');
    }

    // ── Upsert ft_billing_deductions (if notes provided) ───────────────────
    if (deductions.length > 0) {
      // Delete existing deductions for this billing week before re-inserting
      await pool.query(
        `DELETE FROM ft_billing_deductions WHERE billing_week_id = $1`,
        [billingWeekId]
      );

      // Bulk insert via unnest
      const drNumbers      = deductions.map(d => d.drNumber);
      const notes          = deductions.map(d => d.note);
      const serials        = deductions.map(d => d.serialNumber ?? null);
      const teams          = deductions.map(d => d.team ?? null);
      const reasons        = deductions.map(d => d.reason ?? null);
      const weekEndingArr  = deductions.map(() => summary.weekEnding);
      const projectArr     = deductions.map(() => summary.project);
      const weekIdArr      = deductions.map(() => billingWeekId);

      await pool.query(
        `INSERT INTO ft_billing_deductions
           (billing_week_id, week_ending, project, dr_number, deduction_note,
            serial_number, team, deduction_reason)
         SELECT
           UNNEST($1::uuid[]),
           UNNEST($2::date[]),
           UNNEST($3::varchar[]),
           UNNEST($4::varchar[]),
           UNNEST($5::varchar[]),
           UNNEST($6::varchar[]),
           UNNEST($7::varchar[]),
           UNNEST($8::text[])
         ON CONFLICT (billing_week_id, dr_number, deduction_note) DO UPDATE SET
           serial_number    = EXCLUDED.serial_number,
           team             = EXCLUDED.team,
           deduction_reason = EXCLUDED.deduction_reason`,
        [weekIdArr, weekEndingArr, projectArr, drNumbers, notes, serials, teams, reasons]
      );

      logger.info('Deductions imported', {
        billingWeekId,
        deductionCount: deductions.length,
      });
    }

    cleanupTempFiles(pdfPath, notesPath);

    const importRes: UploadImportResponse = {
      success: true,
      action: 'import',
      billingWeekId,
      weekEnding: summary.weekEnding,
      project: summary.project,
      deductionCount: deductions.length,
      invoiceSubtotal,
      invoiceTotal,
      parseWarnings: allWarnings,
    };
    return res.status(200).json(importRes);
  } catch (error) {
    cleanupTempFiles(pdfPath, notesPath);
    const message = error instanceof Error ? error.message : 'Upload failed';
    logger.error('upload-weekly failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

// ─── Cleanup Helper ───────────────────────────────────────────────────────────

function cleanupTempFiles(pdfPath: string | null, notesPath: string | null): void {
  if (pdfPath) {
    try { fs.unlinkSync(pdfPath); } catch { /* already gone */ }
  }
  if (notesPath) {
    try { fs.unlinkSync(notesPath); } catch { /* already gone */ }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withAuth(withRole('manager')(handler as any));
