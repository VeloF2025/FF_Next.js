/**
 * Parser coverage for the Jul 2026 OES format: 15 columns with FT's
 * "Payment Eligibility" / "Not Eligible Reason" appended — plus back-compat
 * with the prior 13-column format (per-site files gain the columns at FT's
 * pace).
 */

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  EXPECTED_HEADERS,
  validateHeaders,
  parseOESExcel,
} from '../oesExcelParser';

const HDR13 = EXPECTED_HEADERS.slice(0, 13);
const HDR15 = EXPECTED_HEADERS;

function writeWorkbook(rows: unknown[][]): string {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'OLT');
  const file = path.join(os.tmpdir(), `oes-parser-test-${process.pid}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, file);
  return file;
}

const baseCols = (dr: string, serial: string) => [
  dr, serial, 46224.5, 'OLT-1/1/1', -19.5, 2.1, -22.0, 1.4,
  'Active', -26.37, 27.9, -19.8, 'Team A',
];

describe('validateHeaders — 13 vs 15 column formats', () => {
  it('accepts the legacy 13-column header row', () => {
    expect(validateHeaders(HDR13).valid).toBe(true);
  });

  it('accepts the Jul 2026 15-column header row', () => {
    expect(validateHeaders(HDR15).valid).toBe(true);
  });

  it('warns on an unknown 14-column shape', () => {
    const r = validateHeaders([...HDR13, 'Mystery']);
    expect(r.valid).toBe(false);
    expect(r.warnings.join(' ')).toContain('expected 13 or 15');
  });
});

describe('parseOESExcel — eligibility columns', () => {
  it('captures Payment Eligibility and Not Eligible Reason when present', () => {
    const file = writeWorkbook([
      HDR15,
      [...baseCols('DR1000001', 'ALCLB4AAA111'), 'Not Eligible', 'Note 4 - SN mismatch (Field App vs OES)'],
      [...baseCols('DR1000002', 'ALCLB4AAA222'), 'PAID - Invoiced on 2026-07-12', ''],
      [...baseCols('DR1000003', 'ALCLB4AAA333'), 'Eligible', ''],
    ]);
    try {
      const { rows, headerMismatch } = parseOESExcel(file);
      expect(headerMismatch).toBe(false);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        drop_number: 'DR1000001',
        payment_eligibility: 'Not Eligible',
        not_eligible_reason: 'Note 4 - SN mismatch (Field App vs OES)',
      });
      expect(rows[1]).toMatchObject({
        payment_eligibility: 'PAID - Invoiced on 2026-07-12',
        not_eligible_reason: null,
      });
      expect(rows[2]).toMatchObject({ payment_eligibility: 'Eligible', not_eligible_reason: null });
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('yields null eligibility fields for legacy 13-column files', () => {
    const file = writeWorkbook([HDR13, baseCols('DR1000009', 'ALCLB4AAA999')]);
    try {
      const { rows, headerMismatch } = parseOESExcel(file);
      expect(headerMismatch).toBe(false);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        drop_number: 'DR1000009',
        team: 'Team A',
        payment_eligibility: null,
        not_eligible_reason: null,
      });
    } finally {
      fs.unlinkSync(file);
    }
  });
});
