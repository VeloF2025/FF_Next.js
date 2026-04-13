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

/** GPS and pole metadata for a single photo slot in the TQR grid */
export interface TqrGridSlot {
  /** Snag number for this photo slot */
  snagNumber: number;
  /** GPS latitude from the PDF grid text, or null if not found */
  latitude: number | null;
  /** GPS longitude from the PDF grid text, or null if not found */
  longitude: number | null;
  /** Pole reference label above this photo slot (e.g. "CO4", "PH258B"), or null */
  poleReference: string | null;
}

/** Ordered list of snag numbers per photo slot, derived from grid text */
export interface TqrGridMapping {
  /** Full slot data including GPS and pole reference per photo (0-indexed) */
  slots: TqrGridSlot[];
  /** snagNumbers[i] is the snag number for the i-th snag photo — kept for backward compatibility */
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
// Discipline Classification
// ============================================================

/**
 * Classify a TQR finding description into a work discipline for team
 * routing. Used by PR 3 of the April-11 NOC taxonomy refactor to populate
 * maintenance_tickets.type (discipline) for snag tickets created from TQR
 * PDF imports.
 *
 * The TQR `category` field (quality / health / safety / environment /
 * traffic) is an audit-axis classification and does not map to work
 * disciplines — every TQR finding regardless of category can be civils,
 * optical, or activations work. The real signal is the finding text.
 *
 * Keyword lists are ordered by specificity: optical checks run first (the
 * most discriminating vocabulary), then activations, then civils as the
 * fallback since the bulk of TQR findings are civils (pole, compaction,
 * trench, chamber, backfill) work.
 */
export type SnagDiscipline = 'civils' | 'optical' | 'activations';

const OPTICAL_KEYWORDS = [
  'splice', 'splicing', 'fusion',
  'fiber', 'fibre',
  'otdr', 'attenuation', 'insertion loss',
  'connector', 'closure', 'rosette',
  'slack', 'drop cable', 'feeder', 'distribution cable',
  'micro duct', 'microduct',
  'odf', 'patch panel',
  'cable management', 'cable labelling', 'cable labeling',
];

const ACTIVATIONS_KEYWORDS = [
  'ont', 'olt',
  'activation', 'activate', 'provisioning', 'provision',
  'service turn', 'turn up', 'turn-up',
  'light level', 'rx level', 'tx level', 'power level',
  'signal', 'connectivity', 'link light',
  'install complete', 'incomplete install',
];

const CIVILS_KEYWORDS = [
  'compaction', 'backfill',
  'trench', 'trenching',
  'pole', 'poles',
  'conduit', 'duct',
  'chamber', 'manhole', 'hand hole', 'handhole',
  'excavation',
  'reinstatement', 'reinstate',
  'paving', 'concrete',
  'surface', 'earthworks',
  'dome joint', 'joint',
  'ground level', 'depth',
];

/**
 * Classify a TQR finding description into a work discipline.
 * Defaults to 'civils' when no keywords match — the vast majority of TQR
 * findings are civil-work audit items (pole placement, trench quality,
 * compaction) so civils is the safest fallback.
 */
export function classifySnagDiscipline(description: string): SnagDiscipline {
  if (!description) return 'civils';
  const lower = description.toLowerCase();

  // Optical is most specific — check first
  for (const keyword of OPTICAL_KEYWORDS) {
    if (lower.includes(keyword)) return 'optical';
  }

  // Activations next
  for (const keyword of ACTIVATIONS_KEYWORDS) {
    if (lower.includes(keyword)) return 'activations';
  }

  // Civils keywords as the explicit positive case
  for (const keyword of CIVILS_KEYWORDS) {
    if (lower.includes(keyword)) return 'civils';
  }

  // Fallback — TQR is predominantly a civils audit
  return 'civils';
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
 * Returns true if a line contains only pole reference labels (e.g. "CO4", "PH258B").
 * Pole refs are 1–3 groups of uppercase letters followed by digits and optional letters,
 * separated by whitespace. Lines with 1–3 such tokens and nothing else.
 *
 * Examples that match: "CO4", "PH258B  PH256  PH257", "PH258B"
 * Examples that don't: "Finding: ...", "-26.1  28.4", plain numbers
 */
function isPoleReferenceLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Must consist solely of tokens like CO4, PH258B, PH256A — at least one
  return /^[A-Z]{1,4}\d+[A-Z]?(?:\s{2,}[A-Z]{1,4}\d+[A-Z]?){0,2}$/.test(trimmed);
}

/**
 * Split a pole-reference line into up to 3 column values.
 * Uses 2+ spaces as the column delimiter (same layout convention as GPS lines).
 */
function splitPoleReferenceLine(line: string): (string | null)[] {
  const parts = line.trim().split(/\s{2,}/);
  return [
    parts[0] ?? null,
    parts[1] ?? null,
    parts[2] ?? null,
  ];
}

/**
 * Parse the photo-grid text to extract an ordered sequence of snag numbers,
 * GPS coordinates (latitude/longitude), and pole reference labels per slot.
 *
 * Grid layout (3 photos per row):
 *   PoleRef          PoleRef          PoleRef       ← pole reference line
 *   N  -lat  lon     N  -lat  lon     N  -lat  lon  ← GPS line
 *
 * Grid pages are pages 3-7 in the PDF. In the text file, these are
 * identified by sections between "Page 2 of 10" and the recommendations section.
 */
export function parseGridMapping(text: string): TqrGridMapping {
  // GPS line pattern: up to 3 groups of "snagNum  -lat  lon" on one line
  // Example: "1   -26.119823 28.48195   1   -26.119711 28.481402   1  -26.119648 28.480923"
  const _gpsGroupPattern = /(\d+)\s+(-\d+\.\d+)\s+(\d+\.\d+)/g;

  const lines = text.split('\n');
  let inGridSection = false;

  // We collect rows: each GPS line has up to 3 slots; the line immediately before
  // it (if it looks like a pole-ref line) gives us the pole references.
  const slots: TqrGridSlot[] = [];
  let pendingPoleRefs: (string | null)[] = [null, null, null];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] ?? '';

