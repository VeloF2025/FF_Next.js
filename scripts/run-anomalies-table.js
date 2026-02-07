/**
 * Create Fleet Odometer Anomalies Table
 */
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function createTable() {
  console.log('Creating fleet_odometer_anomalies table...\n');

  try {
    // Create the table
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_odometer_anomalies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        odometer_history_id UUID REFERENCES fleet_odometer_history(id) ON DELETE SET NULL,
        anomaly_type VARCHAR(30) NOT NULL,
        odometer_reading INTEGER NOT NULL,
        previous_reading INTEGER,
        odometer_diff INTEGER,
        gps_distance_km INTEGER,
        variance_percent NUMERIC(5,2),
        severity VARCHAR(20) NOT NULL DEFAULT 'warning',
        resolved BOOLEAN DEFAULT false,
        resolved_by UUID REFERENCES staff(id),
        resolved_at TIMESTAMPTZ,
        resolution_notes TEXT,
        detected_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ Table created');

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_anomalies_vehicle ON fleet_odometer_anomalies(vehicle_id, detected_at DESC)`;
    console.log('✓ Index idx_anomalies_vehicle created');

    await sql`CREATE INDEX IF NOT EXISTS idx_anomalies_unresolved ON fleet_odometer_anomalies(resolved, severity)`;
    console.log('✓ Index idx_anomalies_unresolved created');

    await sql`CREATE INDEX IF NOT EXISTS idx_anomalies_type ON fleet_odometer_anomalies(anomaly_type)`;
    console.log('✓ Index idx_anomalies_type created');

    // Add GPS comparison column to check schedule
    await sql`ALTER TABLE fleet_check_schedule ADD COLUMN IF NOT EXISTS last_gps_comparison DATE`;
    console.log('✓ Added last_gps_comparison column to fleet_check_schedule');

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

createTable();
