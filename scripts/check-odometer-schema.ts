import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'fleet_odometer_history'
    ORDER BY ordinal_position
  `;
  console.log('fleet_odometer_history columns:');
  for (const c of cols) {
    const nullable = c.is_nullable === 'YES' ? '' : ' (required)';
    console.log('  -', c.column_name + ':', c.data_type + nullable);
  }
}
check();
