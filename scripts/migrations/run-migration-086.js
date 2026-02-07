/**
 * Run Migration 086: RFQ Improvements
 * - Creates rfq_suppliers junction table
 * - Adds stock_item_id to rfq_items and boq_items
 * - Migrates existing invited_suppliers JSON array to junction table
 *
 * Usage: node scripts/migrations/run-migration-086.js
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  console.log('Starting Migration 086: RFQ Improvements');
  console.log('='.repeat(70));

  const sql = neon(DATABASE_URL);

  try {
    // 1. Create rfq_suppliers junction table
    console.log('\n1. Creating rfq_suppliers junction table...');
    await sql`
      CREATE TABLE IF NOT EXISTS rfq_suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        viewed_at TIMESTAMP WITH TIME ZONE,
        responded_at TIMESTAMP WITH TIME ZONE,
        status VARCHAR(50) DEFAULT 'invited',
        invitation_sent BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(rfq_id, supplier_id)
      )
    `;
    console.log('   ✅ rfq_suppliers table created');

    // 2. Create indexes
    console.log('\n2. Creating rfq_suppliers indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_rfq_id ON rfq_suppliers(rfq_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_supplier_id ON rfq_suppliers(supplier_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_status ON rfq_suppliers(status)`;
    console.log('   ✅ Indexes created');

    // 3. Add stock_item_id to rfq_items
    console.log('\n3. Adding stock_item_id to rfq_items...');
    await sql`ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id)`;
    await sql`ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS boq_item_id UUID REFERENCES boq_items(id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rfq_items_stock_item_id ON rfq_items(stock_item_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rfq_items_boq_item_id ON rfq_items(boq_item_id)`;
    console.log('   ✅ stock_item_id and boq_item_id columns added to rfq_items');

    // 4. Add stock_item_id to boq_items
    console.log('\n4. Adding stock_item_id to boq_items...');
    await sql`ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_boq_items_stock_item_id ON boq_items(stock_item_id)`;
    console.log('   ✅ stock_item_id column added to boq_items');

    // 5. Migrate existing invited_suppliers JSON to junction table
    console.log('\n5. Migrating invited_suppliers JSON to junction table...');
    const rfqsWithSuppliers = await sql`
      SELECT id, invited_suppliers
      FROM rfqs
      WHERE invited_suppliers IS NOT NULL
        AND invited_suppliers::text != '[]'
        AND invited_suppliers::text != 'null'
    `;

    let migratedCount = 0;
    for (const rfq of rfqsWithSuppliers) {
      if (rfq.invited_suppliers && Array.isArray(rfq.invited_suppliers)) {
        for (const supplierId of rfq.invited_suppliers) {
          if (supplierId && !isNaN(parseInt(supplierId))) {
            try {
              await sql`
                INSERT INTO rfq_suppliers (rfq_id, supplier_id, status)
                VALUES (${rfq.id}, ${parseInt(supplierId)}, 'invited')
                ON CONFLICT (rfq_id, supplier_id) DO NOTHING
              `;
              migratedCount++;
            } catch (e) {
              // Supplier might not exist, skip
            }
          }
        }
      }
    }
    console.log(`   ✅ Migrated ${migratedCount} supplier relationships`);

    // 6. Add rfq_supplier_id to rfq_responses
    console.log('\n6. Linking rfq_responses to rfq_suppliers...');
    await sql`ALTER TABLE rfq_responses ADD COLUMN IF NOT EXISTS rfq_supplier_id UUID REFERENCES rfq_suppliers(id)`;

    // Update existing responses
    await sql`
      UPDATE rfq_responses rr
      SET rfq_supplier_id = rs.id
      FROM rfq_suppliers rs
      WHERE rr.rfq_id = rs.rfq_id
        AND rr.supplier_id::text = rs.supplier_id::text
        AND rr.rfq_supplier_id IS NULL
    `;
    console.log('   ✅ rfq_responses linked to rfq_suppliers');

    // 7. Create helper view
    console.log('\n7. Creating rfq_with_suppliers view...');
    await sql`
      CREATE OR REPLACE VIEW rfq_with_suppliers AS
      SELECT
        r.id,
        r.rfq_number,
        r.project_id,
        r.title,
        r.status,
        r.response_deadline,
        r.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', rs.id,
              'supplierId', rs.supplier_id,
              'supplierName', s.name,
              'status', rs.status,
              'invitedAt', rs.invited_at,
              'respondedAt', rs.responded_at
            )
          ) FILTER (WHERE rs.id IS NOT NULL),
          '[]'::json
        ) as suppliers,
        COUNT(rs.id) as supplier_count
      FROM rfqs r
      LEFT JOIN rfq_suppliers rs ON r.id = rs.rfq_id
      LEFT JOIN suppliers s ON rs.supplier_id = s.id
      GROUP BY r.id
    `;
    console.log('   ✅ View created');

    // 8. Verify migration
    console.log('\n8. Verifying migration...');

    const tableExists = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'rfq_suppliers'
      ) as exists
    `;
    console.log(`   - rfq_suppliers table: ${tableExists[0].exists ? '✅' : '❌'}`);

    const rfqItemsColumn = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rfq_items' AND column_name = 'stock_item_id'
      ) as exists
    `;
    console.log(`   - rfq_items.stock_item_id: ${rfqItemsColumn[0].exists ? '✅' : '❌'}`);

    const boqItemsColumn = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boq_items' AND column_name = 'stock_item_id'
      ) as exists
    `;
    console.log(`   - boq_items.stock_item_id: ${boqItemsColumn[0].exists ? '✅' : '❌'}`);

    const supplierCount = await sql`SELECT COUNT(*) as count FROM rfq_suppliers`;
    console.log(`   - rfq_suppliers records: ${supplierCount[0].count}`);

    console.log('\n' + '='.repeat(70));
    console.log('Migration 086 COMPLETE - RFQ Improvements ready');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    throw error;
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
