/**
 * Run ticket status migration
 * Creates the ticket_statuses reference table and seeds default values
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  console.log('Running ticket status migration...\n');

  const sql = neon(DATABASE_URL);

  try {
    // Step 1: Create ticket_statuses table
    console.log('1. Creating ticket_statuses table...');
    await sql`
      CREATE TABLE IF NOT EXISTS ticket_statuses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        parent_id UUID REFERENCES ticket_statuses(id) ON DELETE SET NULL,
        color VARCHAR(20) DEFAULT '#6B7280',
        icon VARCHAR(50) DEFAULT 'circle',
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        is_terminal BOOLEAN DEFAULT false,
        qcontact_status VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log('   Table created');

    // Step 2: Create indexes
    console.log('2. Creating indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_ticket_statuses_code ON ticket_statuses(code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ticket_statuses_parent ON ticket_statuses(parent_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ticket_statuses_active ON ticket_statuses(is_active) WHERE is_active = true`;
    console.log('   Indexes created');

    // Step 3: Insert default statuses
    console.log('3. Inserting default statuses...');

    const statuses = [
      { code: 'new', name: 'New', desc: 'Newly created ticket, not yet reviewed', color: '#3B82F6', icon: 'circle', order: 10, terminal: false, qc: 'Open' },
      { code: 'triaged', name: 'Triaged', desc: 'Reviewed and categorized, ready for assignment', color: '#8B5CF6', icon: 'clipboard-check', order: 20, terminal: false, qc: 'Open' },
      { code: 'assigned', name: 'Assigned', desc: 'Assigned to a technician or team', color: '#06B6D4', icon: 'user-check', order: 30, terminal: false, qc: 'In Progress' },
      { code: 'in_progress', name: 'In Progress', desc: 'Work is actively being done', color: '#F59E0B', icon: 'loader', order: 40, terminal: false, qc: 'In Progress' },
      { code: 'blocked', name: 'Blocked', desc: 'Work paused due to external dependency', color: '#EF4444', icon: 'alert-triangle', order: 50, terminal: false, qc: 'Pending Company' },
      { code: 'resolved', name: 'Resolved', desc: 'Work completed, awaiting confirmation', color: '#10B981', icon: 'check-circle', order: 60, terminal: false, qc: 'Solved' },
      { code: 'closed', name: 'Closed', desc: 'Ticket fully closed and verified', color: '#6B7280', icon: 'check-circle-2', order: 70, terminal: true, qc: 'Solved' },
      { code: 'cancelled', name: 'Cancelled', desc: 'Ticket cancelled or duplicate', color: '#DC2626', icon: 'x-circle', order: 80, terminal: true, qc: 'Cancelled' },
    ];

    for (const s of statuses) {
      await sql`
        INSERT INTO ticket_statuses (code, name, description, color, icon, display_order, is_terminal, qcontact_status)
        VALUES (${s.code}, ${s.name}, ${s.desc}, ${s.color}, ${s.icon}, ${s.order}, ${s.terminal}, ${s.qc})
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          color = EXCLUDED.color,
          icon = EXCLUDED.icon,
          display_order = EXCLUDED.display_order,
          is_terminal = EXCLUDED.is_terminal,
          qcontact_status = EXCLUDED.qcontact_status,
          updated_at = NOW()
      `;
      console.log(`   Added: ${s.code} -> ${s.name}`);
    }

    // Step 4: Update tickets table status column type if needed
    console.log('4. Checking tickets table status column...');

    // Check current column type
    const columnInfo = await sql`
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'tickets' AND column_name = 'status'
    `;

    if (columnInfo.length > 0) {
      console.log(`   Current type: ${columnInfo[0].udt_name}`);

      if (columnInfo[0].udt_name !== 'varchar') {
        console.log('   Converting status column to VARCHAR...');
        // Create temp column, copy, drop old, rename
        await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS status_temp VARCHAR(50)`;
        await sql`UPDATE tickets SET status_temp = status::text WHERE status_temp IS NULL`;
        await sql`ALTER TABLE tickets DROP COLUMN IF EXISTS status`;
        await sql`ALTER TABLE tickets RENAME COLUMN status_temp TO status`;
        await sql`ALTER TABLE tickets ALTER COLUMN status SET DEFAULT 'new'`;
        console.log('   Conversion complete');
      }
    }

    // Create index on status
    await sql`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`;

    // Step 5: Verify
    console.log('\n5. Verifying migration...');

    const resultStatuses = await sql`
      SELECT code, name, color, display_order, is_terminal, qcontact_status
      FROM ticket_statuses
      WHERE is_active = true
      ORDER BY display_order
    `;

    console.log('\nAvailable ticket statuses:');
    console.table(resultStatuses);

    const ticketStatuses = await sql`
      SELECT status, COUNT(*) as count
      FROM tickets
      GROUP BY status
      ORDER BY count DESC
    `;

    console.log('\nCurrent ticket statuses in use:');
    console.table(ticketStatuses);

    console.log('\nMigration complete!');

  } catch (error) {
    console.error('\nMigration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration();
