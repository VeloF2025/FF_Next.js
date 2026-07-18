/**
 * PP DATA sheet GPS extraction — the Fibertime per-site OES files carry an
 * "Address link" column of HYPERLINK() cells with an EMPTY cached value, so
 * coordinates are only visible via cell.f under a stubs-aware read.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  collectSheetDrTriples,
  extractGpsFromFormula,
  normalizeSheetDropNumber,
  parsePPDataSheet,
  parseOESExcel,
  EXPECTED_HEADERS,
  type PPRow,
} from '../oes/oesExcelParser';

const MAPS_FORMULA = 'HYPERLINK("https://maps.google.com/?q=-26.72364496494768,27.01957903906529","View Map")';

describe('extractGpsFromFormula', () => {
  it('extracts lat/lng from a maps HYPERLINK formula', () => {
    expect(extractGpsFromFormula(MAPS_FORMULA)).toEqual({
      latitude: -26.72364496494768,
      longitude: 27.01957903906529,
    });
  });

  it('returns null for undefined / non-maps / malformed input', () => {
    expect(extractGpsFromFormula(undefined)).toBeNull();
    expect(extractGpsFromFormula('HYPERLINK("https://example.com","x")')).toBeNull();
    expect(extractGpsFromFormula('HYPERLINK("https://maps.google.com/?q=abc,def","x")')).toBeNull();
  });

  it('rejects out-of-range and 0,0 coordinates', () => {
    expect(extractGpsFromFormula('HYPERLINK("https://maps.google.com/?q=-95.1,27.0","x")')).toBeNull();
    expect(extractGpsFromFormula('HYPERLINK("https://maps.google.com/?q=-26.1,187.0","x")')).toBeNull();
    expect(extractGpsFromFormula('HYPERLINK("https://maps.google.com/?q=0,0","x")')).toBeNull();
  });
});

/** Build the PP sheet cell grid used by both tests below. */
function buildPPSheet(): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {
    '!ref': 'A1:G4',
    A1: { t: 's', v: 'Project' },
    B1: { t: 's', v: 'Serial' },
    C1: { t: 's', v: 'Date Registered (SAST)' },
    D1: { t: 's', v: 'OLT Address' },
    E1: { t: 's', v: 'ACS Last Seen Online' },
    F1: { t: 's', v: 'Drop Number' },
    G1: { t: 's', v: 'Address link' },
    // Row 2: has GPS formula (no cached value — matches the real files) + a DR
    A2: { t: 's', v: 'MOA' },
    B2: { t: 's', v: 'ALCLB477AAAA' },
    C2: { t: 's', v: '2025-09-09 11:21:39' },
    F2: { t: 's', v: 'dr1853481' },
    G2: { t: 's', f: MAPS_FORMULA },
    // Row 3: no Address link, no Drop Number
    A3: { t: 's', v: 'MOA' },
    B3: { t: 's', v: 'ALCLB477BBBB' },
    C3: { t: 's', v: '2025-09-09 14:15:18' },
    // Row 4: non-maps link + unallocated drop text
    A4: { t: 's', v: 'LAW' },
    B4: { t: 's', v: 'ALCLB477CCCC' },
    C4: { t: 's', v: '2025-09-10 08:00:00' },
    F4: { t: 's', v: 'no drop allocated' },
    G4: { t: 's', f: 'HYPERLINK("https://example.com/x","View Map")' },
  };
  return sheet;
}

