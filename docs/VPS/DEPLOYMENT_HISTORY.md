# VPS Deployment History

## November 3, 2025 - Initial VPS Deployment

### Summary
Successfully deployed FibreFlow Next.js application to Hostinger VPS (Lithuania) as a parallel deployment alongside Vercel.

### Server Details
- **Provider:** Hostinger
- **Location:** Lithuania (Vilnius)
- **IP:** 72.60.17.245
- **Hostname:** srv1092611.hstgr.cloud
- **Domain:** app.fibreflow.app
- **SSL:** Let's Encrypt (expires Feb 1, 2026)

### Deployment Method
1. ✅ Added DNS A record: app.fibreflow.app → 72.60.17.245
2. ✅ Created directory structure: /var/www/fibreflow/
3. ✅ Created production .env file on server
4. ✅ Cloned GitHub repo: VelocityFibre/FF_Next.js
5. ✅ Installed dependencies: npm ci
6. ✅ Built Next.js app: npm run build
7. ✅ Configured PM2 process manager
8. ✅ Configured Nginx reverse proxy
9. ✅ Set up SSL with Certbot
10. ✅ Tested deployment successfully

### Configuration
- **Stack:** Next.js + PM2 + Nginx + Let's Encrypt
- **Port:** 3005 (internal)
- **Process Manager:** PM2 v6.0.13
- **Web Server:** Nginx v1.24.0
- **Node.js:** v20.19.5
- **Mode:** Production (demo mode enabled, Clerk auth bypassed)

### DNS Configuration
- `app.fibreflow.app` → 72.60.17.245 (VPS)
- `www.fibreflow.app` → Vercel (unchanged)

### Initial Performance
- **Status:** Online
- **Uptime:** 50 minutes
- **Restarts:** 0
- **Memory:** 104 MB
- **Response Time:** < 1s

### Issues Encountered
1. **Large file transfer timeout**
   - Problem: Rsync of 433MB .next folder timed out
   - Solution: Cloned repo directly on server and built there

2. **None after deployment**
   - App started successfully on first try
   - SSL certificate obtained without issues
   - DNS propagated quickly (~15 minutes)

### Testing Results
- ✅ HTTPS working: https://app.fibreflow.app
- ✅ HTTP redirects to HTTPS
- ✅ App renders correctly
- ✅ PM2 running stable (0 restarts)
- ✅ Nginx proxy working
- ✅ SSL certificate valid

### Notes
- Deployment completed in parallel with Vercel (both running)
- Vercel remains primary production (www.fibreflow.app)
- VPS serves as testing/staging environment (app.fibreflow.app)
- Full control over server configuration and deployment
- Manual deployment process (can be automated with CI/CD later)

### Next Steps
- [ ] Monitor performance over next 24-48 hours
- [ ] Consider setting up automated deployments via GitHub Actions
- [ ] Evaluate if VPS should become primary or remain staging
- [ ] Set up monitoring/alerting (UptimeRobot, etc.)
- [ ] Consider implementing PM2 cluster mode for better performance

---

## November 7, 2025 - Database Consolidation & Critical Fix

### Summary
**CRITICAL**: Consolidated all VPS services to use single FibreFlow Neon database. Fixed production outage caused by wrong database connection.

### Problem Discovered
Production site (app.fibreflow.app) was **down** with database errors:
- FibreFlow app connected to **wrong database** (WhatsApp ticketing system)
- Drop Monitor (Python) writing to **different database** than FibreFlow was reading from
- Two separate Neon databases causing data sync issues
- Production showing "relation 'projects' does not exist" errors

### Root Cause Analysis
**Environment Configuration Mismatch:**

| Component | Old Database | Status |
|-----------|-------------|--------|
| FibreFlow Production | ep-damp-credit (❌ WRONG) | WhatsApp ticketing tables |
| FibreFlow Development | ep-damp-credit (❌ WRONG) | WhatsApp ticketing tables |
| Drop Monitor (Python) | ep-damp-credit (❌ WRONG) | WA Monitor data |
| **Should all use** | **ep-dry-night (✅ CORRECT)** | **FibreFlow tables** |

### Changes Deployed

**1. Database Consolidation:**
- ✅ Updated `/var/www/fibreflow/.env.production` → Correct FibreFlow DB
- ✅ Updated `/var/www/fibreflow-dev/.env.production` → Correct FibreFlow DB
- ✅ Updated `/opt/velo-test-monitor/.env` → Correct FibreFlow DB
- ✅ Added `whatsapp_message_date` column to FibreFlow DB schema
- ✅ Migrated 5 missing QA photo reviews from old → new database
- ✅ Total consolidated: 558 QA photo reviews in single database

**2. Services Restarted:**
- ✅ PM2 fibreflow-prod restarted (7 restarts during troubleshooting)
- ✅ PM2 fibreflow-dev restarted (1 restart)
- ✅ Drop Monitor (Python) restarted with new database config

