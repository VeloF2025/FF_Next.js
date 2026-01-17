/**
 * Add missing Odoo columns to suppliers table
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log('Adding missing Odoo columns to suppliers table...\n');

  // Check what columns exist
  const existingCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'suppliers'
  `;
  const colNames = existingCols.map((c) => c.column_name);
  console.log('Existing columns:', colNames.join(', '));

  // Add odoo_partner_id if missing
  if (!colNames.includes('odoo_partner_id')) {
    console.log('\nAdding odoo_partner_id...');
    await sql`ALTER TABLE suppliers ADD COLUMN odoo_partner_id INTEGER`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_odoo_partner ON suppliers(odoo_partner_id) WHERE odoo_partner_id IS NOT NULL`;
    console.log('  Done');
  }

  // Add province if missing
  if (!colNames.includes('province')) {
    console.log('Adding province...');
    await sql`ALTER TABLE suppliers ADD COLUMN province TEXT`;
    console.log('  Done');
  }

  // Add supplier_rank if missing
  if (!colNames.includes('supplier_rank')) {
    console.log('Adding supplier_rank...');
    await sql`ALTER TABLE suppliers ADD COLUMN supplier_rank INTEGER DEFAULT 0`;
    console.log('  Done');
  }

  // Add reference_code if missing
  if (!colNames.includes('reference_code')) {
    console.log('Adding reference_code...');
    await sql`ALTER TABLE suppliers ADD COLUMN reference_code TEXT`;
    console.log('  Done');
  }

  console.log('\nAll columns added successfully!');

  // Verify
  const finalCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'suppliers'
    ORDER BY ordinal_position
  `;
  console.log('\nFinal columns:', finalCols.map((c) => c.column_name).join(', '));
}

run().catch(console.error);
