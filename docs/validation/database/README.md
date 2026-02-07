# Database Validation Module

**Purpose**: Validate Neon PostgreSQL database connectivity, schema integrity, and data quality

**Status**: ✅ Ready to Run
**Version**: 1.0
**Created**: November 24, 2025
**Last Updated**: November 24, 2025

---

## Overview

This module validates the foundational database layer that all FibreFlow features depend on. It tests connectivity, schema integrity, data quality, and performance of the Neon PostgreSQL database.

### What It Tests

**7 Critical Scenarios** across **25+ individual tests**:

1. **Database Connectivity** (4 tests)
   - Neon PostgreSQL connection
   - Connection pooling
   - SSL/TLS security
   - Connection timeout handling

2. **Schema Validation** (6 tests)
   - Critical tables exist
   - Column structure correct
   - Indexes present
   - Foreign key constraints
   - Primary keys
   - Data types correct

3. **Data Integrity** (5 tests)
   - No orphaned records
   - Referential integrity
   - Required fields populated
   - Data format consistency
   - Duplicate detection

4. **Critical Data Existence** (4 tests)
   - Projects table populated
   - Contractors exist
   - QA photo reviews present
   - Staff records exist

5. **Query Performance** (3 tests)
   - Connection time < 2s
   - Simple queries < 500ms
   - Complex joins < 2s

6. **Database Configuration** (2 tests)
   - Correct database URL (ep-dry-night-a9qyh4sj)
   - Not using old database (ep-damp-credit-a857vku0)

7. **Data Quality Checks** (3 tests)
   - Recent data exists (< 30 days old)
   - No test/dummy data in production
   - Timestamp fields valid

---

## Database Architecture

### Primary Database (MUST USE)

```
postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require
```

**Project**: FF_React
**Region**: AWS US East
**Type**: Neon Serverless PostgreSQL
**Connection**: Pooled (serverless driver)

### ⚠️ CRITICAL: Database Verification

**ALL environments MUST use ep-dry-night-a9qyh4sj**:
- ✅ Local development
- ✅ VPS Production
- ✅ VPS Dev
- ✅ WA Monitor (prod & dev)

**DO NOT USE**: ep-damp-credit-a857vku0 (old/incorrect)

---

## Critical Tables

### Core Application Tables

| Table | Purpose | Critical? | Validation Tests |
|-------|---------|-----------|------------------|
| `projects` | Project master data | ✅ Yes | Exists, has records, required fields |
| `contractors` | Contractor records | ✅ Yes | Exists, has records, RAG calculations |
| `staff` | Staff/user records | ✅ Yes | Exists, has records |
| `clients` | Client companies | ⚠️ Important | Exists, referential integrity |
| `suppliers` | Supplier records | ⚠️ Important | Exists, referential integrity |

### WhatsApp Monitor Tables

| Table | Purpose | Critical? | Validation Tests |
|-------|---------|-----------|------------------|
| `qa_photo_reviews` | QA submissions from WhatsApp | ✅ Yes | Exists, recent data, all columns present |
| `whatsapp_message_date` column | Source of truth for daily counts | ✅ Yes | Not null, valid timestamps |

### Fiber Network Tables

| Table | Purpose | Critical? | Validation Tests |
|-------|---------|-----------|------------------|
| `fibre` | Fiber segment data | ✅ Yes | Exists, segment_id unique |
| `poles` | Pole locations | ⚠️ Important | Exists, coordinates valid |
| `drops` | Customer drop data | ✅ Yes | Exists, drop_number unique |

### Supporting Tables

| Table | Purpose | Critical? | Validation Tests |
|-------|---------|-----------|------------------|
| `documents` | Document attachments | ⚠️ Important | Exists, foreign keys valid |
| `teams` | Team assignments | ⚠️ Important | Exists |
| `procurement` | Stock/procurement | ⚠️ Important | Exists |

---

## Schema Validation Rules

### Table Existence
- All critical tables must exist
- No missing tables from core schema
- Table names follow convention (lowercase, snake_case)

