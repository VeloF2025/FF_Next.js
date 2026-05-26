/** Report FibreFlow stock_quants vs live Odoo drift. Run: npx tsx scripts/reconcile-stock-quants-vs-odoo.ts */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

function cfg(k: string): string { const v = process.env[k]; if (!v) { console.error(`Missing env ${k}`); process.exit(1); } return v; }

async function main() {
  const { OdooClient } = await import('../src/services/odoo/odooClient');
  const { reconcileStockQuantsVsOdoo } = await import('../src/services/odoo/entities/stockQuantReconcile');

  const client = new OdooClient({ url: cfg('ODOO_URL'), db: cfg('ODOO_DB'), username: cfg('ODOO_USERNAME'), password: cfg('ODOO_PASSWORD') });
  const conn = await client.testConnection();
  if (!conn.success) { console.error('Odoo connect failed:', conn.message); process.exit(1); }

  const r = await reconcileStockQuantsVsOdoo(client);
  console.log(`\nMatches: ${r.matches}  | Drift rows: ${r.drift.length}`);
  console.log('Top 30 drift (delta = FF - Odoo):');
  r.drift.slice(0, 30).forEach((d) => console.log(`  ${d.name}: FF ${Math.round(d.ffQty)} vs Odoo ${Math.round(d.odooQty)} (Δ ${Math.round(d.delta)})`));
}
main().catch((e) => { console.error('Reconcile failed:', e.message); process.exit(1); });
