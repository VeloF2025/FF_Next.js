/**
 * Field Report PDF Parser
 *
 * Parses "field report" PDFs: 3-column table (Photo | Location | Snag).
 * Input: pdftotext -layout output.
 *
 * Column extraction strategy:
 *   - DMS anchor lines: description starts at dmsMatch.end()
 *   - URL anchor lines: description at fixed col 33 (URL is ~33 chars)
 *   - "- Google Maps" continuation: description after the marker
 *   - Indented continuation lines: trimmed text (indent >= MIN_CONTINUATION_INDENT)
 *
 * No deduplication: each PDF row becomes one snag so photos map 1:1.
 * Same GPS + same description across rows is valid (same pole, different
 * angles or different issues).
 *
 * Status: WORKING
 */

import type { SnagSeverity, SnagCategory } from '../types/snag.types';
import {
  DMS_PATTERN,
  DMS_LAT_ONLY,
  DMS_LNG_ONLY,
  GMAPS_ANCHOR,
  reconstructUrlGps,
  dmsToDecimal,
} from './field-report-gps';

export { parseGpsFromLine } from './field-report-gps';

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
// Layout Constants
// ============================================================

/** Matches "- Google Maps" prefix (possibly with leading whitespace) */
const GMAPS_CONTINUATION = /^-\s*Google\s+Maps\s*/i;
/** Minimum leading spaces for a pure-continuation line (no GPS, no marker) */
const MIN_CONTINUATION_INDENT = 10;
/** Fixed right-column start for URL anchor lines */
const URL_COL_START = 33;

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
 * The right column starts at approximately char 33 in URL anchor line format.
 * Excludes URL fragments and "- Google Maps" continuation markers.
 *
 * For DMS lines use extractDescFromDmsLine instead.
 */
