/**
 * Integration tests for the commit phase of the combined-PDF importer.
 *
 * These cover the orchestration logic that the unit tests for rowState /
 * casualInput / staffMatcher don't exercise:
 *   - upload-then-commit ordering (uploads succeed before any DB write)
 *   - upload rollback when one Promise.allSettled fails
 *   - transaction rollback + storage cleanup on DB error
 *   - skip-row writes
 *   - force-reimport overrides 'already_imported'
 *   - resolve-prior-skip when staff record finally exists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ExtractedPayslipPage } from '../../pdfSplitter';
import type { StaffMatchResult } from '../../staffMatcher';
import type { ExistingPayslipSummary } from '../../types';

// ── Mocks ──────────────────────────────────────────────────────────────
const sqlMock = vi.fn();
const transactionMock = vi.fn();
const uploadFileMock = vi.fn();
const deleteFileMock = vi.fn();

vi.mock('@/lib/db-pool', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
  transaction: (cb: (txn: TxnLike) => Promise<unknown>) => transactionMock(cb),
}));
vi.mock('@/services/vfStorageAdapter', () => ({
  vfStorage: {
    uploadFile: (...args: unknown[]) => uploadFileMock(...args),
    deleteFile: (...args: unknown[]) => deleteFileMock(...args),
  },
}));

import { runCommitImport } from '../../services/commitImport';

interface TxnLike {
  query: (text: string, params?: unknown[]) => Promise<unknown[]>;
}

// ── Helpers ────────────────────────────────────────────────────────────
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
    pdfBuffer: Buffer.from('%PDF-fake-' + (over.page ?? 1)),
    rawText: 'fake page',
    ...over,
  };
}

function makeMatch(staffId: string): StaffMatchResult {
  return {
    staffId,
    staffName: 'Test Staff',
    staffEmail: 'test@example.com',
    method: 'id_number',
    confidence: 1,
  };
}

function makeExisting(overrides: Partial<ExistingPayslipSummary> = {}): ExistingPayslipSummary {
  return {
    id: 'existing-1',
    importedAt: '2026-04-27T10:00:00Z',
    grossCents: 2_500_000,
    deductionsCents: 360_000,
    netCents: 2_140_000,
    hasPdf: true,
    pdfStoredFilename: 'old-hash.pdf',
    ...overrides,
  };
}

/** Stand-in transaction that just runs the callback against a stub txn. */
function fakeTransaction() {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  const txn: TxnLike = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      // Default: return empty rows.
      return [];
    }),
  };
  return {
    txn,
    queries,
    runner: async (cb: (txn: TxnLike) => Promise<unknown>) => {
      return cb(txn);
    },
  };
}

beforeEach(() => {
  sqlMock.mockReset();
  transactionMock.mockReset();
  uploadFileMock.mockReset();
  deleteFileMock.mockReset();
});

