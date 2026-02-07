# Neon Database Configuration
**FibreFlow Production Database**

## Neon Project Details

**Project Information (from Neon Dashboard):**
- **Project Name**: FF_React
- **Project ID**: sparkling-bar-47287977
- **Database Endpoint**: ep-dry-night-a9qyh4sj
- **Region**: Azure GWC (Global West Coast)

## Connection Details

### Production Connection String
```bash
postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

### Environment Variable Name
Use `DATABASE_URL` in all FibreFlow environments:
- `.env.local` (local development)
- `.env.production` (VPS production)
- `.env.production` (VPS development)

For WA Monitor Python service, use:
- `NEON_DATABASE_URL` in `/opt/velo-test-monitor/.env`

## Database Scope

### This Database Contains:

**FibreFlow Application Data:**
- ✅ 104 total tables
- ✅ `projects`, `clients`, `contractors`, `staff`
- ✅ `sow_poles`, `sow_fibre`, `sow_drops`
- ✅ All FibreFlow business logic tables

**WA Monitor Data:**
- ✅ `qa_photo_reviews` (558 rows as of Nov 7, 2025)
- ✅ Real-time QA drop submissions from WhatsApp

### All Services Using This Database:

| Service | Environment | Config File | Variable |
|---------|-------------|-------------|----------|
| FibreFlow App (Local) | localhost:3005 | `.env.local` | `DATABASE_URL` |
| FibreFlow Production | app.fibreflow.app | `/var/www/fibreflow/.env.production` | `DATABASE_URL` |
| FibreFlow Development | dev.fibreflow.app | `/var/www/fibreflow-dev/.env.production` | `DATABASE_URL` |
| Drop Monitor (Python) | VPS Background Service | `/opt/velo-test-monitor/.env` | `NEON_DATABASE_URL` |

## Access Methods

### 1. Direct SQL (psql)
```bash
# From command line
psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'

# Example queries
SELECT COUNT(*) FROM projects;
SELECT COUNT(*) FROM qa_photo_reviews;
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
```

### 2. Neon Serverless Client (Node.js)
```javascript
import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require');

// Query example
const projects = await sql`SELECT * FROM projects`;
console.log(projects);
```

### 3. Standard PostgreSQL Client (pg)
```javascript
import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
});

await client.connect();
const res = await client.query('SELECT * FROM projects');
console.log(res.rows);
await client.end();
```

## Neon Dashboard Access

**URL**: https://console.neon.tech/app/projects/sparkling-bar-47287977

From the dashboard you can:
- View database metrics and usage
- Monitor connections
- Manage branches
- View query statistics
- Configure compute settings
- Manage database users

## Database Statistics (as of Nov 7, 2025)

```
Total Tables: 104
Key Tables:
  - projects: 2 rows
  - contractors: 20 rows
  - clients: 1 row
  - qa_photo_reviews: 558 rows (WA Monitor)
  - sow_poles: varies by project
  - sow_fibre: varies by project
```

## Backups & Recovery

Neon provides:
- ✅ **Point-in-Time Recovery** (PITR) - Available via Neon dashboard
- ✅ **Automatic Backups** - Managed by Neon
- ✅ **Branch Creation** - Create database branches for testing

**To restore to a previous point in time:**
1. Go to Neon dashboard
2. Navigate to project: sparkling-bar-47287977
3. Select "Branches" → Create new branch from specific timestamp
4. Update connection string to point to new branch

## Security

**Credentials Management:**
- ✅ Database password: `$NEON_DB_PASSWORD_OLD` (stored in environment variables)
- ✅ SSL/TLS required: `sslmode=require`
- ✅ Channel binding: `channel_binding=require`
- ⚠️ **Never commit credentials to git** - Use environment files (.env)

**Access Control:**
- Database user: `neondb_owner` (full access)
- No public access - requires credentials
- All connections must use SSL

## Related Documentation

- **Database Consolidation**: `docs/DATABASE_CONSOLIDATION.md`
- **VPS Deployment History**: `docs/VPS/DEPLOYMENT_HISTORY.md` (Nov 7, 2025 entry)
- **Changelog**: `docs/CHANGELOG.md` (Nov 7, 2025 entry)
- **WA Monitor Integration**: See CLAUDE.md "WhatsApp Monitor (WA Monitor) Integration" section

## Quick Reference

```bash
# Test connection
psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require' -c "SELECT version();"

# List all tables
psql "$DATABASE_URL" -c "\dt"

# Count records in key tables
psql "$DATABASE_URL" -c "
  SELECT
    'projects' as table_name, COUNT(*) FROM projects
  UNION ALL
  SELECT 'contractors', COUNT(*) FROM contractors
  UNION ALL
  SELECT 'qa_photo_reviews', COUNT(*) FROM qa_photo_reviews;
"
```

---

**Document Created**: November 7, 2025
**Last Updated**: November 7, 2025
**Status**: ✅ Single consolidated database for all FibreFlow services
