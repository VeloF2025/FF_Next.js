/**
 * Run Fleet Check-In Migration
 */
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Running Fleet Check-In Migration...\n');

  try {
    // 1. Create templates table
    console.log('Creating fleet_check_templates table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_check_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        description TEXT,
        is_default BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ fleet_check_templates created');

    // 2. Create items table
    console.log('Creating fleet_check_items table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_check_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID NOT NULL REFERENCES fleet_check_templates(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        category VARCHAR(50),
        is_critical BOOLEAN DEFAULT false,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ fleet_check_items created');

    // 3. Create records table
    console.log('Creating fleet_check_records table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_check_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
        template_id UUID REFERENCES fleet_check_templates(id),
        driver_id UUID NOT NULL,
        driver_name VARCHAR(100) NOT NULL,
        check_date DATE NOT NULL DEFAULT CURRENT_DATE,
        check_time TIME NOT NULL DEFAULT CURRENT_TIME,
        odometer_reading INTEGER,
        status VARCHAR(20) DEFAULT 'pending',
        has_critical_issues BOOLEAN DEFAULT false,
        has_minor_issues BOOLEAN DEFAULT false,
        approved_by UUID,
        approved_at TIMESTAMPTZ,
        approval_notes TEXT,
        offline_id VARCHAR(100),
        sync_status VARCHAR(20) DEFAULT 'synced',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ fleet_check_records created');

    // 4. Create responses table
    console.log('Creating fleet_check_responses table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_check_responses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        record_id UUID NOT NULL REFERENCES fleet_check_records(id) ON DELETE CASCADE,
        item_id UUID NOT NULL REFERENCES fleet_check_items(id),
        is_passed BOOLEAN NOT NULL,
        severity VARCHAR(20),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ fleet_check_responses created');

    // 5. Create photos table
    console.log('Creating fleet_check_photos table...');
    await sql`
      CREATE TABLE IF NOT EXISTS fleet_check_photos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        record_id UUID NOT NULL REFERENCES fleet_check_records(id) ON DELETE CASCADE,
        response_id UUID REFERENCES fleet_check_responses(id) ON DELETE SET NULL,
        photo_type VARCHAR(50) NOT NULL,
        is_required BOOLEAN DEFAULT false,
        file_url TEXT NOT NULL,
        file_path TEXT,
        file_size INTEGER,
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        captured_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('✓ fleet_check_photos created');

    // 6. Create indexes
    console.log('Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_check_items_template ON fleet_check_items(template_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_check_records_vehicle ON fleet_check_records(vehicle_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_check_records_driver ON fleet_check_records(driver_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_check_records_date ON fleet_check_records(check_date DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_check_records_status ON fleet_check_records(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_check_records_offline ON fleet_check_records(offline_id) WHERE offline_id IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_check_responses_record ON fleet_check_responses(record_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_check_photos_record ON fleet_check_photos(record_id)`;
    console.log('✓ Indexes created');

    // 7. Insert default template
    console.log('Creating default template...');
    const existingTemplate = await sql`SELECT id FROM fleet_check_templates WHERE is_default = true LIMIT 1`;

    if (existingTemplate.length === 0) {
      const [template] = await sql`
        INSERT INTO fleet_check_templates (name, description, is_default)
        VALUES ('Daily Pre-Trip Inspection', 'Standard daily vehicle inspection checklist', true)
        RETURNING id
      `;

      // Insert default items
      const items = [
        { name: 'Tires', description: 'Check tire pressure and tread depth', category: 'safety', is_critical: true, order: 1 },
        { name: 'Lights', description: 'Check all lights (headlights, brake, turn signals)', category: 'safety', is_critical: true, order: 2 },
        { name: 'Brakes', description: 'Check brake pedal and parking brake', category: 'safety', is_critical: true, order: 3 },
        { name: 'Seat Belts', description: 'Check all seat belts function properly', category: 'safety', is_critical: true, order: 4 },
        { name: 'Fluids', description: 'Check oil, coolant, and washer fluid levels', category: 'mechanical', is_critical: false, order: 5 },
        { name: 'Mirrors', description: 'Check all mirrors are present and adjustable', category: 'exterior', is_critical: false, order: 6 },
        { name: 'Wipers', description: 'Check windshield wipers condition', category: 'exterior', is_critical: false, order: 7 },
        { name: 'Horn', description: 'Check horn functionality', category: 'safety', is_critical: false, order: 8 },
        { name: 'Exterior Damage', description: 'Check for any exterior damage or issues', category: 'exterior', is_critical: false, order: 9 },
      ];

      for (const item of items) {
        await sql`
          INSERT INTO fleet_check_items (template_id, name, description, category, is_critical, display_order)
          VALUES (${template.id}, ${item.name}, ${item.description}, ${item.category}, ${item.is_critical}, ${item.order})
        `;
      }
      console.log('✓ Default template created with 9 items');
    } else {
      console.log('✓ Default template already exists');
    }

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
