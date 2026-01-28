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

## API Authentication

QFieldCloud uses token-based authentication. Tokens are stored in `authentication_authtoken` table (NOT `authtoken_token`).

**Current Token (generated 2026-01-27, expires 2027-01-27):**
```typescript
const QFIELD_API_TOKEN = '2VbfhkUAfPHw7s7zAtMsyRTFF0xU00JtQRKyF3vzTxZtRODF4FLbzEc91f7PRhCIQvc48WLkC3TowKruYgFHIgm9ewk1VGb0JIQp';
// Owner: Jaun (project owner)
// Expiry: 1 year from creation
```

**Generate New Token:**
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 "docker exec qfieldcloud-app-1 python manage.py shell -c \"
from rest_framework.authtoken.models import Token
from django.contrib.auth import get_user_model
User = get_user_model()
user = User.objects.get(username='Jaun')
Token.objects.filter(user=user).delete()
token = Token.objects.create(user=user)
print('NEW TOKEN:', token.key)
\""
```

**API Usage:**
```bash
curl -s "https://qfield.fibreflow.app/api/v1/files/{project_id}/" \
  -H "Authorization: Token {token}"
```

## GeoJSON Requirements

**CRITICAL: Coordinates must be NUMBERS, not strings!**

PostgreSQL returns lat/lng as strings. QGIS/QField cannot render points with string coordinates.

```typescript
// ❌ BROKEN - strings don't render
coordinates: [point.longitude, point.latitude]  // ['18.67', '-34.00']

// ✅ WORKING - explicit number conversion
coordinates: [Number(point.longitude), Number(point.latitude)]  // [18.67, -34.00]
```

**Symptoms of string coordinates:**
- Layer appears in QField layer list
- Zero points render on map
- File size is correct

**OES Filename Convention:** `OES FF DD-MM-YYYY.geojson` (e.g., `OES FF 28-01-2026.geojson`)

## File Upload (OES Sync)

QFieldCloud does **NOT** have a `/layers/` API endpoint. To add GIS data:

1. **Manual Method (current):** Upload GeoPackage via QFieldCloud web UI or QField mobile app
2. **API Method:** Upload file via `/files/` endpoint

```bash
# Upload GeoPackage to project
curl -X POST "https://qfield.fibreflow.app/api/v1/files/{project_id}/oes_data.gpkg" \
  -H "Authorization: Token {token}" \
  -F "file=@/path/to/oes_data.gpkg"
```

**Note:** The current `sync-oes-to-qfield.ts` API attempts to use a non-existent `/layers/` endpoint. Manual GeoPackage upload (e.g., `OES 27-01-26.gpkg`) is the working method.

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

## Historical Notes

**2026-01-27 (965e918a):** Fixed GeoJSON coordinates - converted from strings to numbers. Points weren't rendering because PostgreSQL returns lat/lng as strings and GeoJSON requires numeric coordinates.

**2026-01-27 (f917cb16):** Updated to long-lived API token (1 year expiry). Owner: Jaun (project owner).

**2026-01-27 (d22fee08):** Fixed DB host from VPS (72.61.166.168) to Velocity (100.96.203.105). The VPS had a stale copy with only 17 projects.

**2026-01-27 (81174ba7):** Updated API token. Old token was expired. New token from `authentication_authtoken` table (not `authtoken_token`). Token owner: Jaun (user_id: 4).
