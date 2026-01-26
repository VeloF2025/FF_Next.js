/**
 * Migration 131: Fleet Portal Sessions
 *
 * Creates tables for plate-based portal authentication:
 * - fleet_portal_sessions: Session records for plate-authenticated users
 * - fleet_portal_session_activity: Audit log of portal actions
 */

const { neon } = require('@neondatabase/serverless');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('Starting migration 131: Fleet Portal Sessions...');
  console.log('Database:', databaseUrl.includes('ep-dry-night') ? 'PRODUCTION' : 'DEVELOPMENT');

  const sql = neon(databaseUrl);

  try {
    // Create fleet_portal_sessions table
    console.log('Creating fleet_portal_sessions table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_portal_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
          driver_id UUID REFERENCES staff(id),
          plate_scanned VARCHAR(20) NOT NULL,
          confidence NUMERIC(5,4),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          ip_address VARCHAR(45),
          user_agent TEXT,
          is_active BOOLEAN DEFAULT true,
          revoked_at TIMESTAMPTZ,
          revoked_by UUID REFERENCES staff(id),
          revoke_reason TEXT
      )
    `;
    console.log('✓ Created fleet_portal_sessions table');

    // Create indexes
    console.log('Creating indexes...');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_vehicle
          ON fleet_portal_sessions(vehicle_id, is_active)
          WHERE is_active = true
    `;
    console.log('✓ Created vehicle index');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_driver
          ON fleet_portal_sessions(driver_id)
          WHERE driver_id IS NOT NULL
    `;
    console.log('✓ Created driver index');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_expires
          ON fleet_portal_sessions(expires_at)
          WHERE is_active = true
    `;
    console.log('✓ Created expires index');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_ip
          ON fleet_portal_sessions(ip_address, created_at DESC)
    `;
    console.log('✓ Created IP index');

    // Create activity log table
    console.log('Creating fleet_portal_session_activity table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_portal_session_activity (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID NOT NULL REFERENCES fleet_portal_sessions(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          details JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ip_address VARCHAR(45)
      )
    `;
    console.log('✓ Created fleet_portal_session_activity table');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_fleet_portal_activity_session
          ON fleet_portal_session_activity(session_id, created_at DESC)
    `;
    console.log('✓ Created activity session index');

    // Add comments
    await sql`
      COMMENT ON TABLE fleet_portal_sessions IS
          'Portal sessions created via plate-based authentication. Scanning a license plate creates an 8-hour session for vehicle interactions.'
    `;

    await sql`
      COMMENT ON TABLE fleet_portal_session_activity IS
          'Audit log of actions taken during a portal session'
    `;

    console.log('\n✅ Migration 131 completed successfully!');

    // Verify tables exist
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('fleet_portal_sessions', 'fleet_portal_session_activity')
      ORDER BY table_name
    `;

    console.log('\nCreated tables:');
    tables.forEach((t) => console.log(`  - ${t.table_name}`));
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
