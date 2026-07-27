/**
 * Field-extraction tests for both payslip layouts.
 *
 * The samples below reproduce the exact text pdfjs emits for each layout —
 * including the quirks that broke the July 2026 import: values printed
 * *before* their labels, employee names wrapped across lines, space
 * thousands separators, and a page with no ID number. All names, IDs and
 * amounts are fictional; no real payroll data enters the repo.
 */

import { describe, it, expect } from 'vitest';

import {
  detectLayout,
  extractFields,
  findDuplicateAnchors,
} from '../payslipLayouts';

/** Plain Paper, short name that fits inline next to the label. */
const PLAIN_INLINE = [
  '6020',
  'DR MALABAR',
  '138.88890\tRate per hour\tHAWARTHIA',
  '2025/04/01\tEmployed from\t10 DEMO MEWS\tAddress',
  '8001015009088\tIdentity Number\tProjects Administrator\tJob title',
  'AC002\tEmployee Code\tJANE DOE (JANE)\tEmployee',
  '6070',
  'Gqeberha',
  '26 Demo Road',
  '2026/07/31\tPay Date\tAcme Demo (Pty) Ltd',
  'Amount\t',
  'Opening',
  'balance',
  'Deductions\tAmount\tUnits\tEarnings',
  '25 000.00\tBasic salary 3 381.00\tTax',
  '177.12\tUnemployment insurance fund',
  '21 441.88\tNett pay',
  '3 558.12\tTotal deductions\t25 000.00\tTotal earnings',
  '250.00\tSkills development levy',
  'Amount\tCompany Contributions',
  '19 793.92\tTax paid',
  '136 111.11\tTaxable earnings',
  'Amount\tYTD Totals',
  'Closing Balance\tLeave Type',
  '17.7500\tAnnual Leave',
].join('\n');

/** Plain Paper, long name Sage wrapped onto its own lines. */
const PLAIN_WRAPPED = [
  '6070',
  'CQEBERHA',
  '138.88890\tRate per hour\tWESTERLING',
  '2025/08/01\tEmployed from\t151 DEMO TERRACE\tAddress',
  '8703165009086\tIdentity Number\tNetwork Planner\tJob title',
  'AC022\tEmployee Code\t',
  'PIETER JOHANNES VAN NIEKERK',
  '(PIETER)',
  'Employee',
  '2026/07/31\tPay Date\tAcme Demo (Pty) Ltd',
  '4 858.12\tTotal deductions\t30 000.00\tTotal earnings',
  '25 141.88\tNett pay',
].join('\n');

/** Plain Paper, wrapped name and no ID number on file. */
const PLAIN_NO_ID = [
  '2136',
  'SOUTH HILLS',
  '97.22220\tRate per hour\t1 DEMO STREET',
  '2025/11/01\tEmployed from\t33 DEMO STREET\tAddress',
  'Identity Number\tFibre Maintenance Technician\tJob title',
  'AC032\tEmployee Code\t',
  'THABO GLADWELL MOKOENA',
  '(THABO)',
  'Employee',
  '2026/07/31\tPay Date\tAcme Demo (Pty) Ltd',
  '2 960.61\tTotal deductions\t22 701.87\tTotal earnings',
  '19 741.26\tNett pay',
].join('\n');

/** Legacy VIP layout — label first, comma separators. */
const VIP_SAMPLE = [
  'Co. Name  Acme Demo (Pty) Ltd   Payment Dt 2026/04/30',
  'Emp Code  AC001',
  'Emp Name  Mr A Smith   Id Number 8001015009088',
  'Total Earnings 25000.00',
  'Total Deductions 3599.12',
  'NETT PAY',
  '21,400.88',
].join('\n');

describe('detectLayout', () => {
  it('identifies the Plain Paper layout by its "Employee Code" label', () => {
    expect(detectLayout(PLAIN_INLINE)).toBe('plain_paper');
    expect(detectLayout(PLAIN_WRAPPED)).toBe('plain_paper');
    expect(detectLayout(PLAIN_NO_ID)).toBe('plain_paper');
  });

  it('falls back to the VIP layout when that label is absent', () => {
    expect(detectLayout(VIP_SAMPLE)).toBe('vip');
    expect(detectLayout('')).toBe('vip');
  });
});

