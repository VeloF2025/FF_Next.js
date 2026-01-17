import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  // Count all suppliers
  const total = await sql`SELECT COUNT(*) as count FROM suppliers`;
  console.log('Total suppliers:', total[0].count);

  // Count Odoo-synced vs others
  const odooCount = await sql`SELECT COUNT(*) as count FROM suppliers WHERE odoo_partner_id IS NOT NULL`;
  const nonOdooCount = await sql`SELECT COUNT(*) as count FROM suppliers WHERE odoo_partner_id IS NULL`;
  console.log('Odoo-synced:', odooCount[0].count);
  console.log('Non-Odoo (existing/seed):', nonOdooCount[0].count);

  // Show all suppliers
  console.log('\n--- ALL SUPPLIERS ---');
  const all = await sql`
    SELECT id, code, name, odoo_partner_id, created_by, created_at 
    FROM suppliers 
    ORDER BY created_at DESC
  `;
  for (const s of all) {
    const source = s.odoo_partner_id ? `Odoo ID: ${s.odoo_partner_id}` : 'Seed/Manual';
    console.log(`  [${s.code}] ${s.name} - ${source} (by: ${s.created_by})`);
  }
}
check();
