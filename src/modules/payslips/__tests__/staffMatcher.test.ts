/**
 * Staff matcher tests.
 *
 * Mocks @/lib/db-pool's `sql` so we can drive the matcher with synthetic
 * staff fixtures and assert priority / fuzzy behaviour. The shape returned
 * by the mock matches the SELECT in matchPagesToStaff.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ExtractedPayslipPage } from '../pdfSplitter';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { matchPagesToStaff } from '../staffMatcher';

function makePage(overrides: Partial<ExtractedPayslipPage> = {}): ExtractedPayslipPage {
  return {
    page: 1,
    empCode: null,
    empName: null,
    firstInitial: null,
    lastName: null,
    idNumber: null,
    paymentDate: null,
    totalEarningsCents: null,
    totalDeductionsCents: null,
    nettPayCents: null,
    pdfBuffer: Buffer.alloc(0),
    rawText: '',
    ...overrides,
  };
}

describe('matchPagesToStaff', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('matches by payroll_code first', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: 'a',
        email: 'a@x.za',
        first_name: 'Janice',
        last_name: 'George',
        id_number: '7701010168082',
        sa_id_number: null,
        payroll_code: 'VF002',
      },
      {
        id: 'b',
        email: 'b@x.za',
        first_name: 'Other',
        last_name: 'Person',
        id_number: '0000000000000',
        sa_id_number: null,
        payroll_code: null,
      },
    ]);
    const page = makePage({ empCode: 'VF002', idNumber: '7701010168082', firstInitial: 'J', lastName: 'george' });
    const out = await matchPagesToStaff([page]);
    const m = out.get(1)!;
    expect(m.staffId).toBe('a');
    expect(m.method).toBe('payroll_code');
    expect(m.confidence).toBe(1);
  });

  it('falls back to id_number when no payroll_code', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: 'a',
        email: 'a@x.za',
        first_name: 'Janice',
        last_name: 'George',
        id_number: '7701010168082',
        sa_id_number: null,
        payroll_code: null,
      },
    ]);
    const page = makePage({ empCode: 'VF002', idNumber: '7701010168082' });
    const out = await matchPagesToStaff([page]);
    expect(out.get(1)?.method).toBe('id_number');
  });

  it('falls back to fuzzy name when no codes match', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: 'a',
        email: 'a@x.za',
        first_name: 'Janice',
        last_name: 'George',
        id_number: null,
        sa_id_number: null,
        payroll_code: null,
      },
      {
        id: 'b',
        email: 'b@x.za',
        first_name: 'Bryan',
        last_name: 'Viviers',
        id_number: null,
        sa_id_number: null,
        payroll_code: null,
      },
    ]);
    const page = makePage({ firstInitial: 'J', lastName: 'george' });
    const out = await matchPagesToStaff([page]);
    const m = out.get(1)!;
    expect(m.staffId).toBe('a');
    expect(m.method).toBe('name_fuzzy');
    expect(m.confidence).toBe(1);
  });

  it('returns unmatched when nothing fits', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: 'a',
        email: 'a@x.za',
        first_name: 'Janice',
        last_name: 'George',
        id_number: null,
        sa_id_number: null,
        payroll_code: null,
      },
    ]);
    const page = makePage({ empCode: 'VF999', idNumber: '0000000000000', firstInitial: 'Z', lastName: 'unknown' });
    const out = await matchPagesToStaff([page]);
    const m = out.get(1)!;
    expect(m.staffId).toBeNull();
    expect(m.method).toBe('unmatched');
  });

  it('does not pick a fuzzy match when initials differ', async () => {
    // Two staff with last name "george" but different initials — page has J,
    // staff B has B initial. Only Janice should win, not Bryan.
    sqlMock.mockResolvedValueOnce([
      {
        id: 'a',
        email: 'a@x.za',
        first_name: 'Janice',
        last_name: 'George',
        id_number: null,
        sa_id_number: null,
        payroll_code: null,
      },
      {
        id: 'b',
        email: 'b@x.za',
        first_name: 'Bryan',
        last_name: 'George',
        id_number: null,
        sa_id_number: null,
        payroll_code: null,
      },
    ]);
    const page = makePage({ firstInitial: 'J', lastName: 'george' });
    const out = await matchPagesToStaff([page]);
    expect(out.get(1)?.staffId).toBe('a');
  });

  it('matches by sa_id_number when only that column is set', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        id: 'a',
        email: 'a@x.za',
        first_name: 'Janice',
        last_name: 'George',
        id_number: null,
        sa_id_number: '7701010168082',
        payroll_code: null,
      },
    ]);
    const page = makePage({ idNumber: '7701010168082' });
    const out = await matchPagesToStaff([page]);
    expect(out.get(1)?.method).toBe('sa_id_number');
    expect(out.get(1)?.staffId).toBe('a');
  });

  it('handles an empty pages list with a single SELECT', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const out = await matchPagesToStaff([]);
    expect(out.size).toBe(0);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('abstains when two same-initial candidates score within 0.05 of each other', async () => {
    // Levenshtein similarity for "george" vs "georg" is 5/6 ≈ 0.833 — below
    // threshold so won't even be a candidate. Use closer pair: "smith" vs
    // "smyth" → 4/5 = 0.8 (also below). Use "anderson" vs "andersen" →
    // 7/8 = 0.875, and a tied second "andersone" → 8/9 ≈ 0.889. Both ≥ 0.85
    // and within 0.05 of each other → matcher should abstain.
    sqlMock.mockResolvedValueOnce([
      {
        id: 'a',
        email: 'a@x.za',
        first_name: 'Adam',
        last_name: 'Andersen',
        id_number: null,
        sa_id_number: null,
        payroll_code: null,
      },
      {
        id: 'b',
        email: 'b@x.za',
        first_name: 'Alice',
        last_name: 'Andersone',
        id_number: null,
        sa_id_number: null,
        payroll_code: null,
      },
    ]);
    const page = makePage({ firstInitial: 'A', lastName: 'anderson' });
    const out = await matchPagesToStaff([page]);
    expect(out.get(1)?.method).toBe('unmatched');
  });
});
