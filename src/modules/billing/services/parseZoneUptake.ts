/**
 * FiberTime "Installation Uptake" PDF parser.
 *
 * Handles two PDF variants that ship alongside the weekly FT payment summary:
 *
 *   1. "<Project>_installation uptake per zone_<weekcode>.pdf"
 *      Columns: zone_no | Sum of Planned Drop | Sum of Installed | % of installed
 *
 *   2. "<Project>_installation uptake per zone per pon_<weekcode>.pdf"
 *      Columns: zone_no | pon_no | Sum of Planned Drop | Sum of Installed | % of installed
 *      Zone numbers repeat — `pon_no` is unique within a zone.
 *
 * Both formats have a "Grand Total" footer that we extract separately for
 * reconcile checks against the FT payment summary's total ONT count.
 */

import { log } from '@/lib/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ZoneUptakeRow {
  zoneNo: number;
  plannedDrops: number;
  installed: number;
  pctInstalled: number;
}

export interface ZonePonUptakeRow {
  zoneNo: number;
  ponNo: number;
  plannedDrops: number;
  installed: number;
  pctInstalled: number;
}

export interface ParsedZoneUptake {
  /** Per-zone rollups (20 rows for Lawley). Empty if none found. */
  zones: ZoneUptakeRow[];
  /** Per-zone-per-PON rollups. Only populated for the zone/pon PDF. */
  pons: ZonePonUptakeRow[];
  grandTotal: {
    plannedDrops: number;
    installed: number;
    pctInstalled: number;
  };
  /** True when the PDF was the zone-per-pon variant. */
  hasPonBreakdown: boolean;
  parseWarnings: string[];
}

// ─── pdf-parse loader (shared with parseFTPaymentSummary's pattern) ────────

async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdf-parse v2 is CJS-only; use a runtime require to keep ESM happy.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParseModule = require('pdf-parse') as {
    PDFParse: new (data: Uint8Array) => {
      getText(): Promise<{ pages: { text: string }[] }>;
    };
  };
  const { PDFParse } = pdfParseModule;
  const uint8 = new Uint8Array(buffer);
  const parser = new PDFParse(uint8);
  const result = await parser.getText();
  return result.pages.map((p) => p.text).join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse a percentage string like "19%" → 19, "6.5%" → 6.5. Returns NaN-safe 0. */
