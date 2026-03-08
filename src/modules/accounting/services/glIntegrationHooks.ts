/**
 * PRD-060: GL Integration Hooks
 * Auto-post GL entries when existing modules trigger financial events
 *
 * Hooks:
 * - Customer invoice approved → DR AR, CR Revenue
 * - Customer payment recorded → DR Bank, CR AR
 * - GRN confirmed → DR Materials, CR AP
 * - PO approved → DR Materials, CR AP (commitment accounting)
 * - Asset depreciation → DR Depreciation Expense, CR Accumulated Depreciation
 */

import { sql } from '@/lib/neon';
import { log } from '@/lib/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// GL account codes (from seeded chart of accounts)
const ACCOUNTS = {
  BANK: '1110',
  AR: '1120',
  VAT_INPUT: '1140',
  AP: '2110',
  VAT_OUTPUT: '2120',
  ACTIVATION_REVENUE: '4100',
  MATERIALS: '5100',
} as const;

async function getAccountId(code: string): Promise<string> {
  const rows = (await sql`SELECT id FROM gl_accounts WHERE account_code = ${code} LIMIT 1`) as Row[];
  if (!rows[0]) throw new Error(`GL account ${code} not found`);
  return String(rows[0].id);
}

// ── Customer Invoice Approved → GL ──────────────────────────────────────────

