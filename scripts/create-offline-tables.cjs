const { neon } = require("@neondatabase/serverless");

const DATABASE_URL = "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require";

async function run() {
  const sql = neon(DATABASE_URL);
  
  try {
    // First verify we can connect
    const test = await sql`SELECT 1 as test`;
    console.log("Connected to database");
    
    // Create offline_devices table
    console.log("\n1. Creating offline_devices table...");
    await sql`
      CREATE TABLE IF NOT EXISTS offline_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        import_batch_id UUID,
        drop_number VARCHAR(20) NOT NULL,
        serial_number VARCHAR(20) NOT NULL,
        area_code VARCHAR(10),
        ont_address VARCHAR(100),
        olt_rack INT,
        olt_shelf INT,
        olt_slot INT,
        olt_port INT,
        olt_ont INT,
        last_down_reason VARCHAR(100) NOT NULL,
        last_inform_date TIMESTAMPTZ,
        days_since_last_inform INT,
        offline_bucket VARCHAR(50),
        drop_id UUID,
        oes_activation_id UUID,
        match_status VARCHAR(20) DEFAULT 'pending',
        expected_serial VARCHAR(20),
        serial_mismatch BOOLEAN DEFAULT false,
        serial_mismatch_type VARCHAR(50),
        latitude DECIMAL(12,8),
        longitude DECIMAL(12,8),
        report_date DATE NOT NULL,
        snapshot_timestamp TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(drop_number, report_date)
      )
    `;
    console.log("   Created offline_devices");
    
    // Check it exists
    const check1 = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'offline_devices')`;
    console.log("   Verified:", check1[0].exists ? "OK" : "FAILED");
    
    // Create offline_alerts table
    console.log("\n2. Creating offline_alerts table...");
    await sql`
      CREATE TABLE IF NOT EXISTS offline_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        offline_device_id UUID,
        drop_number VARCHAR(20) NOT NULL,
        serial_number VARCHAR(20),
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) DEFAULT 'medium',
        description TEXT,
        days_offline INT,
        last_down_reason VARCHAR(100),
        status VARCHAR(20) DEFAULT 'open',
        resolved_at TIMESTAMPTZ,
        resolved_by VARCHAR(100),
        resolution_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("   Created offline_alerts");
    
    const check2 = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'offline_alerts')`;
    console.log("   Verified:", check2[0].exists ? "OK" : "FAILED");
    
    // Add is_offline column to drops if not exists
    console.log("\n3. Adding is_offline column to drops...");
    await sql`ALTER TABLE drops ADD COLUMN IF NOT EXISTS is_offline BOOLEAN DEFAULT false`;
    console.log("   Added is_offline");
    
    const check3 = await sql`SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'drops' AND column_name = 'is_offline')`;
    console.log("   Verified:", check3[0].exists ? "OK" : "FAILED");
    
    // Final summary
    console.log("\n=== Migration Complete ===");
    const allTables = await sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('offline_import_batches', 'offline_devices', 'offline_alerts')`;
    console.log("Tables created:", allTables.map(t => t.table_name).join(", "));
    
  } catch (err) {
    console.error("Error:", err.message);
    if (err.code) console.error("Code:", err.code);
    process.exit(1);
  }
}

run();
