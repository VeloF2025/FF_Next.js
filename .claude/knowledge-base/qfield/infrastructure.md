# QFieldCloud Infrastructure Reference

## Overview

QFieldCloud is a self-hosted GIS synchronization service running on Docker. FibreFlow uses it for OES data sync to field devices.

## Server Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    VELOCITY SERVER (100.96.203.105)                     │
├─────────────────────────────────────────────────────────────────────────┤
│  QFieldCloud Docker Stack                                               │
│  ├── qfieldcloud-db-1        → PostgreSQL :5433 (34 projects) ✅       │
│  ├── qfieldcloud-app-1       → Django :8000                            │
│  ├── qfieldcloud-nginx-1     → Nginx :8082 → qfield.fibreflow.app      │
│  ├── qfieldcloud-worker_wrapper-{1..8}  → Background workers           │
│  ├── qfieldcloud-minio-1     → S3 storage :8009/:8010                  │
│  ├── qfieldcloud-memcached-1 → Cache :11211                            │
│  └── qfieldcloud-ofelia-1    → Cron scheduler                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        VPS (72.61.166.168)                              │
├─────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL :5433  → OLD/stale QFieldCloud DB copy (17 projects) ❌    │
│  (Do NOT use - incomplete data)                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Database Connection

**CORRECT Connection (Velocity - 34 projects):**
```typescript
const qfieldPool = new Pool({
  host: '100.96.203.105',  // Velocity server
  port: 5433,
  database: 'qfieldcloud_db',
  user: 'qfieldcloud_db_admin',
  password: 'c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753',
});
```

**WRONG Connection (VPS - stale data):**
```typescript
// ❌ Do NOT use - only has 17 of 34 projects
const qfieldPool = new Pool({
  host: '72.61.166.168',   // VPS - incomplete
  port: 5433,
  // ...
});
```

## Key Tables

| Table | Purpose |
|-------|---------|
| `core_project` | QFieldCloud projects (id, name, owner_id) |
| `core_person` | QFieldCloud users |
| `core_layer` | Project layers |
| `core_feature` | GIS features |

## FibreFlow Integration

### Dynamic Project Registry

QFieldCloud projects are now managed via FibreFlow database:

| Table | Purpose |
|-------|---------|
| `qfield_projects` | Registered QFieldCloud projects |
| `qfield_project_links` | Links to FibreFlow projects (many-to-many) |

### APIs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/qfield/projects` | List registered projects |
| `POST /api/qfield/projects` | Register new project |
| `GET /api/qfield/projects/discover` | Fetch from QFieldCloud DB |
| `POST /api/activate/sync-oes-to-qfield` | Sync OES data to projects |

### Multi-Project OES Sync

OES data can sync to multiple QFieldCloud projects simultaneously:

```typescript
// All active + sync_enabled projects receive the data
const targetProjectIds = await pool.query(
  'SELECT qfield_project_id FROM qfield_projects WHERE is_active = true AND sync_enabled = true'
);
// GeoJSON built once, uploaded to each project
```

## Admin Access

**Django Admin:** https://qfield.fibreflow.app/admin/
- Core > Projects - View/manage all QFieldCloud projects
- Core > People - View/manage users
- Authentication > Tokens - API tokens

**FibreFlow UI:** https://dev.fibreflow.app/system/data-sync?group=qfield&tab=projects
- Register/edit QFieldCloud projects
- Discover projects from QFieldCloud
- Link to FibreFlow projects
- Enable/disable sync

## Verification Commands

```bash
# Check project count in QFieldCloud DB
node -e "
const { Pool } = require('pg');
const pool = new Pool({
  host: '100.96.203.105',
  port: 5433,
  database: 'qfieldcloud_db',
  user: 'qfieldcloud_db_admin',
  password: 'c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753'
});
pool.query('SELECT COUNT(*) FROM core_project').then(r => {
  console.log('Total projects:', r.rows[0].count);
  pool.end();
});
"

# Check Docker containers
sshpass -p 'velo2026' ssh velo@100.96.203.105 "docker ps --format '{{.Names}}' | grep qfield"
```

## Related Files

| File | Purpose |
|------|---------|
| `src/modules/qfield-sync/services/qfieldcloudApiService.ts` | DB queries |
| `pages/api/qfield/projects.ts` | Project registry API |
| `pages/api/qfield/projects/discover.ts` | Discovery from QFieldCloud |
| `pages/api/activate/sync-oes-to-qfield.ts` | OES sync |
| `scripts/migrations/134_qfield_projects.sql` | Registry schema |

## Historical Note

**2026-01-27:** Fixed DB host from VPS (72.61.166.168) to Velocity (100.96.203.105). The VPS had a stale copy with only 17 projects. Commit: `d22fee08`
