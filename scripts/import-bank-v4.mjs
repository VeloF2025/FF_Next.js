/**
 * Import bank transactions from vf-bank-classified-v4.xlsx
 * Reads all 3 sheets, maps columns, inserts into bank_transactions
 */
import { neon } from '@neondatabase/serverless';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL required');
const sql = neon(DATABASE_URL);

// Bank account GL IDs
const ACCOUNTS = {
  'ABSA VF1':       '3eb6b8d1-e6dc-457d-81c8-4baebd8d9b67', // Bank - ABSA Current (1110)
  'ABSA VF2':       'd0da6db9-6992-4dc2-9ef7-3c77b158a4d1', // Bank - ABSA Savings (1111)
  'Standard Bank':  'c57ba2dc-107d-490e-b057-1465c88609dc', // Bank - Standard Bank (1112)
};

// Generate a batch ID for this import
const batchId = crypto.randomUUID();
console.log(`Import batch: ${batchId}`);

const filePath = process.argv[2] || 'docs/vf-bank-classified-v4.xlsx';
const buf = await readFile(filePath);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });

let totalInserted = 0;

for (const sheetName of Object.keys(ACCOUNTS)) {
  const ws = wb.Sheets[sheetName];
  if (!ws) { console.warn(`Sheet "${sheetName}" not found, skipping`); continue; }

  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  const bankAccountId = ACCOUNTS[sheetName];

  // Filter out TOTAL row and empty rows
  const txRows = rows.filter(r => {
    if (!r.Date) return false;
    if (String(r.Description || '').toUpperCase() === 'TOTAL') return false;
    return true;
  });

  console.log(`\n${sheetName}: ${txRows.length} transactions to import`);

  // Batch insert in chunks of 50
  const CHUNK = 50;
  let inserted = 0;

  for (let i = 0; i < txRows.length; i += CHUNK) {
    const chunk = txRows.slice(i, i + CHUNK);

    // Build VALUES for batch insert
    const promises = chunk.map(r => {
      // Parse date
      let txDate;
      if (r.Date instanceof Date) {
        txDate = r.Date.toISOString().split('T')[0];
      } else {
        txDate = String(r.Date).split('T')[0];
      }

      // Convert debit/credit to signed amount
      const debit = r.Debit != null ? Number(r.Debit) : 0;
      const credit = r.Credit != null ? Number(r.Credit) : 0;
      let amount;
      if (credit > 0 && debit === 0) {
        amount = credit;          // Deposit
      } else if (debit > 0 && credit === 0) {
        amount = -debit;          // Withdrawal
      } else if (credit > 0 && debit > 0) {
        amount = credit - debit;  // Net (bank charges with refund)
      } else {
        amount = 0;
      }

      const description = r.Description ? String(r.Description).trim() : null;
      const reference = r.Statement ? String(r.Statement).trim() : null;
      const balance = r.Balance != null ? Number(r.Balance) : null;
      const category = r.Category ? String(r.Category).trim() : null;
      const costCentre = [r['Cost Centre T1'], r['Cost Centre T2']]
        .filter(Boolean)
        .map(s => String(s).trim())
        .join(' / ') || null;

      // Store Business Unit + Type in notes for now
      const buType = [r['Business Unit'], r.Type]
        .filter(Boolean)
        .map(s => String(s).trim())
        .join(' | ') || null;

      return sql`
        INSERT INTO bank_transactions (
          bank_account_id, transaction_date, amount, description,
          reference, balance, import_batch_id,
          suggested_category, suggested_cost_centre, notes
        ) VALUES (
          ${bankAccountId}::UUID, ${txDate}::DATE, ${amount},
          ${description}, ${reference}, ${balance}, ${batchId}::UUID,
          ${category}, ${costCentre}, ${buType}
        )
      `;
    });

    await Promise.all(promises);
    inserted += chunk.length;
    process.stdout.write(`  ${inserted}/${txRows.length}\r`);
  }

  console.log(`  ${sheetName}: imported ${inserted} transactions`);
  totalInserted += inserted;
}

console.log(`\nDone! Total imported: ${totalInserted}`);

// Verify
const verify = await sql`
  SELECT bank_account_id, COUNT(*)::int AS cnt
  FROM bank_transactions
  WHERE import_batch_id = ${batchId}::UUID
  GROUP BY bank_account_id
`;
console.log('\nVerification:');
console.table(verify);
