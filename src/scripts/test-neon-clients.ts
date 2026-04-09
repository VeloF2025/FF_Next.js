import { sql } from '../lib/neon';
import { log } from '@/lib/logger';

async function testNeonClients() {
  try {
    // 1. Test basic connection
    await sql`SELECT NOW() as current_time`;
    // 2. Check if clients table exists
    await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'clients'
    `;
    // 3. Get table structure
    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'clients'
      ORDER BY ordinal_position
    `;
    columns.forEach((col: { column_name: string; data_type: string; is_nullable: string }) => {
      log.info(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(required);' : ''}`, {}, 'test-neon-clients');
    });
    
    // 4. Count records
    const count = await sql`SELECT COUNT(*) as total FROM clients`;
    // 5. Get sample data
    if (count[0].total > 0) {
      const sample = await sql`
        SELECT * FROM clients 
        ORDER BY created_at DESC 
        LIMIT 3
      `;
      sample.forEach((_client: Record<string, unknown>, _i: number) => {
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
    `;
  } catch (error) {
    log.error('❌ Error:', { data: error }, 'test-neon-clients');
  }
}

// Run the test
testNeonClients();