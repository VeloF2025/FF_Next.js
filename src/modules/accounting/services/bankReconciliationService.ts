/**
 * PRD-060: FibreFlow Accounting Module — Phase 4
 * Bank Reconciliation Service
 */

import { sql } from '@/lib/neon';
import { log } from '@/lib/logger';
import { detectBankFormat, parseFNBStatement, parseStandardBankStatement, parseNedbankStatement } from '../utils/bankCsvParsers';
import { runAutoMatch } from '../utils/autoMatch';
import { createJournalEntry, postJournalEntry } from './journalEntryService';
import type { BankTransaction, BankReconciliation, AutoMatchResult, BankFormat } from '../types/bank.types';
import type { JournalLineInput } from '../types/gl.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// ── Import ───────────────────────────────────────────────────────────────────

export async function importBankStatement(
  csvContent: string,
  bankAccountId: string,
  statementDate: string,
  bankFormat?: BankFormat
): Promise<{ batchId: string; transactionCount: number; errors: Array<{ row: number; error: string }> }> {
  try {
    const format = bankFormat && bankFormat !== 'unknown' ? bankFormat : detectBankFormat(csvContent);
    let parseResult;

    switch (format) {
      case 'fnb':
        parseResult = parseFNBStatement(csvContent);
        break;
      case 'standard_bank':
        parseResult = parseStandardBankStatement(csvContent);
        break;
      case 'nedbank':
        parseResult = parseNedbankStatement(csvContent);
        break;
      default:
        throw new Error('Unable to detect bank format. Please specify the bank.');
    }

    if (parseResult.transactions.length === 0) {
      return { batchId: '', transactionCount: 0, errors: parseResult.errors };
    }

    const batchId = crypto.randomUUID();

    for (const tx of parseResult.transactions) {
      await sql`
        INSERT INTO bank_transactions (
          bank_account_id, transaction_date, value_date, amount,
          description, reference, import_batch_id
        ) VALUES (
          ${bankAccountId}::UUID, ${tx.transactionDate}, ${tx.valueDate || null},
          ${tx.amount}, ${tx.description}, ${tx.reference || null}, ${batchId}::UUID
        )
      `;
    }

    log.info('Imported bank statement', {
      batchId, format, count: parseResult.transactions.length,
    }, 'accounting');

    return {
      batchId,
      transactionCount: parseResult.transactions.length,
      errors: parseResult.errors,
    };
  } catch (err) {
    log.error('Failed to import bank statement', { error: err }, 'accounting');
    throw err;
  }
}

// ── Bank Transactions ────────────────────────────────────────────────────────

