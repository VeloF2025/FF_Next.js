const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function main() {
  const sql = neon(DATABASE_URL);

  // Use tagged template literal for queries
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'offline_devices'
    ORDER BY ordinal_position
  `;

  console.log('All columns in offline_devices (' + cols.length + '):');
  cols.forEach(c => console.log('  - ' + c.column_name + ' (' + c.data_type + ')'));

  // Check for our new columns specifically
  const newCols = cols.filter(c =>
    ['zone', 'planned_pon', 'address', 'pole_number', 'point_of_interest',
     'installation_date', 'days_since_activation', 'revenue_30day_avg', 'source_report'].includes(c.column_name)
  );

  console.log('\nNew columns found:', newCols.length);
  if (newCols.length > 0) {
    newCols.forEach(c => console.log('  ✓ ' + c.column_name));
  }
}

main().catch(console.error);
