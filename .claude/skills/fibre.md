---
name: fibre
description: Fibre network GIS management — poles, fibre cables, splices, drops, routing, QField sync, 1Map integration
version: 1.0.0
triggers:
  - /fibre
  - fibre network
  - pole status
  - splice closure
  - fibre routing
  - cable route
  - fibre cable
  - sow_poles
  - sow_fibre
  - fibre coverage
  - network topology
  - pole tracker
  - fibre stringing
  - splice points
  - ONT serial
  - fibre map
---

# /fibre — Fibre Network GIS Agent

Manages the physical fibre network: poles, fibre cables, splice closures, drops, and GIS data across FibreFlow and 1Map.

## Architecture

```
Field Data Collection:
  QField (mobile) → QFieldCloud → QField Sync → FibreFlow DB

Design Data:
  SOW Excel Import → sow_poles, sow_drops, sow_fibre

GIS Layer:
  FibreFlow DB ↔ 1Map API (Fibertime Installations layer)

ONT/Installation:
  1Map (ph_ont field) ← WhatsApp DR photos → VLM extracts serial
```

## Key DB Tables

| Table | Description |
|-------|-------------|
| `sow_poles` | Designed pole positions |
| `sow_drops` | Designed service drops |
| `sow_fibre` | Designed fibre cable sections |
| `drops` | Actual installation drops (from SOW imports) |
| `qfield_sync_jobs` | QField sync tracking |
| `qfield_sync_conflicts` | Field vs design conflicts |

## Common Queries

### Network Coverage by Project
```sql
-- Poles: designed vs completed
SELECT
  p.name as project,
  COUNT(sp.id) as total_poles,
  SUM(CASE WHEN sp.status = 'installed' THEN 1 ELSE 0 END) as installed,
  SUM(CASE WHEN sp.status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(
    100.0 * SUM(CASE WHEN sp.status = 'installed' THEN 1 ELSE 0 END) / NULLIF(COUNT(sp.id), 0), 1
  ) as completion_pct
FROM sow_poles sp
JOIN projects p ON sp.project_id = p.id
GROUP BY p.name
ORDER BY completion_pct ASC;

-- Fibre laid vs total
SELECT
  p.name as project,
  COUNT(sf.id) as cable_sections,
  SUM(sf.length_m) as designed_m,
  SUM(CASE WHEN sf.status = 'installed' THEN sf.length_m ELSE 0 END) as laid_m,
  ROUND(SUM(sf.length_m) / 1000.0, 2) as designed_km
FROM sow_fibre sf
JOIN projects p ON sf.project_id = p.id
GROUP BY p.name;
```

### Drop Connection Status
```sql
-- Service drops by status
SELECT
  p.name as project,
  sd.status,
  COUNT(*) as count
FROM sow_drops sd
JOIN projects p ON sd.project_id = p.id
GROUP BY p.name, sd.status
ORDER BY p.name, count DESC;

-- Unconnected drops near completion
SELECT
  sd.drop_id,
  sd.address,
  sd.erf_number,
  sd.pole_reference,
  sd.status
FROM sow_drops sd
WHERE sd.status = 'pending'
  AND sd.project_id = '<project_uuid>'
ORDER BY sd.drop_id
LIMIT 50;
```

### ONT Serial Tracking
```sql
-- Drops with ONT serials
SELECT
  d.drop_number,
  d.address,
  d.ont_serial,
  d.status,
  d.connected_at
FROM drops d
WHERE d.ont_serial IS NOT NULL
  AND d.project_id = '<project_uuid>'
ORDER BY d.connected_at DESC;

-- Drops missing ONT serial (connected but no serial)
SELECT drop_number, address, status
FROM drops
WHERE status = 'connected'
  AND (ont_serial IS NULL OR ont_serial = '')
  AND project_id = '<project_uuid>';
```

## 1Map Integration

### Query 1Map Layer
```bash
# Use the OneMap skill for 1Map operations
# Key layer: Fibertime Installations
# Key field: ph_ont (ONT serial number)
```

```sql
-- Check 1Map sync status (if tracking in DB)
SELECT ont_serial, onemap_id, synced_at
FROM drops
WHERE onemap_id IS NOT NULL
ORDER BY synced_at DESC
LIMIT 20;
```

### Fix ONT Serial in 1Map
Use the `/OneMap` skill:
- Trigger: "fix ONT serial", "update 1Map", "ONT mismatch"