describe('extractFields — Plain Paper layout', () => {
  it('reads a page whose name sits inline beside the label', () => {
    const f = extractFields(PLAIN_INLINE, 'plain_paper');

    expect(f.empCode).toBe('AC002');
    expect(f.empName).toBe('JANE DOE');
    expect(f.firstInitial).toBe('J');
    expect(f.lastName).toBe('doe');
    expect(f.idNumber).toBe('8001015009088');
    expect(f.paymentDate).toBe('2026/07/31');
  });

  it('parses space-separated amounts into cents', () => {
    const f = extractFields(PLAIN_INLINE, 'plain_paper');

    expect(f.totalEarningsCents).toBe(2_500_000);
    expect(f.totalDeductionsCents).toBe(355_812);
    expect(f.nettPayCents).toBe(2_144_188);
  });

  it('does not mistake the YTD "Taxable earnings" line for total earnings', () => {
    // 136 111.11 is the larger, more tempting number on the page — anchoring
    // on the wrong label silently imports the wrong gross.
    const f = extractFields(PLAIN_INLINE, 'plain_paper');
    expect(f.totalEarningsCents).not.toBe(13_611_111);
  });

  it('reassembles a name Sage wrapped onto its own lines, dropping the known-as', () => {
    const f = extractFields(PLAIN_WRAPPED, 'plain_paper');

    expect(f.empCode).toBe('AC022');
    expect(f.empName).toBe('PIETER JOHANNES VAN NIEKERK');
    expect(f.firstInitial).toBe('P');
    expect(f.lastName).toBe('niekerk');
    expect(f.totalEarningsCents).toBe(3_000_000);
    expect(f.nettPayCents).toBe(2_514_188);
  });

  it('returns a null ID rather than a wrong one when the field is blank', () => {
    const f = extractFields(PLAIN_NO_ID, 'plain_paper');

    expect(f.idNumber).toBeNull();
    expect(f.empCode).toBe('AC032');
    expect(f.empName).toBe('THABO GLADWELL MOKOENA');
    expect(f.totalEarningsCents).toBe(2_270_187);
    expect(f.totalDeductionsCents).toBe(296_061);
    expect(f.nettPayCents).toBe(1_974_126);
  });

  it('derives deductions to the figure Sage prints on the page', () => {
    // Deductions is derived (earnings - nett) rather than read off the page,
    // so it can never be null on its own. It must still reproduce Sage's own
    // printed "Total deductions" line exactly, or the stored row would
    // disagree with the PDF the staff member downloads.
    const printedOnPage: Array<[string, number]> = [
      [PLAIN_INLINE, 355_812], //  "3 558.12\tTotal deductions"
      [PLAIN_WRAPPED, 485_812], // "4 858.12\tTotal deductions"
      [PLAIN_NO_ID, 296_061], //   "2 960.61\tTotal deductions"
    ];
    for (const [sample, expected] of printedOnPage) {
      expect(extractFields(sample, 'plain_paper').totalDeductionsCents).toBe(expected);
    }
  });

  it('parses non-breaking spaces used as a thousands separator', () => {
    const nbsp = PLAIN_INLINE.replace(
      '25 000.00\tTotal earnings',
      '25\u00a0000.00\tTotal earnings'
    ).replace('21 441.88\tNett pay', '21\u202f441.88\tNett pay');

    const f = extractFields(nbsp, 'plain_paper');
    expect(f.totalEarningsCents).toBe(2_500_000);
    expect(f.nettPayCents).toBe(2_144_188);
  });

  it('never bridges a tab when capturing an amount', () => {
    // The neighbouring column's number must stay out of the capture — pulling
    // it in is how one employee's figure lands on another's payslip row.
    const f = extractFields('999.99\t177.12\tTotal earnings', 'plain_paper');
    expect(f.totalEarningsCents).toBe(17_712);
  });
});

describe('findDuplicateAnchors', () => {
  it('reports nothing for the well-formed sample pages', () => {
    expect(findDuplicateAnchors(PLAIN_INLINE, 'plain_paper')).toEqual([]);
    expect(findDuplicateAnchors(PLAIN_WRAPPED, 'plain_paper')).toEqual([]);
    expect(findDuplicateAnchors(PLAIN_NO_ID, 'plain_paper')).toEqual([]);
    expect(findDuplicateAnchors(VIP_SAMPLE, 'vip')).toEqual([]);
  });

  it('reports an anchor label that appears more than once', () => {
    // A second "Nett pay" line (e.g. a corrections panel a future Sage
    // template adds) would make the first-match-wins extraction pick the
    // wrong figure silently. This is the signal that catches it.
    const doubled = `${PLAIN_INLINE}\n10 000.00\tNett pay`;

    expect(findDuplicateAnchors(doubled, 'plain_paper')).toEqual(['Nett pay']);
  });

  it('reports every duplicated anchor, not just the first', () => {
    const doubled = [PLAIN_INLINE, '9 999.00\tNett pay', '1 234.00\tTotal earnings'].join(
      '\n'
    );

    expect(findDuplicateAnchors(doubled, 'plain_paper').sort()).toEqual([
      'Nett pay',
      'Total earnings',
    ]);
  });

  it('checks the anchors the active layout actually uses', () => {
    // "Employee Code" is a Plain Paper anchor and means nothing to VIP, so
    // duplicating it must not raise a VIP warning.
    const doubled = `${VIP_SAMPLE}\nAC999\tEmployee Code\tAC998\tEmployee Code`;

    expect(findDuplicateAnchors(doubled, 'vip')).toEqual([]);
    expect(findDuplicateAnchors(`${VIP_SAMPLE}\nEmp Code  AC999`, 'vip')).toEqual([
      'Emp Code',
    ]);
  });

  it('is not left stateful by a previous call (global-regex lastIndex)', () => {
    const doubled = `${PLAIN_INLINE}\n10 000.00\tNett pay`;

    expect(findDuplicateAnchors(doubled, 'plain_paper')).toEqual(['Nett pay']);
    expect(findDuplicateAnchors(doubled, 'plain_paper')).toEqual(['Nett pay']);
    expect(findDuplicateAnchors(PLAIN_INLINE, 'plain_paper')).toEqual([]);
  });
});

describe('extractFields — VIP layout (unchanged)', () => {
  it('still reads the legacy label-first layout', () => {
    const f = extractFields(VIP_SAMPLE, 'vip');

    expect(f.empCode).toBe('AC001');
    expect(f.empName).toBe('Mr A Smith');
    expect(f.firstInitial).toBe('A');
    expect(f.lastName).toBe('smith');
    expect(f.idNumber).toBe('8001015009088');
    expect(f.paymentDate).toBe('2026/04/30');
    expect(f.totalEarningsCents).toBe(2_500_000);
    expect(f.nettPayCents).toBe(2_140_088);
    expect(f.totalDeductionsCents).toBe(2_500_000 - 2_140_088);
  });
});
