/**
 * PRD-060: FibreFlow Accounting Module
 * General Ledger Type Definitions
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export type GLAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type GLAccountSubtype =
  | 'bank'
  | 'receivable'
  | 'payable'
  | 'tax'
  | 'inventory'
  | 'fixed_asset'
  | 'accumulated_depreciation'
  | 'cost_of_sales'
  | 'revenue'
  | 'operating_expense'
  | 'equity'
  | 'retained_earnings'
  | 'other_current_asset'
  | 'other_current_liability'
  | 'other';

export type GLEntrySource =
  | 'manual'
  | 'auto_invoice'
  | 'auto_payment'
  | 'auto_grn'
  | 'auto_credit_note'
  | 'auto_bank_recon'
  | 'auto_supplier_invoice'
  | 'auto_supplier_payment'
  | 'auto_write_off'
  | 'auto_adjustment'
  | 'auto_vat_adjustment'
  | 'auto_batch_payment'
  | 'auto_recurring'
  | 'auto_purchase_order'
  | 'auto_depreciation';

// ── Recurring Journals ────────────────────────────────────────────────────────

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'annually';
export type RecurringStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface RecurringJournal {
  id: string;
  templateName: string;
  description?: string;
  frequency: RecurringFrequency;
  nextRunDate: string;
  endDate?: string;
  lastRunDate?: string;
  runCount: number;
  status: RecurringStatus;
  lines: JournalLineInput[];
  totalAmount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringJournalCreateInput {
  templateName: string;
  description?: string;
  frequency: RecurringFrequency;
  nextRunDate: string;
  endDate?: string;
  lines: JournalLineInput[];
}

// ── VAT Adjustments ──────────────────────────────────────────────────────────

export type VATAdjustmentType = 'input' | 'output';
export type VATAdjustmentStatus = 'draft' | 'approved' | 'cancelled';

export interface VATAdjustment {
  id: string;
  adjustmentNumber: string;
  adjustmentDate: string;
  vatPeriod?: string;
  adjustmentType: VATAdjustmentType;
  amount: number;
  reason: string;
  status: VATAdjustmentStatus;
  glJournalEntryId?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VATAdjustmentCreateInput {
  adjustmentDate: string;
  vatPeriod?: string;
  adjustmentType: VATAdjustmentType;
  amount: number;
  reason: string;
}

export type GLEntryStatus = 'draft' | 'posted' | 'reversed';

export type FiscalPeriodStatus = 'open' | 'closing' | 'closed' | 'locked';

// ── Chart of Accounts ────────────────────────────────────────────────────────

export interface GLAccount {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: GLAccountType;
  accountSubtype?: string;
  parentAccountId?: string;
  isActive: boolean;
  isSystemAccount: boolean;
  description?: string;
  normalBalance: 'debit' | 'credit';
  level: number;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  // Tree display
  children?: GLAccount[];
  balance?: number;
}

// ── Fiscal Periods ───────────────────────────────────────────────────────────

export interface FiscalPeriod {
  id: string;
  periodName: string;
  periodNumber: number;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  status: FiscalPeriodStatus;
  closedBy?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Journal Entries ──────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  fiscalPeriodId?: string;
  description?: string;
  source: GLEntrySource;
  sourceDocumentId?: string;
  status: GLEntryStatus;
  postedBy?: string;
  postedAt?: string;
  reversedBy?: string;
  reversedAt?: string;
  reversalOfId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Detail
  lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  journalEntryId: string;
  glAccountId: string;
  debit: number;
  credit: number;
  description?: string;
  projectId?: string;
  costCenterId?: string;
  createdAt: string;
  // Joined
  accountCode?: string;
  accountName?: string;
}

export interface JournalEntryCreateInput {
  entryDate: string;
  description?: string;
  source?: GLEntrySource;
  sourceDocumentId?: string;
  fiscalPeriodId?: string;
  lines: JournalLineInput[];
}

export interface JournalLineInput {
  glAccountId: string;
  debit: number;
  credit: number;
  description?: string;
  projectId?: string;
  costCenterId?: string;
}

// ── Validation Results ───────────────────────────────────────────────────────

export interface JournalValidationResult {
  valid: boolean;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  errors: string[];
}

export interface LineValidationResult {
  valid: boolean;
  error?: string;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: 'debit' | 'credit';
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalanceReport {
  asAtDate: string;
  fiscalPeriodId: string;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
}

export interface IncomeStatementReport {
  periodStart: string;
  periodEnd: string;
  projectId?: string;
  revenue: Array<{ accountCode: string; accountName: string; amount: number }>;
  costOfSales: Array<{ accountCode: string; accountName: string; amount: number }>;
  operatingExpenses: Array<{ accountCode: string; accountName: string; amount: number }>;
  totalRevenue: number;
  totalCostOfSales: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  netProfit: number;
}

export interface BalanceSheetReport {
  asAtDate: string;
  assets: Array<{ accountCode: string; accountName: string; balance: number }>;
  liabilities: Array<{ accountCode: string; accountName: string; balance: number }>;
  equity: Array<{ accountCode: string; accountName: string; balance: number }>;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export interface VATReturnReport {
  periodStart: string;
  periodEnd: string;
  outputVAT: number;
  inputVAT: number;
  netVAT: number;
  outputDetails: Array<{ accountCode: string; accountName: string; amount: number }>;
  inputDetails: Array<{ accountCode: string; accountName: string; amount: number }>;
}

export interface ProjectProfitabilityReport {
  projectId: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  costs: number;
  profit: number;
  margin: number;
  revenueLines: Array<{ accountCode: string; accountName: string; amount: number }>;
  costLines: Array<{ accountCode: string; accountName: string; amount: number }>;
}

export interface CashFlowReport {
  periodStart: string;
  periodEnd: string;
  operatingActivities: Array<{ description: string; amount: number }>;
  investingActivities: Array<{ description: string; amount: number }>;
  financingActivities: Array<{ description: string; amount: number }>;
  totalOperating: number;
  totalInvesting: number;
  totalFinancing: number;
  netCashFlow: number;
  openingBalance: number;
  closingBalance: number;
}
