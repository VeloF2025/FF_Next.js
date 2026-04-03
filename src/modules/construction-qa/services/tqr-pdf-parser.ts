/**
 * TQR PDF Text Parser
 *
 * Extracts structured metadata and findings from pdftotext -layout output
 * for Tera Fibre Quality Report (TQR) documents.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH (validated against real TQR 0012/2026)
 */

// ============================================================
// Result Types
// ============================================================

export interface TqrMetadata {
  reportNumber: string | null;
  auditDate: string | null;
  siteName: string | null;
  /** Address field from cover page (e.g. "Etwatwa") — used for project auto-detection */
  address: string | null;
  client: string | null;
  contractor: string | null;
  auditor: string | null;
}

export interface TqrFinding {
  snagNumber: number;
  description: string;
  category: 'quality' | 'health' | 'safety' | 'environment' | 'traffic';
}

export interface TqrAuditScores {
  qualityAssurance: number;
  qualityNc: number;
  healthAssurance: number;
  healthNc: number;
  safetyAssurance: number;
  safetyNc: number;
  environmentAssurance: number;
  environmentNc: number;
  trafficAssurance: number;
  trafficNc: number;
}

/** Ordered list of snag numbers per photo slot, derived from grid text */
export interface TqrGridMapping {
  /** snagNumbers[i] is the snag number for the i-th snag photo (0-indexed) */
  snagNumbers: number[];
  /** Total photo slots parsed from grid text */
  totalSlots: number;
}

export interface TqrParseResult {
  metadata: TqrMetadata;
  findings: TqrFinding[];
  gridMapping: TqrGridMapping;
  auditScores: TqrAuditScores;
}

// ============================================================
// Category Detection
// ============================================================

/**
 * Determine the finding category from the "Finding:" header line.
 * Pattern: "Finding: Quality X Health    Environment    Traffic    Safety"
 * The "X" immediately follows the active category name.
 */
function detectCategory(findingHeader: string): TqrFinding['category'] {
  // Category is the word immediately before "X"
  const match = findingHeader.match(
    /(?:finding[:\s]*)(\w+)\s+X\b/i
  );
  if (match && match[1]) {
    const raw = match[1].toLowerCase();
    if (raw === 'quality')     return 'quality';
    if (raw === 'health')      return 'health';
    if (raw === 'safety')      return 'safety';
    if (raw === 'environment') return 'environment';
    if (raw === 'traffic')     return 'traffic';
  }
  // Default fallback — quality is most common
  return 'quality';
}

// ============================================================
// Metadata Parser
// ============================================================

/**
 * Extract cover-page metadata from the text.
 *
 * Expected patterns (flexible whitespace):
 *   Site Name:       ETW.02.797012
 *   Audit Date:      2026-02-03
 *   Report Document No:  TQR 0012/2026
 *   Client:          Fibertime
 *   Contractor:      Velocity Fibre
 */