## QField Sync

### Check QField Sync Status
```sql
-- Recent sync jobs
SELECT
  id,
  status,
  sync_type,
  records_synced,
  conflicts_found,
  started_at,
  completed_at
FROM qfield_sync_jobs
ORDER BY started_at DESC
LIMIT 10;

-- Unresolved conflicts
SELECT
  qc.id,
  qc.entity_type,
  qc.entity_id,
  qc.field_name,
  qc.qfield_value,
  qc.fibreflow_value,
  qc.created_at
FROM qfield_sync_conflicts qc
WHERE qc.resolved_at IS NULL
ORDER BY qc.created_at DESC;
```

### QField Sync API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/qfield-sync-dashboard` | Sync dashboard data |
| POST | `/api/qfield-sync-start` | Start sync job |
| GET | `/api/qfield-sync-current` | Current job status |
| GET | `/api/qfield-sync-history` | Sync history |
| POST | `/api/qfield-sync-cancel` | Cancel running sync |
| GET | `/api/qfield-sync-poles` | QField pole data |
| GET | `/api/qfield-sync-cables` | QField cable data |

## Pipeline & Wayleaves

```sql
-- Pending wayleave approvals
SELECT
  pp.name as pipeline_project,
  at.name as approval_type,
  ppa.status,
  ppa.expiry_date,
  CASE WHEN ppa.expiry_date < CURRENT_DATE + INTERVAL '90 days'
    THEN 'EXPIRING SOON' ELSE 'OK' END as alert
FROM pipeline_project_approvals ppa
JOIN pipeline_projects pp ON ppa.pipeline_project_id = pp.id
JOIN approval_types at ON ppa.approval_type_id = at.id
WHERE ppa.status IN ('submitted', 'in_review', 'conditionally_approved')
ORDER BY ppa.expiry_date;

-- Expired approvals
SELECT
  pp.name, at.name as approval_type, ppa.expiry_date
FROM pipeline_project_approvals ppa
JOIN pipeline_projects pp ON ppa.pipeline_project_id = pp.id
JOIN approval_types at ON ppa.approval_type_id = at.id
WHERE ppa.status = 'expired'
  OR (ppa.expiry_date < CURRENT_DATE AND ppa.status != 'rejected');
```

## Fibre Stringing Tracking
```sql
-- Fibre sections not yet strung
SELECT
  sf.cable_id,
  sf.from_pole,
  sf.to_pole,
  sf.length_m,
  sf.cable_type,
  sf.status
FROM sow_fibre sf
WHERE sf.status = 'pending'
  AND sf.project_id = '<project_uuid>'
ORDER BY sf.cable_id;
```

## GIS Coordinates

All coordinates in FibreFlow use **decimal degrees** (WGS84):
- Latitude: `-90` to `90`
- Longitude: `-180` to `180`
- South Africa typical range: lat `-22` to `-35`, lon `16` to `33`

```sql
-- Find poles within a bounding box (e.g., Johannesburg area)
SELECT pole_id, latitude, longitude, status
FROM sow_poles
WHERE latitude BETWEEN -26.4 AND -25.8
  AND longitude BETWEEN 27.8 AND 28.3
  AND project_id = '<uuid>';
```

## Troubleshooting

### QField Sync Stuck
```bash
# Cancel stuck job
curl -X POST https://dev.fibreflow.app/api/qfield-sync-cancel
# Check QFieldCloud containers on Velocity
ssh velo@100.96.203.105 "docker ps --filter 'name=qfieldcloud'"
```

### 1Map Data Out of Sync
- Use `/OneMap` skill to query and update 1Map directly
- Check `drops.onemap_id` — if NULL, the record isn't linked to 1Map yet

### Pole Count Mismatch (SOW vs Actual)
```sql
-- Compare SOW pole count vs daily progress count
SELECT
  p.name,
  p.total_poles as project_field,
  COUNT(sp.id) as sow_poles_count
FROM projects p
LEFT JOIN sow_poles sp ON sp.project_id = p.id
GROUP BY p.name, p.total_poles
HAVING p.total_poles != COUNT(sp.id);
```

## Related
- `/sow` skill — SOW import workflow
- `OneMap` skill — 1Map GIS API
- `Qfield` skill — QField infrastructure management
- `.claude/modules/qfield-sync.md` — QField sync module
- `.claude/modules/pipeline.md` — Pipeline and wayleaves
