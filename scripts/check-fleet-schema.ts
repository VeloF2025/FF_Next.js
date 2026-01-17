import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'fleet_vehicles'
    ORDER BY ordinal_position
  `;
  console.log('fleet_vehicles columns:');
  for (const c of cols) {
    console.log('  -', c.column_name + ':', c.data_type, c.is_nullable === 'NO' ? '(required)' : '');
  }
}
check();
