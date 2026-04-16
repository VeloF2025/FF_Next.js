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
    const line = ' '.repeat(33) + 'Pole Scew';
    expect(extractRightColumnText(line)).toBe('Pole Scew');
  });

  it('returns empty for short lines', () => {
    expect(extractRightColumnText('short')).toBe('');
  });

  it('excludes URL fragments in the right column', () => {
    const urlFragLine = ' '.repeat(8) + 'maps?q=-26.123%2C28.456';
    expect(extractRightColumnText(urlFragLine)).toBe('');
  });
});

// ============================================================
// Integration tests — parseFieldReport
// ============================================================

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

  it('does NOT deduplicate rows with matching GPS + description', () => {
    // Same pole, same description, two separate entries — preserves 1:1 photo mapping.
    const text = `Photo   Location                    Snag
26°07'41.2"S 28°28'29.6"E Pole Scew
- Google Maps

26°07'41.2"S 28°28'29.6"E Pole Scew
- Google Maps
`;
    const result = parseFieldReport(text, 'test.pdf');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.description).toBe('Pole Scew');
    expect(result.rows[1]!.description).toBe('Pole Scew');
    expect(result.rows[0]!.latitude).toBeCloseTo(result.rows[1]!.latitude!, 4);
  });
});
