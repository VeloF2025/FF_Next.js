/** Seed stock_quants from live Odoo. Run: npx tsx scripts/seed-stock-quants-from-odoo.ts [--commit] */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

function cfg(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
}

async function main() {
  const commit = process.argv.includes('--commit');
  console.log(`\n=== ODOO -> stock_quants SEED — ${commit ? 'COMMIT' : 'DRY RUN'} ===\n`);

  // Dynamic imports AFTER dotenv so db-pool binds the loaded DATABASE_URL.
  const { OdooClient } = await import('../src/services/odoo/odooClient');
  const { seedStockQuantsFromOdoo } = await import('../src/services/odoo/entities/stockQuantSeed');

  const client = new OdooClient({
    url: cfg('ODOO_URL'), db: cfg('ODOO_DB'),
    username: cfg('ODOO_USERNAME'), password: cfg('ODOO_PASSWORD'),
  });
  const conn = await client.testConnection();
  if (!conn.success) { console.error('Odoo connect failed:', conn.message); process.exit(1); }

  const res = await seedStockQuantsFromOdoo(client, { dryRun: !commit });

  const { query } = await import('../src/lib/db-pool');
  const locRows = await query<{ id: string; code: string }>('SELECT id, code FROM stock_locations');
  const codeById = new Map(locRows.map((r) => [String(r.id), r.code]));

  const byLoc = res.rows.reduce<Record<string, number>>((a, r) => {
    a[r.locationId] = (a[r.locationId] || 0) + r.quantity; return a;
  }, {});
  console.log(`Seed rows: ${res.rows.length}  | total qty: ${Math.round(res.rows.reduce((s, r) => s + r.quantity, 0))}`);
  console.log('By location:');
  Object.entries(byLoc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${codeById.get(k) ?? k} = ${Math.round(v)}`));
  if (res.gaps.length) {
    console.log(`\nGAPS (${res.gaps.length}) — NOT seeded:`);
    res.gaps.forEach((g) => console.log(`  [${g.kind}] ${g.name} (odoo ${g.odooId}) qty ${g.quantity}`));
  }
  console.log(commit ? `\nCOMMITTED ${res.committed} quant rows.` : '\nDRY RUN — nothing written.');
}
main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
