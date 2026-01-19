const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'
});

async function main() {
  console.log('Adding new columns to offline_devices using Pool...\n');

  const columns = [
    'zone VARCHAR(50)',
    'planned_pon VARCHAR(50)',
    'address TEXT',
    'pole_number VARCHAR(50)',
    'point_of_interest VARCHAR(100)',
    'installation_date DATE',
    'days_since_activation INT',
    'revenue_30day_avg DECIMAL(10,2)',
    "source_report VARCHAR(20) DEFAULT 'audit'",
  ];

  for (const col of columns) {
    const colName = col.split(' ')[0];
    try {
      await pool.query(`ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS ${col}`);
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
    WHERE table_name = 'offline_devices'
      AND column_name IN ('zone', 'planned_pon', 'address', 'pole_number', 'point_of_interest',
                         'installation_date', 'days_since_activation', 'revenue_30day_avg', 'source_report')
    ORDER BY column_name
  `);
  console.log('New columns:', result.rows.length > 0 ? result.rows.map(c => c.column_name).join(', ') : 'NONE');

  await pool.end();
}

main().catch(console.error);
