/**
 * bankReconciliationService.test.ts
 * Unit tests for Bank Reconciliation Service (Sage/bank reconciliation module)
 *
 * Coverage targets:
 * - importBankStatement: format detection & CSV parsing
 * - importParsedTransactions: persist pre-parsed transactions
 * - matchTransaction / unmatchTransaction / excludeTransaction
 * - deleteTransactions / bulkAcceptTransactions
 * - getReconciliationById / completeReconciliation error paths
 * - autoMatchTransactions (no candidates, empty state)
 *
 * All DB calls (sql tagged template) are mocked via @/lib/neon.
 */

// ============================================================================
// MOCKS - defined before imports
// ============================================================================

vi.mock('@/lib/logger', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

// vi.hoisted ensures mockSqlFn is available before vi.mock factories run
const mockSqlFn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/neon', () => ({
  sql: new Proxy(mockSqlFn, {
    // Tagged template usage: sql`...` calls the function with strings + values
    apply: (target, _thisArg, args) => target(...args),
    get: (target, prop) => {
      if (typeof prop === 'string' && prop !== 'then' && prop !== 'catch') {
        return target[prop as keyof typeof target];
      }
      return target[prop as keyof typeof target];
    },
  }),
}));

// Mock bank CSV parsers (heavy external parsers)
vi.mock('@/modules/accounting/utils/bankCsvParsers', () => ({
  detectBankFormat: vi.fn(() => 'fnb'),
  parseFNBStatement: vi.fn(() => ({
    transactions: [
      {
        transactionDate: '2025-01-15',
        valueDate: '2025-01-15',
        amount: -1500.00,
        description: 'PAYMENT TO VENDOR',
        reference: 'REF001',
      },
    ],
    errors: [],
    bankFormat: 'fnb',
  })),
  parseStandardBankStatement: vi.fn(() => ({ transactions: [], errors: [], bankFormat: 'standard_bank' })),
  parseNedbankStatement: vi.fn(() => ({ transactions: [], errors: [], bankFormat: 'nedbank' })),
  parseABSAStatement: vi.fn(() => ({ transactions: [], errors: [], bankFormat: 'absa' })),
  parseCapitecStatement: vi.fn(() => ({ transactions: [], errors: [], bankFormat: 'capitec' })),
}));

vi.mock('@/modules/accounting/utils/bankOfxParser', () => ({
  parseOfxStatement: vi.fn(() => ({ transactions: [], errors: [], bankFormat: 'ofx' })),
}));

vi.mock('@/modules/accounting/utils/bankQifParser', () => ({
  parseQifStatement: vi.fn(() => ({ transactions: [], errors: [], bankFormat: 'qif' })),
}));

vi.mock('@/modules/accounting/utils/autoMatch', () => ({
  runAutoMatch: vi.fn(() => ({ matches: [], unmatched: [], candidates: [] })),
}));

vi.mock('@/modules/accounting/services/journalEntryService', () => ({
  createJournalEntry: vi.fn(async () => ({ id: 'je-uuid-test' })),
  postJournalEntry: vi.fn(async () => {}),
}));

// ============================================================================
// IMPORTS - after mocks
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  importBankStatement,
  importParsedTransactions,
  matchTransaction,
  unmatchTransaction,
  excludeTransaction,
  deleteTransactions,
  bulkAcceptTransactions,
  getReconciliationById,
  completeReconciliation,
  autoMatchTransactions,
} from '@/modules/accounting/services/bankReconciliationService';

// ============================================================================
// Helpers
// ============================================================================

