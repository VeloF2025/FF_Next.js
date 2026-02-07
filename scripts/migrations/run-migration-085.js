/**
 * Run Migration 085: Purchase Order History
 *
 * Usage: node scripts/migrations/run-migration-085.js
 *
 * Creates the missing purchase_order_history table required by the
 * PO status update workflow.
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  console.log('Starting Migration 085: Purchase Order History');
  console.log('='.repeat(60));

  const sql = neon(DATABASE_URL);

  try {
    // 1. Check if table already exists
    console.log('\n1. Checking if purchase_order_history exists...');
    const existingTable = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name = 'purchase_order_history'
    `;

    if (existingTable.length > 0) {
      console.log('   ✅ Table already exists - migration skipped');
      return;
    }

    // 2. Create purchase_order_history table
    console.log('\n2. Creating purchase_order_history table...');
    await sql`
      CREATE TABLE IF NOT EXISTS purchase_order_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        notes TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('   ✅ Table created');

    // 3. Create indexes
    console.log('\n3. Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_poh_po ON purchase_order_history(purchase_order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_poh_action ON purchase_order_history(action)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_poh_created_at ON purchase_order_history(created_at)`;
    console.log('   ✅ Indexes created');

    // 4. Verify migration
    console.log('\n4. Verifying migration...');
    const columns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'purchase_order_history'
    `;
    console.log(`   - purchase_order_history columns: ${columns.length} ✅`);
    console.log(`   - Columns: ${columns.map(c => c.column_name).join(', ')}`);

    console.log('\n' + '='.repeat(60));
    console.log('Migration 085 COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    throw error;
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
