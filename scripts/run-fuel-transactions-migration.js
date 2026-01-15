/**
 * Run fuel transactions migration
 */

const { neon } = require('@neondatabase/serverless');

async function runMigration() {
  const sql = neon(process.env.DATABASE_URL);

  console.log('Running fleet fuel transactions migration...');

  // Create fuel transactions table
  await sql`
    CREATE TABLE IF NOT EXISTS fleet_fuel_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        transaction_date DATE NOT NULL,
        amount_rand NUMERIC(10,2) NOT NULL,
        litres NUMERIC(10,3) NOT NULL,
        price_per_litre NUMERIC(10,3),
        odometer_reading INTEGER,
        km_since_last_fill INTEGER,
        litres_per_100km NUMERIC(6,2),
        station_name VARCHAR(255),
        station_location VARCHAR(500),
        receipt_photo_url VARCHAR(500),
        receipt_photo_key VARCHAR(255),
        odometer_photo_url VARCHAR(500),
        odometer_photo_key VARCHAR(255),
        vlm_extracted BOOLEAN DEFAULT false,
        vlm_confidence NUMERIC(5,2),
        vlm_raw_result JSONB,
        vlm_verified BOOLEAN DEFAULT false,
        source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'vlm', 'hybrid')),
        recorded_by UUID REFERENCES staff(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✓ Created fleet_fuel_transactions table');

  // Create index on fuel transactions
  await sql`
    CREATE INDEX IF NOT EXISTS idx_fuel_transactions_vehicle
    ON fleet_fuel_transactions(vehicle_id, transaction_date DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_fuel_transactions_date
    ON fleet_fuel_transactions(transaction_date DESC)
  `;
  console.log('✓ Created fuel transactions indexes');

  // Create vehicle photos table
  await sql`
    CREATE TABLE IF NOT EXISTS fleet_vehicle_photos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        photo_type VARCHAR(50) NOT NULL,
        file_url VARCHAR(500) NOT NULL,
        file_key VARCHAR(255),
        file_size INTEGER,
        mime_type VARCHAR(50),
        check_record_id UUID REFERENCES fleet_check_records(id) ON DELETE SET NULL,
        fuel_transaction_id UUID REFERENCES fleet_fuel_transactions(id) ON DELETE SET NULL,
        vlm_processed BOOLEAN DEFAULT false,
        vlm_result JSONB,
        vlm_confidence NUMERIC(5,2),
        captured_at TIMESTAMPTZ DEFAULT NOW(),
        captured_by UUID REFERENCES staff(id),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✓ Created fleet_vehicle_photos table');

  // Create indexes on vehicle photos
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle
    ON fleet_vehicle_photos(vehicle_id, photo_type)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_vehicle_photos_type
    ON fleet_vehicle_photos(photo_type, created_at DESC)
  `;
  console.log('✓ Created vehicle photos indexes');

  console.log('\n✅ Migration complete!');

  // Verify tables
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('fleet_fuel_transactions', 'fleet_vehicle_photos')
  `;
  console.log('Created tables:', tables.map(t => t.table_name).join(', '));
}

runMigration().catch(console.error);
