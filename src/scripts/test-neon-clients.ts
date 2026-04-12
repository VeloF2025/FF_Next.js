import { sql } from '../lib/neon';
import { log } from '@/lib/logger';

type DbRow = Record<string, unknown>;

async function testNeonClients() {
  try {
    // 1. Test basic connection
    await sql`SELECT NOW() as current_time` as DbRow[];
    // 2. Check if clients table exists
    await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'clients'
    ` as DbRow[];
    // 3. Get table structure
    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'clients'
      ORDER BY ordinal_position
    ` as DbRow[];
    columns.forEach((col) => {
      const { column_name, data_type, is_nullable } = col as { column_name: string; data_type: string; is_nullable: string };
      log.info(`  - ${column_name}: ${data_type} ${is_nullable === 'NO' ? '(required);' : ''}`, {}, 'test-neon-clients');
    });

    // 4. Count records
    const count = await sql`SELECT COUNT(*) as total FROM clients` as DbRow[];
    // 5. Get sample data
    if ((count[0]?.total as number) > 0) {
      const sample = await sql`
        SELECT * FROM clients
        ORDER BY created_at DESC
        LIMIT 3
      ` as DbRow[];
      sample.forEach((_client, _i) => {
      });
    }

    // 6. Test the query used in the service
    await sql`
      SELECT
        c.*,
        s.name as account_manager_name
      FROM clients c
      LEFT JOIN staff s ON c.account_manager_id = s.id
      ORDER BY c.name ASC
      LIMIT 5
    ` as DbRow[];
  } catch (error) {
    log.error('❌ Error:', { data: error }, 'test-neon-clients');
  }
}

// Run the test
testNeonClients();
