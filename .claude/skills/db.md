---
name: db
description: Database schema management for FibreFlow Neon PostgreSQL — schema diff, migrations, branch comparison, safe query execution
version: 1.0.0
triggers:
  - /db
  - database schema
  - schema diff
  - schema migration
  - migration script
  - neon branch
  - schema drift
  - database comparison
  - DB schema
  - run migration
  - create table
  - alter table
  - neon database
---

# /db — Database Schema Agent

Manages FibreFlow's Neon PostgreSQL schema: migrations, branch comparisons, schema drift detection, and safe query execution.

## Quick Reference

| Item | Value |
|------|-------|
| **DB Type** | Neon PostgreSQL (serverless) |
| **Production branch** | `production` — `ep-dry-night-a9qyh4sj` |
| **Dev branch** | `hein-dev` — `ep-aged-poetry-a9bbd8e9` |
| **Connection format** | `postgresql://neondb_owner:<PW>@<endpoint>/neondb?sslmode=require` |
| **Credentials** | `.claude/credentials.local.md` (gitignored) |
| **Migrations dir** | `scripts/migrations/` |

## Branch Architecture

```
production branch (ep-dry-night-a9qyh4sj)
  └── Used by ALL environments (prod, staging, dev, VPS backup)
      ALL share the same production database

hein-dev branch (ep-aged-poetry-a9bbd8e9)
  └── Safe for experimental schema changes
      Use for migration testing before production
```

**CRITICAL:** All 4 deployed environments (app, vf, dev, backup) share the **production** Neon branch. Schema changes affect everyone immediately.

## Common Tasks

### Check Current Schema
```bash
# Via psql with production DATABASE_URL (from .env.local)
psql "$DATABASE_URL" -c "\dt" | head -50

# List all tables with row counts
psql "$DATABASE_URL" -c "
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

### Find Schema Differences (Dev vs Prod)
```bash
# Compare column lists for a specific table
psql "$PROD_DATABASE_URL" -c "\d+ table_name"
psql "$DEV_DATABASE_URL" -c "\d+ table_name"

# Find tables that exist in dev but not prod
psql "$PROD_DATABASE_URL" -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
EXCEPT
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public';"
# (run second query against dev)
```

### Check Migration Files
```bash
# List existing migrations
ls -la scripts/migrations/*.sql

# Check which migrations have run (if tracked)
psql "$DATABASE_URL" -c "
SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 20;"
```

### Run a Migration Safely
```bash
# 1. Test on dev branch first
psql "$DEV_DATABASE_URL" -f scripts/migrations/NNN_description.sql

# 2. Verify the change
psql "$DEV_DATABASE_URL" -c "\d+ affected_table"

# 3. Apply to production (run from Velocity if needed)
psql "$DATABASE_URL" -f scripts/migrations/NNN_description.sql
```

### Check Table Structure
```sql
-- Full table description
\d+ table_name

-- Specific columns
SELECT
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'your_table'
ORDER BY ordinal_position;

-- Indexes on table
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'your_table';

-- Foreign keys
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'your_table';
```

### Safe Column Addition (Zero-downtime)
```sql
-- SAFE: Add nullable column (instant)
ALTER TABLE table_name ADD COLUMN new_column TEXT;

-- SAFE: Add column with default (Postgres 11+ - instant)
ALTER TABLE table_name ADD COLUMN new_column BOOLEAN NOT NULL DEFAULT FALSE;

-- UNSAFE: Adding NOT NULL without default to existing data
-- Do this instead:
ALTER TABLE table_name ADD COLUMN new_column TEXT;
UPDATE table_name SET new_column = 'default_value' WHERE new_column IS NULL;
ALTER TABLE table_name ALTER COLUMN new_column SET NOT NULL;
```

### Migration File Naming Convention
```
scripts/migrations/NNN_description.sql
```
Where NNN is the next sequential number (e.g., `108_add_contractor_fault_reports.sql`).

### Common Migration Template
```sql
-- Migration: NNN_description
-- Date: YYYY-MM-DD
-- Purpose: <description>

BEGIN;

-- Your changes here
ALTER TABLE table_name ADD COLUMN new_field TEXT;

-- Add index if needed
CREATE INDEX CONCURRENTLY idx_table_field ON table_name(new_field);

COMMIT;
```

## Critical Rules

- **NO conditional SQL fragments** — `${cond ? sql\`AND x\` : sql\`\`}` breaks Neon
- **Never use nested dynamic routes** in API — flattened routes only
- **Use `BEGIN/COMMIT`** for multi-statement migrations
- **`CONCURRENTLY`** for indexes — avoids table lock
- **Test on dev branch first** — always
- **Check for trigger conflicts** — `tr_grn_stock_update` was disabled, don't re-enable

## DB Connection in Code

```typescript
// Standard pattern in pages/api/
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const rows = await sql`SELECT * FROM table WHERE id = ${id}`;
```

## Qdrant Ingestion (KB sync)

After schema changes, re-ingest to keep vector DB current:
```bash
cd /home/velo/fibreflow-production && export $(grep DATABASE_URL .env) && scripts/.venv/bin/python scripts/ingest-qdrant.py --force 2>&1
```

## Troubleshooting

### Neon Connection Errors
```bash
# Test connection
psql "$DATABASE_URL" -c "SELECT version();"

# Check if pooler endpoint is used (required for serverless)
# Should end in: -pooler.gwc.azure.neon.tech
echo $DATABASE_URL | grep pooler
```

### Migration Failed Mid-Way
```sql
-- Check if partial changes applied
SELECT * FROM information_schema.columns WHERE table_name = 'affected_table';

-- Rollback if inside transaction
ROLLBACK;
```

### Table Lock Issues
```sql
-- Check for locks
SELECT pid, query, state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE wait_event_type = 'Lock';

-- Kill blocking query (if necessary)
SELECT pg_terminate_backend(pid);
```

## Related
- `docs/INFRASTRUCTURE.md` — Server and DB endpoints
- `.claude/credentials.local.md` — Connection strings (gitignored)
- `scripts/migrations/` — All migration files
- `/kb` skill — Re-ingests schema to Qdrant after changes
