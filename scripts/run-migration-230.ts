import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS onedrive_item_id TEXT`;
  console.log('Column added');
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_onedrive_item_id ON meetings (onedrive_item_id) WHERE onedrive_item_id IS NOT NULL`;
  console.log('Index created');
  console.log('Migration 230 complete');
}

main().catch(e => { console.error(e); process.exit(1); });
