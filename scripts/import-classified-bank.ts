/**
 * Import Classified Bank Transactions from spreadsheet data
 *
 * Usage:
 *   npx ts-node scripts/import-classified-bank.ts <json-file> <bank-account-id>
 *
 * The JSON file should be an array of objects with:
 *   {
 *     "transactionDate": "2024-01-15",
 *     "description": "SALARY PAYMENT",
 *     "debit": 5000.00,
 *     "credit": 0,
 *     "category": "Salaries",
 *     "costCentreT1": "Head Office",
 *     "costCentreT2": "Admin",
 *     "businessUnit": "VF1",
 *     "statementRef": "St01",
 *     "source": "ABSA_VF1"
 *   }
 *
 * Alternatively, pipe JSON via stdin:
 *   cat classified-txns.json | npx ts-node scripts/import-classified-bank.ts - <bank-account-id>
 */

import * as fs from 'fs';

const API_BASE = process.env.API_BASE || 'http://localhost:3004';

async function main() {
  const filePath = process.argv[2];
  const bankAccountId = process.argv[3];

  if (!bankAccountId) {
    // eslint-disable-next-line no-console
    console.error('Usage: import-classified-bank.ts <json-file|-stdin> <bank-account-id>');
    process.exit(1);
  }

  let jsonData: string;
  if (filePath && filePath !== '-') {
    jsonData = fs.readFileSync(filePath, 'utf-8');
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    jsonData = Buffer.concat(chunks).toString('utf-8');
  }

  const transactions = JSON.parse(jsonData);
  if (!Array.isArray(transactions)) {
    // eslint-disable-next-line no-console
    console.error('Expected a JSON array of classified bank transactions');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`Importing ${transactions.length} classified transactions to bank account ${bankAccountId}...`);

  const res = await fetch(`${API_BASE}/api/accounting/bank-transactions-import-classified`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bankAccountId, transactions }),
  });

  const json = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error('Import failed:', json.message || json.error);
    process.exit(1);
  }

  const data = json.data || json;
  // eslint-disable-next-line no-console
  console.log(`Done: ${data.inserted} inserted, ${data.skippedDuplicates} duplicates skipped`);
  if (data.unresolvedCategories) {
    // eslint-disable-next-line no-console
    console.log('Unresolved categories:', data.unresolvedCategories);
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
