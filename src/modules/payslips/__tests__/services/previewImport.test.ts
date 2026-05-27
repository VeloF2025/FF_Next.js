/**
 * Integration tests for the preview phase of the combined-PDF importer.
 *
 * Covers the orchestration that runPreviewImport does:
 *   - splits PDF, runs auto-match
 *   - applies manual mappings (with archived-staff guard)
 *   - joins existing payslips for diff state
 *   - pulls period skip rows
 *   - applies casualMatchOverrides on the commit re-run path
 *
 * The PDF splitter and staff matcher have their own unit tests; here we
 * mock them to focus on the preview service's wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────
const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

const splitMock = vi.fn();
vi.mock('../../pdfSplitter', async () => {
  const actual = await vi.importActual<typeof import('../../pdfSplitter')>(
    '../../pdfSplitter'
  );
  return {
    ...actual,
    splitCombinedPayslipPdf: (...args: unknown[]) => splitMock(...args),
  };
});

const matchPagesMock = vi.fn();
vi.mock('../../staffMatcher', () => ({
  matchPagesToStaff: (...args: unknown[]) => matchPagesMock(...args),
}));

import { runPreviewImport } from '../../services/previewImport';
import type { ExtractedPayslipPage } from '../../pdfSplitter';
import type { StaffMatchResult } from '../../staffMatcher';

function makePage(over: Partial<ExtractedPayslipPage> = {}): ExtractedPayslipPage {
  return {
    page: 1,
    empCode: 'AC001',
    empName: 'Mr A Smith',
    firstInitial: 'A',
    lastName: 'smith',
    idNumber: '8001015009088',
    paymentDate: '2026/04/30',
    totalEarningsCents: 2_500_000,
    totalDeductionsCents: 360_000,
    nettPayCents: 2_140_000,
    pdfBuffer: Buffer.from('%PDF-fake'),
    rawText: 'fake page',
    ...over,
  };
}

function makeMatch(staffId: string | null): StaffMatchResult {
  return {
    staffId,
    staffName: staffId ? 'Test Staff' : null,
    staffEmail: staffId ? 'test@example.com' : null,
    method: staffId ? 'id_number' : 'unmatched',
    confidence: staffId ? 1 : 0,
  };
}

beforeEach(() => {
  sqlMock.mockReset();
  splitMock.mockReset();
  matchPagesMock.mockReset();
});

/**
 * Simulate the SQL query sequence runPreviewImport runs:
 *   1. (only if manualMappings) SELECT staff WHERE id = ANY(...)
 *   2. (only if matched ids)    SELECT payslips for period
 *   3. (only if period)         SELECT payslip_import_skips for period
 *   4. always                   SELECT staff list for the dropdown
 */
function queueSqlReplies(replies: unknown[][]) {
  for (const r of replies) sqlMock.mockResolvedValueOnce(r);
}

