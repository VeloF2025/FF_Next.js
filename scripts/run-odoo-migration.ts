/**
 * Run Odoo schema alignment migration
 * Applies migration 081 to align FF schema with Odoo data requirements
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('            ODOO SCHEMA ALIGNMENT MIGRATION (081)               ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // 1. Make supplier email nullable (critical - all Odoo suppliers have missing emails)
    console.log('1. Making supplier email nullable...');
    await sql`ALTER TABLE suppliers ALTER COLUMN email DROP NOT NULL`;
    console.log('   ✓ Done\n');

    // 2. Create fleet_service_logs table
    console.log('2. Creating fleet_service_logs table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_service_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        odoo_service_id INTEGER UNIQUE,
        service_date DATE NOT NULL,
        service_type TEXT NOT NULL,
        category TEXT,
        amount DECIMAL(12, 2) DEFAULT 0,
        currency TEXT DEFAULT 'ZAR',
        odometer_value DECIMAL(12, 2),
        odometer_unit TEXT DEFAULT 'kilometers',
        description TEXT,
        vendor_name TEXT,
        project_code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        synced_at TIMESTAMP
      )
    `;
    console.log('   ✓ Done\n');

    // 3. Create fleet_odometer_history table
    console.log('3. Creating fleet_odometer_history table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_odometer_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        odoo_odometer_id INTEGER UNIQUE,
        reading_date DATE NOT NULL,
        value DECIMAL(12, 2) NOT NULL,
        unit TEXT DEFAULT 'kilometers',
        source TEXT DEFAULT 'manual',
        service_log_id UUID REFERENCES fleet_service_logs(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        synced_at TIMESTAMP
      )
    `;
    console.log('   ✓ Done\n');

    // 4. Create indexes
    console.log('4. Creating indexes on new tables...');
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_service_logs_vehicle ON fleet_service_logs(vehicle_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_service_logs_date ON fleet_service_logs(service_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_service_logs_type ON fleet_service_logs(service_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_odometer_vehicle ON fleet_odometer_history(vehicle_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fleet_odometer_date ON fleet_odometer_history(reading_date)`;
    console.log('   ✓ Done\n');

    // 5. Add odometer columns to fleet_vehicles
    console.log('5. Adding odometer tracking columns to fleet_vehicles...');
    const fleetCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'fleet_vehicles' AND column_name = 'current_odometer'
    `;
    if (fleetCols.length === 0) {
      await sql`ALTER TABLE fleet_vehicles ADD COLUMN current_odometer DECIMAL(12, 2)`;
      await sql`ALTER TABLE fleet_vehicles ADD COLUMN odometer_unit TEXT DEFAULT 'kilometers'`;
      await sql`ALTER TABLE fleet_vehicles ADD COLUMN last_odometer_update TIMESTAMP`;
      console.log('   ✓ Added current_odometer, odometer_unit, last_odometer_update\n');
    } else {
      console.log('   (columns already exist, skipping)\n');
    }

    // 6. Add warehouse mapping columns to projects
    console.log('6. Adding warehouse mapping columns to projects...');
    const projCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'projects' AND column_name = 'odoo_warehouse_code'
    `;
    if (projCols.length === 0) {
      await sql`ALTER TABLE projects ADD COLUMN odoo_warehouse_code TEXT`;
      await sql`ALTER TABLE projects ADD COLUMN odoo_warehouse_id INTEGER`;
      console.log('   ✓ Added odoo_warehouse_code, odoo_warehouse_id\n');
    } else {
      console.log('   (columns already exist, skipping)\n');
    }

    // 7. Add Odoo-related columns to suppliers
    console.log('7. Adding Odoo-related columns to suppliers...');
    const suppCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'suppliers' AND column_name = 'province'
    `;
    if (suppCols.length === 0) {
      await sql`ALTER TABLE suppliers ADD COLUMN province TEXT`;
      await sql`ALTER TABLE suppliers ADD COLUMN supplier_rank INTEGER DEFAULT 0`;
      await sql`ALTER TABLE suppliers ADD COLUMN reference_code TEXT`;
      console.log('   ✓ Added province, supplier_rank, reference_code\n');
    } else {
      console.log('   (columns already exist, skipping)\n');
    }

    // 8. Add odoo_line_id to purchase_order_items
    console.log('8. Adding odoo_line_id to purchase_order_items...');
    const poiCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'purchase_order_items' AND column_name = 'odoo_line_id'
    `;
    if (poiCols.length === 0) {
      await sql`ALTER TABLE purchase_order_items ADD COLUMN odoo_line_id INTEGER`;
      console.log('   ✓ Added odoo_line_id\n');
    } else {
      console.log('   (column already exists, skipping)\n');
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           ✅ MIGRATION COMPLETED SUCCESSFULLY!                 ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Verify the changes
    console.log('Verifying changes:');
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('fleet_service_logs', 'fleet_odometer_history')
    `;
    console.log(`  New tables created: ${tables.map((t: { table_name: string }) => t.table_name).join(', ')}`);

    const emailNullable = await sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'suppliers' AND column_name = 'email'
    `;
    console.log(`  suppliers.email nullable: ${emailNullable[0]?.is_nullable === 'YES' ? '✓ YES' : '✗ NO'}`);

  } catch (err) {
    const error = err as Error;
    console.error('\n❌ Migration error:', error.message);
    process.exit(1);
  }
}

run();
