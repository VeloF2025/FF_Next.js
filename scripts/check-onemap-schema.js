/**
 * Check onemap_properties table schema and data
 */
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function checkSchema() {
  console.log('Checking onemap_properties table...\n');

  // Get columns
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'onemap_properties'
    ORDER BY ordinal_position
  `;

  console.log('=== COLUMNS ===');
  cols.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));

  // Get counts
  const total = await sql`SELECT COUNT(*) as total FROM onemap_properties`;
  const withOnt = await sql`SELECT COUNT(*) as total FROM onemap_properties WHERE ont_barcode IS NOT NULL`;
  const withUps = await sql`SELECT COUNT(*) as total FROM onemap_properties WHERE ups_serial IS NOT NULL`;

  console.log('\n=== COUNTS ===');
  console.log(`  Total records: ${total[0].total}`);
  console.log(`  With ONT barcode: ${withOnt[0].total}`);
  console.log(`  With UPS serial: ${withUps[0].total}`);

  // Sample data
  const sample = await sql`
    SELECT drop_number, ont_barcode, ups_serial
    FROM onemap_properties
    WHERE ont_barcode IS NOT NULL
    LIMIT 5
  `;

  console.log('\n=== SAMPLE DATA (with ONT) ===');
  if (sample.length === 0) {
    console.log('  No records with ONT barcode');
  } else {
    sample.forEach(r => {
      console.log(`  ${r.drop_number}: ONT=${r.ont_barcode}, UPS=${r.ups_serial || 'null'}`);
    });
  }
}

checkSchema().catch(console.error);
