# WA Monitor Database Separation
**Date:** November 9, 2025
**Version:** 2.0
**Type:** Prod/Dev Environment Isolation

## Overview

The WA Monitor system uses **separate database schemas** for production and development environments to ensure complete isolation.

## Database Configuration

### Same Database, Different Schemas

**Database:** Neon PostgreSQL - `neondb`
**Connection:** Same connection string for both environments

**Production Schema:** `public.qa_photo_reviews`
**Development Schema:** `dev.qa_photo_reviews`

### Why Separate Schemas?

✅ **Complete Isolation:** Dev testing cannot corrupt production data
✅ **Same Connection:** No need for separate database credentials
✅ **Easy Cleanup:** Drop entire dev schema to reset
✅ **Cost Efficient:** One database, two schemas
✅ **Safe Testing:** Test database operations without risk

## Schema Details

### Production Schema (public)
```sql
-- Production writes to:
public.qa_photo_reviews

-- Example:
SELECT * FROM public.qa_photo_reviews WHERE project = 'Lawley';
```

**Used by:**
- `wa-monitor-prod` service
- FibreFlow Dashboard (`/wa-monitor`)
- SharePoint sync

### Development Schema (dev)
```sql
-- Development writes to:
dev.qa_photo_reviews

-- Example:
SELECT * FROM dev.qa_photo_reviews WHERE project = 'Velo Test';
```

**Used by:**
- `wa-monitor-dev` service only

## Configuration

### Production (/opt/wa-monitor/prod/)

**database.py:**
```python
class DatabaseManager:
    def __init__(self, connection_url: str):
        self.connection_url = connection_url
        self.table_name = "qa_photo_reviews"  # Default: public schema
```

**Writes to:** `public.qa_photo_reviews` (production data)

### Development (/opt/wa-monitor/dev/)

**database.py:**
```python
class DatabaseManager:
    def __init__(self, connection_url: str):
        self.connection_url = connection_url
        self.table_name = "dev.qa_photo_reviews"  # ← DEV SCHEMA
```

**Writes to:** `dev.qa_photo_reviews` (isolated test data)

## Verification Commands

### Check Both Tables

```bash
# Connect to database
psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'

# Count production drops
SELECT COUNT(*) FROM public.qa_photo_reviews;

# Count dev drops
SELECT COUNT(*) FROM dev.qa_photo_reviews;

# Compare recent activity
SELECT
    'PRODUCTION' as env,
    COUNT(*) as drops,
    MAX(created_at) as latest
FROM public.qa_photo_reviews
UNION ALL
SELECT
    'DEVELOPMENT' as env,
    COUNT(*) as drops,
    MAX(created_at) as latest
FROM dev.qa_photo_reviews;
```

### Check Service Logs

```bash
# Production logs (look for normal messages)
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log
# Example: "✅ Created QA review for DR12345678"

# Dev logs (look for [DEV] prefix)
tail -f /opt/wa-monitor/dev/logs/wa-monitor-dev.log
# Example: "✅ [DEV] Created QA review for DR12345678"
```

## Data Flow

### Production Data Flow
```
WhatsApp Message
    ↓
WhatsApp Bridge (SQLite)
    ↓
wa-monitor-prod service
    ↓
public.qa_photo_reviews ← PRODUCTION DATA
    ↓
Dashboard (/wa-monitor)
    ↓
SharePoint Sync
```

### Development Data Flow
```
WhatsApp Message (Velo Test group)
    ↓
WhatsApp Bridge (SQLite) ← SAME
    ↓
wa-monitor-dev service
    ↓
dev.qa_photo_reviews ← DEV DATA (ISOLATED)
```

**Key Point:** Both services read from same WhatsApp SQLite database, but write to different PostgreSQL schemas.

## Schema Management

### Create Dev Schema (Already Done)

