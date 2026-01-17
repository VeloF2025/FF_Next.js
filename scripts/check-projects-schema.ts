import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'projects'
    ORDER BY ordinal_position
  `;
  console.log('projects columns:');
  for (const c of cols) {
    console.log(`  - ${c.column_name}: ${c.data_type}`);
  }

  // Get a sample project
  const sample = await sql`SELECT * FROM projects LIMIT 1`;
  console.log('\nSample project:', JSON.stringify(sample[0], null, 2));
}
check();