function parsePct(s: string): number {
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

function toInt(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s.replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// ─── Parser ────────────────────────────────────────────────────────────────

/**
 * Parse a FiberTime "installation uptake" PDF. Auto-detects whether the
 * document is the per-zone or per-zone-per-pon variant by looking at the
 * header text.
 */
export async function parseZoneUptakePdf(
  buffer: Buffer,
  filename: string,
): Promise<ParsedZoneUptake> {
  const warnings: string[] = [];
  let rawText: string;
  try {
    rawText = await extractPdfText(buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read uptake PDF "${filename}": ${msg}`);
  }

  if (!rawText || rawText.trim().length === 0) {
    throw new Error(`No text content in "${filename}" — PDF may be scanned.`);
  }

  const lines = rawText.split('\n').map((l) => l.trimEnd()).filter(Boolean);

  // Detect variant from filename first, header text as backup
  const hasPonBreakdown =
    /per\s+pon/i.test(filename) ||
    lines.some((l) => /installed\s+per\s+zone\s+per\s+pon/i.test(l));

  log.info('Parsing FT uptake PDF', {
    filename,
    hasPonBreakdown,
    lineCount: lines.length,
  }, 'billing-uptake-pdf');

  const zones: ZoneUptakeRow[] = [];
  const pons: ZonePonUptakeRow[] = [];
  let grandTotal = { plannedDrops: 0, installed: 0, pctInstalled: 0 };

  if (hasPonBreakdown) {
    parseZonePon(lines, zones, pons, warnings);
  } else {
    parseZoneOnly(lines, zones, warnings);
  }

  // Grand Total row — identical layout in both variants
  const grandTotalLine = lines.find((l) => /grand\s+total/i.test(l));
  if (grandTotalLine) {
    // Format: "Grand Total                  23706      6512         27%"
    const nums = [...grandTotalLine.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => m[0]);
    if (nums.length >= 3) {
      grandTotal = {
        plannedDrops: toInt(nums[0]),
        installed: toInt(nums[1]),
        pctInstalled: parsePct(nums[2]!),
      };
    } else {
      warnings.push(`Grand Total line found but could not parse 3 numbers: "${grandTotalLine}"`);
    }
  } else {
    warnings.push('Grand Total line not found in uptake PDF');
  }

  log.info('Uptake PDF parsed', {
    filename,
    zoneCount: zones.length,
    ponCount: pons.length,
    grandTotal,
    warningCount: warnings.length,
  }, 'billing-uptake-pdf');

  return { zones, pons, grandTotal, hasPonBreakdown, parseWarnings: warnings };
}

// ─── Per-zone parser ────────────────────────────────────────────────────────

/**
 * Per-zone PDF lines look like:
 *   "               1              1880       351         19%"
 *   "               2               120          0         0%"
 * We pull three integers + a percentage from each line that has exactly 4
 * numeric tokens and starts with whitespace.
 */
function parseZoneOnly(
  lines: string[],
  zones: ZoneUptakeRow[],
  warnings: string[],
): void {
  for (const line of lines) {
    if (/grand\s+total/i.test(line)) continue;
    // Skip non-data lines by requiring at least 4 numeric tokens
    const nums = [...line.matchAll(/-?\d+(?:\.\d+)?%?/g)].map((m) => m[0]);
    if (nums.length !== 4) continue;
    // Last token must be a percentage
    if (!/%$/.test(nums[3]!)) continue;
    const zoneNo = toInt(nums[0]);
    if (zoneNo <= 0 || zoneNo > 999) continue;
    zones.push({
      zoneNo,
      plannedDrops: toInt(nums[1]),
      installed: toInt(nums[2]),
      pctInstalled: parsePct(nums[3]!),
    });
  }
  if (zones.length === 0) {
    warnings.push('No zone rows extracted from uptake PDF');
  }
}

// ─── Per-zone-per-PON parser ────────────────────────────────────────────────

/**
 * The per-pon PDF groups PONs under each zone. Zone numbers only appear once
 * at the start of a block; PON rows beneath them omit the zone number.
 * Example:
 *   "             1             1               119         69        58%"
 *   "                           2               112         74        66%"
 *   "                          ...
 *   "1 Total                                   1880       351         19%"
 *   "             2            17               120          0         0%"
 *
 * We track the current zone via the "<N> Total" footer and infer zone from
 * whichever numeric context appears. A data row with 5 numeric tokens has
 * [zoneNo, ponNo, planned, installed, pct]. A data row with 4 numeric
 * tokens has [ponNo, planned, installed, pct] — inherit the previous zone.
 */
function parseZonePon(
  lines: string[],
  zones: ZoneUptakeRow[],
  pons: ZonePonUptakeRow[],
  warnings: string[],
): void {
  let currentZone: number | null = null;

  for (const line of lines) {
    // Zone total rollup: "1 Total                                   1880       351         19%"
    const totalMatch = line.match(/^(\d+)\s+Total\b/i);
    if (totalMatch) {
      const nums = [...line.matchAll(/-?\d+(?:\.\d+)?%?/g)].map((m) => m[0]);
      // nums: [zoneNo, planned, installed, pct%]
      if (nums.length >= 4) {
        zones.push({
          zoneNo: toInt(nums[0]),
          plannedDrops: toInt(nums[1]),
          installed: toInt(nums[2]),
          pctInstalled: parsePct(nums[3]!),
        });
      }
      currentZone = null;
      continue;
    }

    if (/grand\s+total/i.test(line)) continue;
    if (/installed\s+per\s+zone/i.test(line)) continue;
    if (/planned|installed|zone_no|pon_no/i.test(line)) continue;

    const nums = [...line.matchAll(/-?\d+(?:\.\d+)?%?/g)].map((m) => m[0]);
    // Must end with a percentage
    if (nums.length === 0 || !/%$/.test(nums[nums.length - 1]!)) continue;

    if (nums.length === 5) {
      // Row includes its own zone number
      const zoneNo = toInt(nums[0]);
      if (zoneNo > 0) currentZone = zoneNo;
      pons.push({
        zoneNo,
        ponNo: toInt(nums[1]),
        plannedDrops: toInt(nums[2]),
        installed: toInt(nums[3]),
        pctInstalled: parsePct(nums[4]!),
      });
    } else if (nums.length === 4 && currentZone !== null) {
      // Row inherits the previous zone
      pons.push({
        zoneNo: currentZone,
        ponNo: toInt(nums[0]),
        plannedDrops: toInt(nums[1]),
        installed: toInt(nums[2]),
        pctInstalled: parsePct(nums[3]!),
      });
    }
  }

  if (pons.length === 0) {
    warnings.push('No zone/PON rows extracted from per-pon uptake PDF');
  }
}