describe('parsePPDataSheet GPS', () => {
  it('attaches GPS from the Address link column, null otherwise', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buildPPSheet(), 'Pre-Provisioned Data');

    const rows = parsePPDataSheet(wb);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(3);
    expect(rows?.[0]).toMatchObject({
      project: 'Mohadin',
      serial_number: 'ALCLB477AAAA',
      latitude: -26.72364496494768,
      longitude: 27.01957903906529,
      drop_number: 'DR1853481',
    });
    expect(rows?.[1]).toMatchObject({ serial_number: 'ALCLB477BBBB', latitude: null, longitude: null, drop_number: null });
    expect(rows?.[2]).toMatchObject({ project: 'Lawley', latitude: null, longitude: null, drop_number: null });
  });

  it('handles sheets without an Address link column (pre-Jul-2026 format)', () => {
    const sheet: XLSX.WorkSheet = {
      '!ref': 'A1:C2',
      A1: { t: 's', v: 'Project' },
      B1: { t: 's', v: 'Serial' },
      C1: { t: 's', v: 'Date Registered (SAST)' },
      A2: { t: 's', v: 'MOA' },
      B2: { t: 's', v: 'ALCLB477DDDD' },
      C2: { t: 's', v: '2025-09-09 11:21:39' },
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'PP DATA');

    const rows = parsePPDataSheet(wb);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ serial_number: 'ALCLB477DDDD', latitude: null, longitude: null, drop_number: null });
  });
});

describe('collectSheetDrTriples', () => {
  const row = (serial: string, project: string, dr: string | null): PPRow => ({
    project, serial_number: serial, date_registered: null, latitude: null, longitude: null, drop_number: dr,
  });

  it('keeps only DR-bearing rows, deduped by serial+project, first occurrence wins', () => {
    const rows = [
      row('S1', 'Mohadin', 'DR1'),
      row('S1', 'Mohadin', 'DR2'),      // duplicate pair, conflicting DR — dropped
      row('S1', 'Lawley', 'DR3'),       // same serial, different project — kept
      row('S2', 'Mohadin', null),       // no DR — dropped
    ];
    expect(collectSheetDrTriples(rows)).toEqual([
      expect.objectContaining({ serial_number: 'S1', project: 'Mohadin', drop_number: 'DR1' }),
      expect.objectContaining({ serial_number: 'S1', project: 'Lawley', drop_number: 'DR3' }),
    ]);
  });

  it('returns empty for rows without DRs', () => {
    expect(collectSheetDrTriples([row('S1', 'Mohadin', null)])).toEqual([]);
  });
});

describe('normalizeSheetDropNumber', () => {
  it('accepts DR numbers case-insensitively', () => {
    expect(normalizeSheetDropNumber('DR1853481')).toBe('DR1853481');
    expect(normalizeSheetDropNumber(' dr1853481 ')).toBe('DR1853481');
  });

  it('rejects blanks, placeholders, and junk', () => {
    expect(normalizeSheetDropNumber(undefined)).toBeNull();
    expect(normalizeSheetDropNumber('')).toBeNull();
    expect(normalizeSheetDropNumber('no drop allocated')).toBeNull();
    expect(normalizeSheetDropNumber('DR')).toBeNull();
    expect(normalizeSheetDropNumber('1853481')).toBeNull();
  });
});

describe('parseOESExcel file round-trip', () => {
  const tmpFile = path.join(os.tmpdir(), `oes-pp-gps-test-${process.pid}.xlsx`);
  afterAll(() => {
    fs.rmSync(tmpFile, { force: true });
  });

  it('surfaces PP GPS through the full file read (formula-only cells survive)', () => {
    const wb = XLSX.utils.book_new();
    const oltSheet = XLSX.utils.aoa_to_sheet([
      EXPECTED_HEADERS,
      ['DR1853481', 'ALCLB477AAAA', 45900, 'olt1', -20.1, 2.2, -21.3, 2.4, 'active', -26.7, 27.0, -20.5, 'Team A'],
    ]);
    XLSX.utils.book_append_sheet(wb, oltSheet, 'OLT Data');
    XLSX.utils.book_append_sheet(wb, buildPPSheet(), 'Pre-Provisioned Data');
    XLSX.writeFile(wb, tmpFile);

    const result = parseOESExcel(tmpFile);
    expect(result.rows).toHaveLength(1);
    expect(result.ppRows).toHaveLength(3);
    expect(result.ppRows?.[0]?.latitude).toBeCloseTo(-26.72364496494768, 10);
    expect(result.ppRows?.[0]?.longitude).toBeCloseTo(27.01957903906529, 10);
  });
});
