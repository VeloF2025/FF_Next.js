/**
 * PRD-060: FibreFlow Accounting Module
 * Bank Reconciliation Type Definitions
 */

export type BankTxStatus = 'imported' | 'matched' | 'reconciled' | 'excluded';
export type BankReconStatus = 'in_progress' | 'completed';
export type BankFormat = 'fnb' | 'standard_bank' | 'nedbank' | 'unknown';

// ── Parsed Bank Transaction ──────────────────────────────────────────────────

export interface ParsedBankTransaction {
  transactionDate: string; // YYYY-MM-DD
  valueDate?: string;
  amount: number; // positive = deposit, negative = withdrawal
  description: string;
  reference?: string;
  balance?: number;
}

export interface BankCsvParseResult {
  transactions: ParsedBankTransaction[];
  errors: Array<{ row: number; error: string }>;
  bankFormat: string;
}

// ── Bank Transaction (DB) ────────────────────────────────────────────────────

export interface BankTransaction {
  id: string;
  bankAccountId: string;
  transactionDate: string;
  valueDate?: string;
  amount: number;
  description?: string;
  reference?: string;
  bankReference?: string;
  status: BankTxStatus;
  matchedJournalLineId?: string;
  reconciliationId?: string;
  importBatchId?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  bankAccountName?: string;
  matchedEntryNumber?: string;
}

// ── Bank Reconciliation ──────────────────────────────────────────────────────

export interface BankReconciliation {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementBalance: number;
  glBalance: number;
  reconciledBalance: number;
  difference: number;
  status: BankReconStatus;
  startedBy: string;
  startedAt: string;
  completedBy?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  bankAccountName?: string;
  matchedCount?: number;
  unmatchedCount?: number;
}

// ── Auto-Match ───────────────────────────────────────────────────────────────

export interface AutoMatchCandidate {
  bankTransactionId: string;
  journalLineId: string;
  confidence: number; // 0-1
  matchReason: 'exact_reference' | 'amount_date' | 'amount_only';
}

export interface AutoMatchResult {
  matched: number;
  unmatched: number;
  candidates: AutoMatchCandidate[];
}