export function extractRightColumnText(line: string): string {
  if (line.length <= URL_COL_START) return '';

  const rightPart = line.substring(URL_COL_START).trim();

  if (!rightPart) return '';
  if (GMAPS_CONTINUATION.test(rightPart)) return '';
  if (/^maps\?q=/i.test(rightPart)) return '';
  if (/^https?:\/\//i.test(rightPart)) return '';
  if (/^[\d.]+%2C/i.test(rightPart)) return '';
  if (/^[\d.]+&z=/i.test(rightPart)) return '';
  if (/^\d+&z=/i.test(rightPart)) return '';

  return rightPart;
}

/**
 * Extract description text from a DMS anchor line (text after GPS match).
 */
function extractDescFromDmsLine(line: string, matchEnd: number): string {
  return line.substring(matchEnd).trim();
}

/**
 * Extract description text from a "- Google Maps" continuation line.
 * Returns text after the marker, or empty string if no text follows.
 */
function extractDescFromGmapsLine(line: string): string {
  const m = line.match(GMAPS_CONTINUATION);
  if (!m) return '';
  return line.substring(m[0].length).trim();
}

// ============================================================
// Main Parser
// ============================================================

/**
 * Parse pdftotext -layout output of a field report PDF.
 * Returns ordered snag rows suitable for direct DB import.
 *
 * Each PDF row becomes one snag — no deduplication. The PDF table has
 * one photo per row, so a 1:1 row-to-photo mapping is preserved. Rows
 * may share GPS and description text when the same pole was captured
 * multiple times (different angles / different issues at the same pole).
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
    // Strip form-feed characters that pdftotext embeds at page breaks
    const line    = (lines[i] ?? '').replace(/\f/g, '');
    const trimmed = line.trim();

    // Skip blank lines (only flush if we were mid-block and hit multiple blanks)
    if (!trimmed) continue;

    // ── DMS anchor line (single-line, lat + lng together) ──
    const dmsMatch = line.match(DMS_PATTERN);
    if (dmsMatch && dmsMatch[1] && dmsMatch[2] && dmsMatch[3] && dmsMatch[4] &&
        dmsMatch[5] && dmsMatch[6] && dmsMatch[7] && dmsMatch[8] &&
        dmsMatch.index !== undefined) {
      flushRow();
      currentGps = {
        lat: dmsToDecimal(dmsMatch[1], dmsMatch[2], dmsMatch[3], dmsMatch[4]),
        lng: dmsToDecimal(dmsMatch[5], dmsMatch[6], dmsMatch[7], dmsMatch[8]),
      };
      currentGpsRaw = dmsMatch[0] ?? null;
      const matchEnd = (dmsMatch.index) + dmsMatch[0].length;
      const descPart = extractDescFromDmsLine(line, matchEnd);
      if (descPart) currentDesc.push(descPart);
      continue;
    }

    // ── Split DMS anchor (lat on this line, lng on next line) ──
    // Example: "26°07'53.6"S               Pole Scew"
    //          "28°28'33.0"E - Google"
    const latOnly = line.match(DMS_LAT_ONLY);
    const nextLine = (lines[i + 1] ?? '').replace(/\f/g, '');
    const lngOnly = nextLine.match(DMS_LNG_ONLY);
    if (latOnly && latOnly[1] && latOnly[2] && latOnly[3] && latOnly[4] &&
        latOnly.index !== undefined &&
        !DMS_PATTERN.test(line) &&
        lngOnly && lngOnly[1] && lngOnly[2] && lngOnly[3] && lngOnly[4] &&
        !DMS_PATTERN.test(nextLine)) {
      flushRow();
      currentGps = {
        lat: dmsToDecimal(latOnly[1], latOnly[2], latOnly[3], latOnly[4]),
        lng: dmsToDecimal(lngOnly[1], lngOnly[2], lngOnly[3], lngOnly[4]),
      };
      currentGpsRaw = `${latOnly[0]} ${lngOnly[0]}`;
      const matchEnd = latOnly.index + latOnly[0].length;
      const descPart = extractDescFromDmsLine(line, matchEnd);
      if (descPart) currentDesc.push(descPart);
      // Skip the lng line (it has the "- Google Maps" marker and possibly more description)
      // Check if there's description text on the lng line after the lng match
      const lngMatchEnd = (lngOnly.index ?? 0) + lngOnly[0].length;
      const lngRemainder = nextLine.substring(lngMatchEnd).trim();
      if (lngRemainder && !/^-?\s*Google\s+Maps/i.test(lngRemainder)) {
        // Strip off a leading "- Google" or "- Google Maps" marker if present
        const cleaned = lngRemainder.replace(/^-\s*Google(\s+Maps)?\s*/i, '').trim();
        if (cleaned) currentDesc.push(cleaned);
      }
      i++; // consume the lng line
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

    // ── URL continuation lines (skip — already handled in reconstructUrlGps) ──
    if (inUrlBlock && /^(maps\?|[\d.]+%2C|[\d.]+&z=|[\d-]+&|\d+&)/i.test(trimmed)) {
      continue;
    }

    // ── "- Google Maps" continuation ──────────────────────
    // Works for both DMS blocks (8-space indent) and 0-indent blocks
    if (GMAPS_CONTINUATION.test(trimmed)) {
      const descPart = extractDescFromGmapsLine(trimmed);
      if (descPart) currentDesc.push(descPart);
      continue;
    }

    // ── Description continuation (indented text) ──────────
    // Any non-GPS, non-Google-Maps line with sufficient indent is a continuation
    if (currentGps !== null || inUrlBlock) {
      const leadingSpaces = line.length - line.trimStart().length;
      if (leadingSpaces >= MIN_CONTINUATION_INDENT) {
        const text = trimmed;
        if (text) currentDesc.push(text);
      }
    }
  }

  // Flush final pending row
  flushRow();

  const suggestedName = filenameHint.replace(/\.pdf$/i, '').trim() || 'Field Report';
  return { format: 'field_report', rows, suggestedName };
}
