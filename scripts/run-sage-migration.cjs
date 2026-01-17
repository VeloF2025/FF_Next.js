const { neon } = require('@neondatabase/serverless');

const sql = neon('postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');

async function runMigration() {
  const statements = [
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS username TEXT",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS password TEXT",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS auth_type VARCHAR(20) DEFAULT 'basic'",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT false",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS last_connection_test_at TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS last_token_refresh_at TIMESTAMP WITH TIME ZONE",
    "ALTER TABLE sage_api_config ADD COLUMN IF NOT EXISTS redirect_uri TEXT",
    "ALTER TABLE sage_api_config ALTER COLUMN client_secret DROP NOT NULL",
    "ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS operation_type VARCHAR(50)",
    "ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS direction VARCHAR(20)",
    "ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS error_message TEXT",
    "ALTER TABLE sage_sync_history ADD COLUMN IF NOT EXISTS details JSONB",
    "ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS ff_purchase_order_id UUID",
    "ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS outstanding_amount DECIMAL(15,2)",
    "ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS raw_data JSONB",
    "ALTER TABLE sage_supplier_payments ADD COLUMN IF NOT EXISTS match_status VARCHAR(30)",
    "ALTER TABLE sage_supplier_payments ADD COLUMN IF NOT EXISTS sage_invoice_id_ref VARCHAR(100)",
    "ALTER TABLE sage_supplier_payments ADD COLUMN IF NOT EXISTS raw_data JSONB",
  ];

  console.log("Running " + statements.length + " statements...\n");

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await sql(stmt);
      console.log("✓ " + (i + 1) + "/" + statements.length + ": " + stmt.substring(0, 65) + "...");
    } catch (err) {
      if (err.message.includes('already exists') || err.message.includes('duplicate')) {
        console.log("⚠ " + (i + 1) + "/" + statements.length + ": Already exists");
      } else if (err.message.includes('does not exist')) {
        console.log("⚠ " + (i + 1) + "/" + statements.length + ": Table/column not found - " + err.message.substring(0, 50));
      } else {
        console.error("✗ " + (i + 1) + "/" + statements.length + " failed: " + err.message);
      }
    }
  }

  console.log('\n✅ Migration complete!');

  // Verify columns
  const cols = await sql("SELECT column_name FROM information_schema.columns WHERE table_name = 'sage_api_config' ORDER BY ordinal_position");
  console.log('\nsage_api_config columns:', cols.map(function(c) { return c.column_name; }).join(', '));
}

runMigration().catch(console.error);