interface BankTxFilters {
  bankAccountId?: string;
  reconciliationId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export async function getBankTransactions(filters?: BankTxFilters): Promise<{
  transactions: BankTransaction[];
  total: number;
}> {
  try {
    const limit = filters?.limit || 100;
    const offset = filters?.offset || 0;
    let rows: Row[];
    let countRows: Row[];

    if (filters?.reconciliationId) {
      rows = (await sql`
        SELECT bt.*, ga.account_name AS bank_account_name
        FROM bank_transactions bt
        LEFT JOIN gl_accounts ga ON ga.id = bt.bank_account_id
        WHERE bt.reconciliation_id = ${filters.reconciliationId}::UUID
        ORDER BY bt.transaction_date DESC, bt.amount DESC
        LIMIT ${limit} OFFSET ${offset}
      `) as Row[];
      countRows = (await sql`
        SELECT COUNT(*) AS cnt FROM bank_transactions
        WHERE reconciliation_id = ${filters.reconciliationId}::UUID
      `) as Row[];
    } else if (filters?.bankAccountId && filters?.status) {
      rows = (await sql`
        SELECT bt.*, ga.account_name AS bank_account_name
        FROM bank_transactions bt
        LEFT JOIN gl_accounts ga ON ga.id = bt.bank_account_id
        WHERE bt.bank_account_id = ${filters.bankAccountId}::UUID
          AND bt.status = ${filters.status}
        ORDER BY bt.transaction_date DESC, bt.amount DESC
        LIMIT ${limit} OFFSET ${offset}
      `) as Row[];
      countRows = (await sql`
        SELECT COUNT(*) AS cnt FROM bank_transactions
        WHERE bank_account_id = ${filters.bankAccountId}::UUID AND status = ${filters.status}
      `) as Row[];
    } else if (filters?.bankAccountId) {
      rows = (await sql`
        SELECT bt.*, ga.account_name AS bank_account_name
        FROM bank_transactions bt
        LEFT JOIN gl_accounts ga ON ga.id = bt.bank_account_id
        WHERE bt.bank_account_id = ${filters.bankAccountId}::UUID
        ORDER BY bt.transaction_date DESC, bt.amount DESC
        LIMIT ${limit} OFFSET ${offset}
      `) as Row[];
      countRows = (await sql`
        SELECT COUNT(*) AS cnt FROM bank_transactions
        WHERE bank_account_id = ${filters.bankAccountId}::UUID
      `) as Row[];
    } else {
      rows = (await sql`
        SELECT bt.*, ga.account_name AS bank_account_name
        FROM bank_transactions bt
        LEFT JOIN gl_accounts ga ON ga.id = bt.bank_account_id
        ORDER BY bt.transaction_date DESC, bt.amount DESC
        LIMIT ${limit} OFFSET ${offset}
      `) as Row[];
      countRows = (await sql`SELECT COUNT(*) AS cnt FROM bank_transactions`) as Row[];
    }

    return { transactions: rows.map(mapTxRow), total: Number(countRows[0]!.cnt) };
  } catch (err) {
    log.error('Failed to get bank transactions', { error: err }, 'accounting');
    throw err;
  }
}

// ── Match / Unmatch ──────────────────────────────────────────────────────────

export async function matchTransaction(
  bankTxId: string,
  journalLineId: string,
  reconciliationId?: string
): Promise<BankTransaction> {
  try {
    let rows: Row[];
    if (reconciliationId) {
      rows = (await sql`
        UPDATE bank_transactions
        SET status = 'matched',
            matched_journal_line_id = ${journalLineId}::UUID,
            reconciliation_id = ${reconciliationId}::UUID
        WHERE id = ${bankTxId}::UUID
        RETURNING *
      `) as Row[];
    } else {
      rows = (await sql`
        UPDATE bank_transactions
        SET status = 'matched',
            matched_journal_line_id = ${journalLineId}::UUID
        WHERE id = ${bankTxId}::UUID
        RETURNING *
      `) as Row[];
    }

    if (rows.length === 0) throw new Error(`Bank transaction ${bankTxId} not found`);

    // Update reconciled balance if part of a reconciliation
    if (reconciliationId) {
      await updateReconciledBalance(reconciliationId);
    }

    log.info('Matched bank transaction', { bankTxId, journalLineId }, 'accounting');
    return mapTxRow(rows[0]!);
  } catch (err) {
    log.error('Failed to match bank transaction', { bankTxId, error: err }, 'accounting');
    throw err;
  }
}

export async function unmatchTransaction(bankTxId: string): Promise<BankTransaction> {
  try {
    const existing = (await sql`SELECT reconciliation_id FROM bank_transactions WHERE id = ${bankTxId}::UUID`) as Row[];
    const reconId = existing[0]?.reconciliation_id ? String(existing[0].reconciliation_id) : null;

    const rows = (await sql`
      UPDATE bank_transactions
      SET status = 'imported', matched_journal_line_id = NULL
      WHERE id = ${bankTxId}::UUID
      RETURNING *
    `) as Row[];

    if (rows.length === 0) throw new Error(`Bank transaction ${bankTxId} not found`);

    if (reconId) {
      await updateReconciledBalance(reconId);
    }

    log.info('Unmatched bank transaction', { bankTxId }, 'accounting');
    return mapTxRow(rows[0]!);
  } catch (err) {
    log.error('Failed to unmatch bank transaction', { bankTxId, error: err }, 'accounting');
    throw err;
  }
}

export async function excludeTransaction(bankTxId: string): Promise<BankTransaction> {
  try {
    const rows = (await sql`
      UPDATE bank_transactions SET status = 'excluded'
      WHERE id = ${bankTxId}::UUID RETURNING *
    `) as Row[];
    if (rows.length === 0) throw new Error(`Bank transaction ${bankTxId} not found`);
    return mapTxRow(rows[0]!);
  } catch (err) {
    log.error('Failed to exclude bank transaction', { bankTxId, error: err }, 'accounting');
    throw err;
  }
}

// ── Auto-Match ───────────────────────────────────────────────────────────────

export async function autoMatchTransactions(
  bankAccountId: string,
  reconciliationId?: string
): Promise<AutoMatchResult> {
  try {
    // Get unmatched bank transactions
    const bankTxRows = (await sql`
      SELECT id, amount, transaction_date, reference, description
      FROM bank_transactions
      WHERE bank_account_id = ${bankAccountId}::UUID AND status = 'imported'
      ORDER BY transaction_date
    `) as Row[];

    if (bankTxRows.length === 0) {
      return { matched: 0, unmatched: 0, candidates: [] };
    }

    // Get unmatched GL journal lines for this bank account (posted entries only)
    const glRows = (await sql`
      SELECT jl.id, jl.debit, jl.credit, jl.description,
        je.entry_date, je.entry_number, je.source_document_id
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.gl_account_id = ${bankAccountId}::UUID
        AND je.status = 'posted'
        AND jl.id NOT IN (
          SELECT matched_journal_line_id FROM bank_transactions
          WHERE matched_journal_line_id IS NOT NULL
        )
      ORDER BY je.entry_date
    `) as Row[];

    const bankTxs = bankTxRows.map((r: Row) => ({
      id: String(r.id),
      amount: Number(r.amount),
      transactionDate: String(r.transaction_date),
      reference: r.reference ? String(r.reference) : undefined,
      description: r.description ? String(r.description) : undefined,
    }));

    const glLines = glRows.map((r: Row) => ({
      id: String(r.id),
      debit: Number(r.debit),
      credit: Number(r.credit),
      description: r.description ? String(r.description) : undefined,
      entryDate: String(r.entry_date),
      entryNumber: r.entry_number ? String(r.entry_number) : undefined,
      sourceDocumentId: r.source_document_id ? String(r.source_document_id) : undefined,
    }));

    const result = runAutoMatch(bankTxs, glLines);

    // Apply high-confidence matches automatically (>= 0.9)
    let matchedCount = 0;
    for (const match of result.matches) {
      if (match.confidence >= 0.9) {
        await matchTransaction(match.bankTransactionId, match.journalLineId, reconciliationId);
        matchedCount++;
      }
    }

    const lowConfidence = result.matches.filter(m => m.confidence < 0.9);

    log.info('Auto-match completed', {
      bankAccountId, autoMatched: matchedCount,
      candidates: lowConfidence.length, unmatched: result.unmatched.length,
    }, 'accounting');

    return {
      matched: matchedCount,
      unmatched: result.unmatched.length,
      candidates: lowConfidence,
    };
  } catch (err) {
    log.error('Failed to auto-match transactions', { error: err }, 'accounting');
    throw err;
  }
}

// ── Reconciliation CRUD ──────────────────────────────────────────────────────

export async function getReconciliations(bankAccountId?: string): Promise<BankReconciliation[]> {
  try {
    let rows: Row[];
    if (bankAccountId) {
      rows = (await sql`
        SELECT br.*, ga.account_name AS bank_account_name,
          (SELECT COUNT(*) FROM bank_transactions WHERE reconciliation_id = br.id AND status = 'matched') AS matched_count,
          (SELECT COUNT(*) FROM bank_transactions WHERE reconciliation_id = br.id AND status = 'imported') AS unmatched_count
        FROM bank_reconciliations br
        LEFT JOIN gl_accounts ga ON ga.id = br.bank_account_id
        WHERE br.bank_account_id = ${bankAccountId}::UUID
        ORDER BY br.statement_date DESC
      `) as Row[];
    } else {
      rows = (await sql`
        SELECT br.*, ga.account_name AS bank_account_name,
          (SELECT COUNT(*) FROM bank_transactions WHERE reconciliation_id = br.id AND status = 'matched') AS matched_count,
          (SELECT COUNT(*) FROM bank_transactions WHERE reconciliation_id = br.id AND status = 'imported') AS unmatched_count
        FROM bank_reconciliations br
        LEFT JOIN gl_accounts ga ON ga.id = br.bank_account_id
        ORDER BY br.statement_date DESC
      `) as Row[];
    }
    return rows.map(mapReconRow);
  } catch (err) {
    log.error('Failed to get reconciliations', { error: err }, 'accounting');
    throw err;
  }
}

export async function getReconciliationById(id: string): Promise<BankReconciliation | null> {
  try {
    const rows = (await sql`
      SELECT br.*, ga.account_name AS bank_account_name,
        (SELECT COUNT(*) FROM bank_transactions WHERE reconciliation_id = br.id AND status = 'matched') AS matched_count,
        (SELECT COUNT(*) FROM bank_transactions WHERE reconciliation_id = br.id AND status = 'imported') AS unmatched_count
      FROM bank_reconciliations br
      LEFT JOIN gl_accounts ga ON ga.id = br.bank_account_id
      WHERE br.id = ${id}::UUID
    `) as Row[];
    return rows.length > 0 ? mapReconRow(rows[0]!) : null;
  } catch (err) {
    log.error('Failed to get reconciliation', { id, error: err }, 'accounting');
    throw err;
  }
}

export async function startReconciliation(
  bankAccountId: string,
  statementDate: string,
  statementBalance: number,
  userId: string
): Promise<BankReconciliation> {
  try {
    // Calculate current GL balance for this bank account
    const balRows = (await sql`
      SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0) AS gl_balance
      FROM gl_journal_lines jl
      JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
      WHERE jl.gl_account_id = ${bankAccountId}::UUID
        AND je.status = 'posted'
        AND je.entry_date <= ${statementDate}
    `) as Row[];

    const glBalance = Number(balRows[0]!.gl_balance);

    const rows = (await sql`
      INSERT INTO bank_reconciliations (
        bank_account_id, statement_date, statement_balance, gl_balance,
        reconciled_balance, started_by
      ) VALUES (
        ${bankAccountId}::UUID, ${statementDate}, ${statementBalance},
        ${glBalance}, ${glBalance}, ${userId}::UUID
      ) RETURNING *
    `) as Row[];

    // Link unmatched imported transactions to this reconciliation
    await sql`
      UPDATE bank_transactions
      SET reconciliation_id = ${rows[0]!.id}::UUID
      WHERE bank_account_id = ${bankAccountId}::UUID
        AND status = 'imported'
        AND reconciliation_id IS NULL
    `;

    log.info('Started bank reconciliation', {
      id: String(rows[0]!.id), bankAccountId, statementBalance, glBalance,
    }, 'accounting');

    return mapReconRow(rows[0]!);
  } catch (err) {
    log.error('Failed to start reconciliation', { error: err }, 'accounting');
    throw err;
  }
}

export async function completeReconciliation(id: string, userId: string): Promise<BankReconciliation> {
  try {
    const recon = await getReconciliationById(id);
    if (!recon) throw new Error(`Reconciliation ${id} not found`);
    if (recon.status === 'completed') throw new Error('Reconciliation already completed');
    if (Math.abs(recon.difference) > 0.01) {
      throw new Error(`Cannot complete: difference is R${recon.difference.toFixed(2)} (must be R0.00)`);
    }

    // Mark all matched transactions as reconciled
    await sql`
      UPDATE bank_transactions SET status = 'reconciled'
      WHERE reconciliation_id = ${id}::UUID AND status = 'matched'
    `;

    const rows = (await sql`
      UPDATE bank_reconciliations
      SET status = 'completed', completed_by = ${userId}::UUID, completed_at = NOW()
      WHERE id = ${id}::UUID RETURNING *
    `) as Row[];

    log.info('Completed bank reconciliation', { id }, 'accounting');
    return mapReconRow(rows[0]!);
  } catch (err) {
    log.error('Failed to complete reconciliation', { id, error: err }, 'accounting');
    throw err;
  }
}

// ── Adjustment Entry ─────────────────────────────────────────────────────────

export async function createAdjustmentEntry(
  reconciliationId: string,
  bankAccountId: string,
  contraAccountId: string,
  amount: number,
  description: string,
  userId: string
): Promise<string> {
  try {
    const lines: JournalLineInput[] = amount > 0
      ? [
          { glAccountId: bankAccountId, debit: amount, credit: 0, description },
          { glAccountId: contraAccountId, debit: 0, credit: amount, description },
        ]
      : [
          { glAccountId: contraAccountId, debit: Math.abs(amount), credit: 0, description },
          { glAccountId: bankAccountId, debit: 0, credit: Math.abs(amount), description },
        ];

    const recon = await getReconciliationById(reconciliationId);
    if (!recon) throw new Error(`Reconciliation ${reconciliationId} not found`);

    const je = await createJournalEntry({
      entryDate: recon.statementDate,
      description: `Bank recon adjustment: ${description}`,
      source: 'auto_bank_recon',
      sourceDocumentId: reconciliationId,
      lines,
    }, userId);
    await postJournalEntry(je.id, userId);

    // Update reconciled balance
    await updateReconciledBalance(reconciliationId);

    log.info('Created adjustment entry', { reconciliationId, journalEntryId: je.id }, 'accounting');
    return je.id;
  } catch (err) {
    log.error('Failed to create adjustment entry', { error: err }, 'accounting');
    throw err;
  }
}

// ── Allocate (Sage-style "Process Bank") ────────────────────────────────────

export type AllocationType = 'account' | 'supplier' | 'customer';

/** Look up a GL account by its code (e.g. '2110' for AP, '1120' for AR) */
async function glAccountByCode(code: string): Promise<string> {
  const rows = (await sql`
    SELECT id FROM gl_accounts WHERE account_code = ${code} AND is_active = TRUE LIMIT 1
  `) as Row[];
  if (rows.length === 0) throw new Error(`GL account ${code} not found`);
  return String(rows[0]!.id);
}

/**
 * Allocate a bank transaction — Sage Process Bank equivalent.
 * Supports three types:
 *   account  → DR/CR bank ↔ GL account
 *   supplier → DR Accounts Payable (2110), CR Bank (payment out)
 *   customer → DR Bank, CR Accounts Receivable (1120) (receipt in)
 */
export async function allocateTransaction(
  bankTxId: string,
  contraAccountId: string,
  userId: string,
  description?: string,
  allocType: AllocationType = 'account',
  entityId?: string,
): Promise<{ journalEntryId: string; bankTransaction: BankTransaction }> {
  // Get the bank transaction
  const txRows = (await sql`
    SELECT * FROM bank_transactions WHERE id = ${bankTxId}::UUID
  `) as Row[];
  if (txRows.length === 0) throw new Error(`Bank transaction ${bankTxId} not found`);
  const tx = txRows[0]!;

  if (tx.status !== 'imported') {
    throw new Error(`Transaction already ${tx.status} — cannot allocate`);
  }

  const amount = Math.abs(Number(tx.amount));
  const bankAccountId = String(tx.bank_account_id);
  const txDate = tx.transaction_date instanceof Date
    ? tx.transaction_date.toISOString().split('T')[0]
    : String(tx.transaction_date).split('T')[0];

  let lines: JournalLineInput[];
  let source: string;
  let entryDesc: string;

  if (allocType === 'supplier' && entityId) {
    // Supplier payment: DR Accounts Payable, CR Bank
    const apAccountId = await glAccountByCode('2110');
    const supRows = (await sql`SELECT name FROM suppliers WHERE id = ${Number(entityId)}`) as Row[];
    const supName = supRows.length > 0 ? String(supRows[0]!.name) : `Supplier #${entityId}`;
    entryDesc = description || `Payment to ${supName}`;
    source = 'bank_allocation_supplier';
    lines = [
      { glAccountId: apAccountId, debit: amount, credit: 0, description: entryDesc },
      { glAccountId: bankAccountId, debit: 0, credit: amount, description: entryDesc },
    ];
  } else if (allocType === 'customer' && entityId) {
    // Customer receipt: DR Bank, CR Accounts Receivable
    const arAccountId = await glAccountByCode('1120');
    const custRows = (await sql`SELECT company_name FROM clients WHERE id = ${entityId}::UUID`) as Row[];
    const custName = custRows.length > 0 ? String(custRows[0]!.company_name) : `Customer #${entityId}`;
    entryDesc = description || `Receipt from ${custName}`;
    source = 'bank_allocation_customer';
    lines = [
      { glAccountId: bankAccountId, debit: amount, credit: 0, description: entryDesc },
      { glAccountId: arAccountId, debit: 0, credit: amount, description: entryDesc },
    ];
  } else {
    // Standard GL account allocation
    entryDesc = description || tx.description || 'Bank allocation';
    source = 'bank_allocation';
    const isCredit = Number(tx.amount) > 0;
    lines = isCredit
      ? [
          { glAccountId: bankAccountId, debit: amount, credit: 0, description: entryDesc },
          { glAccountId: contraAccountId, debit: 0, credit: amount, description: entryDesc },
        ]
      : [
          { glAccountId: contraAccountId, debit: amount, credit: 0, description: entryDesc },
          { glAccountId: bankAccountId, debit: 0, credit: amount, description: entryDesc },
        ];
  }

  const je = await createJournalEntry({
    entryDate: txDate,
    description: entryDesc,
    source,
    sourceDocumentId: bankTxId,
    lines,
  }, userId);
  await postJournalEntry(je.id, userId);

  // Find the bank-side journal line to match against
  const jeLines = (await sql`
    SELECT id FROM gl_journal_lines
    WHERE journal_entry_id = ${je.id}::UUID
      AND gl_account_id = ${bankAccountId}::UUID
    LIMIT 1
  `) as Row[];

  const journalLineId = jeLines.length > 0 ? String(jeLines[0]!.id) : null;

  // Auto-match the bank transaction to the journal line
  if (journalLineId) {
    await sql`
      UPDATE bank_transactions
      SET status = 'matched', matched_journal_line_id = ${journalLineId}::UUID, updated_at = NOW()
      WHERE id = ${bankTxId}::UUID
    `;
  }

  log.info('Allocated bank transaction', {
    bankTxId, journalEntryId: je.id, allocType, entityId, contraAccountId,
  }, 'accounting');

  const updated = (await sql`SELECT * FROM bank_transactions WHERE id = ${bankTxId}::UUID`) as Row[];
  return { journalEntryId: je.id, bankTransaction: mapTxRow(updated[0]!) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function updateReconciledBalance(reconciliationId: string): Promise<void> {
  // Reconciled balance = sum of matched bank transaction amounts
  const sumRows = (await sql`
    SELECT COALESCE(SUM(amount), 0) AS matched_total
    FROM bank_transactions
    WHERE reconciliation_id = ${reconciliationId}::UUID
      AND status IN ('matched', 'reconciled')
  `) as Row[];

  const reconRows = (await sql`
    SELECT gl_balance FROM bank_reconciliations WHERE id = ${reconciliationId}::UUID
  `) as Row[];

  if (reconRows.length > 0) {
    const reconciledBalance = Number(reconRows[0]!.gl_balance) + Number(sumRows[0]!.matched_total);
    await sql`
      UPDATE bank_reconciliations SET reconciled_balance = ${reconciledBalance}
      WHERE id = ${reconciliationId}::UUID
    `;
  }
}

function fmtDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return val ? String(val).split('T')[0] : '';
}

function mapTxRow(row: Row): BankTransaction {
  return {
    id: String(row.id),
    bankAccountId: String(row.bank_account_id),
    transactionDate: fmtDate(row.transaction_date),
    valueDate: row.value_date ? fmtDate(row.value_date) : undefined,
    amount: Number(row.amount),
    description: row.description ? String(row.description) : undefined,
    reference: row.reference ? String(row.reference) : undefined,
    bankReference: row.bank_reference ? String(row.bank_reference) : undefined,
    status: String(row.status) as BankTransaction['status'],
    matchedJournalLineId: row.matched_journal_line_id ? String(row.matched_journal_line_id) : undefined,
    reconciliationId: row.reconciliation_id ? String(row.reconciliation_id) : undefined,
    importBatchId: row.import_batch_id ? String(row.import_batch_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    bankAccountName: row.bank_account_name ? String(row.bank_account_name) : undefined,
    matchedEntryNumber: row.matched_entry_number ? String(row.matched_entry_number) : undefined,
  };
}

function mapReconRow(row: Row): BankReconciliation {
  return {
    id: String(row.id),
    bankAccountId: String(row.bank_account_id),
    statementDate: fmtDate(row.statement_date),
    statementBalance: Number(row.statement_balance),
    glBalance: Number(row.gl_balance),
    reconciledBalance: Number(row.reconciled_balance),
    difference: Number(row.difference),
    status: String(row.status) as BankReconciliation['status'],
    startedBy: String(row.started_by),
    startedAt: String(row.started_at),
    completedBy: row.completed_by ? String(row.completed_by) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    bankAccountName: row.bank_account_name ? String(row.bank_account_name) : undefined,
    matchedCount: row.matched_count !== undefined ? Number(row.matched_count) : undefined,
    unmatchedCount: row.unmatched_count !== undefined ? Number(row.unmatched_count) : undefined,
  };
}
