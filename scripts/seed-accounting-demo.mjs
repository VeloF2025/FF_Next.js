/**
 * Accounting Demo Data Seed Script
 *
 * Seeds realistic South African fiber company accounting data for testing:
 * - Opening balances (Jan 1, 2026)
 * - 2 months of transactions (Jan + Feb 2026)
 * - Supplier invoices, payments, customer invoices, payments
 * - Bank transactions for reconciliation
 * - Credit notes, VAT data, cost centres, budgets
 *
 * All data tagged [DEMO] for easy cleanup.
 * Run purge: node scripts/seed-accounting-demo.mjs --purge
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

// ── GL Account IDs (from migration 200 seed) ──────────────────────
const GL = {
  BANK:           '3eb6b8d1-e6dc-457d-81c8-4baebd8d9b67', // 1110
  AR:             'c39f5778-f678-4305-8b72-d0368c50dae5', // 1120
  PETTY_CASH:     'fbb6bcb9-8ab7-4493-b703-34ee2cb443d6', // 1130
  VAT_INPUT:      'd06d2352-2872-46de-8bb6-df5af82fe178', // 1140
  EQUIPMENT:      'f97f10fa-4170-4bd8-9476-ed80298f502b', // 1210
  VEHICLES:       '95fd181e-d81b-41a5-9ced-b53512a88a85', // 1220
  ACCUM_DEP:      '14ecaf3c-9ece-4ae1-a03f-aa017da11e60', // 1230
  AP:             'a7a6e31f-0587-436b-995c-e682e808bd4f', // 2110
  VAT_OUTPUT:     'd08b1c66-dcc5-45b3-ab84-fa6fe53f8d8a', // 2120
  ACCRUED:        '96d3be6b-e27f-447c-b368-088d20e4b6ec', // 2130
  LT_LOANS:       '87a8199f-596b-4942-95d4-9f97a84b522f', // 2210
  SHARE_CAPITAL:  '997ad307-ad2a-4b95-a127-a43fddf0b704', // 3100
  RETAINED:       '3fbb7cdb-966f-4791-bc69-834fbd2323ee', // 3200
  REV_ACTIVATION: '11295175-27cc-4a21-b75f-0904a91bf4a5', // 4100
  REV_MAINTENANCE:'4e1a0460-6e5d-4ebd-b928-18552e18bd19', // 4200
  REV_OTHER:      'c264e1b9-1b25-4d39-8cb9-3c7f500171d1', // 4300
  MATERIALS:      '9231ac45-e4a1-490e-94d1-4a1f5b24bd2b', // 5100
  LABOUR:         'a8a2df7c-83a9-4eda-a5c3-bf976e24d946', // 5200
  SUBCONTRACTOR:  'a79e7b64-bdd5-4a17-a25d-3d70e1b784c6', // 5300
  TRANSPORT:      '0115d435-fddd-4992-b9f3-850ac5f791ba', // 5400
  EQUIPMENT_EXP:  'fa613bef-10ac-4aae-84c8-5071dbdc0a6c', // 5500
  ADMIN:          '5e6d7d6e-4f30-4122-a330-ce4ab0d5f9a5', // 5600
  BANK_CHARGES:   '2c319f17-9879-4948-a68b-ab42c0022aa0', // 5700
  DEPRECIATION:   '644dd0e3-42ba-4a26-a445-3ba72c5da454', // 5800
};

// Fiscal period IDs
const FP = {
  JAN: 'fbec06ad-f9eb-4d98-9465-b33fe3c1ccf6',
  FEB: 'be502af1-2429-4b22-a44c-c5e1a82f215f',
  MAR: '5236ef32-bbde-4773-a2a0-720b902e1df1',
};

// Known supplier IDs
const SUPPLIERS = {
  AVERGE: '17',
  CABLE_FEEDER: '18',
  PROCUREMENT_AUDIT: '28',
};

// Known client ID
const CLIENT_FIBERTIME = 'af80daa4-fa65-45b6-bdbf-8e05f9ea3520';

// Known project IDs
const PROJECT_LAWLEY = '4eb13426-b2a1-472d-9b3c-277082ae9b55';
const PROJECT_MAMELODI = '7003dc06-9af7-4a7c-bc6c-a177d77784f2';

const DEMO_TAG = '[DEMO]';
const DEMO_USER_ID = '28ab98c1-df21-48f8-a30a-489cd09a0d39'; // hein@velocityfibre.co.za

// ── Helper: Create journal entry with lines ───────────────────────
async function createJournalEntry(description, entryDate, fiscalPeriodId, source, lines, status = 'posted') {
  // Insert the journal entry (trigger auto-generates entry_number)
  const [je] = await sql`
    INSERT INTO gl_journal_entries (description, entry_date, fiscal_period_id, source, status, posted_at, posted_by, created_by)
    VALUES (${DEMO_TAG + ' ' + description}, ${entryDate}, ${fiscalPeriodId}, ${source}, ${status},
            ${status === 'posted' ? entryDate : null},
            ${status === 'posted' ? DEMO_USER_ID : null},
            ${DEMO_USER_ID})
    RETURNING id, entry_number
  `;

  for (const line of lines) {
    await sql`
      INSERT INTO gl_journal_lines (journal_entry_id, gl_account_id, debit, credit, description, project_id, cost_center_id, vat_type)
      VALUES (${je.id}, ${line.account}, ${line.debit || 0}, ${line.credit || 0},
              ${DEMO_TAG + ' ' + (line.desc || description)}, ${line.project || null}, ${line.costCentre || null}, ${line.vatType || null})
    `;
  }

  return je;
}

// ── PURGE ──────────────────────────────────────────────────────────
async function purge() {
  console.log('🗑️  Purging all [DEMO] accounting data...\n');

  // Delete in reverse dependency order
  // 1. Payment allocations (reference payments and invoices)
  const pa = await sql`DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM supplier_payments WHERE description LIKE '%[DEMO]%') RETURNING id`;
  console.log(`  payment_allocations: ${pa.length} deleted`);

  const cpa = await sql`DELETE FROM customer_payment_allocations WHERE payment_id IN (SELECT id FROM customer_payments WHERE description LIKE '%[DEMO]%') RETURNING id`;
  console.log(`  customer_payment_allocations: ${cpa.length} deleted`);

  // 2. Credit notes
  const cn = await sql`DELETE FROM credit_notes WHERE reason LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  credit_notes: ${cn.length} deleted`);

  // 3. Supplier invoice items
  const sii = await sql`DELETE FROM supplier_invoice_items WHERE supplier_invoice_id IN (SELECT id FROM supplier_invoices WHERE notes LIKE '%[DEMO]%') RETURNING id`;
  console.log(`  supplier_invoice_items: ${sii.length} deleted`);

  // 4. Supplier payments
  const sp = await sql`DELETE FROM supplier_payments WHERE description LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  supplier_payments: ${sp.length} deleted`);

  // 5. Supplier invoices
  const si = await sql`DELETE FROM supplier_invoices WHERE notes LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  supplier_invoices: ${si.length} deleted`);

  // 6. Customer payments
  const cp = await sql`DELETE FROM customer_payments WHERE description LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  customer_payments: ${cp.length} deleted`);

  // 7. Customer invoices
  const ci = await sql`DELETE FROM customer_invoices WHERE notes LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  customer_invoices: ${ci.length} deleted`);

  // 8. Bank transactions
  const bt = await sql`DELETE FROM bank_transactions WHERE description LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  bank_transactions: ${bt.length} deleted`);

  // 9. Journal lines (cascade from entries, but let's be explicit)
  const jl = await sql`DELETE FROM gl_journal_lines WHERE description LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  gl_journal_lines: ${jl.length} deleted`);

  // 10. Journal entries
  const je = await sql`DELETE FROM gl_journal_entries WHERE description LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  gl_journal_entries: ${je.length} deleted`);

  // 11. VAT adjustments
  const va = await sql`DELETE FROM vat_adjustments WHERE reason LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  vat_adjustments: ${va.length} deleted`);

  // 12. Budgets
  const bud = await sql`DELETE FROM accounting_budgets WHERE notes LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  accounting_budgets: ${bud.length} deleted`);

  // 13. Cost centres
  const cc = await sql`DELETE FROM cost_centres WHERE name LIKE '%[DEMO]%' RETURNING id`;
  console.log(`  cost_centres: ${cc.length} deleted`);

  // 14. Recalculate balance cache
  await sql`DELETE FROM gl_account_balances`;
  await sql`
    INSERT INTO gl_account_balances (gl_account_id, fiscal_period_id, debit_total, credit_total, balance)
    SELECT
      jl.gl_account_id,
      je.fiscal_period_id,
      COALESCE(SUM(jl.debit), 0),
      COALESCE(SUM(jl.credit), 0),
      COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
    FROM gl_journal_lines jl
    JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.status = 'posted'
    GROUP BY jl.gl_account_id, je.fiscal_period_id
  `;
  console.log('  gl_account_balances: recalculated');

  console.log('\n✅ Purge complete!');
}

// ── SEED ───────────────────────────────────────────────────────────
async function seed() {
  console.log('🌱 Seeding accounting demo data...\n');

  // ── 1. Cost Centres ──────────────────────────────────────────────
  console.log('1. Cost Centres...');
  const costCentres = [];
  for (const cc of [
    { code: 'OPS', name: '[DEMO] Operations', department: 'Operations', desc: 'Field operations and installations' },
    { code: 'ADM', name: '[DEMO] Administration', department: 'Admin', desc: 'Office and administrative costs' },
    { code: 'PRJ-LAW', name: '[DEMO] Lawley Project', department: 'Projects', desc: 'Lawley fiber deployment' },
    { code: 'PRJ-MAM', name: '[DEMO] Mamelodi Project', department: 'Projects', desc: 'Mamelodi fiber deployment' },
    { code: 'FLEET', name: '[DEMO] Fleet', department: 'Operations', desc: 'Vehicle and transport costs' },
  ]) {
    const [row] = await sql`
      INSERT INTO cost_centres (code, name, description, department, is_active)
      VALUES (${cc.code}, ${cc.name}, ${cc.desc}, ${cc.department}, true)
      ON CONFLICT (code) DO UPDATE SET name = ${cc.name}
      RETURNING id
    `;
    costCentres.push({ ...cc, id: row.id });
  }
  console.log(`   Created ${costCentres.length} cost centres`);

  const CC_OPS = costCentres[0].id;
  const CC_ADM = costCentres[1].id;
  const CC_LAWLEY = costCentres[2].id;
  const CC_MAMELODI = costCentres[3].id;
  const CC_FLEET = costCentres[4].id;

  // ── 2. Opening Balances (Jan 1, 2026) ───────────────────────────
  console.log('2. Opening Balances...');
  await createJournalEntry(
    'Opening Balances - FY2026', '2026-01-01', FP.JAN, 'manual',
    [
      // Assets (debits)
      { account: GL.BANK,          debit: 1250000, desc: 'Bank opening balance' },
      { account: GL.AR,            debit: 485000,  desc: 'AR opening balance' },
      { account: GL.PETTY_CASH,    debit: 5000,    desc: 'Petty cash opening' },
      { account: GL.VAT_INPUT,     debit: 12500,   desc: 'VAT input carried forward', vatType: 'standard' },
      { account: GL.EQUIPMENT,     debit: 850000,  desc: 'Equipment at cost' },
      { account: GL.VEHICLES,      debit: 1200000, desc: 'Vehicles at cost' },
      { account: GL.ACCUM_DEP,     credit: 380000, desc: 'Accumulated depreciation' },
      // Liabilities (credits)
      { account: GL.AP,            credit: 320000, desc: 'AP opening balance' },
      { account: GL.VAT_OUTPUT,    credit: 45000,  desc: 'VAT output carried forward', vatType: 'standard' },
      { account: GL.ACCRUED,       credit: 75000,  desc: 'Accrued expenses' },
      { account: GL.LT_LOANS,     credit: 500000, desc: 'Vehicle finance loan' },
      // Equity (credits)
      { account: GL.SHARE_CAPITAL, credit: 100000, desc: 'Share capital' },
      { account: GL.RETAINED,      credit: 2382500, desc: 'Retained earnings' },
    ]
  );
  console.log('   Opening balances posted');

  // ── 3. January 2026 Transactions ────────────────────────────────
  console.log('3. January 2026 Transactions...');

  // Jan 5 - Activation revenue invoice (Fibertime - Lawley project)
  const jeRevJan1 = await createJournalEntry(
    'Activation Revenue - Lawley Jan Batch 1', '2026-01-05', FP.JAN, 'auto_invoice',
    [
      { account: GL.AR,             debit: 287500,  costCentre: CC_LAWLEY, desc: 'Invoice FT-2026-001 incl. VAT' },
      { account: GL.REV_ACTIVATION, credit: 250000, costCentre: CC_LAWLEY, desc: 'Activation 50 homes @ R5,000' },
      { account: GL.VAT_OUTPUT,     credit: 37500,  desc: 'VAT output 15%', vatType: 'standard' },
    ]
  );

  // Jan 8 - Supplier invoice: Cable Feeder - fiber materials
  const [siCable] = await sql`
    INSERT INTO supplier_invoices
      (supplier_id, invoice_number, invoice_date, due_date, subtotal, tax_rate, tax_amount, total_amount, amount_paid, status, match_status, notes, gl_journal_entry_id, created_by)
    VALUES
      (${SUPPLIERS.CABLE_FEEDER}, 'CF-INV-2026-001', '2026-01-08', '2026-02-07',
       125000, 15, 18750, 143750, 0, 'approved', 'po_matched',
       ${DEMO_TAG + ' Fiber cable 48-core 5km + connectors'}, null, ${DEMO_USER_ID})
    RETURNING id
  `;
  const jeCable = await createJournalEntry(
    'Supplier Invoice CF-INV-2026-001 - Cable Feeder', '2026-01-08', FP.JAN, 'auto_supplier_invoice',
    [
      { account: GL.MATERIALS,  debit: 125000, costCentre: CC_LAWLEY, desc: 'Fiber cable 48-core 5km' },
      { account: GL.VAT_INPUT,  debit: 18750,  desc: 'VAT input 15%', vatType: 'standard' },
      { account: GL.AP,         credit: 143750, desc: 'Cable Feeder Systems invoice' },
    ]
  );
  await sql`UPDATE supplier_invoices SET gl_journal_entry_id = ${jeCable.id} WHERE id = ${siCable.id}`;
  // Add invoice items
  await sql`
    INSERT INTO supplier_invoice_items (supplier_invoice_id, description, quantity, unit_price, tax_rate, tax_amount, line_total, gl_account_id)
    VALUES
      (${siCable.id}, ${DEMO_TAG + ' 48-core fiber cable (5km)'}, 5, 20000, 15, 15000, 100000, ${GL.MATERIALS}),
      (${siCable.id}, ${DEMO_TAG + ' SC/APC connectors (500pc)'}, 500, 50, 15, 3750, 25000, ${GL.MATERIALS})
  `;

  // Jan 10 - Supplier invoice: Averge - equipment rental
  const [siAverge] = await sql`
    INSERT INTO supplier_invoices
      (supplier_id, invoice_number, invoice_date, due_date, subtotal, tax_rate, tax_amount, total_amount, amount_paid, status, match_status, notes, created_by)
    VALUES
      (${SUPPLIERS.AVERGE}, 'AVG-0145', '2026-01-10', '2026-02-09',
       45000, 15, 6750, 51750, 0, 'approved', 'unmatched',
       ${DEMO_TAG + ' Fusion splicer rental + OTDR testing'}, ${DEMO_USER_ID})
    RETURNING id
  `;
  const jeAverge = await createJournalEntry(
    'Supplier Invoice AVG-0145 - Averge Technologies', '2026-01-10', FP.JAN, 'auto_supplier_invoice',
    [
      { account: GL.EQUIPMENT_EXP, debit: 45000, costCentre: CC_OPS, desc: 'Fusion splicer rental' },
      { account: GL.VAT_INPUT,     debit: 6750,  desc: 'VAT input 15%', vatType: 'standard' },
      { account: GL.AP,            credit: 51750, desc: 'Averge Technologies invoice' },
    ]
  );
  await sql`UPDATE supplier_invoices SET gl_journal_entry_id = ${jeAverge.id} WHERE id = ${siAverge.id}`;
  await sql`
    INSERT INTO supplier_invoice_items (supplier_invoice_id, description, quantity, unit_price, tax_rate, tax_amount, line_total, gl_account_id)
    VALUES
      (${siAverge.id}, ${DEMO_TAG + ' Fusion splicer rental (monthly)'}, 1, 35000, 15, 5250, 35000, ${GL.EQUIPMENT_EXP}),
      (${siAverge.id}, ${DEMO_TAG + ' OTDR testing equipment'}, 1, 10000, 15, 1500, 10000, ${GL.EQUIPMENT_EXP})
  `;

  // Jan 12 - Subcontractor costs
  await createJournalEntry(
    'Subcontractor Payment - Trenching Lawley Phase 1', '2026-01-12', FP.JAN, 'manual',
    [
      { account: GL.SUBCONTRACTOR, debit: 180000, costCentre: CC_LAWLEY, desc: 'Trenching 2.5km Lawley' },
      { account: GL.VAT_INPUT,    debit: 27000,  desc: 'VAT input 15%', vatType: 'standard' },
      { account: GL.BANK,         credit: 207000, desc: 'EFT to TrenchCo' },
    ]
  );

  // Jan 15 - Customer payment received (partial)
  const [cpJan1] = await sql`
    INSERT INTO customer_payments
      (client_id, payment_date, total_amount, payment_method, bank_reference, bank_account_id, description, status, confirmed_by, confirmed_at, created_by)
    VALUES
      (${CLIENT_FIBERTIME}, '2026-01-15', 200000, 'eft', 'FT-PAY-20260115',
       ${GL.BANK}, ${DEMO_TAG + ' Fibertime partial payment - Lawley'}, 'confirmed', ${DEMO_USER_ID}, '2026-01-15', ${DEMO_USER_ID})
    RETURNING id
  `;
  await createJournalEntry(
    'Customer Payment - Fibertime R200,000', '2026-01-15', FP.JAN, 'auto_payment',
    [
      { account: GL.BANK, debit: 200000, desc: 'Fibertime EFT received' },
      { account: GL.AR,   credit: 200000, desc: 'AR reduction - Fibertime' },
    ]
  );

  // Jan 18 - Labour costs (payroll)
  await createJournalEntry(
    'January Payroll - Field Teams', '2026-01-18', FP.JAN, 'manual',
    [
      { account: GL.LABOUR,   debit: 185000, costCentre: CC_OPS, desc: 'Field team salaries Jan' },
      { account: GL.ADMIN,    debit: 65000,  costCentre: CC_ADM, desc: 'Admin salaries Jan' },
      { account: GL.BANK,     credit: 250000, desc: 'Salary payments Jan' },
    ]
  );

  // Jan 20 - Transport & fuel
  await createJournalEntry(
    'Fleet Fuel & Maintenance - January', '2026-01-20', FP.JAN, 'manual',
    [
      { account: GL.TRANSPORT, debit: 35000, costCentre: CC_FLEET, desc: 'Diesel fleet vehicles Jan' },
      { account: GL.VAT_INPUT, debit: 5250,  desc: 'VAT input 15%', vatType: 'standard' },
      { account: GL.BANK,      credit: 40250, desc: 'Fleet fuel Jan' },
    ]
  );

  // Jan 22 - Maintenance revenue
  await createJournalEntry(
    'Maintenance Revenue - Mamelodi SLA', '2026-01-22', FP.JAN, 'auto_invoice',
    [
      { account: GL.AR,               debit: 57500,  costCentre: CC_MAMELODI, desc: 'Maintenance invoice MAM-2026-001' },
      { account: GL.REV_MAINTENANCE,   credit: 50000, costCentre: CC_MAMELODI, desc: 'Monthly SLA maintenance' },
      { account: GL.VAT_OUTPUT,        credit: 7500,  desc: 'VAT output 15%', vatType: 'standard' },
    ]
  );

  // Jan 25 - Pay supplier (Cable Feeder partial)
  const [spCable] = await sql`
    INSERT INTO supplier_payments
      (supplier_id, payment_date, total_amount, payment_method, bank_account_id, reference, description, status, approved_by, approved_at, processed_at, created_by)
    VALUES
      (${SUPPLIERS.CABLE_FEEDER}, '2026-01-25', 100000, 'eft', ${GL.BANK}, 'EFT-CF-001',
       ${DEMO_TAG + ' Partial payment Cable Feeder'}, 'processed', ${DEMO_USER_ID}, '2026-01-25', '2026-01-25', ${DEMO_USER_ID})
    RETURNING id
  `;
  await sql`
    INSERT INTO payment_allocations (payment_id, invoice_id, amount_allocated)
    VALUES (${spCable.id}, ${siCable.id}, 100000)
  `;
  await sql`UPDATE supplier_invoices SET amount_paid = 100000, status = 'partially_paid' WHERE id = ${siCable.id}`;
  await createJournalEntry(
    'Supplier Payment - Cable Feeder R100,000', '2026-01-25', FP.JAN, 'auto_supplier_payment',
    [
      { account: GL.AP,   debit: 100000, desc: 'Payment to Cable Feeder' },
      { account: GL.BANK, credit: 100000, desc: 'EFT to Cable Feeder' },
    ]
  );

  // Jan 28 - Admin expenses & bank charges
  await createJournalEntry(
    'Office Expenses & Bank Charges - January', '2026-01-28', FP.JAN, 'manual',
    [
      { account: GL.ADMIN,        debit: 22000, costCentre: CC_ADM, desc: 'Office rent, insurance, supplies' },
      { account: GL.BANK_CHARGES, debit: 3500,  desc: 'Bank service fees Jan' },
      { account: GL.VAT_INPUT,    debit: 3300,  desc: 'VAT on office rent', vatType: 'standard' },
      { account: GL.BANK,         credit: 28800, desc: 'Admin expenses Jan' },
    ]
  );

  // Jan 31 - Depreciation
  await createJournalEntry(
    'Monthly Depreciation - January 2026', '2026-01-31', FP.JAN, 'auto_depreciation',
    [
      { account: GL.DEPRECIATION, debit: 17083,  desc: 'Equipment + vehicles depreciation' },
      { account: GL.ACCUM_DEP,    credit: 17083, desc: 'Accumulated depreciation increase' },
    ]
  );

  // Jan 31 - Other income (interest)
  await createJournalEntry(
    'Bank Interest Received - January', '2026-01-31', FP.JAN, 'manual',
    [
      { account: GL.BANK,      debit: 4200,  desc: 'Interest on business account' },
      { account: GL.REV_OTHER, credit: 4200, desc: 'Interest income Jan' },
    ]
  );

  console.log('   January: 11 journal entries posted');

  // ── 4. February 2026 Transactions ───────────────────────────────
  console.log('4. February 2026 Transactions...');

  // Feb 3 - Activation revenue (Mamelodi)
  await createJournalEntry(
    'Activation Revenue - Mamelodi Feb Batch', '2026-02-03', FP.FEB, 'auto_invoice',
    [
      { account: GL.AR,             debit: 172500,  costCentre: CC_MAMELODI, desc: 'Invoice MAM-2026-002 incl. VAT' },
      { account: GL.REV_ACTIVATION, credit: 150000, costCentre: CC_MAMELODI, desc: 'Activation 30 homes @ R5,000' },
      { account: GL.VAT_OUTPUT,     credit: 22500,  desc: 'VAT output 15%', vatType: 'standard' },
    ]
  );

  // Feb 5 - Activation revenue (Lawley batch 2)
  await createJournalEntry(
    'Activation Revenue - Lawley Feb Batch', '2026-02-05', FP.FEB, 'auto_invoice',
    [
      { account: GL.AR,             debit: 460000,   costCentre: CC_LAWLEY, desc: 'Invoice FT-2026-002 incl. VAT' },
      { account: GL.REV_ACTIVATION, credit: 400000,  costCentre: CC_LAWLEY, desc: 'Activation 80 homes @ R5,000' },
      { account: GL.VAT_OUTPUT,     credit: 60000,   desc: 'VAT output 15%', vatType: 'standard' },
    ]
  );

  // Feb 7 - Supplier invoice: materials for Mamelodi
  const [siMatsFeb] = await sql`
    INSERT INTO supplier_invoices
      (supplier_id, invoice_number, invoice_date, due_date, subtotal, tax_rate, tax_amount, total_amount, amount_paid, status, match_status, notes, created_by)
    VALUES
      (${SUPPLIERS.CABLE_FEEDER}, 'CF-INV-2026-002', '2026-02-07', '2026-03-09',
       95000, 15, 14250, 109250, 0, 'approved', 'po_matched',
       ${DEMO_TAG + ' Fiber cable 24-core 3km + splice closures'}, ${DEMO_USER_ID})
    RETURNING id
  `;
  const jeMatsFeb = await createJournalEntry(
    'Supplier Invoice CF-INV-2026-002 - Cable Feeder', '2026-02-07', FP.FEB, 'auto_supplier_invoice',
    [
      { account: GL.MATERIALS, debit: 95000,  costCentre: CC_MAMELODI, desc: 'Fiber cable 24-core 3km' },
      { account: GL.VAT_INPUT, debit: 14250,  desc: 'VAT input 15%', vatType: 'standard' },
      { account: GL.AP,        credit: 109250, desc: 'Cable Feeder invoice Feb' },
    ]
  );
  await sql`UPDATE supplier_invoices SET gl_journal_entry_id = ${jeMatsFeb.id} WHERE id = ${siMatsFeb.id}`;
  await sql`
    INSERT INTO supplier_invoice_items (supplier_invoice_id, description, quantity, unit_price, tax_rate, tax_amount, line_total, gl_account_id)
    VALUES
      (${siMatsFeb.id}, ${DEMO_TAG + ' 24-core fiber cable (3km)'}, 3, 25000, 15, 11250, 75000, ${GL.MATERIALS}),
      (${siMatsFeb.id}, ${DEMO_TAG + ' Splice closures (40pc)'}, 40, 500, 15, 3000, 20000, ${GL.MATERIALS})
  `;

  // Feb 10 - Customer payment (Fibertime - large payment)
  await sql`
    INSERT INTO customer_payments
      (client_id, payment_date, total_amount, payment_method, bank_reference, bank_account_id, description, status, confirmed_by, confirmed_at, created_by)
    VALUES
      (${CLIENT_FIBERTIME}, '2026-02-10', 450000, 'eft', 'FT-PAY-20260210',
       ${GL.BANK}, ${DEMO_TAG + ' Fibertime payment - Lawley + Mamelodi'}, 'confirmed', ${DEMO_USER_ID}, '2026-02-10', ${DEMO_USER_ID})
  `;
  await createJournalEntry(
    'Customer Payment - Fibertime R450,000', '2026-02-10', FP.FEB, 'auto_payment',
    [
      { account: GL.BANK, debit: 450000, desc: 'Fibertime EFT received' },
      { account: GL.AR,   credit: 450000, desc: 'AR reduction - Fibertime' },
    ]
  );

  // Feb 12 - Subcontractor costs (Mamelodi trenching)
  await createJournalEntry(
    'Subcontractor Payment - Trenching Mamelodi Phase 1', '2026-02-12', FP.FEB, 'manual',
    [
      { account: GL.SUBCONTRACTOR, debit: 220000, costCentre: CC_MAMELODI, desc: 'Trenching 3km Mamelodi' },
      { account: GL.VAT_INPUT,     debit: 33000,  desc: 'VAT input 15%', vatType: 'standard' },
      { account: GL.BANK,          credit: 253000, desc: 'EFT to TrenchCo' },
    ]
  );

  // Feb 15 - Payroll
  await createJournalEntry(
    'February Payroll - Field Teams', '2026-02-15', FP.FEB, 'manual',
    [
      { account: GL.LABOUR, debit: 195000, costCentre: CC_OPS, desc: 'Field team salaries Feb' },
      { account: GL.ADMIN,  debit: 65000,  costCentre: CC_ADM, desc: 'Admin salaries Feb' },
      { account: GL.BANK,   credit: 260000, desc: 'Salary payments Feb' },
    ]
  );

  // Feb 17 - Pay remaining Cable Feeder Jan invoice
  const [spCableFeb] = await sql`
    INSERT INTO supplier_payments
      (supplier_id, payment_date, total_amount, payment_method, bank_account_id, reference, description, status, approved_by, approved_at, processed_at, created_by)
    VALUES
      (${SUPPLIERS.CABLE_FEEDER}, '2026-02-17', 43750, 'eft', ${GL.BANK}, 'EFT-CF-002',
       ${DEMO_TAG + ' Final payment Cable Feeder Jan invoice'}, 'processed', ${DEMO_USER_ID}, '2026-02-17', '2026-02-17', ${DEMO_USER_ID})
    RETURNING id
  `;
  await sql`
    INSERT INTO payment_allocations (payment_id, invoice_id, amount_allocated)
    VALUES (${spCableFeb.id}, ${siCable.id}, 43750)
  `;
  await sql`UPDATE supplier_invoices SET amount_paid = 143750, status = 'paid' WHERE id = ${siCable.id}`;
  await createJournalEntry(
    'Supplier Payment - Cable Feeder R43,750 (final)', '2026-02-17', FP.FEB, 'auto_supplier_payment',
    [
      { account: GL.AP,   debit: 43750,  desc: 'Final payment Cable Feeder' },
      { account: GL.BANK, credit: 43750, desc: 'EFT to Cable Feeder' },
    ]
  );

  // Feb 18 - Pay Averge invoice in full
  const [spAvergeFeb] = await sql`
    INSERT INTO supplier_payments
      (supplier_id, payment_date, total_amount, payment_method, bank_account_id, reference, description, status, approved_by, approved_at, processed_at, created_by)
    VALUES
      (${SUPPLIERS.AVERGE}, '2026-02-18', 51750, 'eft', ${GL.BANK}, 'EFT-AVG-001',
       ${DEMO_TAG + ' Payment Averge Technologies full'}, 'processed', ${DEMO_USER_ID}, '2026-02-18', '2026-02-18', ${DEMO_USER_ID})
    RETURNING id
  `;
  await sql`
    INSERT INTO payment_allocations (payment_id, invoice_id, amount_allocated)
    VALUES (${spAvergeFeb.id}, ${siAverge.id}, 51750)
  `;
  await sql`UPDATE supplier_invoices SET amount_paid = 51750, status = 'paid' WHERE id = ${siAverge.id}`;
  await createJournalEntry(
    'Supplier Payment - Averge Technologies R51,750', '2026-02-18', FP.FEB, 'auto_supplier_payment',
    [
      { account: GL.AP,   debit: 51750,  desc: 'Payment to Averge Technologies' },
      { account: GL.BANK, credit: 51750, desc: 'EFT to Averge Technologies' },
    ]
  );

  // Feb 20 - Fleet expenses
  await createJournalEntry(
    'Fleet Fuel & Maintenance - February', '2026-02-20', FP.FEB, 'manual',
    [
      { account: GL.TRANSPORT, debit: 42000, costCentre: CC_FLEET, desc: 'Diesel + tyre replacement' },
      { account: GL.VAT_INPUT, debit: 6300,  desc: 'VAT input 15%', vatType: 'standard' },
      { account: GL.BANK,      credit: 48300, desc: 'Fleet expenses Feb' },
    ]
  );

  // Feb 22 - Maintenance revenue (Mamelodi SLA)
  await createJournalEntry(
    'Maintenance Revenue - Mamelodi SLA Feb', '2026-02-22', FP.FEB, 'auto_invoice',
    [
      { account: GL.AR,              debit: 57500,  costCentre: CC_MAMELODI, desc: 'Maintenance invoice MAM-2026-003' },
      { account: GL.REV_MAINTENANCE, credit: 50000, costCentre: CC_MAMELODI, desc: 'Monthly SLA maintenance Feb' },
      { account: GL.VAT_OUTPUT,      credit: 7500,  desc: 'VAT output 15%', vatType: 'standard' },
    ]
  );

  // Feb 24 - Credit note (customer billing error)
  const [cnDemo] = await sql`
    INSERT INTO credit_notes
      (type, client_id, credit_date, reason, subtotal, tax_rate, tax_amount, total_amount, status, approved_by, approved_at, created_by)
    VALUES
      ('customer', ${CLIENT_FIBERTIME}, '2026-02-24',
       ${DEMO_TAG + ' Billing correction - 2 duplicate activations'},
       10000, 15, 1500, 11500, 'approved', ${DEMO_USER_ID}, '2026-02-24', ${DEMO_USER_ID})
    RETURNING id
  `;
  const jeCN = await createJournalEntry(
    'Credit Note - Fibertime duplicate billing correction', '2026-02-24', FP.FEB, 'auto_credit_note',
    [
      { account: GL.REV_ACTIVATION, debit: 10000,  costCentre: CC_LAWLEY, desc: 'Revenue reversal - 2 duplicates' },
      { account: GL.VAT_OUTPUT,     debit: 1500,   desc: 'VAT output reversal', vatType: 'standard' },
      { account: GL.AR,             credit: 11500, desc: 'AR credit note - Fibertime' },
    ]
  );
  await sql`UPDATE credit_notes SET gl_journal_entry_id = ${jeCN.id} WHERE id = ${cnDemo.id}`;

  // Feb 25 - Admin expenses
  await createJournalEntry(
    'Office Expenses & Bank Charges - February', '2026-02-25', FP.FEB, 'manual',
    [
      { account: GL.ADMIN,        debit: 24000, costCentre: CC_ADM, desc: 'Office rent, insurance Feb' },
      { account: GL.BANK_CHARGES, debit: 3800,  desc: 'Bank service fees Feb' },
      { account: GL.VAT_INPUT,    debit: 3600,  desc: 'VAT on office rent Feb', vatType: 'standard' },
      { account: GL.BANK,         credit: 31400, desc: 'Admin expenses Feb' },
    ]
  );

  // Feb 28 - Depreciation
  await createJournalEntry(
    'Monthly Depreciation - February 2026', '2026-02-28', FP.FEB, 'auto_depreciation',
    [
      { account: GL.DEPRECIATION, debit: 17083,  desc: 'Equipment + vehicles depreciation Feb' },
      { account: GL.ACCUM_DEP,    credit: 17083, desc: 'Accumulated depreciation increase' },
    ]
  );

  // Feb 28 - Bank interest
  await createJournalEntry(
    'Bank Interest Received - February', '2026-02-28', FP.FEB, 'manual',
    [
      { account: GL.BANK,      debit: 3800,  desc: 'Interest on business account Feb' },
      { account: GL.REV_OTHER, credit: 3800, desc: 'Interest income Feb' },
    ]
  );

  // Feb draft entry (not yet posted)
  await createJournalEntry(
    'Accrual - Pending subcontractor invoice', '2026-02-28', FP.FEB, 'manual',
    [
      { account: GL.SUBCONTRACTOR, debit: 85000, costCentre: CC_LAWLEY, desc: 'Estimated cable pulling costs' },
      { account: GL.ACCRUED,       credit: 85000, desc: 'Accrual for pending invoice' },
    ],
    'draft'
  );

  console.log('   February: 13 journal entries (12 posted + 1 draft)');

  // ── 4b. Mixed VAT Type Transactions (for VAT201 testing) ──────
  console.log('4b. Mixed VAT Type Transactions...');

  // Zero-rated export sale (Box 2A)
  await createJournalEntry(
    'Export Sale - Mozambique fiber project', '2026-02-05', FP.FEB, 'auto_invoice',
    [
      { account: GL.AR,          debit: 95000,  desc: 'Invoice EXP-001 zero-rated export' },
      { account: GL.REV_OTHER,   credit: 95000, desc: 'Export revenue - Mozambique' },
      { account: GL.VAT_OUTPUT,  credit: 0,     desc: 'Zero-rated export VAT', vatType: 'export' },
    ]
  );

  // Zero-rated domestic sale (Box 2) - e.g. fiber to an exempt body
  await createJournalEntry(
    'Zero-rated sale - Government fiber contract', '2026-02-08', FP.FEB, 'auto_invoice',
    [
      { account: GL.AR,          debit: 120000, desc: 'Invoice GOV-001 zero-rated domestic' },
      { account: GL.REV_ACTIVATION, credit: 120000, desc: 'Govt activation - zero-rated' },
      { account: GL.VAT_OUTPUT,  credit: 0,     desc: 'Zero-rated domestic supply', vatType: 'zero_rated' },
    ]
  );

  // Capital goods purchase (Box 14) - bought a new splicing machine
  await createJournalEntry(
    'Capital purchase - Fusion splicer', '2026-02-10', FP.FEB, 'auto_supplier_invoice',
    [
      { account: GL.EQUIPMENT,   debit: 185000, desc: 'Fujikura 90S+ fusion splicer' },
      { account: GL.VAT_INPUT,   debit: 27750,  desc: 'VAT on capital equipment', vatType: 'capital_goods' },
      { account: GL.AP,          credit: 212750, desc: 'AP - Fibre Optic Solutions' },
    ]
  );

  // Imported services (Box 12 output + Box 14A/15A input) - Microsoft 365 subscription
  await createJournalEntry(
    'Imported services - Microsoft 365 Enterprise', '2026-02-15', FP.FEB, 'manual',
    [
      { account: GL.ADMIN,       debit: 8500,   desc: 'M365 E3 subscription Feb' },
      { account: GL.VAT_INPUT,   debit: 1275,   desc: 'VAT on imported services (self-accounted)', vatType: 'imported' },
      { account: GL.VAT_OUTPUT,  credit: 1275,  desc: 'Reverse charge - imported services', vatType: 'imported' },
      { account: GL.BANK,        credit: 8500,  desc: 'M365 payment' },
    ]
  );

  // Exempt supply (Box 3) - training services provided
  await createJournalEntry(
    'Exempt supply - Staff fiber training course', '2026-02-18', FP.FEB, 'auto_invoice',
    [
      { account: GL.AR,          debit: 45000,  desc: 'Training services rendered (exempt)' },
      { account: GL.REV_OTHER,   credit: 45000, desc: 'Training revenue - exempt' },
      { account: GL.VAT_OUTPUT,  credit: 0,     desc: 'Exempt supply - no VAT', vatType: 'exempt' },
    ]
  );

  // Bad debt write-off with VAT recovery (Box 17)
  await createJournalEntry(
    'Bad debt write-off - Old client TelCom', '2026-02-20', FP.FEB, 'auto_write_off',
    [
      { account: GL.ADMIN,       debit: 23000,  desc: 'Bad debt expense - TelCom invoice' },
      { account: GL.VAT_INPUT,   debit: 3000,   desc: 'VAT recovery on bad debt', vatType: 'bad_debt' },
      { account: GL.AR,          credit: 26000, desc: 'Write off AR - TelCom' },
    ]
  );

  console.log('   Mixed VAT: 6 journal entries with export, zero-rated, capital, imported, exempt, bad debt');

  // ── 5. Bank Transactions (for reconciliation) ───────────────────
  console.log('5. Bank Transactions...');
  const bankTxns = [
    // January
    { date: '2026-01-05', amount: -207000,  desc: DEMO_TAG + ' EFT TrenchCo trenching', ref: 'EFT-TRENCH-001' },
    { date: '2026-01-15', amount: 200000,   desc: DEMO_TAG + ' Fibertime payment received', ref: 'FT-PAY-20260115' },
    { date: '2026-01-18', amount: -250000,  desc: DEMO_TAG + ' Salary payments Jan', ref: 'SAL-JAN-2026' },
    { date: '2026-01-20', amount: -40250,   desc: DEMO_TAG + ' Fleet fuel Jan', ref: 'FLEET-JAN' },
    { date: '2026-01-25', amount: -100000,  desc: DEMO_TAG + ' Cable Feeder payment', ref: 'EFT-CF-001' },
    { date: '2026-01-28', amount: -28800,   desc: DEMO_TAG + ' Office expenses Jan', ref: 'ADMIN-JAN' },
    { date: '2026-01-31', amount: -3500,    desc: DEMO_TAG + ' Bank service fees Jan', ref: 'BANK-FEE-JAN' },
    { date: '2026-01-31', amount: 4200,     desc: DEMO_TAG + ' Interest received Jan', ref: 'INT-JAN' },
    // February
    { date: '2026-02-10', amount: 450000,   desc: DEMO_TAG + ' Fibertime payment Feb', ref: 'FT-PAY-20260210' },
    { date: '2026-02-12', amount: -253000,  desc: DEMO_TAG + ' EFT TrenchCo Mamelodi', ref: 'EFT-TRENCH-002' },
    { date: '2026-02-15', amount: -260000,  desc: DEMO_TAG + ' Salary payments Feb', ref: 'SAL-FEB-2026' },
    { date: '2026-02-17', amount: -43750,   desc: DEMO_TAG + ' Cable Feeder final Jan', ref: 'EFT-CF-002' },
    { date: '2026-02-18', amount: -51750,   desc: DEMO_TAG + ' Averge Technologies', ref: 'EFT-AVG-001' },
    { date: '2026-02-20', amount: -48300,   desc: DEMO_TAG + ' Fleet expenses Feb', ref: 'FLEET-FEB' },
    { date: '2026-02-25', amount: -31400,   desc: DEMO_TAG + ' Office expenses Feb', ref: 'ADMIN-FEB' },
    { date: '2026-02-28', amount: -3800,    desc: DEMO_TAG + ' Bank service fees Feb', ref: 'BANK-FEE-FEB' },
    { date: '2026-02-28', amount: 3800,     desc: DEMO_TAG + ' Interest received Feb', ref: 'INT-FEB' },
    // Unmatched transactions (for testing reconciliation)
    { date: '2026-02-26', amount: -1250,    desc: DEMO_TAG + ' Stationery - Makro', ref: 'POS-MAKRO-001' },
    { date: '2026-02-27', amount: -890,     desc: DEMO_TAG + ' Printer ink cartridges', ref: 'POS-CART-001' },
    { date: '2026-02-28', amount: 15000,    desc: DEMO_TAG + ' Refund from supplier', ref: 'REF-SUP-001' },
  ];

  for (const tx of bankTxns) {
    await sql`
      INSERT INTO bank_transactions (bank_account_id, transaction_date, value_date, amount, description, reference, status)
      VALUES (${GL.BANK}, ${tx.date}, ${tx.date}, ${tx.amount}, ${tx.desc}, ${tx.ref},
              ${tx.ref.startsWith('POS-') || tx.ref === 'REF-SUP-001' ? 'imported' : 'matched'})
    `;
  }
  console.log(`   ${bankTxns.length} bank transactions created (17 matched + 3 unmatched)`);

  // ── 6. Customer Invoices ─────────────────────────────────────────
  console.log('6. Customer Invoices...');
  for (const inv of [
    { num: 'FT-2026-001', date: '2026-01-05', due: '2026-02-04', bps: '2026-01-01', bpe: '2026-01-31', sub: 250000, tax: 37500, total: 287500, paid: 200000, status: 'partially_paid', project: PROJECT_LAWLEY },
    { num: 'FT-2026-002', date: '2026-02-05', due: '2026-03-07', bps: '2026-02-01', bpe: '2026-02-28', sub: 400000, tax: 60000, total: 460000, paid: 450000, status: 'partially_paid', project: PROJECT_LAWLEY },
    { num: 'MAM-2026-001', date: '2026-01-22', due: '2026-02-21', bps: '2026-01-01', bpe: '2026-01-31', sub: 50000, tax: 7500, total: 57500, paid: 0, status: 'sent', project: PROJECT_MAMELODI },
    { num: 'MAM-2026-002', date: '2026-02-03', due: '2026-03-05', bps: '2026-02-01', bpe: '2026-02-28', sub: 150000, tax: 22500, total: 172500, paid: 0, status: 'sent', project: PROJECT_MAMELODI },
    { num: 'MAM-2026-003', date: '2026-02-22', due: '2026-03-24', bps: '2026-02-01', bpe: '2026-02-28', sub: 50000, tax: 7500, total: 57500, paid: 0, status: 'sent', project: PROJECT_MAMELODI },
  ]) {
    await sql`
      INSERT INTO customer_invoices
        (invoice_number, project_id, client_id, invoice_date, due_date, billing_period_start, billing_period_end, subtotal, tax_rate, tax_amount, total_amount, amount_paid, status, notes, created_by)
      VALUES
        (${inv.num}, ${inv.project}, ${CLIENT_FIBERTIME}, ${inv.date}, ${inv.due}, ${inv.bps}, ${inv.bpe},
         ${inv.sub}, 15, ${inv.tax}, ${inv.total}, ${inv.paid}, ${inv.status},
         ${DEMO_TAG + ' Demo invoice'}, ${DEMO_USER_ID})
    `;
  }
  console.log('   5 customer invoices created');

  // ── 7. Budgets ───────────────────────────────────────────────────
  console.log('7. Budgets...');
  const budgetAccounts = [
    { account: GL.REV_ACTIVATION,  annual: 6000000, monthly: 500000 },
    { account: GL.REV_MAINTENANCE, annual: 720000,  monthly: 60000 },
    { account: GL.MATERIALS,       annual: 2400000, monthly: 200000 },
    { account: GL.LABOUR,          annual: 2340000, monthly: 195000 },
    { account: GL.SUBCONTRACTOR,   annual: 2400000, monthly: 200000 },
    { account: GL.TRANSPORT,       annual: 480000,  monthly: 40000 },
    { account: GL.EQUIPMENT_EXP,   annual: 600000,  monthly: 50000 },
    { account: GL.ADMIN,           annual: 300000,  monthly: 25000 },
    { account: GL.BANK_CHARGES,    annual: 48000,   monthly: 4000 },
    { account: GL.DEPRECIATION,    annual: 205000,  monthly: 17083 },
  ];

  for (const b of budgetAccounts) {
    await sql`
      INSERT INTO accounting_budgets
        (gl_account_id, fiscal_year, annual_amount, jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, notes)
      VALUES
        (${b.account}, 2026, ${b.annual},
         ${b.monthly}, ${b.monthly}, ${b.monthly}, ${b.monthly}, ${b.monthly}, ${b.monthly},
         ${b.monthly}, ${b.monthly}, ${b.monthly}, ${b.monthly}, ${b.monthly}, ${b.monthly},
         ${DEMO_TAG + ' FY2026 budget'})
      ON CONFLICT (gl_account_id, fiscal_year) DO UPDATE SET
        annual_amount = ${b.annual}, notes = ${DEMO_TAG + ' FY2026 budget'}
    `;
  }
  console.log(`   ${budgetAccounts.length} budget lines created for FY2026`);

  // ── 8. VAT Adjustment ───────────────────────────────────────────
  console.log('8. VAT Adjustment...');
  await sql`
    INSERT INTO vat_adjustments
      (adjustment_date, vat_period, adjustment_type, amount, reason, status, approved_by, approved_at, created_by)
    VALUES
      ('2026-01-31', 'January 2026', 'output', 2500,
       ${DEMO_TAG + ' VAT rounding adjustment for Jan period'},
       'approved', ${DEMO_USER_ID}, '2026-02-01', ${DEMO_USER_ID})
  `;
  console.log('   1 VAT adjustment created');

  // ── Summary ──────────────────────────────────────────────────────
  const jCount = await sql`SELECT COUNT(*) as c FROM gl_journal_entries WHERE description LIKE '%[DEMO]%'`;
  const jlCount = await sql`SELECT COUNT(*) as c FROM gl_journal_lines WHERE description LIKE '%[DEMO]%'`;
  const balCount = await sql`SELECT COUNT(*) as c FROM gl_account_balances`;

  console.log('\n✅ Seed complete!');
  console.log(`   Journal entries: ${jCount[0].c}`);
  console.log(`   Journal lines:   ${jlCount[0].c}`);
  console.log(`   Balance cache:   ${balCount[0].c} records`);
  console.log('\nTo purge: node scripts/seed-accounting-demo.mjs --purge');
}

// ── Main ───────────────────────────────────────────────────────────
const isPurge = process.argv.includes('--purge');
(isPurge ? purge() : seed()).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
