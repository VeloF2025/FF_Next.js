# Ticketing Module - Database Migrations

This directory contains PostgreSQL migration files for the FibreFlow Ticketing Module.

## Migration Files

### 001_create_core_tables.sql
Creates 8 core tables for ticket management:

1. **tickets** - Core ticket table with source tracking, location, equipment, assignment, guarantee, fault attribution, and SLA fields
2. **verification_steps** - 12-step verification tracking for QA approval
3. **weekly_reports** - Import batch tracking for Excel weekly reports (93+ items)
4. **qcontact_sync_log** - Bidirectional sync audit log for QContact integration
5. **guarantee_periods** - Project-specific guarantee configuration and billing rules
6. **whatsapp_notifications** - WhatsApp notification delivery tracking via WAHA API
7. **ticket_attachments** - File metadata for photos and documents linked to tickets
8. **ticket_notes** - Internal, client-facing, and system-generated notes

### 002_create_maintenance_tables.sql
Creates 4 maintenance enhancement tables (NEW features from maintenance head feedback):

9. **qa_readiness_checks** - Pre-QA validation log to ensure tickets are ready for QA review
10. **qa_risk_acceptances** - Conditional approval tracking with documented exceptions and expiry dates
11. **handover_snapshots** - Immutable audit trail for Build → QA → Maintenance handovers
12. **repeat_fault_escalations** - Infrastructure-level escalation tracking for repeat faults on poles, PONs, zones, or DRs

### 003_create_indexes.sql
Creates all indexes for optimal query performance:

- **tickets**: 15+ indexes for status, priority, assignment, location (pole/PON/zone), SLA, QA readiness, fault cause, etc.
- **verification_steps**: Indexes for ticket lookup and step completion
- **weekly_reports**: Indexes for chronological queries and year/week lookup
- **qcontact_sync_log**: Indexes for sync history and audit logs
- **whatsapp_notifications**: Indexes for notification tracking and status
- **ticket_attachments**: Indexes for evidence photos and file retrieval
- **ticket_notes**: Indexes for note types and chronological queries
- **qa_readiness_checks**: Indexes for readiness validation history
- **qa_risk_acceptances**: Indexes for active risks, expiring risks, and follow-ups
- **handover_snapshots**: Indexes for handover history and ownership tracking
- **repeat_fault_escalations**: Indexes for pattern detection by scope (pole, PON, zone, DR)

Also adds foreign key constraints for referential integrity.

## Prerequisites

The following tables must exist before running these migrations:
- `users` (referenced by multiple tables)
- `projects` (referenced by tickets and guarantee_periods - optional for initial migration)
- `contractors` (referenced by tickets - optional for initial migration)

## Running Migrations

### Option 1: Neon Console
1. Log into Neon Console
2. Navigate to your database
3. Run each migration file in order (001 → 002 → 003)

### Option 2: Command Line (psql)
```bash
# Set your Neon connection string
export DATABASE_URL="postgresql://user:password@host/database?sslmode=require"

# Run migrations in order
psql $DATABASE_URL -f 001_create_core_tables.sql
psql $DATABASE_URL -f 002_create_maintenance_tables.sql
psql $DATABASE_URL -f 003_create_indexes.sql
```

### Option 3: Node.js Script
```javascript
import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const sql = neon(process.env.DATABASE_URL);

// Read and execute each migration
const migration1 = fs.readFileSync('001_create_core_tables.sql', 'utf8');
const migration2 = fs.readFileSync('002_create_maintenance_tables.sql', 'utf8');
const migration3 = fs.readFileSync('003_create_indexes.sql', 'utf8');

await sql(migration1);
await sql(migration2);
await sql(migration3);

console.log('✅ Migrations completed successfully');
```

## Verification

After running migrations, verify table creation:

```sql
-- Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'ticket%'
  OR table_name IN ('qa_readiness_checks', 'qa_risk_acceptances', 'handover_snapshots', 'repeat_fault_escalations', 'weekly_reports', 'qcontact_sync_log', 'whatsapp_notifications', 'verification_steps');

-- Check indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE tablename LIKE 'ticket%'
  OR tablename IN ('qa_readiness_checks', 'qa_risk_acceptances', 'handover_snapshots', 'repeat_fault_escalations', 'weekly_reports', 'qcontact_sync_log', 'whatsapp_notifications', 'verification_steps')
ORDER BY tablename, indexname;

-- Check foreign key constraints
SELECT conname, conrelid::regclass AS table_name, confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text LIKE 'ticket%'
  OR conrelid::regclass::text IN ('qa_readiness_checks', 'qa_risk_acceptances', 'handover_snapshots', 'repeat_fault_escalations', 'verification_steps')
ORDER BY table_name;
```

## Rollback

To rollback migrations (⚠️ USE WITH CAUTION - THIS WILL DELETE ALL DATA):

```sql
-- Drop tables in reverse order (to respect foreign key constraints)
DROP TABLE IF EXISTS repeat_fault_escalations CASCADE;
DROP TABLE IF EXISTS handover_snapshots CASCADE;
DROP TABLE IF EXISTS qa_risk_acceptances CASCADE;
DROP TABLE IF EXISTS qa_readiness_checks CASCADE;
DROP TABLE IF EXISTS ticket_notes CASCADE;
DROP TABLE IF EXISTS ticket_attachments CASCADE;
DROP TABLE IF EXISTS whatsapp_notifications CASCADE;
DROP TABLE IF EXISTS guarantee_periods CASCADE;
DROP TABLE IF EXISTS qcontact_sync_log CASCADE;
DROP TABLE IF EXISTS weekly_reports CASCADE;
DROP TABLE IF EXISTS verification_steps CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;

-- Drop trigger function
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
```

## Notes

- All migrations use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotency
- Tables use UUID primary keys (via `gen_random_uuid()`) for distributed systems compatibility
- Triggers automatically update `updated_at` timestamps on tickets and guarantee_periods tables
- Foreign key constraints use `ON DELETE CASCADE` for dependent records or `ON DELETE SET NULL` for audit trails
- JSONB columns are used for flexible structured data (errors, evidence links, decisions, etc.)
- CHECK constraints enforce enum values at the database level
- Partial indexes are used for conditional queries (e.g., active SLAs, evidence photos only)

## Schema Design Principles

1. **Immutability**: Handover snapshots are locked and immutable for audit compliance
2. **Audit Trail**: All critical operations tracked with timestamps and user references
3. **Data Integrity**: Foreign keys and CHECK constraints enforce business rules
4. **Performance**: Strategic indexes for common query patterns
5. **Flexibility**: JSONB for extensible data structures without schema changes
6. **Compliance**: Comprehensive audit logs for regulatory requirements

## References

- **Spec**: `.auto-claude/specs/001-ticketing-phase1-core/spec.md`
- **Implementation Plan**: `.auto-claude/specs/001-ticketing-phase1-core/implementation_plan.json`
- **PRD**: See spec.md for full requirements from PRD-v4.0-ENTERPRISE.md
