const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');

neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: 'process.env.DATABASE_URL'
});

async function main() {
  console.log('Adding missing offline columns to drops table...\n');

  const columns = [
    'is_offline BOOLEAN DEFAULT false',
    'offline_since TIMESTAMPTZ',
    'offline_reason VARCHAR(100)',
    'offline_days INT',
    'last_offline_check TIMESTAMPTZ',
  ];

  for (const col of columns) {
    const colName = col.split(' ')[0];
    try {
      await pool.query(`ALTER TABLE drops ADD COLUMN IF NOT EXISTS ${col}`);
      console.log('✓ Added ' + colName);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('⚠ ' + colName + ' already exists');
      } else {
        console.error('✗ ' + colName + ': ' + err.message);
      }
    }
  }

  // Verify
  console.log('\nVerifying...');
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'drops'
      AND column_name IN ('is_offline', 'offline_since', 'offline_reason', 'offline_days', 'last_offline_check')
    ORDER BY column_name
  `);
  console.log('Offline columns in drops:', result.rows.map(c => c.column_name).join(', '));

  await pool.end();
}

main().catch(console.error);
