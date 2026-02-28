/**
 * Seed accounting knowledge chunks into chat_knowledge table.
 *
 * Requires: OPENAI_API_KEY and DATABASE_URL in environment.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/seed-accounting-knowledge.js
 *
 * Or on the server where the key is already set:
 *   node scripts/seed-accounting-knowledge.js
 */

const { neon } = require('@neondatabase/serverless');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const sql = neon(process.env.DATABASE_URL);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required. Set it in .env.local or pass via environment.');
  process.exit(1);
}

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

const chunks = [
  {
    source: 'user-manual',
    section: '12. Accounting — Overview',
    content: 'The Accounting module in FibreFlow is a full double-entry accounting system aligned with Sage conventions. It covers General Ledger, Accounts Payable (AP), Accounts Receivable (AR), Bank Reconciliation, VAT, and Financial Reporting. Navigation: Sidebar > Accounting. The module uses a tabbed interface with five main tabs: Overview (dashboard with key financial metrics), Chart of Accounts (GL account tree), Journal Entries (double-entry postings), Fiscal Periods (period management), and Reports (financial reporting hub). Access requires Admin or Manager role.',
  },
  {
    source: 'user-manual',
    section: '12.2 Chart of Accounts',
    content: 'The Chart of Accounts defines every GL account in the system. Account ranges: 1000-1999 Assets, 2000-2999 Liabilities, 3000-3999 Equity, 4000-4999 Revenue, 5000-5999 Cost of Sales, 6000-6999 Operating Expenses, 7000-7999 Other Income/Expenses. Features: account hierarchy with parent/child groupings, account CRUD operations, default accounts mapping, and opening balances for migration. Navigate to Sidebar > Accounting > Chart of Accounts tab.',
  },
  {
    source: 'user-manual',
    section: '12.3 Journal Entries',
    content: 'Journal entries are the foundation of double-entry bookkeeping. Every transaction creates balanced debit/credit entries. To create: click New Journal Entry, select posting date and reference, add line items with account/description/debit or credit amount, ensure total debits = total credits, then Save as Draft or Post. Entry statuses: Draft > Posted > (optionally) Reversed. Posted entries cannot be edited — to correct, create a reversing entry. Navigate to Sidebar > Accounting > Journal Entries tab.',
  },
  {
    source: 'user-manual',
    section: '12.5 Accounts Payable (Suppliers)',
    content: 'Accounts Payable manages supplier invoices, payments, and aging. Supplier Invoices: list view with status filter (Draft, Pending Approval, Approved, Paid, Disputed), new invoice capture with 3-way matching (PO vs GRN vs Invoice). Supplier Payments: payment list with allocation status, new payment with multi-invoice allocation, batch payments for grouped submissions. AP Aging Report: aging buckets Current/30/60/90/120+ days, supplier statements, and supplier age analysis. Navigate to Sidebar > Accounting > Suppliers tab.',
  },
  {
    source: 'user-manual',
    section: '12.6 Accounts Receivable (Customers)',
    content: 'Accounts Receivable manages customer invoices, payments, and aging. Customer Invoices: list view with status tracking, new invoice creation that auto-posts to GL. Customer Payments: payment list, new payment with invoice allocation. AR Aging Report: aging buckets Current/30/60/90/120+ days, customer statements, credit notes against invoices. Navigate to Sidebar > Accounting > Customers tab.',
  },
  {
    source: 'user-manual',
    section: '12.7 Banking & Bank Reconciliation',
    content: 'Banking module covers bank reconciliation, accounts, and cashbook. Bank Reconciliation workflow: 1) Import bank data via CSV (FNB, Standard Bank, Nedbank supported) or manual entry, 2) Start reconciliation session for bank account and date range, 3) Match transactions manually or use Auto-Match, 4) Review and complete. Also includes: bank accounts configuration, bank transactions list, cashbook with running balance, bank transfers between accounts, and bank matching rules. Navigate to Sidebar > Accounting > Banking tab.',
  },
  {
    source: 'user-manual',
    section: '12.8 VAT',
    content: 'VAT module for South African tax compliance. VAT Return: generate input/output VAT summary for SARS filing. VAT Adjustments: post correcting VAT journal entries. DRC VAT: Domestic Reverse Charge VAT handling for qualifying transactions. Navigate to Sidebar > Accounting > VAT tab.',
  },
  {
    source: 'user-manual',
    section: '12.9 Accounting Reports',
    content: 'Accounting Reports hub provides categorised financial reports. Financial Statements: Income Statement, Balance Sheet, Cash Flow Statement. General Ledger: Trial Balance, General Ledger, Account Transactions. Tax: VAT Return, DRC VAT. Customer Reports: Customer Report, Customer Detail, AR Aging. Supplier Reports: Supplier Report, Supplier Detail, AP Aging. Banking: Bank Transactions, Unallocated Payments/Receipts. Items: Item Listing, Movement, Quantities, Valuation. Analysis: Project Profitability, Budget vs Actual, Audit Trail. Navigate to Sidebar > Accounting > Reports tab.',
  },
  {
    source: 'user-manual',
    section: '12.10 Data Import & Configuration',
    content: 'Accounting Data Import and configuration pages. Sage Migration: import historical data from Sage (accounts, transactions, balances). Data Import: bulk import utilities for customers, suppliers, items, transactions. Opening Balances: GL opening balances for initial setup. Configuration includes: Cost Centres for departmental tracking, Customer/Supplier Categories, Currencies and Exchange Rates for multi-currency, Item Pricing, Budgets by GL account, Depreciation schedules, Recurring Invoices/Journals, Dunning for automated collection reminders, Write-offs for bad debt. Navigate to Sidebar > Accounting > Data Import tab.',
  },
  {
    source: 'db-schema',
    section: 'Accounting Database Tables',
    content: 'Key accounting database tables: gl_accounts (chart of accounts with account_number, name, type, parent_id, is_active), journal_entries (posting_date, reference, status, narration, total_debit, total_credit), journal_entry_lines (entry_id, account_id, debit, credit, description), fiscal_periods (name, start_date, end_date, status), supplier_invoices (supplier_id, invoice_number, total, tax, status, due_date), supplier_payments (supplier_id, amount, payment_date, reference), customer_invoices, customer_payments, bank_accounts, bank_transactions, bank_reconciliations, bank_reconciliation_lines, credit_notes, vat_returns, cost_centres, budgets, recurring_invoices, recurring_journals.',
  },
];

async function run() {
  console.log(`Inserting ${chunks.length} accounting knowledge chunks...`);

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    console.log(`  [${i + 1}/${chunks.length}] Embedding: ${c.section}`);
    const embedding = await embed(c.content);
    await sql.query(
      `INSERT INTO chat_knowledge (source, section, content, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT DO NOTHING`,
      [c.source, c.section, c.content, JSON.stringify(embedding)]
    );
  }

  // Verify
  const result = await sql.query(
    `SELECT COUNT(*) as cnt FROM chat_knowledge WHERE section LIKE '12.%' OR section LIKE 'Accounting%'`
  );
  console.log(`\nVerification: ${result[0].cnt} accounting chunks in chat_knowledge`);
  console.log('Done!');
}

run().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