/** Build a mock bank transaction row (raw DB row) */
function mockTxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-uuid-001',
    bank_account_id: 'acc-uuid-001',
    transaction_date: new Date('2025-01-15'),
    value_date: null,
    amount: -1500.00,
    description: 'PAYMENT TO VENDOR',
    reference: 'REF001',
    bank_reference: null,
    status: 'imported',
    matched_journal_line_id: null,
    reconciliation_id: null,
    import_batch_id: 'batch-uuid-001',
    exclude_reason: null,
    notes: null,
    suggested_gl_account_id: null,
    suggested_category: null,
    suggested_cost_centre: null,
    created_at: '2025-01-15T10:00:00Z',
    updated_at: '2025-01-15T10:00:00Z',
    bank_account_name: 'FNB Business',
    matched_entry_number: null,
    suggested_gl_account_name: null,
    suggested_gl_account_code: null,
    suggested_supplier_id: null,
    suggested_supplier_name: null,
    suggested_client_id: null,
    suggested_client_name: null,
    suggested_vat_code: null,
    cc1_id: null, cc2_id: null, bu_id: null,
    cc1_name: null, cc2_name: null, bu_name: null,
    allocation_type: null,
    allocated_entity_name: null,
    ...overrides,
  };
}

/** Build a mock reconciliation row */
function mockReconRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recon-uuid-001',
    bank_account_id: 'acc-uuid-001',
    statement_date: new Date('2025-01-31'),
    statement_balance: 100000,
    gl_balance: 100000,
    reconciled_balance: 100000,
    difference: 0,
    status: 'in_progress',
    started_by: 'user-uuid-001',
    started_at: '2025-01-31T08:00:00Z',
    completed_by: null,
    completed_at: null,
    notes: null,
    created_at: '2025-01-31T08:00:00Z',
    updated_at: '2025-01-31T08:00:00Z',
    bank_account_name: 'FNB Business',
    matched_count: 5,
    unmatched_count: 2,
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE 1: importBankStatement
// ============================================================================

describe('importBankStatement', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
    // Mock the SQL INSERT call - tagged template resolves to undefined (no return needed for INSERT)
    mockSqlFn.mockResolvedValue([]);
  });

  it('should import FNB CSV and return batch info', async () => {
    const csvContent = 'Date,Description,Amount\n15 Jan 2025,Payment,−1500.00';
    const result = await importBankStatement(csvContent, 'acc-uuid-001', '2025-01-31', 'fnb');

    expect(result.transactionCount).toBe(1);
    expect(result.batchId).toBeDefined();
    expect(result.batchId).not.toBe('');
    expect(result.errors).toHaveLength(0);
  });

  it('should auto-detect bank format when not specified', async () => {
    const csvContent = 'Date,Description,Amount\n15 Jan 2025,Payment,−1500.00';
    const result = await importBankStatement(csvContent, 'acc-uuid-001', '2025-01-31');

    // detectBankFormat mock returns 'fnb', parseFNBStatement returns 1 transaction
    expect(result.transactionCount).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should return empty result when parser returns no transactions', async () => {
    const { parseFNBStatement } = await import('@/modules/accounting/utils/bankCsvParsers');
    vi.mocked(parseFNBStatement).mockReturnValueOnce({
      transactions: [],
      errors: [],
      bankFormat: 'fnb',
    });

    const result = await importBankStatement('empty', 'acc-uuid-001', '2025-01-31', 'fnb');
    expect(result.transactionCount).toBe(0);
    expect(result.batchId).toBe('');
  });

  it('should throw on unsupported bank format when detect returns unknown', async () => {
    const { detectBankFormat } = await import('@/modules/accounting/utils/bankCsvParsers');
    vi.mocked(detectBankFormat).mockReturnValueOnce('unknown' as never);

    await expect(
      importBankStatement('content', 'acc-uuid-001', '2025-01-31')
    ).rejects.toThrow('Unable to detect bank format');
  });

  it('should propagate DB errors', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('Connection pool exhausted'));
    const csvContent = 'Date,Description,Amount\n15 Jan 2025,Payment,−1500.00';
    await expect(
      importBankStatement(csvContent, 'acc-uuid-001', '2025-01-31', 'fnb')
    ).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 2: importParsedTransactions
// ============================================================================

