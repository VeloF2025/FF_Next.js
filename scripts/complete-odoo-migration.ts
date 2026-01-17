/**
 * Complete remaining Odoo migration steps
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        COMPLETING ODOO SCHEMA ALIGNMENT MIGRATION              ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // 1. Add Odoo columns to existing fleet_odometer_history table
    console.log('1. Adding Odoo columns to fleet_odometer_history...');
    const odooCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'fleet_odometer_history' AND column_name = 'odoo_odometer_id'
    `;
    if (odooCols.length === 0) {
      await sql`ALTER TABLE fleet_odometer_history ADD COLUMN odoo_odometer_id INTEGER`;
      await sql`ALTER TABLE fleet_odometer_history ADD COLUMN reading_date DATE`;
      await sql`ALTER TABLE fleet_odometer_history ADD COLUMN value DECIMAL(12, 2)`;
      await sql`ALTER TABLE fleet_odometer_history ADD COLUMN unit TEXT DEFAULT 'kilometers'`;
      await sql`ALTER TABLE fleet_odometer_history ADD COLUMN synced_at TIMESTAMP`;
      console.log('   ✓ Added odoo_odometer_id, reading_date, value, unit, synced_at\n');
    } else {
      console.log('   (columns already exist, skipping)\n');
    }

    // 2. Create index on reading_date
    console.log('2. Creating index on reading_date...');
    const idxExists = await sql`
      SELECT indexname FROM pg_indexes
      WHERE indexname = 'idx_fleet_odometer_date'
    `;
    if (idxExists.length === 0) {
      await sql`CREATE INDEX IF NOT EXISTS idx_fleet_odometer_date ON fleet_odometer_history(reading_date)`;
      console.log('   ✓ Created idx_fleet_odometer_date\n');
    } else {
      console.log('   (index already exists, skipping)\n');
    }

    // 3. Add odometer columns to fleet_vehicles
    console.log('3. Adding odometer columns to fleet_vehicles...');
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

    // 4. Add warehouse mapping columns to projects
    console.log('4. Adding warehouse mapping columns to projects...');
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

    // 5. Add Odoo columns to suppliers
    console.log('5. Adding Odoo-related columns to suppliers...');
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

    // 6. Add odoo_line_id to purchase_order_items
    console.log('6. Adding odoo_line_id to purchase_order_items...');
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

    // 7. Update warehouse mappings for existing projects
    console.log('7. Mapping Odoo warehouses to projects...');
    const warehouseMappings = [
      { code: 'Law', name: 'Lawley' },
      { code: 'Moh', name: 'Mohadin' },
      { code: 'IP', name: 'Ivory Park' },
      { code: 'MamP1', name: 'Mamelodi' },
      { code: 'GR', name: 'Grabouw' },
      { code: 'ETW', name: 'Etwatwa' },
      { code: 'Tem1', name: 'Tembisa' },
      { code: 'Tem2', name: 'Tembisa' },
      { code: 'Tem3', name: 'Tembisa' },
      { code: 'TBL', name: 'Tembelihle' },
    ];
    let mapped = 0;
    for (const wh of warehouseMappings) {
      const result = await sql`
        UPDATE projects
        SET odoo_warehouse_code = ${wh.code}
        WHERE name ILIKE ${`%${wh.name}%`}
        AND odoo_warehouse_code IS NULL
        RETURNING name
      `;
      if (result.length > 0) {
        mapped++;
        console.log(`   ✓ Mapped ${result[0].name} to ${wh.code}`);
      }
    }
    if (mapped === 0) {
      console.log('   (no new mappings needed or no matching projects)\n');
    } else {
      console.log(`   ✓ Mapped ${mapped} projects\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           ✅ MIGRATION COMPLETED SUCCESSFULLY!                 ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Final verification
    console.log('Final verification:');

    const newCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'fleet_odometer_history' AND column_name = 'odoo_odometer_id'
    `;
    console.log(`  fleet_odometer_history.odoo_odometer_id: ${newCols.length > 0 ? '✓' : '✗'}`);

    const projCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'projects' AND column_name = 'odoo_warehouse_code'
    `;
    console.log(`  projects.odoo_warehouse_code: ${projCheck.length > 0 ? '✓' : '✗'}`);

    const suppCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'suppliers' AND column_name IN ('province', 'supplier_rank', 'reference_code')
    `;
    console.log(`  suppliers Odoo columns: ${suppCheck.length === 3 ? '✓' : '✗'} (${suppCheck.length}/3)`);

  } catch (err) {
    const error = err as Error;
    console.error('\n❌ Migration error:', error.message);
    process.exit(1);
  }
}

run();
