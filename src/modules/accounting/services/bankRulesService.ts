/**
 * Phase 2: Bank Categorisation Rules Service
 * Quick entry rules + statement mapping for auto-categorisation
 */

import { sql } from '@/lib/neon';
import { log } from '@/lib/logger';
import { createJournalEntry, postJournalEntry } from './journalEntryService';
import type {
  BankCategorisationRule, RuleCreateInput, RuleApplyResult,
} from '../types/bank.types';
import type { JournalLineInput } from '../types/gl.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function getRules(): Promise<BankCategorisationRule[]> {
  const rows = (await sql`
    SELECT r.*, ga.account_code AS gl_account_code, ga.account_name AS gl_account_name,
           s.company_name AS supplier_name, c.company_name AS client_name
    FROM bank_categorisation_rules r
    LEFT JOIN gl_accounts ga ON ga.id = r.gl_account_id
    LEFT JOIN suppliers s ON s.id = r.supplier_id
    LEFT JOIN clients c ON c.id = r.client_id
    ORDER BY r.priority ASC, r.rule_name ASC
  `) as Row[];
  return rows.map(mapRuleRow);
}

export async function createRule(input: RuleCreateInput, userId: string): Promise<BankCategorisationRule> {
  const rows = (await sql`
    INSERT INTO bank_categorisation_rules (
      rule_name, match_field, match_type, match_pattern,
      gl_account_id, supplier_id, client_id, description_template,
      priority, auto_create_entry, created_by
    ) VALUES (
      ${input.ruleName}, ${input.matchField}, ${input.matchType}, ${input.matchPattern},
      ${input.glAccountId}::UUID, ${input.supplierId ? Number(input.supplierId) : null},
      ${input.clientId || null}::UUID,
      ${input.descriptionTemplate || null},
      ${input.priority || 100}, ${input.autoCreateEntry !== false}, ${userId}::UUID
    ) RETURNING *
  `) as Row[];
  log.info('Created bank rule', { id: rows[0].id, ruleName: input.ruleName }, 'accounting');
  return mapRuleRow(rows[0]);
}

export async function updateRule(id: string, input: Partial<RuleCreateInput>): Promise<BankCategorisationRule> {
  const rows = (await sql`
    UPDATE bank_categorisation_rules SET
      rule_name = COALESCE(${input.ruleName || null}, rule_name),
      match_field = COALESCE(${input.matchField || null}, match_field),
      match_type = COALESCE(${input.matchType || null}, match_type),
      match_pattern = COALESCE(${input.matchPattern || null}, match_pattern),
      gl_account_id = COALESCE(${input.glAccountId || null}::UUID, gl_account_id),
      supplier_id = COALESCE(${input.supplierId ? Number(input.supplierId) : null}, supplier_id),
      client_id = COALESCE(${input.clientId || null}::UUID, client_id),
      description_template = COALESCE(${input.descriptionTemplate || null}, description_template),
      priority = COALESCE(${input.priority || null}, priority),
      auto_create_entry = COALESCE(${input.autoCreateEntry ?? null}, auto_create_entry)
    WHERE id = ${id}::UUID RETURNING *
  `) as Row[];
  if (!rows[0]) throw new Error(`Rule ${id} not found`);
  return mapRuleRow(rows[0]);
}

export async function deleteRule(id: string): Promise<void> {
  await sql`DELETE FROM bank_categorisation_rules WHERE id = ${id}::UUID`;
}

export async function toggleRule(id: string, isActive: boolean): Promise<void> {
  await sql`UPDATE bank_categorisation_rules SET is_active = ${isActive} WHERE id = ${id}::UUID`;
}

// ── Apply Rules ─────────────────────────────────────────────────────────────

