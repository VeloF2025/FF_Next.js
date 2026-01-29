#!/usr/bin/env node
const { Pool } = require('pg');
const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';
const p = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const low = await p.query(`
    SELECT drop_number, photo_count
    FROM dr_photo_unified_reviews
    WHERE photo_count BETWEEN 1 AND 3
      AND created_at >= '2026-01-01'
    ORDER BY RANDOM()
    LIMIT 50
  `);

  console.log('DR              | DB | 1Map | Local | Mismatch?');
  console.log('-'.repeat(60));

  let mismatches = 0;
  for (const row of low.rows) {
    try {
      const r = await fetch(`http://100.96.203.105:8003/api/record/${row.drop_number}`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) {
        console.log(`${row.drop_number.padEnd(16)}| ${row.photo_count}  | ERR  | -     | ?`);
        continue;
      }
      const data = await r.json();
      const cloudCount = data.photo_count || 0;
      const localCount = (data.local_photos || []).length;
      const mismatch = cloudCount > parseInt(row.photo_count) ? 'YES' : 'no';
      if (cloudCount > parseInt(row.photo_count)) mismatches++;
      console.log(`${row.drop_number.padEnd(16)}| ${String(row.photo_count).padEnd(3)}| ${String(cloudCount).padEnd(5)}| ${String(localCount).padEnd(6)}| ${mismatch}`);
    } catch (e) {
      console.log(`${row.drop_number.padEnd(16)}| ${row.photo_count}  | TIMEOUT`);
    }
  }
  console.log(`\nMismatches: ${mismatches}/20`);
  await p.end();
}
main().catch(console.error);