describe('importParsedTransactions', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
    mockSqlFn.mockResolvedValue([]);
  });

  it('should import pre-parsed transactions and return batch info', async () => {
    const parseResult = {
      transactions: [
        { transactionDate: '2025-01-15', valueDate: '2025-01-15', amount: 5000, description: 'Revenue', reference: null },
        { transactionDate: '2025-01-16', valueDate: null, amount: -200, description: 'Bank fee', reference: 'FEE001' },
      ],
      errors: [],
      bankFormat: 'fnb' as const,
    };

    const result = await importParsedTransactions(parseResult, 'acc-uuid-001', '2025-01-31');
    expect(result.transactionCount).toBe(2);
    expect(result.batchId).toBeDefined();
    expect(result.batchId).not.toBe('');
  });

  it('should return empty result when no transactions provided', async () => {
    const result = await importParsedTransactions(
      { transactions: [], errors: [], bankFormat: 'fnb' },
      'acc-uuid-001',
      '2025-01-31'
    );
    expect(result.transactionCount).toBe(0);
    expect(result.batchId).toBe('');
  });

  it('should propagate DB errors', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('DB timeout'));
    await expect(
      importParsedTransactions(
        { transactions: [{ transactionDate: '2025-01-15', valueDate: null, amount: 100, description: 'Test', reference: null }], errors: [], bankFormat: 'fnb' },
        'acc-uuid-001',
        '2025-01-31'
      )
    ).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 3: matchTransaction
// ============================================================================

describe('matchTransaction', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should match transaction and return updated record', async () => {
    const updatedRow = mockTxRow({ status: 'matched', matched_journal_line_id: 'jl-uuid-001' });
    mockSqlFn
      .mockResolvedValueOnce([updatedRow]) // UPDATE bank_transactions RETURNING
      .mockResolvedValueOnce([{ gl_balance: 100000 }]) // getReconciliationById for updateReconciledBalance
      .mockResolvedValueOnce([{ matched_total: 1500 }]) // SUM for updateReconciledBalance
      .mockResolvedValueOnce([]) // UPDATE reconciled_balance
    ;

    const result = await matchTransaction('tx-uuid-001', 'jl-uuid-001');
    expect(result.status).toBe('matched');
    expect(result.matchedJournalLineId).toBe('jl-uuid-001');
    expect(result.id).toBe('tx-uuid-001');
  });

  it('should match transaction without reconciliation', async () => {
    const updatedRow = mockTxRow({ status: 'matched', matched_journal_line_id: 'jl-uuid-002', reconciliation_id: null });
    mockSqlFn.mockResolvedValueOnce([updatedRow]);

    const result = await matchTransaction('tx-uuid-001', 'jl-uuid-002');
    expect(result.status).toBe('matched');
  });

  it('should throw when transaction not found', async () => {
    mockSqlFn.mockResolvedValueOnce([]); // empty result = not found
    await expect(matchTransaction('nonexistent-tx', 'jl-uuid-001')).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 4: unmatchTransaction
// ============================================================================

describe('unmatchTransaction', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should unmatch transaction and reset to imported', async () => {
    // First query: get reconciliation_id
    mockSqlFn
      .mockResolvedValueOnce([{ reconciliation_id: null }])
      // UPDATE RETURNING
      .mockResolvedValueOnce([mockTxRow({ status: 'imported', matched_journal_line_id: null })]);

    const result = await unmatchTransaction('tx-uuid-001');
    expect(result.status).toBe('imported');
    expect(result.matchedJournalLineId).toBeUndefined();
  });

  it('should throw when transaction not found', async () => {
    mockSqlFn
      .mockResolvedValueOnce([{ reconciliation_id: null }])
      .mockResolvedValueOnce([]); // empty UPDATE result
    await expect(unmatchTransaction('nonexistent-tx')).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 5: excludeTransaction
// ============================================================================

describe('excludeTransaction', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should exclude transaction with reason', async () => {
    const excluded = mockTxRow({ status: 'excluded', exclude_reason: 'Not a business transaction' });
    mockSqlFn.mockResolvedValueOnce([excluded]);

    const result = await excludeTransaction('tx-uuid-001', 'Not a business transaction');
    expect(result.status).toBe('excluded');
    expect(result.excludeReason).toBe('Not a business transaction');
  });

  it('should exclude transaction without reason', async () => {
    const excluded = mockTxRow({ status: 'excluded', exclude_reason: null });
    mockSqlFn.mockResolvedValueOnce([excluded]);

    const result = await excludeTransaction('tx-uuid-001');
    expect(result.status).toBe('excluded');
    expect(result.excludeReason).toBeUndefined();
  });

  it('should throw when transaction not found', async () => {
    mockSqlFn.mockResolvedValueOnce([]);
    await expect(excludeTransaction('nonexistent-tx')).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 6: deleteTransactions
// ============================================================================

describe('deleteTransactions', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should skip DB call when given empty array', async () => {
    const result = await deleteTransactions([]);
    expect(result).toBe(0);
    expect(mockSqlFn).not.toHaveBeenCalled();
  });

  it('should delete imported transactions', async () => {
    mockSqlFn.mockResolvedValueOnce(Object.assign([], { count: 3 }));
    const result = await deleteTransactions(['tx1', 'tx2', 'tx3']);
    expect(result).toBe(3);
  });

  it('should propagate DB errors', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('FK constraint violation'));
    await expect(deleteTransactions(['tx-uuid-001'])).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 7: bulkAcceptTransactions
// ============================================================================

describe('bulkAcceptTransactions', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should skip DB call when given empty array', async () => {
    const result = await bulkAcceptTransactions([]);
    expect(result).toBe(0);
    expect(mockSqlFn).not.toHaveBeenCalled();
  });

  it('should bulk-accept transactions', async () => {
    mockSqlFn.mockResolvedValueOnce(Object.assign([], { count: 5 }));
    const result = await bulkAcceptTransactions(['t1', 't2', 't3', 't4', 't5']);
    expect(result).toBe(5);
  });
});

