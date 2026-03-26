/**
 * FiberTime Payment Summary Parser
 *
 * Parses FiberTime weekly payment summary PDFs and accompanying Notes XLSX files.
 * Extracts ONT counts, deduction breakdowns, and pre-provision counts for billing
 * reconciliation against FibreFlow's own activation records.
 *
 * PDF format: "Lawley WE260322.pdf" (or similar per-project naming)
 * XLSX format: Notes workbook with one sheet per note type (Note 1 through Note 5)
 */

import * as XLSX from 'xlsx';
import { log } from '@/lib/logger';

// ─── pdf-parse (CommonJS) ───────────────────────────────────────────────────

/** Minimal type for pdf-parse result */
interface PdfParseResult {
  text: string;
  numpages: number;
}
type PdfParseFunction = (buffer: Buffer) => Promise<PdfParseResult>;

// ─── Public Interface Types ─────────────────────────────────────────────────

export interface ParsedPaymentSummary {
  project: string;
  weekEnding: string;          // 'YYYY-MM-DD'
  totalOnts: number;
  previouslyInvoiced: number;
  claimable: number;
  note1Count: number;
  note2Count: number;
  note3Count: number;
  note4Count: number;
  note5Count: number;
  preProvisionsCount: number;
  totalClaimableForPayment: number;
  parseWarnings: string[];
}

export interface ParsedDeduction {
  drNumber: string;
  note: 'note1' | 'note2' | 'note3' | 'note4' | 'note5';
  serialNumber?: string;
  team?: string;
  reason?: string;
}

export interface NotesParseResult {
  deductions: ParsedDeduction[];
  parseWarnings: string[];
}

// ─── Month Name Lookup ──────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  // Abbreviations
  jan: '01', feb: '02', mar: '03', apr: '04',
  jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12',
};

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Parse a date string of the form "27 July 2025" or "10 August 2025"
 * into ISO format "YYYY-MM-DD". Returns null if the string cannot be parsed.
 */
function parseNaturalDate(raw: string): string | null {
  // Matches: "27 July 2025", "10 August 2025", "22 March 2026"
  const match = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;

  const [, dayStr, monthName, yearStr] = match;
  const monthNum = MONTH_MAP[monthName!.toLowerCase()];
  if (!monthNum) return null;

  const day = parseInt(dayStr!, 10);
  const year = parseInt(yearStr!, 10);
  if (isNaN(day) || isNaN(year) || day < 1 || day > 31 || year < 2000 || year > 2099) {
    return null;
  }

  return `${year}-${monthNum}-${String(day).padStart(2, '0')}`;
}

/**
 * Extract a project name from a PDF filename.
 * "Lawley WE260322.pdf" → "Lawley"
 * "Mohlakeng WE 10 August 2025.pdf" → "Mohlakeng"
 * Strips the trailing "WE..." token and any extension.
 */
function extractProjectFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, '').trim();
  // Everything before the first "WE" (case-insensitive, word boundary)
  const match = base.match(/^(.*?)\s+WE\b/i);
  if (match && match[1] && match[1].trim().length > 0) {
    return match[1].trim();
  }
  // Fallback: return the whole base name
  return base;
}

/**
 * Parse an integer from a text fragment.
 * Strips minus signs (we use absolute values for counts) and whitespace.
 * Returns 0 if the string is empty or non-numeric.
 */
function parseCount(raw: string): number {
  const cleaned = raw.replace(/\s/g, '').replace(/-/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Find the first integer (possibly negative) following a label pattern within
 * a line. The number may appear on the same line, possibly after many spaces.
 * Returns null when no number is found.
 */
function extractNumberAfterLabel(line: string): number | null {
  // Match any integer (possibly negative) in the line
  const match = line.match(/-?\d+/);
  if (!match) return null;
  return parseInt(match[0], 10);
}

/**
 * Search for the first line in `lines` that contains `label` (case-insensitive)
 * and return the integer found on that line (or the next non-empty line).
 * Returns null when not found; pushes to `warnings` array.
 */
function findCountByLabel(
  lines: string[],
  label: string,
  warnings: string[],
  fieldName: string,
): number {
  const labelLower = label.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.toLowerCase().includes(labelLower)) {
      // Try the same line first
      const same = extractNumberAfterLabel(lines[i]!);
      if (same !== null) return Math.abs(same);

      // Try the next non-empty line
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const next = extractNumberAfterLabel(lines[j]!);
        if (next !== null) return Math.abs(next);
      }

      warnings.push(`Found label "${label}" but could not extract a number for ${fieldName}`);
      return 0;
    }
  }

  warnings.push(`Label not found in PDF: "${label}" (${fieldName} defaulted to 0)`);
  return 0;
}