export async function applyRules(
  bankAccountId: string,
  userId: string
): Promise<RuleApplyResult> {
  try {
    // Get active rules ordered by priority
    const rules = (await sql`
      SELECT * FROM bank_categorisation_rules
      WHERE is_active = true
      ORDER BY priority ASC
    `) as Row[];

    if (rules.length === 0) return { applied: 0, skipped: 0, entries: [] };

    // Get unmatched imported transactions
    const txns = (await sql`
      SELECT id, amount, transaction_date, description, reference
      FROM bank_transactions
      WHERE bank_account_id = ${bankAccountId}::UUID
        AND status = 'imported'
      ORDER BY transaction_date
    `) as Row[];

    let applied = 0;
    let skipped = 0;
    const entries: RuleApplyResult['entries'] = [];

    for (const tx of txns) {
      const desc = String(tx.description || '').toLowerCase();
      const ref = String(tx.reference || '').toLowerCase();
      let matched = false;

      for (const rule of rules) {
        const pattern = String(rule.match_pattern).toLowerCase();
        const field = String(rule.match_field);
        const type = String(rule.match_type);

        const targets: string[] = [];
        if (field === 'description' || field === 'both') targets.push(desc);
        if (field === 'reference' || field === 'both') targets.push(ref);

        const isMatch = targets.some(target => {
          switch (type) {
            case 'contains': return target.includes(pattern);
            case 'starts_with': return target.startsWith(pattern);
            case 'ends_with': return target.endsWith(pattern);
            case 'exact': return target === pattern;
            default: return false;
          }
        });

        if (!isMatch) continue;

        if (!rule.auto_create_entry) {
          // Populate suggestion — don't change status, don't create GL entry
          await sql`
            UPDATE bank_transactions
            SET suggested_gl_account_id = ${rule.gl_account_id}::UUID,
                suggested_supplier_id = ${rule.supplier_id ? Number(rule.supplier_id) : null},
                suggested_client_id = ${rule.client_id || null}::UUID,
                suggested_category = ${rule.rule_name}
            WHERE id = ${tx.id}::UUID AND suggested_gl_account_id IS NULL
          `;
          entries.push({
            bankTxId: String(tx.id),
            ruleName: String(rule.rule_name),
            suggestion: true,
          });
          applied++;
          matched = true;
          break;
        }

        // Create GL journal entry for this transaction
        const amount = Math.abs(Number(tx.amount));
        const isDeposit = Number(tx.amount) > 0;
        const entryDesc = rule.description_template
          ? String(rule.description_template).replace('{description}', String(tx.description || '')).replace('{amount}', amount.toFixed(2))
          : `Bank: ${tx.description || 'Categorised by rule'}`;

        const lines: JournalLineInput[] = isDeposit
          ? [
              { glAccountId: bankAccountId, debit: amount, credit: 0, description: entryDesc },
              { glAccountId: String(rule.gl_account_id), debit: 0, credit: amount, description: entryDesc },
            ]
          : [
              { glAccountId: String(rule.gl_account_id), debit: amount, credit: 0, description: entryDesc },
              { glAccountId: bankAccountId, debit: 0, credit: amount, description: entryDesc },
            ];

        const je = await createJournalEntry({
          entryDate: String(tx.transaction_date).split('T')[0],
          description: entryDesc,
          source: 'auto_bank_recon',
          lines,
        }, userId);
        await postJournalEntry(je.id, userId);

        // Get the bank-side journal line to match against
        const bankLineRows = (await sql`
          SELECT id FROM gl_journal_lines
          WHERE journal_entry_id = ${je.id}::UUID AND gl_account_id = ${bankAccountId}::UUID
          LIMIT 1
        `) as Row[];

        if (bankLineRows[0]) {
          await sql`
            UPDATE bank_transactions
            SET status = 'matched', matched_journal_line_id = ${bankLineRows[0].id}::UUID
            WHERE id = ${tx.id}::UUID
          `;
        }

        entries.push({
          bankTxId: String(tx.id),
          ruleName: String(rule.rule_name),
          journalEntryId: je.id,
        });
        applied++;
        matched = true;
        break; // First matching rule wins
      }

      if (!matched) skipped++;
    }

    log.info('Applied bank rules', { bankAccountId, applied, skipped }, 'accounting');
    return { applied, skipped, entries };
  } catch (err) {
    log.error('Failed to apply bank rules', { error: err }, 'accounting');
    throw err;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapRuleRow(row: Row): BankCategorisationRule {
  return {
    id: String(row.id),
    ruleName: String(row.rule_name),
    matchField: String(row.match_field) as BankCategorisationRule['matchField'],
    matchType: String(row.match_type) as BankCategorisationRule['matchType'],
    matchPattern: String(row.match_pattern),
    glAccountId: String(row.gl_account_id),
    supplierId: row.supplier_id ? String(row.supplier_id) : undefined,
    clientId: row.client_id ? String(row.client_id) : undefined,
    descriptionTemplate: row.description_template ? String(row.description_template) : undefined,
    priority: Number(row.priority),
    isActive: Boolean(row.is_active),
    autoCreateEntry: Boolean(row.auto_create_entry),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    glAccountCode: row.gl_account_code ? String(row.gl_account_code) : undefined,
    glAccountName: row.gl_account_name ? String(row.gl_account_name) : undefined,
    supplierName: row.supplier_name ? String(row.supplier_name) : undefined,
    clientName: row.client_name ? String(row.client_name) : undefined,
  };
}