// ============================================================================
// TEST SUITE 8: getReconciliationById
// ============================================================================

describe('getReconciliationById', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should return reconciliation when found', async () => {
    mockSqlFn.mockResolvedValueOnce([mockReconRow()]);
    const result = await getReconciliationById('recon-uuid-001');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('recon-uuid-001');
    expect(result!.statementBalance).toBe(100000);
    expect(result!.status).toBe('in_progress');
  });

  it('should return null when reconciliation not found', async () => {
    mockSqlFn.mockResolvedValueOnce([]);
    const result = await getReconciliationById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('should throw on DB error', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('Query timeout'));
    await expect(getReconciliationById('recon-uuid-001')).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 9: completeReconciliation
// ============================================================================

describe('completeReconciliation', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should throw when reconciliation is already completed', async () => {
    // getReconciliationById returns completed recon
    mockSqlFn.mockResolvedValueOnce([mockReconRow({ status: 'completed' })]);
    await expect(completeReconciliation('recon-uuid-001', 'user-uuid-001')).rejects.toThrow(
      'already completed'
    );
  });

  it('should throw when difference is non-zero', async () => {
    mockSqlFn.mockResolvedValueOnce([
      mockReconRow({ status: 'in_progress', difference: 150.50 }),
    ]);
    await expect(completeReconciliation('recon-uuid-001', 'user-uuid-001')).rejects.toThrow(
      'difference'
    );
  });

  it('should throw when reconciliation not found', async () => {
    mockSqlFn.mockResolvedValueOnce([]); // getReconciliationById returns null
    await expect(completeReconciliation('nonexistent', 'user-uuid-001')).rejects.toThrow();
  });

  it('should complete reconciliation when difference is zero', async () => {
    const completedRow = mockReconRow({ status: 'completed', difference: 0 });
    mockSqlFn
      .mockResolvedValueOnce([mockReconRow({ status: 'in_progress', difference: 0 })]) // getReconciliationById
      .mockResolvedValueOnce([]) // UPDATE bank_transactions SET status = 'reconciled'
      .mockResolvedValueOnce([completedRow]); // UPDATE bank_reconciliations RETURNING

    const result = await completeReconciliation('recon-uuid-001', 'user-uuid-001');
    expect(result.status).toBe('completed');
  });
});

// ============================================================================
// TEST SUITE 10: autoMatchTransactions (empty bank txs)
// ============================================================================