// ─── PDF Parser ─────────────────────────────────────────────────────────────

/**
 * Parse a FiberTime weekly payment summary PDF.
 *
 * Extracts ONT counts, deduction breakdown per note type, pre-provision count,
 * and total claimable for the billing week. The project name is inferred from
 * the filename; the week-ending date is read from the "PAYMENT SUMMARY AS AT:"
 * header line inside the document.
 *
 * @param buffer   - Raw PDF bytes
 * @param filename - Original filename (used for project name extraction)
 * @returns Parsed summary with any warnings for values that could not be found
 */
export async function parseFTPaymentPdf(
  buffer: Buffer,
  filename: string,
): Promise<ParsedPaymentSummary> {
  const warnings: string[] = [];
  const project = extractProjectFromFilename(filename);

  // ── Load pdf-parse v2 at runtime (CommonJS module) ─────────────────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParseModule = require('pdf-parse') as { PDFParse: new (data: Uint8Array) => { getText(): Promise<{ pages: { text: string }[] }> } };
  const { PDFParse } = pdfParseModule;

  // ── Extract raw text ─────────────────────────────────────────────────────
  let rawText: string;
  try {
    const uint8 = new Uint8Array(buffer);
    const parser = new PDFParse(uint8);
    const result = await parser.getText();
    rawText = result.pages.map((p: { text: string }) => p.text).join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Failed to parse FT payment PDF', { filename, error: msg }, 'billing-pdf');
    throw new Error(`Could not read PDF "${filename}": ${msg}`);
  }

  if (!rawText || rawText.trim().length === 0) {
    throw new Error(`No text content in "${filename}". The PDF may be image-based (scanned).`);
  }

  log.info('Parsing FT payment PDF', {
    filename,
    project,
    pages: parsed.numpages,
    textLength: rawText.length,
  }, 'billing-pdf');

  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // ── Week ending date ─────────────────────────────────────────────────────
  let weekEnding = '';
  for (const line of lines) {
    const asAtMatch = line.match(/PAYMENT\s+SUMMARY\s+AS\s+AT[:\s]+(.+)/i);
    if (asAtMatch && asAtMatch[1]) {
      const iso = parseNaturalDate(asAtMatch[1].trim());
      if (iso) {
        weekEnding = iso;
        break;
      }
    }
  }
  if (!weekEnding) {
    warnings.push('Could not find "PAYMENT SUMMARY AS AT:" date — weekEnding left empty');
  }

  // ── Total ONTs ───────────────────────────────────────────────────────────
  const totalOnts = findCountByLabel(
    lines,
    "total # of ont",
    warnings,
    'totalOnts',
  );

  // ── Previously invoiced ──────────────────────────────────────────────────
  // Sum up the negative numbers on all "Invoiced <date> - INV..." lines
  let previouslyInvoiced = 0;
  for (const line of lines) {
    if (/Invoiced\s+.+\s+-\s+INV/i.test(line)) {
      const numMatch = line.match(/-\s*(\d+)\s*$/);
      if (numMatch && numMatch[1]) {
        previouslyInvoiced += parseInt(numMatch[1], 10);
      }
    }
  }
  // Fallback: look for a "previously invoiced" summary label
  if (previouslyInvoiced === 0) {
    for (const line of lines) {
      if (/previously\s+invoiced/i.test(line)) {
        const n = extractNumberAfterLabel(line);
        if (n !== null) {
          previouslyInvoiced = Math.abs(n);
          break;
        }
      }
    }
  }

  // ── Claimable for the period ─────────────────────────────────────────────
  const claimable = findCountByLabel(
    lines,
    'claimable for the period',
    warnings,
    'claimable',
  );

  // ── Note deduction counts ────────────────────────────────────────────────
  // Note 1: "Lower than -26 dB threshold"
  const note1Count = findCountByLabel(
    lines,
    'lower than -26 db',
    warnings,
    'note1Count',
  );

  // Note 2: "No entry/submission on Field App"
  const note2Count = findCountByLabel(
    lines,
    'no entry/submission on field app',
    warnings,
    'note2Count',
  );

  // Note 3: "Degraded by more than -2dB"
  const note3Count = findCountByLabel(
    lines,
    'degraded by more than',
    warnings,
    'note3Count',
  );

  // Note 4: "Inaccurate: Drop# & ONT SN does not match"
  const note4Count = findCountByLabel(
    lines,
    'inaccurate',
    warnings,
    'note4Count',
  );

  // Note 5: "Fiber Break" or "Device Not Active"
  let note5Count = findCountByLabel(lines, 'fiber break', [], 'note5Count');
  if (note5Count === 0) {
    note5Count = findCountByLabel(lines, 'device not active', [], 'note5Count_device');
  }
  if (note5Count === 0) {
    warnings.push('Could not find Note 5 count (Fiber Break / Device Not Active) — defaulted to 0');
  }

  // ── Pre-provisions ───────────────────────────────────────────────────────
  // Line format: "Pre-Provisioned    0    -163"
  // We want the absolute value of the negative number (actual pre-provisions deducted).
  let preProvisionsCount = 0;
  for (const line of lines) {
    if (/pre-prov/i.test(line)) {
      // Grab all integers on the line; the last (or most negative) is the deduction
      const allNums = [...line.matchAll(/-?\d+/g)].map(m => parseInt(m[0], 10));
      // Prefer the most negative value; that is the pre-provisions deduction
      const negative = allNums.filter(n => n < 0);
      if (negative.length > 0) {
        preProvisionsCount = Math.abs(Math.min(...negative));
      } else if (allNums.length > 0) {
        preProvisionsCount = Math.max(...allNums.map(Math.abs));
      }
      break;
    }
  }
  if (preProvisionsCount === 0) {
    warnings.push('Could not find Pre-Provisioned count — defaulted to 0');
  }

  // ── Total claimable for payment ──────────────────────────────────────────
  const totalClaimableForPayment = findCountByLabel(
    lines,
    'total claimable for payment',
    warnings,
    'totalClaimableForPayment',
  );

  // ── Validation ───────────────────────────────────────────────────────────
  const derivedTotal = claimable - (note1Count + note2Count + note4Count + note5Count) - preProvisionsCount;
  const tolerance = 5; // Allow small rounding/counting differences
  if (
    totalClaimableForPayment > 0 &&
    Math.abs(derivedTotal - totalClaimableForPayment) > tolerance
  ) {
    warnings.push(
      `Validation mismatch: claimable(${claimable}) - deductions(${note1Count + note2Count + note4Count + note5Count}) - preProv(${preProvisionsCount}) = ${derivedTotal}, ` +
      `but PDF says totalClaimableForPayment=${totalClaimableForPayment}. Delta=${Math.abs(derivedTotal - totalClaimableForPayment)}.`,
    );
  }

  const result: ParsedPaymentSummary = {
    project,
    weekEnding,
    totalOnts,
    previouslyInvoiced,
    claimable,
    note1Count,
    note2Count,
    note3Count,
    note4Count,
    note5Count,
    preProvisionsCount,
    totalClaimableForPayment,
    parseWarnings: warnings,
  };

  log.info('FT payment PDF parsed', {
    filename,
    project,
    weekEnding,
    totalOnts,
    claimable,
    totalClaimableForPayment,
    warningCount: warnings.length,
  }, 'billing-pdf');

  return result;
}

