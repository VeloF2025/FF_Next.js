import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function addColumn() {
  console.log('Adding odoo_po_id column to purchase_orders...');

  await sql`
    ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS odoo_po_id INTEGER UNIQUE
  `;
  console.log('  ✓ odoo_po_id column added');

  // Create index for faster lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_odoo_po_id
    ON purchase_orders(odoo_po_id)
    WHERE odoo_po_id IS NOT NULL
  `;
  console.log('  ✓ Index created');

  console.log('\nDone!');
}

addColumn().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
