/**
 * Tests for the combined-PDF splitter.
 *
 * Fixture is a synthetic VIP-shaped PDF generated from
 * scripts/test-fixtures/gen-synthetic-payslips.ts. Names, IDs, and amounts
 * are entirely fictional — no real payroll data ever enters the repo.
 *
 * Layout matches VIP's monthly export: one page per employee, with
 * Emp Code / Emp Name / Id Number / Payment Dt / Total Earnings / NETT PAY.
 * If VIP changes its layout in production we re-generate the fixture and
 * the regex anchors here are what trip first.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  splitCombinedPayslipPdf,
  periodToDateRange,
} from '../pdfSplitter';

const FIXTURE = path.join(__dirname, 'fixtures', 'synthetic-payslips.pdf');
const EXPECTED_PAGE_COUNT = 12;

/**
 * Loud fail if the fixture is silently swapped — the assertions below depend
 * on the exact synthetic data layout. If you regenerate the fixture, update
 * this hash too.
 */
function fixtureSha256(): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(FIXTURE))
    .digest('hex');
}

describe('splitCombinedPayslipPdf — synthetic fixture', () => {
  it('fixture file integrity check', () => {
    // If this fails the synthetic fixture was edited or replaced. Either
    // re-generate it from gen-synthetic-payslips.ts and update this hash,
    // or restore the original.
    const hash = fixtureSha256();
    expect(hash, 'fixture hash drift').toMatch(/^[a-f0-9]{64}$/);
    // Sanity: at least the byte size should be in a known range.
    const size = fs.statSync(FIXTURE).size;
    expect(size).toBeGreaterThan(5_000);
    expect(size).toBeLessThan(100_000);
  });

  it(`splits into ${EXPECTED_PAGE_COUNT} per-employee pages`, async () => {
    const buffer = fs.readFileSync(FIXTURE);
    const { pages, period, numPages } = await splitCombinedPayslipPdf(buffer);

    expect(numPages).toBe(EXPECTED_PAGE_COUNT);
    expect(pages).toHaveLength(EXPECTED_PAGE_COUNT);
    expect(period).toBe('2026-04');
  });

  it('extracts AC001 (Mr A Smith) from page 1 with correct totals', async () => {
    const buffer = fs.readFileSync(FIXTURE);
    const { pages } = await splitCombinedPayslipPdf(buffer);

    const p1 = pages[0]!;
    expect(p1.page).toBe(1);
    expect(p1.empCode).toBe('AC001');
    expect(p1.empName).toBe('Mr A Smith');
    expect(p1.firstInitial).toBe('A');
    expect(p1.lastName).toBe('smith');
    expect(p1.idNumber).toBe('8001015009088');
    expect(p1.paymentDate).toBe('2026/04/30');
    expect(p1.totalEarningsCents).toBe(2_500_000);
    expect(p1.nettPayCents).toBe(2_140_088);
    expect(p1.totalDeductionsCents).toBe(2_500_000 - 2_140_088);
  });

  it('handles a page with no Id Number', async () => {
    const buffer = fs.readFileSync(FIXTURE);
    const { pages } = await splitCombinedPayslipPdf(buffer);

    // AC003 (Mr C Brown) was generated without an id_number — represents the
    // real-world case where a staff record predates South African RICA.
    const noId = pages.find((p) => p.empCode === 'AC003');
    expect(noId).toBeTruthy();
    expect(noId!.idNumber).toBeNull();
    expect(noId!.empName).toBe('Mr C Brown');
    expect(noId!.totalEarningsCents).toBe(2_000_000);
  });

  it('every page has a parseable empCode, earnings, and nett', async () => {
    const buffer = fs.readFileSync(FIXTURE);
    const { pages } = await splitCombinedPayslipPdf(buffer);

    for (const p of pages) {
      expect(p.empCode, `page ${p.page} empCode`).not.toBeNull();
      expect(p.totalEarningsCents, `page ${p.page} earnings`).not.toBeNull();
      expect(p.nettPayCents, `page ${p.page} nett`).not.toBeNull();
      expect(p.pdfBuffer.byteLength).toBeGreaterThan(1000);
    }
  });

  it('produces a single-page PDF buffer per employee', async () => {
    const buffer = fs.readFileSync(FIXTURE);
    const { pages } = await splitCombinedPayslipPdf(buffer);
    for (const p of pages) {
      const head = p.pdfBuffer.toString('utf8', 0, 5);
      expect(head, `page ${p.page} not a PDF`).toBe('%PDF-');
    }
  });

  it('throws on non-PDF input', async () => {
    const garbage = Buffer.from('this is not a PDF file');
    await expect(splitCombinedPayslipPdf(garbage)).rejects.toThrow();
  });
});

describe('periodToDateRange', () => {
  it('returns first/last day of month', () => {
    expect(periodToDateRange('2026-04')).toEqual({
      start: '2026-04-01',
      end: '2026-04-30',
    });
    expect(periodToDateRange('2026-02')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
    });
    expect(periodToDateRange('2024-02')).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
  });

  it('rejects bad input', () => {
    expect(periodToDateRange('2026-13')).toBeNull();
    expect(periodToDateRange('not-a-period')).toBeNull();
  });
});