// ─── XLSX Notes Parser ───────────────────────────────────────────────────────

/** Maps note section header markers to note type keys */
const NOTE_LABEL_MAP: Record<string, ParsedDeduction['note']> = {
  'note 1:': 'note1',
  'note 2:': 'note2',
  'note 3:': 'note3',
  'note 4:': 'note4',
  'note 5:': 'note5',
};

/** Pattern to identify DR number cells: DR followed by digits */
const DR_PATTERN = /^DR\d+/i;

/** Pattern for ONT serial numbers (ALCL prefix common for FiberTime) */
const SERIAL_PATTERN = /^(ALCL|ALHN|HWTC|ZTEG|DSAN)/i;

/** Pattern to identify team codes used in the field (e.g., law, moh, mam) */
const TEAM_PATTERN = /^(law|moh|mam|vel|mid|sow|bel|kwa|dev|lan)/i;

/**
 * Coerce an XLSX cell value to a trimmed string, or empty string if null/undefined.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Parse a FiberTime Notes XLSX file and extract per-DR deduction records.
 *
 * The workbook has one or more sheets. The relevant sheet (usually first or
 * named "Notes") contains sections demarcated by "Note 1:", "Note 2:", etc.
 * Within each section, data rows begin with a DR number in one of the first
 * few columns.
 *
 * @param buffer - Raw XLSX file bytes
 * @returns All deductions found across all note sections with any warnings
 */
