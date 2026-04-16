# Universal Snag PDF Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing TQR PDF snag import to auto-detect and import "field report" PDFs (3-column table: Photo | Location | Snag), with GPS extraction and photo mapping, using the same upload UI.

**Architecture:** Format is detected from `pdftotext -layout` output before parsing begins. Each format routes to its own parser module. Both share the existing photo extraction (`pdfimages`) and VF Storage upload infrastructure. The API endpoints and UI are shared — zero new buttons.

**Tech Stack:** Next.js API routes, pdftotext, pdfimages, Neon PostgreSQL, VF Storage, Vitest, formidable

**Worktree:** `/home/hein/Workspace/FF_Next.js-snag-import` (branch `feature/universal-snag-pdf-import`)

---

## pdftotext Output Reference

The field report PDF produces this layout (verified by running `pdftotext -layout` on "Etwatwa 2 Snag Report.pdf"):

```
Photo   Location                    Snag
        https://maps.google.com/ Pole Scew
        maps?q=-
        26.1270374%2C28.47388
        11&z=17&hl=en

        26°07'41.2"S 28°28'29.6"E Cable hanging on the ground
        - Google Maps             no is working on it. needs to
                                    be put back on the slack
                                    bracket
26°07'44.1"S 28°28'33.6"E Cable hanging on the ground
- Google Maps             no is working on it. needs to
```

Key observations:
- DMS rows: `DD°MM'SS.S"[NS] DD°MM'SS.S"[EW]` on one line, description to the right
- `- Google Maps` = DMS continuation — description continues to the right
- URL rows: `https://maps.google.com/` on line 1 (description to right), URL fragments on next 3 lines
- Snag description always starts at char position ~33 on its anchor line
- Description wraps as indented right-column text on subsequent lines

---

## File Map

| Action | Path |
|---|---|
| **Create** | `src/modules/construction-qa/services/detect-pdf-format.ts` |
| **Create** | `src/modules/construction-qa/services/field-report-pdf-parser.ts` |
| **Create** | `src/modules/construction-qa/__tests__/services/detect-pdf-format.test.ts` |
| **Create** | `src/modules/construction-qa/__tests__/services/field-report-pdf-parser.test.ts` |
| **Modify** | `src/modules/construction-qa/types/snag.types.ts` |
| **Modify** | `src/modules/construction-qa/services/tqr-image-extractor.ts` |
| **Modify** | `pages/api/snags/preview-pdf.ts` |
| **Modify** | `pages/api/snags/import-pdf.ts` |
| **Modify** | `src/modules/construction-qa/components/snags/SnagImportDialog.tsx` |

---

## Task 1: Add `'field_report'` to SnagPhotoSource type

**Files:**
- Modify: `src/modules/construction-qa/types/snag.types.ts:38-41`

- [ ] **Step 1: Update the union type**

In `snag.types.ts`, find `SnagPhotoSource` (currently at line ~38) and add `'field_report'`:

```typescript
export type SnagPhotoSource =
  | 'tqr_import'
  | 'noc_upload'
  | 'manual'
  | 'whatsapp'
  | 'field_report';
```

- [ ] **Step 2: Verify type-check passes**

```bash
cd /home/hein/Workspace/FF_Next.js-snag-import
npm run type-check 2>&1 | grep -E "error|SnagPhotoSource" | head -20
```

Expected: no new errors related to `SnagPhotoSource`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/construction-qa/types/snag.types.ts
git commit -m "feat(snags): add field_report to SnagPhotoSource union"
```

---

## Task 2: Format detector

**Files:**
- Create: `src/modules/construction-qa/services/detect-pdf-format.ts`
- Create: `src/modules/construction-qa/__tests__/services/detect-pdf-format.test.ts`

- [ ] **Step 1: Create test directory**

The `__tests__/services/` directory does not exist yet. Create it:

```bash
mkdir -p /home/hein/Workspace/FF_Next.js-snag-import/src/modules/construction-qa/__tests__/services
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/construction-qa/__tests__/services/detect-pdf-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectPdfFormat } from '../../services/detect-pdf-format';

const TQR_SAMPLE = `
  Report Document No:  TQR 0012/2026
  Audit Date:          2026-02-03
  1. Finding: Quality X Health    Environment    Traffic    Safety
`;

const FIELD_REPORT_SAMPLE = `
Photo   Location                    Snag
        https://maps.google.com/ Pole Scew
        maps?q=-26.1270374%2C28.473881
26°07'41.2"S 28°28'29.6"E Cable hanging on the ground
`;

const UNKNOWN_SAMPLE = `
  This is a random PDF document
  with no recognisable structure.
`;

