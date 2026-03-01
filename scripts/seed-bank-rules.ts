/**
 * Seed Bank Categorisation Rules from Category Map spreadsheet data
 *
 * Usage:
 *   npx ts-node scripts/seed-bank-rules.ts <json-file>
 *
 * The JSON file should be an array of objects with:
 *   { "originalCategory": "...", "standardCategory": "...", "glCode": 5680 }
 *
 * Alternatively, pipe JSON via stdin:
 *   cat category-map.json | npx ts-node scripts/seed-bank-rules.ts
 */

import * as fs from 'fs';

const API_BASE = process.env.API_BASE || 'http://localhost:3004';

async function main() {
  let jsonData: string;

  const filePath = process.argv[2];
  if (filePath) {
    jsonData = fs.readFileSync(filePath, 'utf-8');
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    jsonData = Buffer.concat(chunks).toString('utf-8');
  }

  const entries = JSON.parse(jsonData);
  if (!Array.isArray(entries)) {
    // eslint-disable-next-line no-console
    console.error('Expected a JSON array of category map entries');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`Sending ${entries.length} category map entries to seed API...`);

  const res = await fetch(`${API_BASE}/api/accounting/bank-rules-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });

  const json = await res.json();
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', json.message || json.error);
    process.exit(1);
  }

  const data = json.data || json;
  // eslint-disable-next-line no-console
  console.log(`Done: ${data.created} rules created, ${data.skipped} skipped`);
  if (data.missingGlCodes) {
    // eslint-disable-next-line no-console
    console.log('Missing GL codes:', data.missingGlCodes);
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});