export async function parseNotesXlsx(buffer: Buffer): Promise<NotesParseResult> {
  const warnings: string[] = [];
  const deductions: ParsedDeduction[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Failed to read Notes XLSX', { error: msg }, 'billing-xlsx');
    throw new Error(`Could not read XLSX file: ${msg}`);
  }

  // Prefer a sheet named "Notes"; fall back to the first sheet
  const sheetName =
    workbook.SheetNames.find(n => /notes/i.test(n)) ?? workbook.SheetNames[0];

  if (!sheetName) {
    warnings.push('XLSX workbook has no sheets — no deductions extracted');
    return { deductions, parseWarnings: warnings };
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    warnings.push(`Sheet "${sheetName}" is empty — no deductions extracted`);
    return { deductions, parseWarnings: warnings };
  }

  // Convert to raw row arrays for positional parsing
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  log.info('Parsing Notes XLSX', {
    sheetName,
    rowCount: rows.length,
  }, 'billing-xlsx');

  let currentNote: ParsedDeduction['note'] | null = null;
  let headerRowSeen = false;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!;
    if (row.length === 0) continue;

    // Check for a note section marker in any cell of the row
    const rowText = row.map(cellToString).join(' ').toLowerCase();
    let foundNoteMarker = false;
    for (const [marker, noteKey] of Object.entries(NOTE_LABEL_MAP)) {
      if (rowText.includes(marker)) {
        currentNote = noteKey;
        headerRowSeen = false; // Reset: next non-empty row may be a header
        foundNoteMarker = true;
        break;
      }
    }
    if (foundNoteMarker) continue;

    // No active note section yet
    if (!currentNote) continue;

    // The first non-marker row after a note section start is a header row — skip it
    if (!headerRowSeen) {
      const hasHeader = row.some(cell => {
        const s = cellToString(cell).toLowerCase();
        return s === 'dr' || s === 'drop' || s === 'serial' || s === 'team' || s === 'reason';
      });
      if (hasHeader) {
        headerRowSeen = true;
        continue;
      }
      // Some sheets omit headers — mark as seen and fall through to data parsing
      headerRowSeen = true;
    }

    // Look for a DR number across all cells in this row
    let drNumber = '';
    let serialNumber: string | undefined;
    let team: string | undefined;
    let reason: string | undefined;

    for (const cell of row) {
      const s = cellToString(cell);
      if (!s) continue;

      if (!drNumber && DR_PATTERN.test(s)) {
        drNumber = s.toUpperCase();
        continue;
      }
      if (!serialNumber && SERIAL_PATTERN.test(s)) {
        serialNumber = s.toUpperCase();
        continue;
      }
      if (!team && TEAM_PATTERN.test(s)) {
        team = s.toLowerCase();
        continue;
      }
      // Anything else that is longer than 5 chars and not already assigned is likely a reason
      if (!reason && s.length > 5 && !DR_PATTERN.test(s) && !SERIAL_PATTERN.test(s)) {
        reason = s;
      }
    }

    if (!drNumber) continue; // Not a data row

    deductions.push({
      drNumber,
      note: currentNote,
      ...(serialNumber ? { serialNumber } : {}),
      ...(team ? { team } : {}),
      ...(reason ? { reason } : {}),
    });
  }

  log.info('Notes XLSX parsed', {
    sheetName,
    deductionCount: deductions.length,
    warningCount: warnings.length,
  }, 'billing-xlsx');

  return { deductions, parseWarnings: warnings };
}
