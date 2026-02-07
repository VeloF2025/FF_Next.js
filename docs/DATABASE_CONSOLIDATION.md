# Database Consolidation Documentation
**Created**: November 6, 2025 (Local Development)
**Updated**: November 7, 2025 (VPS Production - CRITICAL FIX)
**Status**: ✅ COMPLETE

## Overview
All FibreFlow services (app and WA Monitor) now share a single Neon PostgreSQL database across all environments (local, VPS production, VPS development).

## Consolidated Database

### Database Details
- **Neon Project Name**: FF_React
- **Neon Project ID**: sparkling-bar-47287977
- **Database Name**: ep-dry-night-a9qyh4sj
- **Host**: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
- **Region**: Azure GWC (Global West Coast)
- **Connection URL**:
  ```
  postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
  ```

### Tables in Database
**FibreFlow App Tables:**
- `contractors` - Contractor management
- `projects` - Project tracking
- `clients` - Client information
- `staff` - Staff management
- `sow_fibre` - Statement of Work fiber data
- `sow_poles` - SOW pole data
- `sow_drops` - SOW drop data
- And more...

**WA Monitor Tables:**
- `qa_photo_reviews` - QA review drops (553 records as of Nov 6, 2025)
- 12 QA step columns (step_01_house_photo through step_12_customer_signature)

## Configuration Files

### 1. FibreFlow App
**File**: `/home/louisdup/VF/Apps/FF_React/.env.production.local`
```bash
DATABASE_URL="postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require"
```

**Access**:
- App URL: http://localhost:3005
- WA Monitor Dashboard: http://localhost:3005/wa-monitor
- API Endpoint: http://localhost:3005/api/wa-monitor-drops

### 2. WA Monitor Service
**File**: `/home/louisdup/VF/deployments/railway/WA_monitor _Velo_Test/.env`
```bash
NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

**Service Components**:
- WhatsApp Bridge (Port 8080)
- Backend API (Port 5000)
- Frontend (Port 3001)
- MCP Server (Port 3000)

## Migration Summary

### What Was Done (Nov 6, 2025)
1. ✅ Exported `qa_photo_reviews` table from old WA Monitor DB (ep-damp-credit)
2. ✅ Imported 553 QA records to FibreFlow DB (ep-dry-night)
3. ✅ Updated FibreFlow `.env.production.local` to point to ep-dry-night
4. ✅ Updated WA Monitor `.env` to point to ep-dry-night
5. ✅ Rebuilt and tested FibreFlow app
6. ✅ Verified both systems work with consolidated database

### Previous Setup (Before Nov 6, 2025)
- **FibreFlow App**: Used ep-dry-night (ep-dry-night-a9qyh4sj)
- **WA Monitor Service**: Used ep-damp-credit (ep-damp-credit-a857vku0)
- **Problem**: Data was split across two databases

## Verification

### Test Queries
```bash
# Count QA reviews
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM qa_photo_reviews;"
# Result: 553 records

# Count contractors
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM contractors;"
# Result: 20 records

# Recent drops
psql "$DATABASE_URL" -c "SELECT drop_number, project, created_at FROM qa_photo_reviews ORDER BY created_at DESC LIMIT 5;"
```

### API Tests
```bash
# WA Monitor API
curl http://localhost:3005/api/wa-monitor-drops | jq '.data | length'
# Expected: 553

# Contractors API
curl http://localhost:3005/api/contractors | jq '.data | length'
# Expected: 20
```

## Next Steps

### For WA Monitor Service
When WA Monitor services are restarted, they will now write to the FibreFlow database automatically:
```bash
cd /home/louisdup/VF/deployments/railway/WA_monitor\ _Velo_Test
# Restart services to pick up new database config
```

### Data Sync
- **Real-time**: New QA reviews from WA Monitor → FibreFlow DB
- **Dashboard**: FibreFlow WA Monitor dashboard shows live data
- **No manual sync needed**: Both systems write to same database

## Old Database (Deprecated)

### ep-damp-credit-a857vku0
- **Status**: ⚠️ DEPRECATED - DO NOT USE
- **Data**: Archived WA Monitor data (pre-Nov 6, 2025)
- **Action**: Can be deleted after verifying all data migrated
- **Verification**: Check WA Monitor dashboard shows recent Nov 6 data

## Support

### If WA Monitor Dashboard Shows Old Data
1. Verify `.env.production.local` points to ep-dry-night
2. Rebuild FibreFlow: `npm run build && PORT=3005 npm start`
3. Check API: `curl http://localhost:3005/api/wa-monitor-drops`

### If WA Monitor Service Not Writing
1. Verify WA Monitor `.env` points to ep-dry-night
2. Restart WA Monitor services
3. Test with new drop submission

## Record Count History
- **Nov 7, 2025**: 558 QA reviews (after VPS production consolidation + 5 missing rows migrated)
- **Nov 6, 2025 12:00 PM**: 553 QA reviews migrated (local development)
- **Nov 6, 2025 10:32 AM**: Last drop (DR1857010) from Mohadin project

---

## VPS Production Consolidation (Nov 7, 2025)

### CRITICAL FIX - Production Outage

**Problem**: VPS production site (app.fibreflow.app) was **DOWN** due to wrong database configuration.