**3. Configuration Files Updated:**
- `/var/www/fibreflow/.env.production`
- `/var/www/fibreflow-dev/.env.production`
- `/opt/velo-test-monitor/.env`
- `/opt/velo-test-monitor/services/start_drop_monitor.sh` (created)

### Database Migration Details

**Old Database (ep-damp-credit-a857vku0-pooler.eastus2.azure.neon.tech):**
- Tables: ContactCustomFields, Contacts, Messages, Queues, Tickets, Users, etc.
- QA Photo Reviews: 558 rows (latest: Nov 6, 13:46)
- **Purpose:** WhatsApp ticketing system (NOT FibreFlow)

**New Database (ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech):**
- Tables: projects, clients, contractors, staff, sow_poles, qa_photo_reviews, etc.
- QA Photo Reviews: 558 rows (after migration)
- **Purpose:** FibreFlow production database (CORRECT)

### Issues Encountered & Solutions

**Issue 1: Production Database Errors**
- **Error:** `relation "projects" does not exist`
- **Cause:** Connected to WhatsApp ticketing DB instead of FibreFlow DB
- **Solution:** Updated DATABASE_URL in .env.production files

**Issue 2: Data Sync Between Databases**
- **Error:** Drop Monitor writing to DB A, FibreFlow reading from DB B
- **Cause:** Different NEON_DATABASE_URL in drop monitor vs FibreFlow
- **Solution:** Standardized all services to use ep-dry-night database

**Issue 3: Missing Schema Column**
- **Error:** `column "whatsapp_message_date" does not exist` in FibreFlow DB
- **Cause:** Old DB had column, new DB didn't
- **Solution:** `ALTER TABLE qa_photo_reviews ADD COLUMN whatsapp_message_date TIMESTAMPTZ`

**Issue 4: 5 Missing QA Reviews**
- **Error:** FibreFlow DB had 553 rows, old DB had 558 rows
- **Cause:** Recent data written to old DB before consolidation
- **Solution:** Migrated 5 missing rows (DR1751923, DR1751928, DR1751927, DR1751942, DR1751939)

### Testing & Verification

**✅ All Services Verified Working:**
```bash
# Production app
curl https://app.fibreflow.app/api/wa-monitor-daily-drops
# Returns: {"success":true,"data":{...}}

# Database connection test
SELECT COUNT(*) FROM qa_photo_reviews;
# Returns: 558 rows

# PM2 status
pm2 list
# fibreflow-prod: online
# fibreflow-dev: online

# Drop monitor status
ps aux | grep realtime_drop_monitor.py
# PID: 726450 - running
```

**API Endpoints Tested:**
- ✅ `/api/wa-monitor-daily-drops` - Returns consolidated data
- ✅ `/api/wa-monitor-drops` - Returns all QA reviews
- ✅ `/wa-monitor` - Dashboard loads successfully

### Performance Impact
- **Downtime:** ~20 minutes (during troubleshooting and migration)
- **PM2 Restarts:** Production had 7 restarts (debugging), now stable
- **Memory Usage:** Production: 123MB, Development: 106MB (normal)
- **Database:** All services now use single source of truth

### Current Configuration

**Single Database for All Services:**
```
postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb
```

**Services Using Consolidated Database:**
1. FibreFlow Production (app.fibreflow.app)
2. FibreFlow Development (dev.fibreflow.app)
3. Drop Monitor (Python - WA Monitor)
4. All future VPS services

### Lessons Learned
1. **Always verify database connections** after initial deployment
2. **Environment variable audits** should be part of deployment checklist
3. **Test database connectivity** before declaring deployment complete
4. **Document which database** each service should use
5. **Monitor for "relation does not exist" errors** - indicates wrong database

### Next Steps
- [x] Monitor production stability over next 24 hours
- [x] Verify Drop Monitor writes to correct database
- [x] Update documentation (CLAUDE.md, deployment docs)
- [x] Fix local .env.local file (completed Nov 7, 2025)
- [ ] Add database connection health checks to monitoring
- [ ] Consider automated environment variable validation

### Post-Deployment Fix (Nov 7, 2025 - Later)

**Additional Issue Found**: Local `.env.local` file still pointing to old database
- **File**: `/home/louisdup/VF/Apps/FF_React/.env.local`
- **Issue**: Contained ep-damp-credit URL (old WhatsApp ticketing DB)
- **Impact**: None (app was using `.env.production.local` which was correct)
- **Fix**: Updated `.env.local` to point to ep-dry-night for consistency
- **Result**: All environment files now verified correct across all environments

---

## Future Deployments

*This section will track subsequent deployments and updates.*

### Template for Future Entries:
```
## [Date] - [Title]

**Changes:**
- List of changes deployed

**Deployment Method:**
- Steps taken

**Issues:**
- Any problems encountered and solutions

**Performance Impact:**
- Memory, CPU, response time changes
```

---

*Last Updated: November 7, 2025*
