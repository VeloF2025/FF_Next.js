/**
 * Combined VIP-payslip PDF splitter.
 *
 * VIP exports the monthly payroll as a single PDF — one page per employee,
 * each page carrying Emp Code / Emp Name / Id Number / Payment Dt / Nett Pay.
 * HR drops the file into the importer; this module splits it into per-page
 * PDFs and extracts the matching fields so the API can pair each page with
 * a staff record.
 *
 * pdf-parse v2 is used for text extraction; pdf-lib for the per-page split.
 * Both are already in the project bundle from prior work.
 */

import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';

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
    pages.push({
      page: i + 1,
      pdfBuffer,
      rawText,
      ...extractFields(rawText),
    });
  }

  const period = pages.length > 0 ? toPeriod(pages[0]!.paymentDate) : null;

  // Defensive: if pdf-parse and pdf-lib disagree on page count (rare; e.g.
  // an image-only page), surface this in the log via the returned numPages
  // — callers can decide whether to flag the import.
  return { pages, period, numPages: Math.max(numPages, pdfParseTotal) };
}

interface ExtractedFields {
  empCode: string | null;
  empName: string | null;
  firstInitial: string | null;
  lastName: string | null;
  idNumber: string | null;
  paymentDate: string | null;
  totalEarningsCents: number | null;
  totalDeductionsCents: number | null;
  nettPayCents: number | null;
}

function extractFields(text: string): ExtractedFields {
  const empCode = matchOne(text, /Emp\s*Code\s+([A-Z0-9-]+)/i);
  const empName = matchOne(
    text,
    /Emp\s*Name\s+([A-Za-z][A-Za-z .'-]+?)(?:\s{2,}|\n|\s+Emp\s|\s+Job\s|\s+Id\s|\s+Co\.|\s+Paypoint|$)/i
  );
  const idNumber = matchOne(text, /Id\s*Number\s+(\d{13})/i);
  const paymentDate = matchOne(text, /Payment\s*Dt\s+(\d{4}\/\d{2}\/\d{2})/i);
  const totalEarningsCents = parseCentsAfter(text, /Total\s+Earnings\s+([\d,]+\.\d{2})/i);

  // pdfjs returns text items in positional order, which interleaves the
  // earnings (left) and deductions (right) columns differently for each
  // page. The "Total Deductions" label and its value can land far apart,
  // and "NETT PAY" appears as a bare label without its value adjacent.
  //
  // Primary heuristic: nett pay is rendered with thousand-separators
  // (e.g. "21,400.88") while earnings/deductions sub-totals never use
  // thousand-separators in this VIP template. The unique comma-decimal
  // number on the page is the nett.
  //
  // Fallback: if the page contains more than one comma-decimal number
  // (e.g. an account number, year-to-date totals, a salary in the
  // hundreds of thousands), pick the largest one whose value is also
  // ≤ totalEarningsCents — nett pay is always less than earnings before
  // deductions (deductions can't be negative).
  let nettPayCents: number | null = null;
  const commaDecimalCents = [
    ...text.matchAll(/(\d{1,3}(?:,\d{3})+\.\d{2})/g),
  ]
    .map((m) => parseRandToCents(m[1]!))
    .filter((c): c is number => c !== null);

  if (commaDecimalCents.length === 1) {
    nettPayCents = commaDecimalCents[0]!;
  } else if (commaDecimalCents.length > 1 && totalEarningsCents !== null) {
    const candidates = commaDecimalCents
      .filter((c) => c <= totalEarningsCents && c > 0)
      .sort((a, b) => b - a);
    nettPayCents = candidates[0] ?? null;
  }

  const totalDeductionsCents =
    totalEarningsCents !== null && nettPayCents !== null
      ? totalEarningsCents - nettPayCents
      : null;

  let firstInitial: string | null = null;
  let lastName: string | null = null;
  if (empName) {
    const tokens = empName.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '').trim().split(/\s+/);
    if (tokens.length >= 1) {
      const firstToken = tokens[0]!;
      firstInitial = firstToken.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || null;
    }
    if (tokens.length >= 2) {
      lastName = tokens[tokens.length - 1]!.toLowerCase();
    }
  }

  return {
    empCode,
    empName: empName ? empName.trim() : null,
    firstInitial,
    lastName,
    idNumber,
    paymentDate,
    totalEarningsCents,
    totalDeductionsCents,
    nettPayCents,
  };
}

function matchOne(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m && m[1] ? m[1].trim() : null;
}

function parseCentsAfter(text: string, re: RegExp): number | null {
  const raw = matchOne(text, re);
  if (!raw) return null;
  return parseRandToCents(raw);
}

function parseRandToCents(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
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
