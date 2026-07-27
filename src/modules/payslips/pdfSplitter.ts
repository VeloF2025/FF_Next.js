/**
 * Combined payslip PDF splitter.
 *
 * Sage exports the monthly payroll as a single PDF — one page per employee.
 * HR drops the file into the importer; this module splits it into per-page
 * PDFs and extracts the matching fields so the API can pair each page with
 * a staff record.
 *
 * Two page layouts are supported — the legacy VIP export and the Plain Paper
 * Payslip export Velocity moved to in July 2026. Layout detection and the
 * field regexes live in `./payslipLayouts`.
 *
 * pdf-parse v2 is used for text extraction; pdf-lib for the per-page split.
 * Both are already in the project bundle from prior work.
 */

import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';

import { log } from '@/lib/logger';

import {
  detectLayout,
  extractFields,
  findAnchorAnomalies,
  type PayslipLayout,
} from './payslipLayouts';

export interface ExtractedPayslipPage {
  /** 1-based page number in the source PDF. */
  page: number;
  /** Employee code as printed (e.g. "VF002"). null if regex missed. */
  empCode: string | null;
  /** Employee name as printed (e.g. "Ms J George"). null if regex missed. */
  empName: string | null;
  /** First-name initial parsed from the name (e.g. "J"). null if unparseable. */
  firstInitial: string | null;
  /** Last-name token parsed from the name, lowercased (e.g. "george"). null if unparseable. */
  lastName: string | null;
  /** 13-digit RSA ID number. null if missing or invalid length. */
  idNumber: string | null;
  /** Payment date as printed (yyyy/mm/dd). null if regex missed. */
  paymentDate: string | null;
  /** Cents — null if not parseable. */
  totalEarningsCents: number | null;
  totalDeductionsCents: number | null;
  nettPayCents: number | null;
  /** The single-page PDF, ready to upload to VF Storage. */
  pdfBuffer: Buffer;
  /** Raw page text (kept for raw_data column on the payslip row). */
  rawText: string;
  /** Which Sage layout this page was read as — useful when HR reports odd values. */
  layout: PayslipLayout;
}

export interface SplitResult {
  pages: ExtractedPayslipPage[];
  /** Period inferred from the first page's Payment Dt. yyyy-mm format. */
  period: string | null;
  numPages: number;
}

/**
 * Split a combined VIP payslips PDF into per-employee pages with extracted
 * fields. Throws if the file isn't a parseable PDF — callers should catch
 * and return a 400 with a clear message.
 */
export async function splitCombinedPayslipPdf(buffer: Buffer): Promise<SplitResult> {
  // pdf-parse v2 takes a TypedArray. Slice into a fresh Uint8Array so the
  // caller's Buffer isn't mutated (pdfjs may transfer ownership of the
  // underlying ArrayBuffer to its worker).
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);

  const parser = new PDFParse({ data });
  let perPageText: string[] = [];
  let pdfParseTotal = 0;
  try {
    const result = await parser.getText();
    pdfParseTotal = result.total;
    perPageText = result.pages
      .slice()
      .sort((a, b) => a.num - b.num)
      .map((p) => p.text);
  } finally {
    await parser.destroy();
  }

  // Pass a fresh Uint8Array view rather than the Buffer itself — pdf-lib's
  // type check (instanceof Uint8Array) fails across vitest worker realms
  // when you hand it a Node Buffer directly.
  const sourceData = new Uint8Array(buffer.byteLength);
  sourceData.set(buffer);
  const source = await PDFDocument.load(sourceData, { ignoreEncryption: true });
  const numPages = source.getPageCount();
  while (perPageText.length < numPages) perPageText.push('');

  const pages: ExtractedPayslipPage[] = [];
  for (let i = 0; i < numPages; i++) {
    const out = await PDFDocument.create();
    const [copied] = await out.copyPages(source, [i]);
    out.addPage(copied);
    const pdfBytes = await out.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    const rawText = perPageText[i] ?? '';
    const layout = detectLayout(rawText);

    // Extraction takes the first match for each anchor, so an anchor occurring
    // more often than the known templates produce means the value we read may
    // not be the one a human would. Never fires on the templates we support —
    // if it does, the payroll export changed shape and this page wants
    // checking by hand.
    const anchorAnomalies = findAnchorAnomalies(rawText, layout);
    if (anchorAnomalies.length > 0) {
      log.warn(
        '[payslips/pdfSplitter] unexpected anchor label counts on page — extracted values may be wrong',
        { page: i + 1, layout, labels: anchorAnomalies }
      );
    }

    pages.push({
      page: i + 1,
      pdfBuffer,
      rawText,
      layout,
      ...extractFields(rawText, layout),
    });
  }

  const period = pages.length > 0 ? toPeriod(pages[0]!.paymentDate) : null;

  // Defensive: if pdf-parse and pdf-lib disagree on page count (rare; e.g.
  // an image-only page), surface this in the log via the returned numPages
  // — callers can decide whether to flag the import.
  return { pages, period, numPages: Math.max(numPages, pdfParseTotal) };
}

/** "2026/04/30" → "2026-04". null if input is null or malformed. */
function toPeriod(paymentDate: string | null): string | null {
  if (!paymentDate) return null;
  const m = paymentDate.match(/^(\d{4})\/(\d{2})\/\d{2}$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** "2026-04" → { start: "2026-04-01", end: "2026-04-30"|"...31"|... } */
export function periodToDateRange(period: string): { start: string; end: string } | null {
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const start = `${m[1]}-${m[2]}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}
