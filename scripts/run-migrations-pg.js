const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PROD_URL = 'process.env.DATABASE_URL';

const MIGRATIONS = [
  'scripts/migrations/049_purchase_requisitions.sql',
  'scripts/migrations/050_purchase_orders.sql',
  'scripts/migrations/051_goods_receipt_notes.sql',
  'scripts/migrations/052_approval_workflows.sql'
];

async function runMigrations() {
  const client = new Client({ connectionString: PROD_URL });

  try {
    await client.connect();
    console.log('✅ Connected to PRODUCTION database\n');

    for (const migFile of MIGRATIONS) {
      const filePath = path.join('/home/hein/Workspace/FF_Next.js', migFile);
      console.log('📄 Running:', path.basename(migFile));

      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        await client.query(sql);
        console.log('   ✅ Completed\n');
      } catch (err) {
        console.log('   ⚠️  Error:', err.message.substring(0, 150), '\n');
      }
    }

    // Verify tables
    console.log('\n=== Verifying Tables ===\n');
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN (
        'purchase_requisitions', 'purchase_requisition_items',
        'purchase_orders', 'purchase_order_items',
        'goods_receipt_notes', 'goods_receipt_items',
        'approval_workflows', 'approval_levels',
        'approval_requests', 'approval_history'
      )
      ORDER BY table_name
    `);

    result.rows.forEach(r => console.log('✅', r.table_name));
    console.log('\nTotal:', result.rows.length, 'of 10 tables created');

  } finally {
    await client.end();
  }
}

runMigrations().catch(console.error);