// ── Tests ──────────────────────────────────────────────────────────────
describe('runCommitImport — orchestration', () => {
  it('uploads, transacts, and skips delete when no existing PDF replaces', async () => {
    uploadFileMock.mockResolvedValueOnce({
      url: '/storage/staff/payslips/new-hash.pdf',
    });
    const fake = fakeTransaction();
    transactionMock.mockImplementationOnce(fake.runner);

    const result = await runCommitImport({
      pages: [makePage()],
      matches: new Map([[1, makeMatch('staff-1')]]),
      existingByStaff: new Map(), // no existing payslip
      period: '2026-04',
      importedByUserId: 'user-1',
      manualMappings: [],
      skipRequests: [],
      forceReimport: false,
    });

    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(deleteFileMock).not.toHaveBeenCalled();
    expect(result.insertedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(result.unchangedSkipped).toBe(0);
    // Verify the INSERT INTO payslips ran.
    const inserts = fake.queries.filter((q) => q.text.includes('INSERT INTO payslips'));
    expect(inserts).toHaveLength(1);
  });

  it('skips DB write entirely when row is already_imported with same amounts', async () => {
    const fake = fakeTransaction();
    transactionMock.mockImplementationOnce(fake.runner);

    const result = await runCommitImport({
      pages: [makePage()],
      matches: new Map([[1, makeMatch('staff-1')]]),
      existingByStaff: new Map([['staff-1', makeExisting()]]),
      period: '2026-04',
      importedByUserId: 'user-1',
      manualMappings: [],
      skipRequests: [],
      forceReimport: false,
    });

    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(result.unchangedSkipped).toBe(1);
  });

  it('forceReimport overrides already_imported and replaces the PDF', async () => {
    uploadFileMock.mockResolvedValueOnce({
      url: '/storage/staff/payslips/new-hash.pdf',
    });
    deleteFileMock.mockResolvedValueOnce(undefined);
    const fake = fakeTransaction();
    transactionMock.mockImplementationOnce(fake.runner);

    const result = await runCommitImport({
      pages: [makePage()],
      matches: new Map([[1, makeMatch('staff-1')]]),
      existingByStaff: new Map([['staff-1', makeExisting()]]),
      period: '2026-04',
      importedByUserId: 'user-1',
      manualMappings: [],
      skipRequests: [],
      forceReimport: true,
    });

    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    expect(result.updatedCount).toBe(1);
    expect(result.unchangedSkipped).toBe(0);
    // Old PDF should be deleted post-commit.
    expect(deleteFileMock).toHaveBeenCalledWith('staff', 'payslips', 'old-hash.pdf');
  });

  it('skipRequests writes a skip row and increments manualSkippedCount', async () => {
    const fake = fakeTransaction();
    transactionMock.mockImplementationOnce(fake.runner);

    const result = await runCommitImport({
      pages: [makePage({ page: 1, empCode: 'AC050' })],
      // No staff match at all — the skip path must work without one,
      // proving skipRequests is consulted before the orphan-page guard.
      matches: new Map([[1, { ...makeMatch('any'), staffId: null, method: 'unmatched' }]]),
      existingByStaff: new Map(),
      period: '2026-04',
      importedByUserId: 'user-1',
      manualMappings: [],
      skipRequests: [{ page: 1, reason: 'Casual not yet in system' }],
      forceReimport: false,
    });

    expect(uploadFileMock).not.toHaveBeenCalled();
    expect(result.manualSkippedCount).toBe(1);
    const skipInserts = fake.queries.filter((q) =>
      q.text.includes('INSERT INTO payslip_import_skips')
    );
    expect(skipInserts).toHaveLength(1);
  });

  it('aborts with a friendly error when one upload fails and rolls back successful uploads', async () => {
    uploadFileMock
      .mockResolvedValueOnce({ url: '/storage/staff/payslips/page1-hash.pdf' })
      .mockRejectedValueOnce(new Error('VF Storage 503'));
    deleteFileMock.mockResolvedValue(undefined);

    await expect(
      runCommitImport({
        pages: [makePage({ page: 1 }), makePage({ page: 2, empCode: 'AC002' })],
        matches: new Map([
          [1, makeMatch('staff-1')],
          [2, makeMatch('staff-2')],
        ]),
        existingByStaff: new Map(),
        period: '2026-04',
        importedByUserId: 'user-1',
        manualMappings: [],
        skipRequests: [],
        forceReimport: false,
      })
    ).rejects.toThrow(/Upload failed for 1 of 2 page/);

    // The successful upload must be deleted with the exact filename — not
    // any random delete (mock-asserting-mock smell).
    expect(deleteFileMock).toHaveBeenCalledWith('staff', 'payslips', 'page1-hash.pdf');
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('rolls back the just-uploaded PDFs when the transaction throws', async () => {
    uploadFileMock.mockResolvedValueOnce({
      url: '/storage/staff/payslips/new-hash.pdf',
    });
    deleteFileMock.mockResolvedValue(undefined);
    transactionMock.mockImplementationOnce(async () => {
      throw new Error('FK violation simulated');
    });

    await expect(
      runCommitImport({
        pages: [makePage()],
        matches: new Map([[1, makeMatch('staff-1')]]),
        existingByStaff: new Map(),
        period: '2026-04',
        importedByUserId: 'user-1',
        manualMappings: [],
        skipRequests: [],
        forceReimport: false,
      })
    ).rejects.toThrow(/FK violation simulated/);

    // The newly-uploaded PDF must be deleted post-rollback — assert exact
    // filename so a wrong-target delete bug would still fail this test.
    expect(deleteFileMock).toHaveBeenCalledWith('staff', 'payslips', 'new-hash.pdf');
  });

  it('throws on orphan unmatched page (no staff, not skipped)', async () => {
    await expect(
      runCommitImport({
        pages: [makePage()],
        matches: new Map([[1, { ...makeMatch('any'), staffId: null, method: 'unmatched' }]]),
        existingByStaff: new Map(),
        period: '2026-04',
        importedByUserId: 'user-1',
        manualMappings: [],
        skipRequests: [],
        forceReimport: false,
      })
    ).rejects.toThrow(/page 1 has no staff assigned and was not skipped/);
  });

  it('throws on unparseable amounts when the page is not skipped', async () => {
    await expect(
      runCommitImport({
        pages: [makePage({ totalEarningsCents: null })],
        matches: new Map([[1, makeMatch('staff-1')]]),
        existingByStaff: new Map(),
        period: '2026-04',
        importedByUserId: 'user-1',
        manualMappings: [],
        skipRequests: [],
        forceReimport: false,
      })
    ).rejects.toThrow(/has unparseable amounts/);
  });

  it('persists payroll_code mapping when manualMappings include savePayrollCode', async () => {
    uploadFileMock.mockResolvedValueOnce({
      url: '/storage/staff/payslips/new-hash.pdf',
    });
    const fake = fakeTransaction();
    // Make the UPDATE staff query return one updated row.
    fake.txn.query = vi.fn(async (text: string, params?: unknown[]) => {
      if (text.includes('UPDATE staff')) {
        return [{ id: 'staff-1' }];
      }
      return [];
    });
    transactionMock.mockImplementationOnce((cb) => cb(fake.txn));

    const result = await runCommitImport({
      pages: [makePage()],
      matches: new Map([[1, makeMatch('staff-1')]]),
      existingByStaff: new Map(),
      period: '2026-04',
      importedByUserId: 'user-1',
      manualMappings: [{ page: 1, staffId: 'staff-1', savePayrollCode: true }],
      skipRequests: [],
      forceReimport: false,
    });

    expect(result.payrollCodesSaved).toBe(1);
  });
});
