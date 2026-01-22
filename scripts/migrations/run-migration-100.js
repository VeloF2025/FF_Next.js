/**
 * Run Migration 100: Fix create_ticket_history Trigger Function
 *
 * The table was renamed from ticket_history to maintenance_history
 * but the trigger function was not updated. This fixes it.
 *
 * Usage: DATABASE_URL='...' node scripts/migrations/run-migration-100.js
 */

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('Running migration 100: Fix create_ticket_history trigger function...');

  try {
    // Update the function directly
    await sql`
      CREATE OR REPLACE FUNCTION create_ticket_history()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          INSERT INTO maintenance_history (ticket_id, action, new_value, changed_by, changed_at)
          VALUES (NEW.id, 'created', jsonb_build_object('status', NEW.status, 'priority', NEW.priority)::TEXT, NEW.created_by, NEW.created_at);

        ELSIF TG_OP = 'UPDATE' THEN
          IF OLD.status != NEW.status THEN
            INSERT INTO maintenance_history (ticket_id, action, field_changed, old_value, new_value, changed_by)
            VALUES (NEW.id, 'status_changed', 'status', OLD.status, NEW.status, NEW.created_by);
          END IF;

          IF OLD.priority != NEW.priority THEN
            INSERT INTO maintenance_history (ticket_id, action, field_changed, old_value, new_value, changed_by)
            VALUES (NEW.id, 'priority_changed', 'priority', OLD.priority, NEW.priority, NEW.created_by);
          END IF;

          IF (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
            INSERT INTO maintenance_history (ticket_id, action, field_changed, old_value, new_value, changed_by)
            VALUES (NEW.id, 'assigned', 'assigned_to', OLD.assigned_to::TEXT, NEW.assigned_to::TEXT, NEW.created_by);
          END IF;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;

    console.log('Migration 100 completed successfully');

    // Verify the fix
    const result = await sql`
      SELECT routine_definition
      FROM information_schema.routines
      WHERE routine_name = 'create_ticket_history'
    `;

    if (result[0]?.routine_definition?.includes('maintenance_history')) {
      console.log('Verified: Function now references maintenance_history');
    } else {
      console.warn('Warning: Could not verify function update');
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