**Symptoms**:
- Users unable to access https://app.fibreflow.app/wa-monitor
- Database errors: `relation "projects" does not exist`
- FibreFlow app connected to WhatsApp ticketing system database (WRONG!)
- Drop Monitor writing to different database than FibreFlow reading from

### VPS Configuration Updates (Nov 7, 2025)

**1. FibreFlow Production (VPS)**
**File**: `/var/www/fibreflow/.env.production`
```bash
# BEFORE (WRONG!)
DATABASE_URL=postgresql://neondb_owner:npg_RIgDxzo4St6d@ep-damp-credit-a857vku0-pooler.eastus2.azure.neon.tech/neondb

# AFTER (CORRECT!)
DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb
```

**2. FibreFlow Development (VPS)**
**File**: `/var/www/fibreflow-dev/.env.production`
```bash
# BEFORE (WRONG!)
DATABASE_URL=postgresql://neondb_owner:npg_RIgDxzo4St6d@ep-damp-credit-a857vku0-pooler.eastus2.azure.neon.tech/neondb

# AFTER (CORRECT!)
DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb
```

**3. Drop Monitor (VPS Python Service)**
**File**: `/opt/velo-test-monitor/.env`
```bash
# BEFORE (WRONG!)
NEON_DATABASE_URL=postgresql://neondb_owner:npg_RIgDxzo4St6d@ep-damp-credit-a857vku0-pooler.eastus2.azure.neon.tech/neondb

# AFTER (CORRECT!)
NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb
```

### Schema & Data Migration (Nov 7, 2025)

**Added Missing Column:**
```sql
ALTER TABLE qa_photo_reviews
ADD COLUMN IF NOT EXISTS whatsapp_message_date TIMESTAMPTZ;
```

**Migrated Missing Data:**
- DR1751923 (Lawley)
- DR1751928 (Lawley)
- DR1751927 (Lawley)
- DR1751942 (Lawley)
- DR1751939 (Lawley)

**Result**: 553 + 5 = 558 total QA photo reviews consolidated in FibreFlow DB

### Services Restarted (Nov 7, 2025)

```bash
# VPS Production
ssh root@72.60.17.245
pm2 restart fibreflow-prod
pm2 restart fibreflow-dev

# Drop Monitor
pkill -f realtime_drop_monitor.py
cd /opt/velo-test-monitor/services
nohup python3 realtime_drop_monitor.py --interval 15 >> ../logs/drop_monitor.log 2>&1 &
```

### Verification (Nov 7, 2025)

**✅ All Services Using Correct Database:**

| Service | Environment | Database | Status |
|---------|-------------|----------|--------|
| FibreFlow Prod | VPS (app.fibreflow.app) | ep-dry-night | ✅ Online |
| FibreFlow Dev | VPS (dev.fibreflow.app) | ep-dry-night | ✅ Online |
| Drop Monitor | VPS (Python service) | ep-dry-night | ✅ Running |
| Local Development | localhost:3005 | ep-dry-night | ✅ Working |

**API Tests:**
```bash
# WA Monitor API (VPS Production)
curl https://app.fibreflow.app/api/wa-monitor-daily-drops
# Response: {"success":true,"data":{...}} ✅

# Database row count
node -e "sql\`SELECT COUNT(*) FROM qa_photo_reviews\`"
# Result: 558 rows ✅
```

### Two Databases Explained

**OLD DATABASE (ep-damp-credit) - DEPRECATED FOR FIBREFLOW**
- Host: ep-damp-credit-a857vku0-pooler.eastus2.azure.neon.tech
- Purpose: WhatsApp ticketing system (separate project, NOT FibreFlow)
- Tables: ContactCustomFields, Contacts, Messages, Queues, Tickets, Users
- Status: ⚠️ **DO NOT USE FOR FIBREFLOW**
- Contains: WhatsApp ticketing data + old QA reviews (558 rows - now migrated)

**NEW DATABASE (ep-dry-night) - FIBREFLOW SOURCE OF TRUTH** ✅
- **Neon Project**: FF_React (ID: sparkling-bar-47287977)
- Host: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
- Purpose: FibreFlow production database (ALL environments)
- Tables: projects, clients, contractors, staff, sow_*, qa_photo_reviews (104 total tables)
- Status: ✅ **SINGLE SOURCE OF TRUTH FOR FIBREFLOW**
- Contains: All FibreFlow data + consolidated QA reviews (558 rows)

### Impact & Resolution

**Downtime**: ~20 minutes (Nov 7, 2025 07:00-07:20 UTC)
**Root Cause**: Environment variables pointing to wrong database
**Resolution**: All VPS services consolidated to FibreFlow database (ep-dry-night)
**Status**: ✅ Production restored, all services stable

**Additional Fix (Nov 7, 2025 - Later):**
- Fixed local `.env.local` file to point to correct database
- Was pointing to ep-damp-credit (old), now points to ep-dry-night (correct)
- Did not cause downtime (production mode was using `.env.production.local` which was already correct)
- Fix ensures consistency across all environment files

**Lesson Learned**: Always verify DATABASE_URL in ALL environment files after VPS deployments

---
**Document Version**: 2.0
**Last Updated**: November 7, 2025
**Maintained By**: FibreFlow Development Team
