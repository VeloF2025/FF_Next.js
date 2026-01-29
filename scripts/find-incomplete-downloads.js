#!/usr/bin/env node
const { Pool } = require('pg');
const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Get all DRs from our DB
  const dbDrs = await pool.query(`
    SELECT drop_number, photo_count
    FROM dr_photo_unified_reviews
    WHERE photo_count > 0
    ORDER BY RANDOM()
    LIMIT 200
  `);

  console.log(`Checking ${dbDrs.rows.length} DRs for incomplete downloads...`);
  console.log('');

  const incomplete = [];
  let checked = 0;

  for (const row of dbDrs.rows) {
    try {
      const r = await fetch(`http://100.96.203.105:8003/api/record/${row.drop_number}`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) continue;

      const data = await r.json();
      const cloudCount = Object.keys(data.photos || {}).length;
      const localCount = (data.local_photos || []).length;
      const dbCount = parseInt(row.photo_count);

      // Incomplete if cloud has more than local OR cloud has more than DB
      if (cloudCount > localCount || cloudCount > dbCount) {
        incomplete.push({
          dr: row.drop_number,
          cloud: cloudCount,
          local: localCount,
          db: dbCount,
          missing: cloudCount - localCount
        });
      }

      checked++;
      if (checked % 50 === 0) {
        process.stderr.write(`\rChecked ${checked}/${dbDrs.rows.length}...`);
      }
    } catch (e) {
      // Skip timeouts
    }
  }

  console.log(`\n\nFound ${incomplete.length} DRs with incomplete downloads:`);
  console.log('DR              | Cloud | Local | DB  | Missing');
  console.log('-'.repeat(55));

  incomplete.sort((a, b) => b.missing - a.missing);
  for (const item of incomplete) {
    console.log(`${item.dr.padEnd(16)}| ${String(item.cloud).padEnd(6)}| ${String(item.local).padEnd(6)}| ${String(item.db).padEnd(4)}| ${item.missing}`);
  }

  const totalMissing = incomplete.reduce((sum, i) => sum + i.missing, 0);
  console.log(`\nTotal: ${incomplete.length} DRs with ${totalMissing} missing photos`);

  await pool.end();
}

main().catch(console.error);
