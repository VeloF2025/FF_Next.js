/**
 * Run Migration 049: Purchase Requisitions
 *
 * Usage: node scripts/migrations/run-migration-049.js
 *
 * This migration creates the proper schema for purchase requisitions
 * with auto-generated requisition numbers.
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  console.log('Starting Migration 049: Purchase Requisitions');
  console.log('='.repeat(60));

  const sql = neon(DATABASE_URL);

  try {
    // Check if table already exists with correct schema
    console.log('\n1. Checking existing schema...');
    const existingTable = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'purchase_requisitions'
    `;

    const hasRequisitionNumber = existingTable.some(c => c.column_name === 'requisition_number');
    const hasPrNumber = existingTable.some(c => c.column_name === 'pr_number');

    if (existingTable.length > 0) {
      if (hasRequisitionNumber) {
        console.log('   ✅ Table exists with correct schema (requisition_number)');
      } else if (hasPrNumber) {
        console.log('   ⚠️  Table exists with legacy schema (pr_number)');
        console.log('   Renaming column pr_number -> requisition_number...');
        await sql`ALTER TABLE purchase_requisitions RENAME COLUMN pr_number TO requisition_number`;
        console.log('   ✅ Column renamed');
      }
    } else {
      console.log('   Creating new purchase_requisitions table...');
    }

    // 2. Create or ensure purchase_requisitions table
    console.log('\n2. Ensuring purchase_requisitions table...');
    await sql`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requisition_number VARCHAR(50) UNIQUE,

        project_id UUID REFERENCES projects(id),
        department VARCHAR(100),

        requested_by VARCHAR(255) NOT NULL DEFAULT 'system',
        requested_by_name VARCHAR(255),
        requested_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        required_date DATE,

        status VARCHAR(30) DEFAULT 'draft',
        approved_by VARCHAR(255),
        approved_at TIMESTAMP WITH TIME ZONE,
        rejection_reason TEXT,

        estimated_total DECIMAL(14,2),
        currency VARCHAR(3) DEFAULT 'ZAR',

        urgency VARCHAR(20) DEFAULT 'normal',
        notes TEXT,

        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('   ✅ purchase_requisitions table ready');

    // 3. Add missing columns if they don't exist
    console.log('\n3. Adding any missing columns...');
    await sql`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS requested_by_name VARCHAR(255)`;
    await sql`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS urgency VARCHAR(20) DEFAULT 'normal'`;
    await sql`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS estimated_total DECIMAL(14,2)`;
    await sql`ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'ZAR'`;
    console.log('   ✅ Columns verified');

    // 4. Check purchase_requisition_items table
    console.log('\n4. Checking purchase_requisition_items table...');
    const itemsTable = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'purchase_requisition_items'
    `;

    const legacyItemsTable = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'requisition_items'
    `;

    if (itemsTable.length > 0) {
      console.log('   ✅ purchase_requisition_items table exists');
    } else if (legacyItemsTable.length > 0) {
      console.log('   ⚠️  Legacy requisition_items table found');
      console.log('   Renaming table requisition_items -> purchase_requisition_items...');
      await sql`ALTER TABLE requisition_items RENAME TO purchase_requisition_items`;

      // Also rename pr_id -> requisition_id if it exists
      const hasPrId = legacyItemsTable.some(c => c.column_name === 'pr_id');
      if (hasPrId) {
        console.log('   Renaming column pr_id -> requisition_id...');
        await sql`ALTER TABLE purchase_requisition_items RENAME COLUMN pr_id TO requisition_id`;
      }
      console.log('   ✅ Table renamed');
    } else {
      console.log('   Creating purchase_requisition_items table...');
    }

    // 5. Create or ensure purchase_requisition_items table
    console.log('\n5. Ensuring purchase_requisition_items table...');
    await sql`
      CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requisition_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,

        stock_item_id UUID,
        item_code VARCHAR(100),
        item_description TEXT NOT NULL,

        quantity DECIMAL(12,3) NOT NULL,
        uom VARCHAR(20) NOT NULL,
        estimated_unit_price DECIMAL(12,2),
        estimated_total DECIMAL(14,2),

        suggested_supplier_id INTEGER,
        notes TEXT,

        converted_to_rfq BOOLEAN DEFAULT false,
        converted_to_po BOOLEAN DEFAULT false,
        rfq_id UUID,
        po_id UUID,

        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('   ✅ purchase_requisition_items table ready');

    // 6. Add missing columns to items table
    console.log('\n6. Adding any missing columns to items table...');
    await sql`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS item_description TEXT`;
    await sql`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS uom VARCHAR(20)`;
    await sql`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS estimated_unit_price DECIMAL(12,2)`;
    await sql`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS estimated_total DECIMAL(14,2)`;
    await sql`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS converted_to_rfq BOOLEAN DEFAULT false`;
    await sql`ALTER TABLE purchase_requisition_items ADD COLUMN IF NOT EXISTS converted_to_po BOOLEAN DEFAULT false`;
    console.log('   ✅ Item columns verified');

    // 7. Create indexes
    console.log('\n7. Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requisitions(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pr_project ON purchase_requisitions(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pr_requested_by ON purchase_requisitions(requested_by)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pr_urgency ON purchase_requisitions(urgency)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pri_requisition ON purchase_requisition_items(requisition_id)`;
    console.log('   ✅ Indexes created');

    // 8. Create trigger function for auto-generating requisition number
    console.log('\n8. Creating requisition number trigger...');
    await sql`
      CREATE OR REPLACE FUNCTION generate_pr_number()
      RETURNS TRIGGER AS $$
      DECLARE
          year_suffix VARCHAR(2);
          next_num INTEGER;
      BEGIN
          IF NEW.requisition_number IS NULL OR NEW.requisition_number = '' THEN
              year_suffix := TO_CHAR(NOW(), 'YY');

              SELECT COALESCE(MAX(
                  CAST(NULLIF(SUBSTRING(requisition_number FROM 5), '') AS INTEGER)
              ), 0) + 1 INTO next_num
              FROM purchase_requisitions
              WHERE requisition_number LIKE 'PR' || year_suffix || '-%';

              NEW.requisition_number := 'PR' || year_suffix || '-' || LPAD(next_num::TEXT, 5, '0');
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    await sql`DROP TRIGGER IF EXISTS tr_pr_number ON purchase_requisitions`;
    await sql`
      CREATE TRIGGER tr_pr_number
          BEFORE INSERT ON purchase_requisitions
          FOR EACH ROW
          EXECUTE FUNCTION generate_pr_number()
    `;
    console.log('   ✅ Requisition number trigger created');

    // 9. Create updated_at trigger
    console.log('\n9. Creating updated_at trigger...');
    await sql`
      CREATE OR REPLACE FUNCTION update_pr_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    await sql`DROP TRIGGER IF EXISTS tr_pr_updated_at ON purchase_requisitions`;
    await sql`
      CREATE TRIGGER tr_pr_updated_at
          BEFORE UPDATE ON purchase_requisitions
          FOR EACH ROW
          EXECUTE FUNCTION update_pr_updated_at()
    `;
    console.log('   ✅ Updated_at trigger created');

    // 10. Create estimated total trigger
    console.log('\n10. Creating estimated total trigger...');
    await sql`
      CREATE OR REPLACE FUNCTION update_pr_estimated_total()
      RETURNS TRIGGER AS $$
      BEGIN
          UPDATE purchase_requisitions
          SET estimated_total = (
              SELECT COALESCE(SUM(estimated_total), 0)
              FROM purchase_requisition_items
              WHERE requisition_id = COALESCE(NEW.requisition_id, OLD.requisition_id)
          )
          WHERE id = COALESCE(NEW.requisition_id, OLD.requisition_id);

          RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `;

    await sql`DROP TRIGGER IF EXISTS tr_pri_total ON purchase_requisition_items`;
    await sql`
      CREATE TRIGGER tr_pri_total
          AFTER INSERT OR UPDATE OR DELETE ON purchase_requisition_items
          FOR EACH ROW
          EXECUTE FUNCTION update_pr_estimated_total()
    `;
    console.log('   ✅ Estimated total trigger created');

    // 11. Verify migration
    console.log('\n11. Verifying migration...');

    const prColumns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'purchase_requisitions'
      AND column_name IN ('requisition_number', 'urgency', 'estimated_total', 'requested_by_name')
    `;
    console.log(`   - purchase_requisitions columns: ${prColumns.length}/4 ✅`);

    const priColumns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'purchase_requisition_items'
      AND column_name IN ('requisition_id', 'item_description', 'uom', 'estimated_total')
    `;
    console.log(`   - purchase_requisition_items columns: ${priColumns.length}/4 ✅`);

    const triggers = await sql`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_table IN ('purchase_requisitions', 'purchase_requisition_items')
    `;
    console.log(`   - Triggers: ${triggers.length} created ✅`);

    console.log('\n' + '='.repeat(60));
    console.log('Migration 049 COMPLETE');
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