describe('detectPdfFormat', () => {
  it('identifies TQR format', () => {
    expect(detectPdfFormat(TQR_SAMPLE)).toBe('tqr');
  });

  it('identifies field report format via Google Maps URL', () => {
    expect(detectPdfFormat(FIELD_REPORT_SAMPLE)).toBe('field_report');
  });

  it('identifies field report format via DMS only', () => {
    const dmsOnly = `26°07'41.2"S 28°28'29.6"E Pole Scew\n- Google Maps`;
    expect(detectPdfFormat(dmsOnly)).toBe('field_report');
  });

  it('returns unknown for unrecognised PDF', () => {
    expect(detectPdfFormat(UNKNOWN_SAMPLE)).toBe('unknown');
  });

  it('prefers TQR when both signatures present', () => {
    const mixed = TQR_SAMPLE + '\nhttps://maps.google.com/ some snag';
    expect(detectPdfFormat(mixed)).toBe('tqr');
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /home/hein/Workspace/FF_Next.js-snag-import
npx vitest run src/modules/construction-qa/__tests__/services/detect-pdf-format.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '../../services/detect-pdf-format'"

- [ ] **Step 4: Create the implementation**

Create `src/modules/construction-qa/services/detect-pdf-format.ts`:

```typescript
/**
 * PDF Snag Format Detector
 *
 * Inspects pdftotext -layout output to determine which parser to use.
 * Status: WORKING
 */

export type PdfSnagFormat = 'tqr' | 'field_report' | 'unknown';

/**
 * Detect the snag report format from pdftotext -layout text output.
 *
 * TQR signature:          "Report Document No" + "Finding:"
 * Field report signature: Google Maps URL or DMS coordinates
 */
export function detectPdfFormat(pdfText: string): PdfSnagFormat {
  // TQR checked first — takes precedence if both signatures appear
  const isTqr =
    /Report\s+Document\s+No/i.test(pdfText) &&
    /Finding:/i.test(pdfText);
  if (isTqr) return 'tqr';

  const hasGoogleMaps = /maps\.google\.com/i.test(pdfText);
  const hasDms = /\d+°\d+'\d+(?:\.\d+)"[NS]/i.test(pdfText);
  const hasSnagColumn = /\bSnag\b/.test(pdfText) || hasDms;

  if ((hasGoogleMaps || hasDms) && hasSnagColumn) return 'field_report';

  return 'unknown';
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx vitest run src/modules/construction-qa/__tests__/services/detect-pdf-format.test.ts 2>&1 | tail -10
```

Expected: PASS — 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/modules/construction-qa/services/detect-pdf-format.ts \
        src/modules/construction-qa/__tests__/services/detect-pdf-format.test.ts
git commit -m "feat(snags): PDF format detector (TQR vs field_report)"
```

---

## Task 3: Field report parser — GPS, severity, right-column extraction, and row extraction

**Files:**
- Create: `src/modules/construction-qa/services/field-report-pdf-parser.ts`
- Create: `src/modules/construction-qa/__tests__/services/field-report-pdf-parser.test.ts`

> **Rationale:** Tasks 3 and 4 from the original plan are merged. The GPS utilities, severity inference, right-column extraction, and `parseFieldReport` are all in the same file and tightly coupled — `parseFieldReport` calls all the helpers directly. Splitting them created an artificial boundary where the parser file would be committed incomplete. One task, one commit.

- [ ] **Step 1: Write all tests (helpers + integration)**

Create `src/modules/construction-qa/__tests__/services/field-report-pdf-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseGpsFromLine,
  inferSeverity,
  extractRightColumnText,
  parseFieldReport,
} from '../../services/field-report-pdf-parser';

// ============================================================
// Unit tests — helper functions
// ============================================================

describe('parseGpsFromLine', () => {
  it('parses decimal Google Maps URL on a single line', () => {
    const line = '        https://maps.google.com/maps?q=-26.1270374%2C28.473881&z=17 Pole Scew';
    expect(parseGpsFromLine(line)).toEqual({ lat: -26.1270374, lng: 28.473881 });
  });

  it('parses DMS South/East coordinates', () => {
    const line = "        26°07'41.2\"S 28°28'29.6\"E Cable hanging on the ground";
    const result = parseGpsFromLine(line);
    expect(result).not.toBeNull();
    // -(26 + 7/60 + 41.2/3600) = -26.12811
    expect(result!.lat).toBeCloseTo(-26.12811, 4);
    // +(28 + 28/60 + 29.6/3600) = 28.47489
    expect(result!.lng).toBeCloseTo(28.47489, 4);
  });

  it('parses DMS at start of line (no leading spaces)', () => {
    const line = "26°07'44.1\"S 28°28'33.6\"E Cable hanging";
    const result = parseGpsFromLine(line);
    expect(result).not.toBeNull();
    // -(26 + 7/60 + 44.1/3600) = -26.12892
    expect(result!.lat).toBeCloseTo(-26.12892, 3);
    // +(28 + 28/60 + 33.6/3600) = 28.47600
    expect(result!.lng).toBeCloseTo(28.47600, 3);
  });

  it('returns null for plain continuation lines', () => {
    expect(parseGpsFromLine('- Google Maps             no is working on it.')).toBeNull();
    expect(parseGpsFromLine('                            be put back on the slack')).toBeNull();
    expect(parseGpsFromLine('')).toBeNull();
  });

  it('returns null for URL fragment lines (not the anchor)', () => {
    expect(parseGpsFromLine('        maps?q=-')).toBeNull();
    expect(parseGpsFromLine('        26.1270374%2C28.47388')).toBeNull();
  });
});

describe('inferSeverity', () => {
  it('returns major for cable on the ground', () => {
    expect(inferSeverity('Cable hanging on the ground no is working on it')).toBe('major');
  });

  it('returns major for incorrectly installed cable', () => {
    expect(inferSeverity('Cable entering the slack brackets incorrectly')).toBe('major');
  });

  it('returns major for fallen', () => {
    expect(inferSeverity('Cable fallen off the pole')).toBe('major');
  });

  it('returns minor for pole scew', () => {
    expect(inferSeverity('Pole Scew')).toBe('minor');
  });

  it('returns minor for no slack bracket', () => {
    expect(inferSeverity('No Slack Bracket')).toBe('minor');
  });

  it('returns minor for bush clearance', () => {
    expect(inferSeverity('Bush Clearance')).toBe('minor');
  });

  it('is case-insensitive', () => {
    expect(inferSeverity('CABLE HANGING ON THE GROUND')).toBe('major');
  });
});

describe('extractRightColumnText', () => {
  it('returns text after char 33', () => {
    // 33 spaces + "Pole Scew"
    const line = ' '.repeat(33) + 'Pole Scew';
    expect(extractRightColumnText(line)).toBe('Pole Scew');
  });

  it('returns empty for short lines', () => {
    expect(extractRightColumnText('short')).toBe('');
  });

  it('excludes Google Maps continuation marker', () => {
    const line = ' '.repeat(8) + '- Google Maps             no is working';
    // "no is working" is at char 33+, but "- Google Maps" itself is before 33
    // The function looks at text after char 33
    expect(extractRightColumnText(line)).toBe('no is working');
  });

  it('excludes URL fragments in the right column', () => {
    const urlFragLine = ' '.repeat(8) + 'maps?q=-26.123%2C28.456';
    expect(extractRightColumnText(urlFragLine)).toBe('');
  });
});

// ============================================================
// Integration tests — parseFieldReport
// ============================================================

// Approximates what pdftotext -layout produces for the Etwatwa 2 report
const SAMPLE_PDF_TEXT = `Photo   Location                    Snag
        https://maps.google.com/ Pole Scew
        maps?q=-
        26.1270374%2C28.47388
        11&z=17&hl=en




        26°07'41.2"S 28°28'29.6"E Cable hanging on the ground
        - Google Maps             no is working on it. needs to
                                    be put back on the slack
                                    bracket
26°07'44.1"S 28°28'33.6"E Cable hanging on the ground
- Google Maps             no is working on it.

26°07'51.1"S 28°28'35.0"E Pole Scew
- Google Maps

26°07'49.2"S 28°28'34.9"E Bush Clearance
- Google Maps

26°07'27.1"S 28°28'22.9"E No Slack Bracket
- Google Maps
`;

describe('parseFieldReport', () => {
  it('extracts all snag rows', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'Etwatwa 2 Snag Report.pdf');
    expect(result.format).toBe('field_report');
    expect(result.rows.length).toBeGreaterThanOrEqual(5);
  });

  it('sets suggestedName from filename', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'Etwatwa 2 Snag Report.pdf');
    expect(result.suggestedName).toBe('Etwatwa 2 Snag Report');
  });

  it('assigns rowIndex sequentially', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'test.pdf');
    result.rows.forEach((row, i) => {
      expect(row.rowIndex).toBe(i);
    });
  });

  it('extracts DMS GPS coordinates', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'test.pdf');
    const cableRow = result.rows.find(r => r.description.includes('Cable hanging'));
    expect(cableRow).toBeDefined();
    expect(cableRow!.latitude).toBeCloseTo(-26.12811, 3);
    expect(cableRow!.longitude).toBeCloseTo(28.47489, 3);
  });

  it('collects multi-line description from DMS row', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'test.pdf');
    // Find the row with the multi-line description
    const cableRow = result.rows.find(r =>
      r.description.includes('Cable hanging') && r.description.includes('no is working')
    );
    expect(cableRow).toBeDefined();
    expect(cableRow!.description).toContain('no is working on it');
  });

  it('infers severity correctly', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'test.pdf');
    const cableRow = result.rows.find(r => r.description.includes('Cable hanging'));
    const poleRow  = result.rows.find(r => r.description === 'Pole Scew');
    expect(cableRow!.severity).toBe('major');
    expect(poleRow!.severity).toBe('minor');
  });

  it('sets category to quality for all rows', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'test.pdf');
    result.rows.forEach(row => {
      expect(row.category).toBe('quality');
    });
  });

  it('handles URL-format GPS row — description extracted correctly', () => {
    const result = parseFieldReport(SAMPLE_PDF_TEXT, 'test.pdf');
    const urlRow = result.rows[0];
    expect(urlRow).toBeDefined();
    expect(urlRow!.description).toBe('Pole Scew');
  });

  it('returns empty rows for text with no GPS', () => {
    const result = parseFieldReport('Some random text\nNo GPS here\n', 'test.pdf');
    expect(result.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/hein/Workspace/FF_Next.js-snag-import
npx vitest run src/modules/construction-qa/__tests__/services/field-report-pdf-parser.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create the full implementation**

Create `src/modules/construction-qa/services/field-report-pdf-parser.ts`:

```typescript
/**
 * Field Report PDF Parser
 *
 * Parses "field report" PDFs: 3-column table (Photo | Location | Snag).
 * Input: pdftotext -layout output.
 *
 * Status: WORKING
 */

import type { SnagSeverity, SnagCategory } from '../types/snag.types';

// ============================================================
// Output Types
// ============================================================

export interface FieldSnagRow {
  /** 0-based index — maps to photo extraction order */
  rowIndex: number;
  description: string;
  latitude: number | null;
  longitude: number | null;
  /** Original GPS string for logging */
  gpsRaw: string | null;
  severity: SnagSeverity;
  category: SnagCategory;
}

export interface FieldReportParseResult {
  format: 'field_report';
  rows: FieldSnagRow[];
  /** Cleaned filename or 'Field Report' */
  suggestedName: string;
}

// ============================================================
// GPS Parsing
// ============================================================

const DMS_PATTERN = /(\d+)°(\d+)'([\d.]+)"([NS])\s+(\d+)°(\d+)'([\d.]+)"([EW])/;
const GMAPS_ANCHOR = /https?:\/\/maps\.google\.com\//i;
const URL_DECIMAL_PATTERN = /[?&]q=(-?\d+\.?\d+)%2[Cc](\d+\.?\d+)/i;

function dmsToDecimal(deg: string, min: string, sec: string, dir: string): number {
  const val = parseInt(deg, 10) + parseInt(min, 10) / 60 + parseFloat(sec) / 3600;
  return (dir === 'S' || dir === 'W') ? -val : val;
}

/**
 * Extract GPS coordinates from a single pdftotext line.
 * Returns null if the line is not a GPS anchor line.
 *
 * Handles:
 *   - DMS: "26°07'41.2"S 28°28'29.6"E"
 *   - Google Maps URL with inline decimal: "https://maps.google.com/maps?q=-26.123%2C28.456"
 *
 * Does NOT handle multi-line URL reconstruction — caller does that.
 */
export function parseGpsFromLine(line: string): { lat: number; lng: number } | null {
  // DMS pattern
  const dmsMatch = line.match(DMS_PATTERN);
  if (dmsMatch && dmsMatch[1] && dmsMatch[2] && dmsMatch[3] && dmsMatch[4] &&
      dmsMatch[5] && dmsMatch[6] && dmsMatch[7] && dmsMatch[8]) {
    return {
      lat: dmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4]),
      lng: dmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8]),
    };
  }

  // Google Maps URL with inline decimal coords (full URL on one line)
  if (GMAPS_ANCHOR.test(line)) {
    const urlMatch = line.match(URL_DECIMAL_PATTERN);
    if (urlMatch && urlMatch[1] && urlMatch[2]) {
      return { lat: parseFloat(urlMatch[1]), lng: parseFloat(urlMatch[2]) };
    }
    // URL found but coords split across following lines — return null, caller reconstructs
    return null;
  }

  return null;
}

// ============================================================
// Severity Inference
// ============================================================

const MAJOR_KEYWORDS = [
  'hanging',
  'on the ground',
  'incorrectly',
  'broken',
  'not working',
  'no is working',
  'fallen',
  'damaged',
];

export function inferSeverity(description: string): SnagSeverity {
  const lower = description.toLowerCase();
  for (const kw of MAJOR_KEYWORDS) {
    if (lower.includes(kw)) return 'major';
  }
  return 'minor';
}

// ============================================================
// Right-column text extraction
// ============================================================

/**
 * Extract snag description text from the right column of a pdftotext line.
 * The right column starts at approximately char 33 in this format.
 *
 * Excludes URL fragments and "- Google Maps" continuation markers.
 */
const SNAG_COL_START = 33;

export function extractRightColumnText(line: string): string {
  if (line.length <= SNAG_COL_START) return '';

  const rightPart = line.substring(SNAG_COL_START).trim();

  if (!rightPart) return '';
  if (/^-?\s*Google\s+Maps/i.test(rightPart)) return '';
  if (/^maps\?q=/i.test(rightPart)) return '';
  if (/^https?:\/\//i.test(rightPart)) return '';
  if (/^[\d.]+%2C/i.test(rightPart)) return '';
  if (/^[\d.]+&z=/i.test(rightPart)) return '';
  if (/^\d+&z=/i.test(rightPart)) return '';

  return rightPart;
}

// ============================================================
// Multi-line URL GPS reconstruction
// ============================================================

/**
 * Reconstruct full Google Maps URL from the anchor line + following URL fragment lines,
 * then extract lat/lng.
 *
 * Example (4 lines from pdftotext):
 *   "        https://maps.google.com/ Pole Scew"
 *   "        maps?q=-"
 *   "        26.1270374%2C28.47388"
 *   "        11&z=17&hl=en"
 *
 * Concatenated: "https://maps.google.com/maps?q=-26.1270374%2C28.4738811&z=17&hl=en"
 */
function reconstructUrlGps(
  anchorLine: string,
  followingLines: string[]
): { lat: number; lng: number } | null {
  const fragments: string[] = [anchorLine.trim()];
  for (const fl of followingLines.slice(0, 5)) {
    const t = fl.trim();
    if (!t) break;
    // Stop when we hit a new GPS anchor
    if (DMS_PATTERN.test(t) || GMAPS_ANCHOR.test(t)) break;
    // Only collect URL fragment lines
    if (!/^(maps\?|[\d.]+%2C|[\d.]+&z=|[\d-]+&|\d+&)/i.test(t)) break;
    fragments.push(t);
  }

  const joined = fragments.join('').replace(/\s+/g, '');
  const urlMatch = joined.match(/[?&]q=(-?\d+\.?\d+)%2[Cc](\d+\.?\d+)/i);
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    return { lat: parseFloat(urlMatch[1]), lng: parseFloat(urlMatch[2]) };
  }
  return null;
}

// ============================================================
// Main Parser
// ============================================================

/**
 * Parse pdftotext -layout output of a field report PDF.
 * Returns ordered snag rows suitable for direct DB import.
 */
export function parseFieldReport(
  pdfText: string,
  filenameHint: string = 'Field Report'
): FieldReportParseResult {
  const lines = pdfText.split('\n');
  const rows: FieldSnagRow[] = [];
  let rowIndex = 0;

  let currentGps: { lat: number; lng: number } | null = null;
  let currentGpsRaw: string | null = null;
  let currentDesc: string[] = [];
  let inUrlBlock = false;

  const flushRow = () => {
    const description = currentDesc.join(' ').replace(/\s+/g, ' ').trim();
    if (description) {
      rows.push({
        rowIndex: rowIndex++,
        description,
        latitude:  currentGps?.lat ?? null,
        longitude: currentGps?.lng ?? null,
        gpsRaw:    currentGpsRaw,
        severity:  inferSeverity(description),
        category:  'quality',
      });
    }
    currentGps    = null;
    currentGpsRaw = null;
    currentDesc   = [];
    inUrlBlock    = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i] ?? '';
    const trimmed = line.trim();

    // Skip page-break characters
    if (trimmed === '\f') { flushRow(); continue; }

    // ── DMS anchor line ────────────────────────────────────
    const dmsMatch = line.match(DMS_PATTERN);
    if (dmsMatch && dmsMatch[1] && dmsMatch[2] && dmsMatch[3] && dmsMatch[4] &&
        dmsMatch[5] && dmsMatch[6] && dmsMatch[7] && dmsMatch[8]) {
      flushRow();
      currentGps = {
        lat: dmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4]),
        lng: dmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8]),
      };
      currentGpsRaw = dmsMatch[0] ?? null;
      const descPart = extractRightColumnText(line);
      if (descPart) currentDesc.push(descPart);
      continue;
    }

    // ── Google Maps URL anchor line ────────────────────────
    if (GMAPS_ANCHOR.test(line)) {
      flushRow();
      inUrlBlock = true;
      const gps = reconstructUrlGps(line, lines.slice(i + 1, i + 6));
      currentGps    = gps;
      currentGpsRaw = trimmed.split(' ')[0] ?? null;
      const descPart = extractRightColumnText(line);
      if (descPart) currentDesc.push(descPart);
      continue;
    }

    // ── URL continuation lines (skip — already handled) ───
    if (inUrlBlock && /^(maps\?|[\d.]+%2C|[\d.]+&z=|[\d-]+&|\d+&)/i.test(trimmed)) {
      continue;
    }

    // ── DMS "- Google Maps" continuation ──────────────────
    if (/^-\s*Google\s+Maps/i.test(trimmed)) {
      const descPart = extractRightColumnText(line);
      if (descPart) currentDesc.push(descPart);
      continue;
    }

    // ── Description continuation (right column text) ──────
    if (currentGps !== null || inUrlBlock) {
      const descPart = extractRightColumnText(line);
      if (descPart) currentDesc.push(descPart);
    }
  }

  // Flush final pending row
  flushRow();

  const suggestedName = filenameHint.replace(/\.pdf$/i, '').trim() || 'Field Report';
  return { format: 'field_report', rows, suggestedName };
}
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run src/modules/construction-qa/__tests__/services/field-report-pdf-parser.test.ts 2>&1 | tail -20
```

Expected: PASS — all tests passing (helper unit tests + integration tests).

- [ ] **Step 5: Smoke test against real PDF (if available)**

If the sample PDF exists at `/home/hein/Downloads/Etwatwa 2 Snag Report.pdf`, run this vitest-based smoke test:

```bash
pdftotext -layout "/home/hein/Downloads/Etwatwa 2 Snag Report.pdf" /tmp/etwatwa2.txt && \
wc -l /tmp/etwatwa2.txt && \
grep -c "Google Maps\|°" /tmp/etwatwa2.txt
```

Then verify the parser output using a quick vitest inline test or a script:

```bash
cd /home/hein/Workspace/FF_Next.js-snag-import
npx tsx -e "
const { parseFieldReport } = require('./src/modules/construction-qa/services/field-report-pdf-parser');
const fs = require('fs');
const text = fs.readFileSync('/tmp/etwatwa2.txt', 'utf-8');
const result = parseFieldReport(text, 'Etwatwa 2 Snag Report.pdf');
console.log('Rows found:', result.rows.length);
result.rows.forEach((r) => console.log(r.rowIndex, r.severity, r.latitude?.toFixed(4), r.description.substring(0, 50)));
"
```

> **Note:** We use `npx tsx` (not `ts-node`) because the project uses `"module": "esnext"` with `"moduleResolution": "bundler"` in tsconfig.json. `ts-node` would require `--esm` and `--experimental-specifier-resolution=node` flags. `tsx` handles this transparently. If `tsx` is not installed, use `npx tsx` which auto-installs it.

Expected: 13-15 rows, each with description. GPS should be populated for all DMS rows. URL rows may have null GPS (acceptable — the URL is split oddly).

Adjust `SNAG_COL_START` in `extractRightColumnText` if descriptions are being missed or truncated.

- [ ] **Step 6: Commit**

```bash
git add src/modules/construction-qa/services/field-report-pdf-parser.ts \
        src/modules/construction-qa/__tests__/services/field-report-pdf-parser.test.ts
git commit -m "feat(snags): field report PDF parser with GPS, severity inference, and row extraction"
```

---

## Task 4: Photo filter for field reports + export `ImageListEntry`

**Files:**
- Modify: `src/modules/construction-qa/services/tqr-image-extractor.ts`

- [ ] **Step 1: Export the `ImageListEntry` interface**

In `tqr-image-extractor.ts`, find the `ImageListEntry` interface (line ~49) and add `export`:

```typescript
export interface ImageListEntry {
  page: number;
  index: number;
  type: string;
  width: number;
  height: number;
  enc: string;
}
```

> **Why:** `filterFieldReportPhotos` uses `ImageListEntry` as a parameter type. Without exporting it, callers in `preview-pdf.ts` and `import-pdf.ts` cannot reference the type when needed. The existing `filterSnagPhotos` and `listPdfImages` already use it in their public signatures but TypeScript infers the return type — explicit export is cleaner.

- [ ] **Step 2: Add the filter function**

After the existing `filterSnagPhotos` function, add:

```typescript
/**
 * Filter images for field report format.
 *
 * Unlike TQR (pages 3-7 only), field reports use the whole document.
 * No page restriction. Filter: image type, width > 150px.
 * Sort by page -> index to match document reading order (top to bottom).
 */
export function filterFieldReportPhotos(entries: ImageListEntry[]): ImageListEntry[] {
  return entries
    .filter(e => e.type === 'image' && e.width > 150)
    .sort((a, b) => a.page !== b.page ? a.page - b.page : a.index - b.index);
}
```

- [ ] **Step 3: Verify it compiles cleanly**

```bash
npm run type-check 2>&1 | grep "tqr-image-extractor" | head -10
```

Expected: no errors.

- [ ] **Step 4: Smoke test photo count against real PDF**

```bash
/usr/bin/pdfimages -list "/home/hein/Downloads/Etwatwa 2 Snag Report.pdf"
```

Count images with `type=image` and `width > 150`. Compare to row count from Task 3. They should match (one photo per row).

- [ ] **Step 5: Commit**

```bash
git add src/modules/construction-qa/services/tqr-image-extractor.ts
git commit -m "feat(snags): export ImageListEntry, add filterFieldReportPhotos"
```

---

## Task 5: Extend preview API

**Files:**
- Modify: `pages/api/snags/preview-pdf.ts`

Read the full file before editing: `cat -n pages/api/snags/preview-pdf.ts`

- [ ] **Step 1: Add `format` field to `PdfPreviewResult` interface**

Find the `PdfPreviewResult` interface in `preview-pdf.ts` and add the `format` field:

```typescript
export interface PdfPreviewResult {
  format?: 'tqr' | 'field_report';   // <-- add at top
  metadata: {
    // ... existing fields unchanged
  };
  // ... rest unchanged
}
```

- [ ] **Step 2: Add new imports**

After existing imports at the top of `preview-pdf.ts`, add:

```typescript
import { detectPdfFormat } from '@/modules/construction-qa/services/detect-pdf-format';
import { parseFieldReport } from '@/modules/construction-qa/services/field-report-pdf-parser';
import { filterFieldReportPhotos } from '@/modules/construction-qa/services/tqr-image-extractor';
```

> **Note:** `filterSnagPhotos` is already imported from `tqr-image-extractor` (line 31 of the existing file). Add `filterFieldReportPhotos` to the existing import block rather than creating a separate one.

- [ ] **Step 3: Replace the parse + validate section with format-aware routing**

Find the section starting at `// -- 3. Parse text` (approximately line 157) and replace everything from there through `return apiResponse.success(res, result)` with:

```typescript
    // ── 3. Detect format ─────────────────────────────────────
    const format = detectPdfFormat(pdfText);

    if (format === 'unknown') {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Unrecognised PDF format. Supported formats: TQR Audit Report, Field Snag Report.'
      );
    }

    // ── 4a. TQR path ─────────────────────────────────────────
    if (format === 'tqr') {
      const { metadata, findings, auditScores } = parseTqrText(pdfText);

      if (!metadata.reportNumber) {
        return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Could not extract report number from TQR PDF.');
      }
      if (!metadata.auditDate) {
        return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Could not extract audit date from TQR PDF.');
      }

      const imageList   = listPdfImages(pdfPath);
      const snagEntries = filterSnagPhotos(imageList);
      const photoCount  = snagEntries.length;

      const existing = await sql`
        SELECT id FROM snag_reports WHERE report_number = ${metadata.reportNumber}
      ` as Array<{ id: string }>;

      const isDuplicate       = existing.length > 0;
      const duplicateReportId = existing[0]?.id ?? null;

      const { project, candidates } = await detectProject(metadata.address, metadata.siteName);

      const categoryCounts: Record<string, number> = {};
      for (const f of findings) {
        categoryCounts[f.category] = (categoryCounts[f.category] ?? 0) + 1;
      }
      const dominantCategory =
        Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'quality';

      const result: PdfPreviewResult = {
        format: 'tqr',
        metadata: {
          reportNumber: metadata.reportNumber,
          auditDate: metadata.auditDate,
          siteName: metadata.siteName,
          address: metadata.address,
          category: dominantCategory,
          auditor: metadata.auditor,
          client: metadata.client,
          contractor: metadata.contractor,
        },
        project,
        projectCandidates: candidates,
        findings: findings.map((f: TqrFinding) => ({
          number: f.snagNumber,
          description: f.description,
          category: f.category,
        })),
        photoCount,
        auditScores,
        isDuplicate,
        duplicateReportId,
      };

      log.info('TqrPdfPreview: TQR complete', {
        reportNumber: metadata.reportNumber,
        findingCount: findings.length,
        photoCount,
        projectDetected: Boolean(project),
        isDuplicate,
      });
      return apiResponse.success(res, result);
    }

    // ── 4b. Field report path ────────────────────────────────
    const originalFilename = uploadedFile.originalFilename ?? 'field-report.pdf';
    const { rows, suggestedName } = parseFieldReport(pdfText, originalFilename);

    if (rows.length === 0) {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'No snag rows found in PDF. Ensure this is a valid field snag report.'
      );
    }

    const today        = new Date().toISOString().split('T')[0]!;
    const slug         = suggestedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const reportNumber = `FIELD-${slug}-${today}`;

    const imageList  = listPdfImages(pdfPath);
    const photoCount = filterFieldReportPhotos(imageList).length;

    const existingField = await sql`
      SELECT id FROM snag_reports WHERE report_number = ${reportNumber}
    ` as Array<{ id: string }>;

    const isDuplicate       = existingField.length > 0;
    const duplicateReportId = existingField[0]?.id ?? null;

    const { project, candidates } = await detectProject(suggestedName, null);

    const fieldResult: PdfPreviewResult = {
      format: 'field_report',
      metadata: {
        reportNumber,
        auditDate: today,
        siteName: suggestedName,
        address: suggestedName,
        category: 'quality',
        auditor: null,
        client: null,
        contractor: null,
      },
      project,
      projectCandidates: candidates,
      findings: rows.map(r => ({
        number: r.rowIndex + 1,
        description: r.description,
        category: r.category,
      })),
      photoCount,
      auditScores: {
        qualityAssurance: 0, qualityNc: 0,
        healthAssurance: 0,  healthNc: 0,
        safetyAssurance: 0,  safetyNc: 0,
        environmentAssurance: 0, environmentNc: 0,
        trafficAssurance: 0, trafficNc: 0,
      },
      isDuplicate,
      duplicateReportId,
    };

    log.info('TqrPdfPreview: field_report complete', {
      suggestedName,
      rowCount: rows.length,
      photoCount,
    });
    return apiResponse.success(res, fieldResult);
```

- [ ] **Step 4: Type-check**

```bash
npm run type-check 2>&1 | grep "preview-pdf\|PdfPreviewResult" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add pages/api/snags/preview-pdf.ts
git commit -m "feat(snags): preview-pdf auto-detects field_report format"
```

---

## Task 6: Extend import API

**Files:**
- Modify: `pages/api/snags/import-pdf.ts`

Read the full file first: `cat -n pages/api/snags/import-pdf.ts`

- [ ] **Step 1: Add new imports**

After existing imports, add:

```typescript
import { detectPdfFormat } from '@/modules/construction-qa/services/detect-pdf-format';
import {
  parseFieldReport,
  type FieldSnagRow,
} from '@/modules/construction-qa/services/field-report-pdf-parser';
import { detectRepeats } from '@/modules/construction-qa/services/snag-repeat-detector';
```

Also add `filterFieldReportPhotos` to the existing `tqr-image-extractor` import:

```typescript
import {
  listPdfImages,
  filterSnagPhotos,
  extractJpegs,
  uploadSnagPhotos,
  uploadSourcePdf,
  filterFieldReportPhotos,
} from '@/modules/construction-qa/services/tqr-image-extractor';
```

> **Note on `NeonQueryFunction` type import:** The existing handler uses `const sql = neon(process.env.DATABASE_URL!)` at module scope and passes it to `createSnagsPerPhoto`. The `importFieldReport` helper below accepts `sql` as `typeof sql` (inferred) rather than importing `NeonQueryFunction` explicitly, to keep the import surface minimal. If you prefer explicit typing, add `import type { NeonQueryFunction } from '@neondatabase/serverless';` and type the parameter as `NeonQueryFunction<false, false>`.

- [ ] **Step 2: Add `importFieldReport` helper function**

Add this function before the `handler` function:

```typescript
async function importFieldReport(params: {
  pdfText: string;
  pdfPath: string;
  originalFilename: string;
  projectId: string;
  userId: string | null;
  sql: typeof sql;
  tempDir: string;
}): Promise<{
  reportId: string;
  reportNumber: string;
  snagCount: number;
  photoCount: number;
}> {
  const { pdfText, pdfPath, originalFilename, projectId, userId, sql: sqlFn, tempDir } = params;

  const { rows, suggestedName } = parseFieldReport(pdfText, originalFilename);

  if (rows.length === 0) {
    throw new Error('No snag rows found in field report PDF.');
  }

  const today        = new Date().toISOString().split('T')[0]!;
  const slug         = suggestedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const reportNumber = `FIELD-${slug}-${today}`;

  log.info('FieldReportImport: starting', { reportNumber, rowCount: rows.length, projectId });

  // ── A. Extract + upload photos ──────────────────────────
  const imageList      = listPdfImages(pdfPath);
  const filteredImages = filterFieldReportPhotos(imageList);
  const extractedFiles = extractJpegs(pdfPath, tempDir, filteredImages);
  const uploadedPhotos = await uploadSnagPhotos(extractedFiles, projectId, reportNumber);

  if (uploadedPhotos.length !== rows.length) {
    log.warn('FieldReportImport: photo/row count mismatch', {
      photos: uploadedPhotos.length,
      rows: rows.length,
    });
  }

  // ── B. Upload source PDF ────────────────────────────────
  const pdfBuffer    = fs.readFileSync(pdfPath);
  const sourcePdfUrl = await uploadSourcePdf(pdfBuffer, originalFilename, projectId, reportNumber);

  // ── C. Insert snag_report ───────────────────────────────
  const reportRows = await sqlFn`
    INSERT INTO snag_reports (
      project_id, report_number, site_name, audit_date,
      source_pdf_url, source_pdf_filename,
      quality_assurance, quality_nc,
      health_assurance, health_nc,
      safety_assurance, safety_nc,
      environment_assurance, environment_nc,
      traffic_assurance, traffic_nc,
      total_findings, import_status, import_notes, imported_by
    ) VALUES (
      ${projectId}, ${reportNumber}, ${suggestedName}, ${today},
      ${sourcePdfUrl ?? null}, ${originalFilename},
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ${rows.length}, 'complete', ${'field_report import - table format'}, ${userId}
    )
    RETURNING id
  ` as Array<{ id: string }>;

  const reportId = reportRows[0]?.id;
  if (!reportId) throw new Error('Failed to create snag_report record');

  // ── D. Insert snags + photos ────────────────────────────
  let snagCount  = 0;
  let photoCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row   = rows[i] as FieldSnagRow;
    const photo = uploadedPhotos[i] ?? null;

    const snagRows = await sqlFn`
      INSERT INTO snags (
        report_id, project_id, snag_number,
        category, severity, description,
        status, is_repeat, repeat_count, reopen_count
      ) VALUES (
        ${reportId}, ${projectId}, ${row.rowIndex + 1},
        ${row.category}, ${row.severity}, ${row.description},
        'open', false, 0, 0
      )
      RETURNING id
    ` as Array<{ id: string }>;

    const snagId = snagRows[0]?.id;
    if (!snagId) {
      log.warn('FieldReportImport: failed to insert snag', { rowIndex: i });
      continue;
    }
    snagCount++;

    // Repeat detection — field reports have no pole references, so detectRepeats
    // will early-return with isRepeat: false. We still call it for consistency
    // and in case future field reports include pole data.
    await detectRepeats(
      {
        id: snagId,
        project_id: projectId,
        category: row.category,
        pole_references: null,
        report_id: reportId,
      },
      sqlFn
    );

    if (photo) {
      await sqlFn`
        INSERT INTO snag_photos (
          snag_id, phase, photo_url, source,
          latitude, longitude
        ) VALUES (
          ${snagId}, 'before', ${photo.url}, 'field_report',
          ${row.latitude}, ${row.longitude}
        )
      `;
      photoCount++;
    } else {
      log.warn('FieldReportImport: no photo for snag', { snagId, rowIndex: i });
    }
  }

  log.info('FieldReportImport: complete', { reportId, snagCount, photoCount });
  return { reportId, reportNumber, snagCount, photoCount };
}
```

> **Signature corrections vs original plan:**
> - `extractJpegs(pdfPath, tempDir, filteredImages)` — real signature is `extractJpegs(pdfPath: string, outputDir: string, snagEntries: ImageListEntry[])`. The original plan had the args in wrong order: `extractJpegs(filteredImages, pdfPath, tempDir)`.
> - `uploadSourcePdf(pdfBuffer, originalFilename, projectId, reportNumber)` — takes 4 params `(buffer, filename, _projectId, _reportNumber)`. The original plan only passed 3.
> - `sql` parameter: renamed to `sqlFn` inside the destructure to avoid shadowing the module-level `sql` constant.

- [ ] **Step 3: Insert format detection + routing into the handler**

After the existing text extraction (`pdftotext` + `fs.readFileSync`), but BEFORE the TQR-specific `parseTqrText` call, insert:

```typescript
    // ── Format detection + routing ────────────────────────
    const format = detectPdfFormat(pdfText);

    if (format === 'unknown') {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        'Unrecognised PDF format. Supported: TQR Audit Report, Field Snag Report.'
      );
    }

    if (format === 'field_report') {
      const originalFilename = uploadedFile.originalFilename ?? 'field-report.pdf';
      try {
        const result = await importFieldReport({
          pdfText,
          pdfPath,
          originalFilename,
          projectId: projectId!,
          userId: user?.id ?? null,
          sql,
          tempDir,
        });
        return apiResponse.success(res, { ...result, format: 'field_report' });
      } catch (fieldErr) {
        const msg = fieldErr instanceof Error ? fieldErr.message : 'Field report import failed';
        log.error('FieldReportImport: failed', { error: fieldErr });
        return apiResponse.badRequest(res, msg);
      }
    }

    // ── TQR path continues below (unchanged) ─────────────
```

> **Note on `pdfPath` availability:** The variable `pdfPath` is assigned at line 118 of the existing handler (`const pdfPath = uploadedFile.filepath`) before the text extraction block. It is in scope when the field report branch runs. The temp file is cleaned up in the `finally` block, which runs after `importFieldReport` completes.

- [ ] **Step 4: Type-check**

```bash
npm run type-check 2>&1 | grep "import-pdf" | head -20
```

Fix any type errors. Common fixes:
- If `detectRepeats` import path is wrong: verify it's at `@/modules/construction-qa/services/snag-repeat-detector`
- If `typeof sql` doesn't satisfy `NeonQueryFunction<false, false>`: add the explicit type import from `@neondatabase/serverless`

- [ ] **Step 5: Commit**

```bash
git add pages/api/snags/import-pdf.ts
git commit -m "feat(snags): import-pdf routes field_report format to dedicated handler"
```

---

## Task 7: UI — format badge and adaptive preview

**Files:**
- Modify: `src/modules/construction-qa/components/snags/SnagImportDialog.tsx`
- Modify: `src/modules/construction-qa/services/snagService.ts` (add `format` to `PdfPreviewResult`)

Read both files first:
```bash
cat -n src/modules/construction-qa/components/snags/SnagImportDialog.tsx
grep -n "PdfPreviewResult" src/modules/construction-qa/services/snagService.ts
```

- [ ] **Step 1: Add `format` to `PdfPreviewResult` in `snagService.ts`**

Find where `PdfPreviewResult` is defined or imported in `snagService.ts`. If it's re-exported from `preview-pdf.ts`, add the `format` field to the interface there (already done in Task 5). If it's defined inline in `snagService.ts`, add `format?: 'tqr' | 'field_report'` to the interface body.

- [ ] **Step 2: Add format badge to preview in `SnagImportDialog.tsx`**

In the preview phase rendering, find where `preview.metadata.reportNumber` is displayed. Add a format badge immediately before or after it:

```tsx
{/* Format badge */}
<div className="mb-3">
  {preview.format === 'field_report' ? (
    <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800">
      Field Report
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
      TQR Audit
    </span>
  )}
</div>
```

- [ ] **Step 3: Conditionally hide audit scores for field reports**

Find the section that renders the audit score rows (the block with `qualityAssurance`, `qualityNc`, etc.). Wrap it:

```tsx
{preview.format !== 'field_report' && (
  <div>
    {/* existing audit scores rendering */}
  </div>
)}
```

- [ ] **Step 4: Type-check**

```bash
npm run type-check 2>&1 | grep "SnagImportDialog\|snagService" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/construction-qa/components/snags/SnagImportDialog.tsx \
        src/modules/construction-qa/services/snagService.ts
git commit -m "feat(snags): import dialog shows format badge, hides audit scores for field reports"
```

---

## Task 8: Full CI + end-to-end test

- [ ] **Step 1: Run full test suite**

```bash
cd /home/hein/Workspace/FF_Next.js-snag-import
npm run ci:quick 2>&1 | tail -30
```

Expected: lint passes, type-check passes, tests pass. Fix any regressions.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build, no new errors.

- [ ] **Step 3: Deploy to dev and test manually**

```bash
bash scripts/deploy-local.sh dev
```

1. Open `https://dev.fibreflow.app` -> Construction QA -> Snag Reports -> Import
2. Upload `/home/hein/Downloads/Etwatwa 2 Snag Report.pdf`
3. Verify preview:
   - Badge shows "Field Report" (orange)
   - N snag descriptions visible
   - No audit score section
   - Photo count shown
4. Select the Etwatwa 2 project
5. Click Import
6. Verify snags appear in the snag list with photos

- [ ] **Step 4: Verify GPS in database**

```bash
psql "$DATABASE_URL" -c "
  SELECT s.snag_number, s.description, s.severity,
         p.latitude, p.longitude, p.source
  FROM snags s
  JOIN snag_reports r ON r.id = s.report_id
  LEFT JOIN snag_photos p ON p.snag_id = s.id
  WHERE r.report_number LIKE 'FIELD-etwatwa%'
  ORDER BY s.snag_number
  LIMIT 20;
"
```

Expected: rows with lat ~-26.12, lng ~28.47, source = 'field_report'.

- [ ] **Step 5: Verify TQR import still works**

Upload any existing TQR PDF via the same dialog. Verify:
- Badge shows "TQR Audit" (blue)
- Audit scores section is visible
- Import completes normally

- [ ] **Step 6: Create PR**

```bash
git push -u origin feature/universal-snag-pdf-import
```

Then run the `/pr` skill to create the pull request with title:
`feat(snags): universal PDF import — auto-detect TQR and field report formats`

---

## Appendix: Signature Reference

Verified signatures from the actual codebase (commit at plan time):

```typescript
// tqr-image-extractor.ts
export function listPdfImages(pdfPath: string): ImageListEntry[]
export function filterSnagPhotos(entries: ImageListEntry[]): ImageListEntry[]
export function extractJpegs(pdfPath: string, outputDir: string, snagEntries: ImageListEntry[]): ExtractedImage[]
export async function uploadSnagPhotos(images: ExtractedImage[], projectId: string, reportNumber: string): Promise<UploadedSnagPhoto[]>
export async function uploadSourcePdf(buffer: Buffer, filename: string, _projectId: string, _reportNumber: string): Promise<string>

// snag-repeat-detector.ts
export async function detectRepeats(newSnag: NewSnagInput, sql: NeonQueryFunction<false, false>): Promise<RepeatDetectionResult>
// where NewSnagInput = { id: string; project_id: string; category: string; pole_references: string[] | null; report_id: string }
```