describe('runPreviewImport — orchestration', () => {
  it('returns "new" rowState when staff matched + no existing payslip', async () => {
    splitMock.mockResolvedValueOnce({
      pages: [makePage()],
      period: '2026-04',
      numPages: 1,
    });
    matchPagesMock.mockResolvedValueOnce(
      new Map([[1, makeMatch('staff-1')]])
    );
    queueSqlReplies([
      [], // existingByStaff (no payslips for period)
      [], // periodSkips
      [{ id: 'staff-1', first_name: 'Test', last_name: 'Staff', email: 'test@example.com', employment_type: 'permanent' }], // staff list
    ]);

    const out = await runPreviewImport({
      buffer: Buffer.from('%PDF-fake'),
      manualMappings: [],
    });

    expect(out.previewRows).toHaveLength(1);
    expect(out.previewRows[0]!.rowState).toBe('new');
    expect(out.previewRows[0]!.match.staffId).toBe('staff-1');
    expect(out.staffOptions).toHaveLength(1);
  });

  it('returns "already_imported" when existing payslip matches amounts', async () => {
    splitMock.mockResolvedValueOnce({
      pages: [makePage()],
      period: '2026-04',
      numPages: 1,
    });
    matchPagesMock.mockResolvedValueOnce(
      new Map([[1, makeMatch('staff-1')]])
    );
    queueSqlReplies([
      [
        {
          id: 'p1',
          staff_id: 'staff-1',
          gross_cents: '2500000',
          deductions_cents: '360000',
          net_cents: '2140000',
          pdf_url: '/storage/staff/payslips/abc.pdf',
          imported_at: '2026-04-27T10:00:00Z',
        },
      ],
      [], // periodSkips
      [{ id: 'staff-1', first_name: 'A', last_name: 'B', email: 'a@b.za', employment_type: 'permanent' }],
    ]);

    const out = await runPreviewImport({
      buffer: Buffer.from('%PDF-fake'),
      manualMappings: [],
    });

    expect(out.previewRows[0]!.rowState).toBe('already_imported');
    expect(out.previewRows[0]!.existingPayslip?.id).toBe('p1');
    expect(out.previewRows[0]!.existingPayslip?.pdfStoredFilename).toBe('abc.pdf');
  });

  it('returns "matched_changed" when amounts differ', async () => {
    splitMock.mockResolvedValueOnce({
      pages: [makePage()],
      period: '2026-04',
      numPages: 1,
    });
    matchPagesMock.mockResolvedValueOnce(
      new Map([[1, makeMatch('staff-1')]])
    );
    queueSqlReplies([
      [
        {
          id: 'p1',
          staff_id: 'staff-1',
          gross_cents: '2500000',
          deductions_cents: '360000',
          net_cents: '2999999', // diff
          pdf_url: '/storage/staff/payslips/abc.pdf',
          imported_at: '2026-04-27T10:00:00Z',
        },
      ],
      [],
      [{ id: 'staff-1', first_name: 'A', last_name: 'B', email: 'a@b.za', employment_type: 'permanent' }],
    ]);

    const out = await runPreviewImport({
      buffer: Buffer.from('%PDF-fake'),
      manualMappings: [],
    });

    expect(out.previewRows[0]!.rowState).toBe('matched_changed');
  });

  it('returns "previously_skipped" when no staff matched but skip row exists', async () => {
    splitMock.mockResolvedValueOnce({
      pages: [makePage({ empCode: 'AC050' })],
      period: '2026-04',
      numPages: 1,
    });
    matchPagesMock.mockResolvedValueOnce(
      new Map([[1, makeMatch(null)]])
    );
    queueSqlReplies([
      [
        {
          id: 'skip-1',
          emp_code: 'AC050',
          emp_name: 'Casual Worker',
          reason: 'Not yet onboarded',
          skipped_at: '2026-04-27T09:00:00Z',
          resolved_at: null,
        },
      ],
      [], // staff list
    ]);

    const out = await runPreviewImport({
      buffer: Buffer.from('%PDF-fake'),
      manualMappings: [],
    });

    expect(out.previewRows[0]!.rowState).toBe('previously_skipped');
    expect(out.previewRows[0]!.previousSkip?.id).toBe('skip-1');
    expect(out.periodSkips).toHaveLength(1);
  });

  it('manualMappings hydrate match + reject archived staff', async () => {
    splitMock.mockResolvedValueOnce({
      pages: [makePage()],
      period: '2026-04',
      numPages: 1,
    });
    matchPagesMock.mockResolvedValueOnce(
      new Map([[1, makeMatch(null)]])
    );
    // First SQL is the manual-mapping resolution. Return empty → mapping refers to archived/unknown staff.
    queueSqlReplies([
      [], // SELECT staff for manual mapping (empty = archived)
    ]);

    await expect(
      runPreviewImport({
        buffer: Buffer.from('%PDF-fake'),
        manualMappings: [{ page: 1, staffId: 'archived-id' }],
      })
    ).rejects.toThrow(/unknown or archived staff id archived-id/);
  });

  it('manualMappings overlay overwrites auto-match for the named page', async () => {
    splitMock.mockResolvedValueOnce({
      pages: [makePage()],
      period: '2026-04',
      numPages: 1,
    });
    matchPagesMock.mockResolvedValueOnce(
      new Map([[1, makeMatch('auto-staff')]])
    );
    queueSqlReplies([
      [{ id: 'manual-staff', first_name: 'M', last_name: 'P', email: 'mp@x.za' }], // manual SELECT
      [], // existingByStaff
      [], // periodSkips
      [{ id: 'manual-staff', first_name: 'M', last_name: 'P', email: 'mp@x.za', employment_type: 'casual' }], // staff list
    ]);

    const out = await runPreviewImport({
      buffer: Buffer.from('%PDF-fake'),
      manualMappings: [{ page: 1, staffId: 'manual-staff' }],
    });

    // manualMappings always overrides auto-match.
    expect(out.matches.get(1)?.staffId).toBe('manual-staff');
  });

  it('casualMatchOverrides applied before manualMappings', async () => {
    splitMock.mockResolvedValueOnce({
      pages: [makePage()],
      period: '2026-04',
      numPages: 1,
    });
    matchPagesMock.mockResolvedValueOnce(new Map([[1, makeMatch(null)]]));
    queueSqlReplies([
      [], // existingByStaff
      [], // periodSkips
      [], // staff list
    ]);

    const out = await runPreviewImport({
      buffer: Buffer.from('%PDF-fake'),
      manualMappings: [],
      casualMatchOverrides: new Map([
        [1, { staffId: 'newly-created', staffName: 'New Casual', staffEmail: 'nc@x.za', method: 'payroll_code', confidence: 1 }],
      ]),
    });

    expect(out.matches.get(1)?.staffId).toBe('newly-created');
    expect(out.previewRows[0]!.rowState).toBe('new');
  });
});
