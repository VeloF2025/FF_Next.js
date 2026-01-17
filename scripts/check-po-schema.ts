import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'purchase_orders'
    ORDER BY ordinal_position
  `;
  console.log('purchase_orders columns:');
  for (const c of cols) {
    const nullable = c.is_nullable === 'YES' ? '' : ' (required)';
    console.log('  -', c.column_name + ':', c.data_type + nullable);
  }

  // Also check purchase_order_items
  const itemCols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'purchase_order_items'
    ORDER BY ordinal_position
  `;
  console.log('\npurchase_order_items columns:');
  for (const c of itemCols) {
    const nullable = c.is_nullable === 'YES' ? '' : ' (required)';
    console.log('  -', c.column_name + ':', c.data_type + nullable);
  }
}
check();