### Column Validation
- Required columns present
- Data types correct (TEXT, INTEGER, TIMESTAMP, etc.)
- NOT NULL constraints on critical fields
- Default values set where appropriate

### Indexes
- Primary keys on all tables
- Foreign key indexes exist
- Performance indexes on frequently queried columns
- Unique indexes where required (segment_id, drop_number)

### Constraints
- Foreign key relationships valid
- Check constraints enforced
- Unique constraints prevent duplicates

---

## Data Integrity Rules

### No Orphaned Records
- All foreign keys reference existing records
- Contractors linked to valid projects
- Documents linked to existing entities
- QA reviews linked to valid projects

### Required Fields
- `created_at` populated on all records
- `project` field not null on project-linked tables
- `drop_number` not null on QA reviews
- `whatsapp_message_date` not null on QA reviews

### Data Format Consistency
- Phone numbers: 11 digits (27xxxxxxxxx format)
- Drop numbers: DRxxxxxxx format
- Timestamps: Valid PostgreSQL timestamptz
- Booleans: true/false (not strings)

---

## Performance Benchmarks

### Connection Time
- **Target**: < 1 second
- **Warning**: 1-2 seconds
- **Fail**: > 2 seconds

### Simple Queries (SELECT with WHERE)
- **Target**: < 200ms
- **Warning**: 200-500ms
- **Fail**: > 500ms

### Complex Queries (JOINs, aggregations)
- **Target**: < 1 second
- **Warning**: 1-2 seconds
- **Fail**: > 2 seconds

### Connection Pooling
- Verify pooler endpoint used (-pooler.gwc.azure.neon.tech)
- Connection reuse working
- No connection leaks

---

## Validation Approach

### 1. Connectivity Tests
```sql
-- Test basic connection
SELECT NOW();

-- Test SSL/TLS
SELECT ssl_is_used();

-- Test connection info
SELECT current_database(), current_user;
```

### 2. Schema Tests
```sql
-- List all tables
SELECT tablename FROM pg_tables WHERE schemaname='public';

-- Check specific table columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'qa_photo_reviews';

-- Verify indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'qa_photo_reviews';
```

### 3. Data Integrity Tests
```sql
-- Check for orphaned QA reviews
SELECT COUNT(*) FROM qa_photo_reviews
WHERE project NOT IN (SELECT project_name FROM projects);

-- Check required fields
SELECT COUNT(*) FROM qa_photo_reviews
WHERE whatsapp_message_date IS NULL;

-- Check recent data
SELECT COUNT(*) FROM qa_photo_reviews
WHERE whatsapp_message_date > NOW() - INTERVAL '30 days';
```

---

## Known Limitations

This validation does NOT test:
- ❌ Database backups/recovery
- ❌ Replication status
- ❌ Neon-specific features (branching, etc.)
- ❌ Write performance (only reads)
- ❌ Transaction isolation
- ❌ Database size/storage limits

---

## Success Criteria

**Validation PASSES when**:
- Database connection successful
- All critical tables exist with correct schema
- No data integrity violations
- Recent data exists (< 30 days)
- Query performance within limits
- Correct database URL verified
- Pass rate ≥ 90% (23/25 tests)

**Validation FAILS when**:
- Cannot connect to database
- Critical tables missing
- Schema mismatch detected
- Data integrity violations found
- Using wrong database URL
- Pass rate < 90%

---

## Related Documentation

- **CLAUDE.md** - Database configuration section
- **Database Connection**: Neon PostgreSQL setup
- **WA Monitor**: Uses `qa_photo_reviews` table
- **API Responses**: Database query patterns

---

## Usage

Run validation:
```bash
/validate-database
```

Expected duration: 3-5 minutes

---

## Certification

**Target**: 10 successful validation runs
**Current**: 0/10
**Status**: ⏳ Not started

Once certified (10/10 successful runs), this module becomes a reference baseline for database health.

---

**Created**: November 24, 2025
**Module Version**: 1.0
**Test Count**: 25+ individual tests across 7 scenarios
