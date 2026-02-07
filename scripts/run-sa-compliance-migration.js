/**
 * SA Labour Compliance Migration Runner
 * Adds all SA labour law compliance columns to the staff table
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Starting SA Compliance Migration...\n');

  // Step 1: Add contract_type column if not exists
  console.log('Step 1: Checking contract_type column...');
  const contractCol = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'staff' AND column_name = 'contract_type'
  `;
  if (contractCol.length === 0) {
    await sql`ALTER TABLE staff ADD COLUMN contract_type VARCHAR(30)`;
  }
  console.log('  ✓ contract_type column ready');

  // Step 2: UIF columns
  console.log('Step 2: Adding UIF compliance columns...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS uif_status VARCHAR(20)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS uif_number VARCHAR(50)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS uif_registration_date DATE`;
  console.log('  ✓ UIF columns added');

  // Step 3: COIDA column
  console.log('Step 3: Adding COIDA column...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS coida_status VARCHAR(20)`;
  console.log('  ✓ COIDA column added');

  // Step 4: Tax status
  console.log('Step 4: Adding tax_status column...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS tax_status VARCHAR(20)`;
  console.log('  ✓ tax_status column added');

  // Step 5: Probation columns
  console.log('Step 5: Adding probation columns...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_status VARCHAR(20)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_start_date DATE`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_end_date DATE`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_extended BOOLEAN`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS probation_extension_reason TEXT`;
  console.log('  ✓ Probation columns added');

  // Step 6: Notice period
  console.log('Step 6: Adding notice_period columns...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS notice_period VARCHAR(20)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS custom_notice_period_days INTEGER`;
  console.log('  ✓ Notice period columns added');

  // Step 7: Working hours
  console.log('Step 7: Adding working hours columns...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS working_hours_category VARCHAR(20)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS weekly_hours DECIMAL(4,1)`;
  console.log('  ✓ Working hours columns added');

  // Step 8: Contract dates
  console.log('Step 8: Adding contract_renewal_date column...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS contract_renewal_date DATE`;
  console.log('  ✓ Contract renewal date column added');

  // Step 9: SA Identity fields
  console.log('Step 9: Adding SA identity columns...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS id_number VARCHAR(13)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS passport_number VARCHAR(50)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS work_permit_number VARCHAR(50)`;
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS work_permit_expiry DATE`;
  console.log('  ✓ SA identity columns added');

  // Step 10: is_employee flag
  console.log('Step 10: Adding is_employee column...');
  await sql`ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_employee BOOLEAN`;
  console.log('  ✓ is_employee column added');

  // Step 11: Create indexes
  console.log('Step 11: Creating indexes...');
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_staff_contract_type ON staff(contract_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_staff_uif_status ON staff(uif_status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_staff_probation_status ON staff(probation_status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_staff_is_employee ON staff(is_employee)`;
    console.log('  ✓ Indexes created');
  } catch (e) {
    console.log('  ✓ Indexes already exist');
  }

  // Step 12: Update existing data with defaults
  console.log('Step 12: Setting default values for existing records...');

  // Set defaults for contract_type
  await sql`UPDATE staff SET contract_type = 'permanent' WHERE contract_type IS NULL`;

  // Set is_employee based on contract type
  await sql`UPDATE staff SET is_employee = true WHERE contract_type IN ('permanent', 'contract', 'temporary', 'intern', 'fixed_term', 'part_time')`;
  await sql`UPDATE staff SET is_employee = false WHERE contract_type IN ('freelance', 'consultant', 'independent_contractor')`;
  await sql`UPDATE staff SET is_employee = true WHERE is_employee IS NULL`;

  // Set UIF status
  await sql`UPDATE staff SET uif_status = 'pending' WHERE is_employee = true AND uif_status IS NULL`;
  await sql`UPDATE staff SET uif_status = 'not_applicable' WHERE is_employee = false AND uif_status IS NULL`;

  // Set COIDA status
  await sql`UPDATE staff SET coida_status = 'pending' WHERE is_employee = true AND coida_status IS NULL`;
  await sql`UPDATE staff SET coida_status = 'not_applicable' WHERE is_employee = false AND coida_status IS NULL`;

  // Set tax status
  await sql`UPDATE staff SET tax_status = 'paye' WHERE is_employee = true AND tax_status IS NULL`;
  await sql`UPDATE staff SET tax_status = 'provisional' WHERE is_employee = false AND tax_status IS NULL`;

  // Set probation status
  await sql`UPDATE staff SET probation_status = 'not_applicable' WHERE probation_status IS NULL`;
  await sql`UPDATE staff SET probation_extended = false WHERE probation_extended IS NULL`;

  // Set notice period
  await sql`UPDATE staff SET notice_period = 'as_per_contract' WHERE is_employee = true AND notice_period IS NULL`;
  await sql`UPDATE staff SET notice_period = 'not_applicable' WHERE is_employee = false AND notice_period IS NULL`;

  // Set working hours category
  await sql`UPDATE staff SET working_hours_category = 'full_time' WHERE working_hours_category IS NULL`;

  console.log('  ✓ Default values set');

  // Verify
  console.log('\n📊 Verification:');
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'staff'
    AND column_name IN (
      'contract_type', 'uif_status', 'uif_number', 'coida_status',
      'tax_status', 'probation_status', 'notice_period', 'weekly_hours',
      'is_employee', 'id_number', 'work_permit_number', 'working_hours_category'
    )
    ORDER BY column_name
  `;
  console.log('SA Compliance columns:', cols.map(c => c.column_name).join(', '));

  const counts = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_employee = true) as employees,
      COUNT(*) FILTER (WHERE is_employee = false) as contractors
    FROM staff
  `;
  console.log('Staff breakdown:', counts[0]);

  console.log('\n✅ Migration completed successfully!');
}

runMigration().catch(e => {
  console.error('Migration error:', e.message);
  process.exit(1);
});
