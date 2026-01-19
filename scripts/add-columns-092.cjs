const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function main() {
  const sql = neon(DATABASE_URL);

  console.log('Adding new columns to offline_devices...\n');

  const columns = [
    { name: 'zone', type: 'VARCHAR(50)' },
    { name: 'planned_pon', type: 'VARCHAR(50)' },
    { name: 'address', type: 'TEXT' },
    { name: 'pole_number', type: 'VARCHAR(50)' },
    { name: 'point_of_interest', type: 'VARCHAR(100)' },
    { name: 'installation_date', type: 'DATE' },
    { name: 'days_since_activation', type: 'INT' },
    { name: 'revenue_30day_avg', type: 'DECIMAL(10,2)' },
    { name: 'source_report', type: "VARCHAR(20) DEFAULT 'audit'" },
  ];

  for (const col of columns) {
    try {
      // Check if column exists
      const exists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offline_devices' AND column_name = ${col.name}
      `;

      if (exists.length > 0) {
        console.log('⚠ ' + col.name + ' already exists');
        continue;
      }

      // Add column using raw SQL
      const alterSQL = `ALTER TABLE offline_devices ADD COLUMN ${col.name} ${col.type}`;
      await sql([alterSQL]);  // Execute as raw SQL array
      console.log('✓ Added ' + col.name);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('⚠ ' + col.name + ' already exists');
      } else {
        console.error('✗ ' + col.name + ': ' + err.message);
      }
    }
  }

  // Verify
  console.log('\nVerifying...');
  const cols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'offline_devices'
      AND column_name IN ('zone', 'planned_pon', 'address', 'pole_number', 'point_of_interest',
                         'installation_date', 'days_since_activation', 'revenue_30day_avg', 'source_report')
    ORDER BY column_name
  `;
  console.log('New columns:', cols.length > 0 ? cols.map(c => c.column_name).join(', ') : 'NONE');
}

main().catch(console.error);
