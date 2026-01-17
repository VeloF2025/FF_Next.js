import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  // Check fleet_odometer_history columns
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'fleet_odometer_history'
    ORDER BY ordinal_position
  `;
  console.log('fleet_odometer_history columns:');
  for (const c of cols) {
    console.log(`  - ${c.column_name}: ${c.data_type}`);
  }

  // Check fleet_service_logs columns
  const cols2 = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'fleet_service_logs'
    ORDER BY ordinal_position
  `;
  console.log('\nfleet_service_logs columns:');
  for (const c of cols2) {
    console.log(`  - ${c.column_name}: ${c.data_type}`);
  }

  // Check suppliers email nullable
  const email = await sql`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'email'
  `;
  console.log('\nsuppliers.email nullable:', email[0]?.is_nullable);

  // Check existing indexes
  const indexes = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('fleet_service_logs', 'fleet_odometer_history')
  `;
  console.log('\nExisting indexes:');
  for (const idx of indexes) {
    console.log(`  - ${idx.indexname}`);
  }
}
check();