export function parseMetadata(text: string): TqrMetadata {
  const extract = (pattern: RegExp): string | null => {
    const m = text.match(pattern);
    return (m && m[1]) ? m[1].trim() : null;
  };

  // Report number: TQR NNNN/YYYY or TQR NNNNNNNN (no slash variant)
  const reportNumber = extract(/Report\s+Document\s+No[:\s]+([A-Z]+\s+[\d/]+)/i);

  // Audit date: ISO or DD-MM-YYYY
  const rawDate = extract(/Audit\s+Date[:\s]+(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/i);
  let auditDate: string | null = null;
  if (rawDate) {
    // Normalise DD-MM-YYYY to YYYY-MM-DD
    const ddmmyyyy = rawDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    auditDate =
      ddmmyyyy && ddmmyyyy[1] && ddmmyyyy[2] && ddmmyyyy[3]
        ? `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
        : rawDate;
  }

  const siteName   = extract(/Site\s+Name[:\s]+(.+)/i);
  const client     = extract(/Client[:\s]+(.+)/i);
  const contractor = extract(/Contractor[:\s]+(.+)/i);

  // Address: "Address:      Etwatwa" from cover page
  const address = extract(/Address[:\s]+(.+)/i);

  // Auditor: "report was prepared by <name>"
  const auditor = extract(/prepared\s+by\s+(.+?)(?:\s*\/\s*.+)?$/im);

  return {
    reportNumber: reportNumber ? reportNumber.replace(/\s+/, ' ') : null,
    auditDate,
    siteName,
    address,
    client,
    contractor,
    auditor,
  };
}

// ============================================================
// Findings Parser
// ============================================================

/**
 * Extract individual findings from the findings section.
 *
 * The section starts at the line matching /Finding:\s+(\w+)\s+X/
 * and ends when we hit GPS coordinates or an empty section.
 *
 * Lines like: "  1.  Compaction around the pole not correct."
 */
export function parseFindings(text: string, category: TqrFinding['category']): TqrFinding[] {
  const lines = text.split('\n');
  const findings: TqrFinding[] = [];

  // Find the start of the numbered findings block
  let inFindings = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect the "Finding:" header line
    if (/^1\.\s+Finding:/i.test(trimmed)) {
      inFindings = true;
      continue;
    }

    if (!inFindings) continue;

    // Match numbered finding lines: "N.  Description text"
    const findingMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (findingMatch && findingMatch[1] && findingMatch[2]) {
      const num = parseInt(findingMatch[1], 10);
      const desc = findingMatch[2].trim();

      // Stop if we hit the GPS coordinate lines (pure numbers + decimals)
      if (/^-?\d+\.\d+\s+-?\d+\.\d+/.test(desc)) {
        break;
      }

      findings.push({ snagNumber: num, description: desc, category });
      continue;
    }

    // Stop at GPS line: "1   -26.119823 28.48195   1   ..."
    if (/^\d+\s+-\d+\.\d+/.test(trimmed)) {
      break;
    }
  }

  return findings;
}

// ============================================================
// Grid Mapping Parser
// ============================================================

/**
 * Parse the photo-grid text to get an ordered sequence of snag numbers.
 *
 * Each grid slot has a line like:
 *   "1               -26.119823 28.48195"
 * The leading number is the snag number for that photo.
 *
 * Grid pages are pages 3-7 in the PDF. In the text file, these are
 * identified by sections between "Page 2 of 10" and "Page 8 of 10".
 */
export function parseGridMapping(text: string): TqrGridMapping {
  const snagNumbers: number[] = [];

  // Multi-column GPS pattern: "N  -lat  lon" groups (global, multiple per line)
  // Example line: "1   -26.119823 28.48195   1   -26.119711 28.481402   1  ..."
  const groupPattern = /(\d+)\s+-\d+\.\d+\s+\d+\.\d+/g;

  const lines = text.split('\n');
  let inGridSection = false;

  for (const line of lines) {
    // Start parsing after page 2 heading
    if (/Page\s+2\s+of\s+10/i.test(line)) {
      inGridSection = true;
      continue;
    }
    // Stop before the recommendations section
    if (/Risk\s+Identification\s*\/\s*Recommendation/i.test(line)) {
      break;
    }
    if (!inGridSection) continue;

    // Extract all (snagNum, lat, lon) groups from this line
    groupPattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = groupPattern.exec(line)) !== null) {
      if (m[1]) {
        snagNumbers.push(parseInt(m[1], 10));
      }
    }
  }

  return { snagNumbers, totalSlots: snagNumbers.length };
}

// ============================================================
// Audit Scores Parser
// ============================================================

/**
 * Extract Quality Audit Results chart values from text.
 *
 * Pattern in text (two rows after chart section):
 *   "Assurance        28        0        0        0        0        36"
 *   "Non - Conformance  50       0        0        0        0        64"
 *
 * Columns: Quality, Health, Safety, Environment, Traffic, AssuranceNC
 * Note: last column is "Assurance / NC" which applies to traffic+NC combined
 */
export function parseAuditScores(text: string): TqrAuditScores {
  const defaultScores: TqrAuditScores = {
    qualityAssurance: 0, qualityNc: 0,
    healthAssurance: 0,  healthNc: 0,
    safetyAssurance: 0,  safetyNc: 0,
    environmentAssurance: 0, environmentNc: 0,
    trafficAssurance: 0, trafficNc: 0,
  };

  // Match the Assurance row: "Assurance   28   0   0   0   0   36"
  const assuranceMatch = text.match(
    /Assurance\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i
  );
  // Match the Non-Conformance row
  const ncMatch = text.match(
    /Non\s*-?\s*Conformance\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i
  );

  if (!assuranceMatch || !ncMatch) return defaultScores;

  return {
    qualityAssurance:     parseInt(assuranceMatch[1] ?? '0', 10),
    healthAssurance:      parseInt(assuranceMatch[2] ?? '0', 10),
    safetyAssurance:      parseInt(assuranceMatch[3] ?? '0', 10),
    environmentAssurance: parseInt(assuranceMatch[4] ?? '0', 10),
    trafficAssurance:     parseInt(assuranceMatch[5] ?? '0', 10),
    qualityNc:            parseInt(ncMatch[1] ?? '0', 10),
    healthNc:             parseInt(ncMatch[2] ?? '0', 10),
    safetyNc:             parseInt(ncMatch[3] ?? '0', 10),
    environmentNc:        parseInt(ncMatch[4] ?? '0', 10),
    trafficNc:            parseInt(ncMatch[5] ?? '0', 10),
  };
}

// ============================================================
// Main Parser Entry Point
// ============================================================

/**
 * Parse the full pdftotext -layout output of a TQR PDF.
 * Returns structured metadata, findings, photo-grid mapping, and audit scores.
 */
export function parseTqrText(text: string): TqrParseResult {
  const metadata = parseMetadata(text);

  // Detect category from the "Finding:" header line
  const findingHeaderMatch = text.match(/(\d+\.\s+Finding:[^\n]+)/i);
  const category = (findingHeaderMatch && findingHeaderMatch[1])
    ? detectCategory(findingHeaderMatch[1])
    : 'quality';

  const findings    = parseFindings(text, category);
  const gridMapping = parseGridMapping(text);
  const auditScores = parseAuditScores(text);

  return { metadata, findings, gridMapping, auditScores };
}