export async function postCustomerInvoiceToGL(
  invoiceId: string,
  projectId: string,
  userId: string
): Promise<string | null> {
  try {
    // Check if already posted
    const inv = (await sql`
      SELECT id, invoice_number, invoice_date, total_amount, tax_amount, subtotal, gl_journal_entry_id
      FROM customer_invoices WHERE id = ${invoiceId}
    `) as Row[];

    if (!inv[0]) { log.warn('Invoice not found for GL posting', { invoiceId }, 'accounting'); return null; }
    if (inv[0].gl_journal_entry_id) return String(inv[0].gl_journal_entry_id); // Already posted

    const totalAmount = Number(inv[0].total_amount || 0);
    const taxAmount = Number(inv[0].tax_amount || 0);
    const subtotal = Number(inv[0].subtotal || totalAmount - taxAmount);
    if (totalAmount === 0) return null;

    const arId = await getAccountId(ACCOUNTS.AR);
    const revenueId = await getAccountId(ACCOUNTS.ACTIVATION_REVENUE);
    const vatOutputId = await getAccountId(ACCOUNTS.VAT_OUTPUT);

    // Create journal entry: DR AR (total), CR Revenue (subtotal), CR VAT Output (tax)
    const entry = (await sql`
      INSERT INTO gl_journal_entries (
        entry_number, entry_date, description, source, status, created_by
      ) VALUES (
        ${`CI-${inv[0].invoice_number}`}, ${String(inv[0].invoice_date).split('T')[0]},
        ${`Customer invoice ${inv[0].invoice_number} approved`},
        'auto_invoice', 'posted', ${userId}
      ) RETURNING id
    `) as Row[];

    const entryId = String(entry[0].id);

    // DR Accounts Receivable (full amount)
    await sql`
      INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
      VALUES (${entryId}::UUID, ${arId}::UUID, ${totalAmount}, 0,
        ${`Invoice ${inv[0].invoice_number}`}, ${projectId}::UUID)
    `;

    // CR Revenue (subtotal excl VAT)
    await sql`
      INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
      VALUES (${entryId}::UUID, ${revenueId}::UUID, 0, ${subtotal},
        ${`Invoice ${inv[0].invoice_number}`}, ${projectId}::UUID)
    `;

    // CR VAT Output (if tax > 0)
    if (taxAmount > 0.01) {
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
        VALUES (${entryId}::UUID, ${vatOutputId}::UUID, 0, ${taxAmount},
          ${`VAT on invoice ${inv[0].invoice_number}`}, ${projectId}::UUID)
      `;
    }

    // Link journal entry back to invoice
    await sql`UPDATE customer_invoices SET gl_journal_entry_id = ${entryId}::UUID WHERE id = ${invoiceId}`;

    log.info('Customer invoice GL posted', { invoiceId, entryId, totalAmount }, 'accounting');
    return entryId;
  } catch (err) {
    log.error('Failed to post customer invoice to GL', { invoiceId, error: err }, 'accounting');
    return null; // Non-blocking — invoice still approved even if GL fails
  }
}

// ── Customer Payment Recorded → GL ──────────────────────────────────────────

export async function postCustomerPaymentToGL(
  invoiceId: string,
  paymentAmount: number,
  projectId: string,
  userId: string
): Promise<string | null> {
  try {
    if (paymentAmount <= 0) return null;

    const inv = (await sql`
      SELECT invoice_number FROM customer_invoices WHERE id = ${invoiceId}
    `) as Row[];
    if (!inv[0]) return null;

    const bankId = await getAccountId(ACCOUNTS.BANK);
    const arId = await getAccountId(ACCOUNTS.AR);

    // DR Bank, CR AR
    const entry = (await sql`
      INSERT INTO gl_journal_entries (
        entry_number, entry_date, description, source, status, created_by
      ) VALUES (
        ${`CPAY-${inv[0].invoice_number}-${Date.now()}`}, CURRENT_DATE,
        ${`Payment received for invoice ${inv[0].invoice_number}`},
        'auto_payment', 'posted', ${userId}
      ) RETURNING id
    `) as Row[];

    const entryId = String(entry[0].id);

    await sql`
      INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
      VALUES (${entryId}::UUID, ${bankId}::UUID, ${paymentAmount}, 0,
        ${`Payment: invoice ${inv[0].invoice_number}`}, ${projectId}::UUID)
    `;
    await sql`
      INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
      VALUES (${entryId}::UUID, ${arId}::UUID, 0, ${paymentAmount},
        ${`Payment: invoice ${inv[0].invoice_number}`}, ${projectId}::UUID)
    `;

    log.info('Customer payment GL posted', { invoiceId, entryId, paymentAmount }, 'accounting');
    return entryId;
  } catch (err) {
    log.error('Failed to post customer payment to GL', { invoiceId, error: err }, 'accounting');
    return null;
  }
}

// ── GRN Confirmed → GL ─────────────────────────────────────────────────────

export async function postGRNToGL(
  grnId: string,
  totalValue: number,
  projectId: string | null,
  userId: string,
  grnNumber: string
): Promise<string | null> {
  try {
    if (totalValue <= 0) return null;

    const materialsId = await getAccountId(ACCOUNTS.MATERIALS);
    const apId = await getAccountId(ACCOUNTS.AP);

    // DR Materials/Inventory, CR AP
    const entry = (await sql`
      INSERT INTO gl_journal_entries (
        entry_number, entry_date, description, source, status, created_by
      ) VALUES (
        ${`GRN-${grnNumber}`}, CURRENT_DATE,
        ${`GRN ${grnNumber} confirmed — goods received`},
        'auto_grn', 'posted', ${userId}
      ) RETURNING id
    `) as Row[];

    const entryId = String(entry[0].id);

    if (projectId) {
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
        VALUES (${entryId}::UUID, ${materialsId}::UUID, ${totalValue}, 0,
          ${`GRN ${grnNumber}`}, ${projectId}::UUID)
      `;
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id)
        VALUES (${entryId}::UUID, ${apId}::UUID, 0, ${totalValue},
          ${`GRN ${grnNumber}`}, ${projectId}::UUID)
      `;
    } else {
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description)
        VALUES (${entryId}::UUID, ${materialsId}::UUID, ${totalValue}, 0, ${`GRN ${grnNumber}`})
      `;
      await sql`
        INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description)
        VALUES (${entryId}::UUID, ${apId}::UUID, 0, ${totalValue}, ${`GRN ${grnNumber}`})
      `;
    }

    log.info('GRN GL posted', { grnId, entryId, totalValue, grnNumber }, 'accounting');
    return entryId;
  } catch (err) {
    log.error('Failed to post GRN to GL', { grnId, error: err }, 'accounting');
    return null;
  }
}

// Re-export Phase 4 cross-module hooks
export { postPurchaseOrderToGL, postAssetDepreciationToGL } from './glCrossModuleHooks';