    // Start parsing after page 2 heading (any page count)
    if (/Page\s+2\s+of\s+\d+/i.test(line)) {
      inGridSection = true;
      continue;
    }
    // Stop before the recommendations section or quality audit results
    if (/Risk\s+Identification|Recommendation|Quality\s+Audit\s+Results/i.test(line)) {
      break;
    }
    if (!inGridSection) continue;

    // Detect pole reference lines and buffer them
    if (isPoleReferenceLine(line)) {
      pendingPoleRefs = splitPoleReferenceLine(line);
      continue;
    }

    // Detect grid data lines: GPS coords, pole refs, or DR refs
    // Format A (2026): "1  -26.119  28.481   1  -26.119  28.481"
    // Format B (2025): "1  P.I031   1  P.H884   1  P.H888"
    // Format C (2025): "1  DR170291   1  DR175032   1  DR170552"
    // Format D (mixed): "1  -26.123,28.489   1  P.I031   1  DR170291"
    // Format E (2026):  "1  PC064   2  DR2598840   3  PC063"  (PC = cabinet/connection point)
    // Refs: P.XXXX (pole), DR/DRXXXXXX (drop), PC/CO/PLXX (label), or GPS coords
    const gridLinePattern = /(\d{1,2})\s+((?:-?\d+\.\d+[,\s]\s*\d+\.\d+)|(?:P\.[A-Z]\s?\d{3,5}[A-Z]?)|(?:DR\d{5,7})|(?:PC\d{1,4})|(?:CO\d{1,3})|(?:PL\d{1,3})|(?:PH\d{2,4}[A-Z]?))/g;
    gridLinePattern.lastIndex = 0;
    const gridMatches: Array<{ snagNumber: number; latitude: number | null; longitude: number | null; poleRef: string | null }> = [];
    let m: RegExpExecArray | null;
    while ((m = gridLinePattern.exec(line)) !== null) {
      if (!m[1] || !m[2]) continue;
      const snagNum = parseInt(m[1], 10);
      if (snagNum > 100) continue; // Skip page numbers etc. (some reports have 70+ findings)
      const val = m[2].trim();
      // Check if it's a GPS coordinate (contains negative sign or comma separator)
      const gpsMatch = val.match(/(-?\d+\.\d+)[,\s]\s*(\d+\.\d+)/);
      if (gpsMatch && gpsMatch[1] && gpsMatch[2]) {
        gridMatches.push({ snagNumber: snagNum, latitude: parseFloat(gpsMatch[1]), longitude: parseFloat(gpsMatch[2]), poleRef: null });
      } else {
        // It's a pole reference (P.I031, P.H884)
        gridMatches.push({ snagNumber: snagNum, latitude: null, longitude: null, poleRef: val });
      }
    }

    if (gridMatches.length > 0) {
      for (let col = 0; col < gridMatches.length; col++) {
        const gm = gridMatches[col];
        if (!gm) continue;
        slots.push({
          snagNumber:    gm.snagNumber,
          latitude:      gm.latitude,
          longitude:     gm.longitude,
          poleReference: gm.poleRef ?? pendingPoleRefs[col] ?? null,
        });
      }
      // Reset pending pole refs after consuming
      pendingPoleRefs = [null, null, null];
    }
  }

  const snagNumbers = slots.map((s) => s.snagNumber);
  return { slots, snagNumbers, totalSlots: slots.length };
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
