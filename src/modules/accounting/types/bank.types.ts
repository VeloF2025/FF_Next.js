/**
 * PRD-060: FibreFlow Accounting Module
 * Bank Reconciliation Type Definitions
 */

export type BankTxStatus = 'imported' | 'matched' | 'reconciled' | 'excluded';
export type BankReconStatus = 'in_progress' | 'completed';
export type BankFormat = 'fnb' | 'standard_bank' | 'nedbank' | 'absa' | 'capitec' | 'ofx' | 'qif' | 'unknown';

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
  /** Contextual reason recorded when this transaction was excluded */
  excludeReason?: string;
  /** Free-text notes attached to this transaction */
  notes?: string;
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
  matchReason: 'exact_reference' | 'amount_date' | 'amount_only' | 'rule_match';
}

export interface AutoMatchResult {
  matched: number;
  unmatched: number;
  candidates: AutoMatchCandidate[];
}

// ── Bank Categorisation Rules ───────────────────────────────────────────────

export type RuleMatchField = 'description' | 'reference' | 'both';
export type RuleMatchType = 'contains' | 'starts_with' | 'ends_with' | 'exact';

export interface BankCategorisationRule {
  id: string;
  ruleName: string;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  matchPattern: string;
  glAccountId: string;
  supplierId?: string;
  descriptionTemplate?: string;
  priority: number;
  isActive: boolean;
  autoCreateEntry: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // Joined
  glAccountCode?: string;
  glAccountName?: string;
  supplierName?: string;
}

export interface RuleCreateInput {
  ruleName: string;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  matchPattern: string;
  glAccountId: string;
  supplierId?: string;
  descriptionTemplate?: string;
  priority?: number;
  autoCreateEntry?: boolean;
}

export interface RuleApplyResult {
  applied: number;
  skipped: number;
  entries: Array<{ bankTxId: string; ruleName: string; journalEntryId: string }>;
}
