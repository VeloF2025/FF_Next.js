# Environment Files Reference
**Last Updated**: November 7, 2025

## Overview
All FibreFlow environment files now point to the single consolidated database (ep-dry-night).

---

## Local Development Environment

### File: `.env.local`
**Location**: `/home/louisdup/VF/Apps/FF_React/.env.local`
**Purpose**: Used when running `npm run dev` (development mode)
**Database**: ep-dry-night (FibreFlow consolidated DB)

```bash
DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

**Fix History**: Updated Nov 7, 2025 (was pointing to ep-damp-credit)

---

### File: `.env.production.local`
**Location**: `/home/louisdup/VF/Apps/FF_React/.env.production.local`
**Purpose**: Used when running `npm start` (production mode locally)
**Database**: ep-dry-night (FibreFlow consolidated DB)

```bash
DATABASE_URL="postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require"
```

**Status**: Already correct (Nov 6, 2025)

---

## VPS Production Environment

### File: `/var/www/fibreflow/.env.production`
**Server**: 72.60.17.245 (Hostinger VPS - Lithuania)
**Purpose**: FibreFlow Production (app.fibreflow.app)
**Database**: ep-dry-night (FibreFlow consolidated DB)

```bash
DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

**Fix History**: Updated Nov 7, 2025 (was pointing to ep-damp-credit)

**Access via SSH**:
```bash
ssh root@72.60.17.245
cat /var/www/fibreflow/.env.production | grep DATABASE_URL
```

---

## VPS Development Environment

### File: `/var/www/fibreflow-dev/.env.production`
**Server**: 72.60.17.245 (Hostinger VPS - Lithuania)
**Purpose**: FibreFlow Development (dev.fibreflow.app)
**Database**: ep-dry-night (FibreFlow consolidated DB)

```bash
DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

**Fix History**: Updated Nov 7, 2025 (was pointing to ep-damp-credit)

**Access via SSH**:
```bash
ssh root@72.60.17.245
cat /var/www/fibreflow-dev/.env.production | grep DATABASE_URL
```

---

## Drop Monitor (Python Service)

### File: `/opt/velo-test-monitor/.env`
**Server**: 72.60.17.245 (Hostinger VPS - Lithuania)
**Purpose**: WA Monitor Python service (monitors WhatsApp for QA drops)
**Database**: ep-dry-night (FibreFlow consolidated DB)

```bash
NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

**Fix History**: Updated Nov 7, 2025 (was pointing to ep-damp-credit)

**Access via SSH**:
```bash
ssh root@72.60.17.245
cat /opt/velo-test-monitor/.env | grep NEON_DATABASE_URL
```

---

## Environment File Priority (Next.js)

### Development Mode (`npm run dev`)
Loads in this order (first found wins):
1. `.env.development.local` (not used in FibreFlow)
2. **`.env.local`** ← **USED** (ep-dry-night ✅)
3. `.env.development` (not used in FibreFlow)
4. `.env`

### Production Mode (`npm start`)
Loads in this order (first found wins):
1. **`.env.production.local`** ← **USED** (ep-dry-night ✅)
2. `.env.local` (ignored in production mode)
3. `.env.production` (not used in FibreFlow)
4. `.env`

---

## Database Details

**Consolidated FibreFlow Database:**
- **Neon Project**: FF_React
- **Project ID**: sparkling-bar-47287977
- **Endpoint**: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
- **Database**: neondb
- **User**: neondb_owner
- **Password**: $NEON_DB_PASSWORD_OLD

**Full Connection String:**
```
postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

---

## Verification Commands

### Local Environment
```bash
# Check .env.local
grep DATABASE_URL .env.local

# Check .env.production.local
grep DATABASE_URL .env.production.local

# Test database connection
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT COUNT(*) FROM projects\`.then(r => console.log('✅ Connected:', r[0].count, 'projects'));
"
```

### VPS Environment
```bash
# SSH into VPS
ssh root@72.60.17.245

# Check production config
grep DATABASE_URL /var/www/fibreflow/.env.production

# Check dev config
grep DATABASE_URL /var/www/fibreflow-dev/.env.production

# Check drop monitor config
grep NEON_DATABASE_URL /opt/velo-test-monitor/.env
```

---

## Troubleshooting

### If Local App Shows Wrong Data

**Problem**: App showing old data or "relation does not exist" errors

**Solution**:
1. Check which environment file is being loaded:
   ```bash
   # Dev mode: uses .env.local
   npm run dev

   # Production mode: uses .env.production.local
   npm start
   ```

2. Verify DATABASE_URL points to ep-dry-night:
   ```bash
   grep DATABASE_URL .env.local
   grep DATABASE_URL .env.production.local
   ```

3. Both should contain: `ep-dry-night-a9qyh4sj-pooler`

### If VPS Shows Wrong Data

**Problem**: VPS production/dev showing wrong data

**Solution**:
1. SSH into VPS:
   ```bash
   ssh root@72.60.17.245
   ```

2. Check environment files:
   ```bash
   grep DATABASE_URL /var/www/fibreflow/.env.production
   grep DATABASE_URL /var/www/fibreflow-dev/.env.production
   ```

3. Should contain: `ep-dry-night-a9qyh4sj-pooler`

4. If wrong, fix and restart PM2:
   ```bash
   pm2 restart fibreflow-prod
   pm2 restart fibreflow-dev
   ```

---

## Related Documentation

- **Database Consolidation**: `docs/DATABASE_CONSOLIDATION.md`
- **Neon Database Reference**: `docs/NEON_DATABASE.md`
- **VPS Deployment History**: `docs/VPS/DEPLOYMENT_HISTORY.md`
- **Changelog**: `docs/CHANGELOG.md`

---

**Document Version**: 1.0
**Created**: November 7, 2025
**Status**: ✅ All environment files verified correct
