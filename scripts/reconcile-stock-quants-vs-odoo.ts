/** Report FibreFlow stock_quants vs live Odoo drift. Run: npx tsx scripts/reconcile-stock-quants-vs-odoo.ts */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// CLI output goes to stdout/stderr directly: @/lib/logger is silent under Node/tsx,
// and console.* is banned by the lint gate.
const out = (s = '') => process.stdout.write(s + '\n');
const err = (s = '') => process.stderr.write(s + '\n');

function cfg(k: string): string { const v = process.env[k]; if (!v) { err(`Missing env ${k}`); process.exit(1); } return v; }

async function main() {
  const { OdooClient } = await import('../src/services/odoo/odooClient');
  const { reconcileStockQuantsVsOdoo } = await import('../src/services/odoo/entities/stockQuantReconcile');

  const client = new OdooClient({ url: cfg('ODOO_URL'), db: cfg('ODOO_DB'), username: cfg('ODOO_USERNAME'), password: cfg('ODOO_PASSWORD') });
  const conn = await client.testConnection();
  if (!conn.success) { err(`Odoo connect failed: ${conn.message}`); process.exit(1); }

  const r = await reconcileStockQuantsVsOdoo(client);
  out(`\nMatches: ${r.matches}  | Drift rows: ${r.drift.length}`);
  out('Top 30 drift (delta = FF - Odoo):');
  r.drift.slice(0, 30).forEach((d) => out(`  ${d.name}: FF ${Math.round(d.ffQty)} vs Odoo ${Math.round(d.odooQty)} (Δ ${Math.round(d.delta)})`));
}
// process.exit(0) is required: db-pool's pg.Pool keeps the event loop alive otherwise.
main().then(() => process.exit(0)).catch((e) => { err(`Reconcile failed: ${e.message}`); process.exit(1); });
