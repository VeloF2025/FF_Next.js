import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');

async function runMigration() {
  console.log('Running Sage Basic Auth migration...\n');

  try {
    // 1. Add username column
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS username TEXT`;
    console.log('✓ Added username column');
  } catch (err) {
    console.log('⚠ username column:', err.message.substring(0, 50));
  }

  try {
    // 2. Add password column
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS password TEXT`;
    console.log('✓ Added password column');
  } catch (err) {
    console.log('⚠ password column:', err.message.substring(0, 50));
  }

  try {
    // 3. Add auth_type column
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS auth_type VARCHAR(20) DEFAULT 'basic'`;
    console.log('✓ Added auth_type column');
  } catch (err) {
    console.log('⚠ auth_type column:', err.message.substring(0, 50));
  }

  try {
    // 4. Add is_active column (may already exist from original migration)
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`;
    console.log('✓ Added is_active column');
  } catch (err) {
    console.log('⚠ is_active column:', err.message.substring(0, 50));
  }

  try {
    // 5. Add is_connected column (may already exist)
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT false`;
    console.log('✓ Added is_connected column');
  } catch (err) {
    console.log('⚠ is_connected column:', err.message.substring(0, 50));
  }

  try {
    // 6. Add last_sync_at column
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE`;
    console.log('✓ Added last_sync_at column');
  } catch (err) {
    console.log('⚠ last_sync_at column:', err.message.substring(0, 50));
  }

  try {
    // 7. Add last_connection_test_at column
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS last_connection_test_at TIMESTAMP WITH TIME ZONE`;
    console.log('✓ Added last_connection_test_at column');
  } catch (err) {
    console.log('⚠ last_connection_test_at column:', err.message.substring(0, 50));
  }

  try {
    // 8. Add redirect_uri column
    await sql`ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS redirect_uri TEXT`;
    console.log('✓ Added redirect_uri column');
  } catch (err) {
    console.log('⚠ redirect_uri column:', err.message.substring(0, 50));
  }

  try {
    // 9. Make client_secret nullable
    await sql`ALTER TABLE sage_api_config ALTER COLUMN client_secret DROP NOT NULL`;
    console.log('✓ Made client_secret nullable');
  } catch (err) {
    console.log('⚠ client_secret nullable:', err.message.substring(0, 50));
  }

  try {
    // 10. Add index on is_active
    await sql`CREATE INDEX IF NOT EXISTS idx_sage_api_config_active ON sage_api_config(is_active) WHERE is_active = true`;
    console.log('✓ Created index on is_active');
  } catch (err) {
    console.log('⚠ is_active index:', err.message.substring(0, 50));
  }

  // Sync history columns
  try {
    await sql`ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS operation_type VARCHAR(50)`;
    console.log('✓ Added sage_sync_history.operation_type');
  } catch (err) {
    console.log('⚠ operation_type:', err.message.substring(0, 50));
  }

  try {
    await sql`ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS direction VARCHAR(20)`;
    console.log('✓ Added sage_sync_history.direction');
  } catch (err) {
    console.log('⚠ direction:', err.message.substring(0, 50));
  }

  try {
    await sql`ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS error_message TEXT`;
    console.log('✓ Added sage_sync_history.error_message');
  } catch (err) {
    console.log('⚠ error_message:', err.message.substring(0, 50));
  }

  try {
    await sql`ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS details JSONB`;
    console.log('✓ Added sage_sync_history.details');
  } catch (err) {
    console.log('⚠ details:', err.message.substring(0, 50));
  }

  // Invoice columns
  try {
    await sql`ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS ff_purchase_order_id UUID`;
    console.log('✓ Added sage_supplier_invoices.ff_purchase_order_id');
  } catch (err) {
    console.log('⚠ ff_purchase_order_id:', err.message.substring(0, 50));
  }

  try {
    await sql`ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS outstanding_amount DECIMAL(15,2)`;
    console.log('✓ Added sage_supplier_invoices.outstanding_amount');
  } catch (err) {
    console.log('⚠ outstanding_amount:', err.message.substring(0, 50));
  }

  try {
    await sql`ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS raw_data JSONB`;
    console.log('✓ Added sage_supplier_invoices.raw_data');
  } catch (err) {
    console.log('⚠ invoice raw_data:', err.message.substring(0, 50));
  }

  // Payment columns
  try {
    await sql`ALTER TABLE sage_supplier_payments ADD COLUMN IF NOT EXISTS match_status VARCHAR(30)`;
    console.log('✓ Added sage_supplier_payments.match_status');
  } catch (err) {
    console.log('⚠ match_status:', err.message.substring(0, 50));
  }

  try {
    await sql`ALTER TABLE sage_supplier_payments ADD COLUMN IF NOT EXISTS sage_invoice_id_ref VARCHAR(100)`;
    console.log('✓ Added sage_supplier_payments.sage_invoice_id_ref');
  } catch (err) {
    console.log('⚠ sage_invoice_id_ref:', err.message.substring(0, 50));
  }

  try {
    await sql`ALTER TABLE sage_supplier_payments ADD COLUMN IF NOT EXISTS raw_data JSONB`;
    console.log('✓ Added sage_supplier_payments.raw_data');
  } catch (err) {
    console.log('⚠ payment raw_data:', err.message.substring(0, 50));
  }

  console.log('\n✅ Migration complete!\n');

  // Verify columns
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'sage_api_config' ORDER BY ordinal_position`;
  console.log('sage_api_config columns:', cols.map(c => c.column_name).join(', '));
}

runMigration().catch(console.error);