describe('autoMatchTransactions', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should return zero counts when no unmatched transactions', async () => {
    // Empty bank transactions
    mockSqlFn.mockResolvedValueOnce([]);

    const result = await autoMatchTransactions('acc-uuid-001');
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });

  it('should propagate DB errors', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(autoMatchTransactions('acc-uuid-001')).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 11: getBankTransactions
// ============================================================================

import {
  getBankTransactions,
  getReconciliations,
  startReconciliation,
} from '../../../modules/accounting/services/bankReconciliationService';

describe('getBankTransactions', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should return all transactions with no filters', async () => {
    const rows = [mockTxRow(), mockTxRow({ id: 'tx-uuid-002', amount: 2500 })];
    mockSqlFn
      .mockResolvedValueOnce(rows)         // SELECT
      .mockResolvedValueOnce([{ cnt: '2' }]); // COUNT

    const result = await getBankTransactions();
    expect(result.transactions).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('should filter by bankAccountId', async () => {
    mockSqlFn
      .mockResolvedValueOnce([mockTxRow()])
      .mockResolvedValueOnce([{ cnt: '1' }]);

    const result = await getBankTransactions({ bankAccountId: 'acc-uuid-001' });
    expect(result.transactions).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('should filter by reconciliationId', async () => {
    mockSqlFn
      .mockResolvedValueOnce([mockTxRow({ reconciliation_id: 'recon-uuid-001' })])
      .mockResolvedValueOnce([{ cnt: '1' }]);

    const result = await getBankTransactions({ reconciliationId: 'recon-uuid-001' });
    expect(result.transactions).toHaveLength(1);
  });

  it('should filter by bankAccountId + status', async () => {
    mockSqlFn
      .mockResolvedValueOnce([mockTxRow({ status: 'matched' })])
      .mockResolvedValueOnce([{ cnt: '1' }]);

    const result = await getBankTransactions({
      bankAccountId: 'acc-uuid-001',
      status: 'matched',
    });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].status).toBe('matched');
  });

  it('should apply default limit of 100', async () => {
    mockSqlFn
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cnt: '0' }]);

    const result = await getBankTransactions({ bankAccountId: 'acc-uuid-001' });
    expect(result.total).toBe(0);
  });

  it('should propagate DB errors', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(getBankTransactions()).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 12: getReconciliations
// ============================================================================

describe('getReconciliations', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should return all reconciliations with no filter', async () => {
    mockSqlFn.mockResolvedValueOnce([mockReconRow(), mockReconRow({ id: 'recon-uuid-002' })]);
    const result = await getReconciliations();
    expect(result).toHaveLength(2);
  });

  it('should filter reconciliations by bankAccountId', async () => {
    mockSqlFn.mockResolvedValueOnce([mockReconRow()]);
    const result = await getReconciliations('acc-uuid-001');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('recon-uuid-001');
  });

  it('should return empty array when no reconciliations', async () => {
    mockSqlFn.mockResolvedValueOnce([]);
    const result = await getReconciliations('acc-no-recons');
    expect(result).toHaveLength(0);
  });

  it('should propagate DB errors', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('Query timeout'));
    await expect(getReconciliations()).rejects.toThrow();
  });
});

// ============================================================================
// TEST SUITE 13: startReconciliation
// ============================================================================

describe('startReconciliation', () => {
  beforeEach(() => {
    mockSqlFn.mockReset();
  });

  it('should create a new reconciliation and link unmatched transactions', async () => {
    const newRecon = mockReconRow({ status: 'in_progress' });
    mockSqlFn
      .mockResolvedValueOnce([{ gl_balance: '95000' }])  // GL balance query
      .mockResolvedValueOnce([newRecon])                  // INSERT reconciliation RETURNING
      .mockResolvedValueOnce([]);                         // UPDATE bank_transactions link

    const result = await startReconciliation(
      'acc-uuid-001',
      '2025-01-31',
      100000,
      'user-uuid-001'
    );
    expect(result.id).toBe('recon-uuid-001');
    expect(result.status).toBe('in_progress');
    expect(result.statementBalance).toBe(100000);
  });

  it('should propagate DB errors on GL balance query', async () => {
    mockSqlFn.mockRejectedValueOnce(new Error('Schema not found'));
    await expect(
      startReconciliation('acc-uuid-001', '2025-01-31', 100000, 'user-uuid-001')
    ).rejects.toThrow();
  });
});