```sql
-- Create dev schema
CREATE SCHEMA IF NOT EXISTS dev;

-- Create qa_photo_reviews table in dev schema
CREATE TABLE IF NOT EXISTS dev.qa_photo_reviews (
    -- Same structure as public.qa_photo_reviews
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    drop_number character varying(50) NOT NULL,
    -- ... all other columns same as production
    UNIQUE (drop_number, review_date)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_dev_qa_reviews_date ON dev.qa_photo_reviews(review_date);
CREATE INDEX IF NOT EXISTS idx_dev_qa_reviews_drop ON dev.qa_photo_reviews(drop_number);
CREATE INDEX IF NOT EXISTS idx_dev_qa_reviews_user ON dev.qa_photo_reviews(user_name);
```

### Reset Dev Data

```sql
-- Clear all dev data
TRUNCATE dev.qa_photo_reviews;

-- Or drop and recreate
DROP SCHEMA dev CASCADE;
CREATE SCHEMA dev;
-- Then recreate table
```

### Copy Production Data to Dev (For Testing)

```sql
-- Copy recent production data to dev for testing
INSERT INTO dev.qa_photo_reviews
SELECT * FROM public.qa_photo_reviews
WHERE created_at > NOW() - INTERVAL '7 days';
```

## Benefits

### 1. Safe Testing
- Test new features in dev without affecting production
- No risk of corrupting production data
- Can truncate dev schema anytime

### 2. Easy Comparison
```bash
# Test a change in dev, compare with prod
grep "✅ Created" /opt/wa-monitor/prod/logs/wa-monitor-prod.log | wc -l  # Prod count
grep "✅ Created" /opt/wa-monitor/dev/logs/wa-monitor-dev.log | wc -l   # Dev count
```

### 3. Quick Rollback
- If dev breaks, just restart service
- Production unaffected
- No database recovery needed

### 4. Cost Efficient
- No separate database needed
- Same connection string
- Neon charges for storage, not schemas

## Important Notes

### Dashboard Shows Production Data Only
The FibreFlow dashboard (`/wa-monitor`) only queries `public.qa_photo_reviews`.

To view dev data, query directly:
```sql
SELECT * FROM dev.qa_photo_reviews ORDER BY created_at DESC LIMIT 20;
```

### SharePoint Sync Uses Production Only
Nightly SharePoint sync only reads from `public.qa_photo_reviews`.

Dev data is never synced to SharePoint.

### Both Services Process Same Messages
- Both services read from same WhatsApp bridge SQLite
- Same messages trigger both prod and dev
- But they write to different tables
- **Result:** Perfect isolated testing environment

## Troubleshooting

### Issue: Dev not writing to dev schema

**Check:**
```bash
# 1. Verify database.py has correct table_name
grep "table_name" /opt/wa-monitor/dev/modules/database.py
# Should show: self.table_name = "dev.qa_photo_reviews"

# 2. Check logs for [DEV] prefix
tail -20 /opt/wa-monitor/dev/logs/wa-monitor-dev.log | grep "\[DEV\]"
```

### Issue: Schema doesn't exist

**Fix:**
```sql
-- Recreate dev schema
CREATE SCHEMA IF NOT EXISTS dev;

-- Verify
\dn
# Should show both 'public' and 'dev'
```

### Issue: Want to test with production data

**Copy recent data:**
```sql
-- Copy last 24 hours of prod data to dev
TRUNCATE dev.qa_photo_reviews;

INSERT INTO dev.qa_photo_reviews
SELECT * FROM public.qa_photo_reviews
WHERE created_at > NOW() - INTERVAL '24 hours';

SELECT COUNT(*) FROM dev.qa_photo_reviews;
```

## Migration History

**Before (Nov 9, 2025 - 19:11 UTC):**
- Both prod and dev wrote to `public.qa_photo_reviews`
- Dev testing could corrupt production data
- No isolation

**After (Nov 9, 2025 - 19:56 UTC):**
- Production writes to `public.qa_photo_reviews`
- Development writes to `dev.qa_photo_reviews`
- Complete isolation ✅

## Related Documentation

- **Architecture:** `WA_MONITOR_ARCHITECTURE_V2.md`
- **Dual-Monitoring:** `WA_MONITOR_DUAL_TESTING.md`
- **Database Setup:** `WA_MONITOR_DATABASE_SETUP.md`

---

**Summary:** Production and development are now completely isolated. Test freely in dev without any risk to production! 🎉
