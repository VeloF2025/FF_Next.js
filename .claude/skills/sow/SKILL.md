---
name: sow
description: Statement of Work (SOW) import and management for FibreFlow. Import poles/drops/fibre data, track import status, validate data. USE WHEN user says '/sow', 'SOW import', 'statement of work', 'import poles', 'import drops', 'import fibre', 'SOW data', 'sow_poles', 'sow_drops', 'sow_fibre'.
---


# /sow — Statement of Work Agent

Manages SOW (Statement of Work) data imports: poles, drops, and fibre cable datasets that define the physical scope of each project.

## Quick Reference

| Item | Value |
|------|-------|
| **UI** | `/sow` |
| **SOW List** | `/sow/list` |
| **SOW Grid** | `/sow/grid` |
| **SOW Import** | `/sow/import` |
| **API** | `/api/sow` |
| **DB Tables** | `sow_imports`, `sow_poles`, `sow_drops`, `sow_fibre` |

## SOW Data Types

| Type | Description | Key Fields |
|------|-------------|-----------|
| **Poles** | Utility poles for cable routing | `pole_id`, `latitude`, `longitude`, `pole_type`, `height` |
| **Drops** | Service drops to premises | `drop_id`, `pole_id`, `address`, `status`, `erf_number` |
| **Fibre** | Fibre cable sections | `cable_id`, `from_pole`, `to_pole`, `length_m`, `cable_type` |

## Import Workflow

```
Excel/CSV file
  → POST /api/sow (with projectId)
  → Validation (type-specific rules)
  → Insert to sow_poles / sow_drops / sow_fibre
  → Update projects.sow_data metadata
  → Import status tracking in sow_imports
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sow` | List all imports |
| GET | `/api/sow?projectId={id}` | Project-specific imports |
| POST | `/api/sow` | Import SOW data |
| GET | `/api/sow/status?id={id}` | Check import status |

## Check Import Status

```sql
-- Recent SOW imports
SELECT
  id,
  project_id,
  import_type,
  status,
  record_count,
  error_count,
  created_at
FROM sow_imports
ORDER BY created_at DESC
LIMIT 20;

-- Failed imports with errors
SELECT
  si.id,
  si.import_type,
  si.error_message,
  si.created_at,
  p.name as project
FROM sow_imports si
JOIN projects p ON si.project_id = p.id
WHERE si.status = 'failed'
ORDER BY si.created_at DESC;
```

## Query SOW Data

```sql
-- Pole count per project
SELECT
  p.name as project,
  COUNT(sp.id) as pole_count,
  SUM(CASE WHEN sp.status = 'completed' THEN 1 ELSE 0 END) as completed
FROM sow_poles sp
JOIN projects p ON sp.project_id = p.id
GROUP BY p.name
ORDER BY pole_count DESC;

-- Drop coverage
SELECT
  p.name as project,
  COUNT(sd.id) as total_drops,
  SUM(CASE WHEN sd.status = 'connected' THEN 1 ELSE 0 END) as connected,
  SUM(CASE WHEN sd.status = 'pending' THEN 1 ELSE 0 END) as pending,
  ROUND(
    100.0 * SUM(CASE WHEN sd.status = 'connected' THEN 1 ELSE 0 END) / COUNT(sd.id), 1
  ) as completion_pct
FROM sow_drops sd
JOIN projects p ON sd.project_id = p.id
GROUP BY p.name
ORDER BY completion_pct ASC;

-- Fibre cable lengths
SELECT
  p.name as project,
  COUNT(sf.id) as cable_sections,
  SUM(sf.length_m) as total_length_m,
  ROUND(SUM(sf.length_m) / 1000.0, 2) as total_km
FROM sow_fibre sf
JOIN projects p ON sf.project_id = p.id
GROUP BY p.name
ORDER BY total_km DESC;

-- Specific project SOW data
SELECT * FROM sow_poles
WHERE project_id = '<project_uuid>'
ORDER BY pole_id
LIMIT 50;
```

## Import Validation Rules

### Poles
- `pole_id` must be unique within project
- `latitude` and `longitude` required (-90 to 90, -180 to 180)
- `pole_type` must be one of: `'wooden'`, `'concrete'`, `'steel'`, `'existing'`

### Drops
- `drop_id` must be unique within project
- `pole_id` must reference existing pole in the project
- `address` or `erf_number` required

### Fibre
- `cable_id` must be unique
- `from_pole` and `to_pole` must reference existing poles
- `length_m` must be positive

## Common Issues

### Import Failing
```sql
-- Check error details
SELECT error_message, error_details
FROM sow_imports
WHERE id = '<import_uuid>';
```
- First 10 errors returned — fix those and re-import
- Check for duplicate `pole_id` values in the source file
- Verify coordinates are in decimal degrees (not DMS format)

### Drops Not Linked to Poles
```sql
-- Drops without valid pole reference
SELECT sd.drop_id, sd.pole_reference
FROM sow_drops sd
LEFT JOIN sow_poles sp ON sp.pole_id = sd.pole_reference
  AND sp.project_id = sd.project_id
WHERE sp.id IS NULL;
```

### SOW Data in `projects` vs `sow_*` Tables
- `projects.sow_data` — JSON metadata summary (counts, import info)
- `sow_poles`, `sow_drops`, `sow_fibre` — Full normalized data
- Always query the normalized tables for accurate counts

## SOW Management UI Pages

| Route | File | Description |
|-------|------|-------------|
| `/sow` | Main SOW page | Overview |
| `/sow/list` | SOW list view | Document listing |
| `/sow/grid` | Grid view | Data grid |
| `/sow/import` | Import wizard | Upload + validate |

## Gotchas

- **Mock data warning**: `useSOWDocuments` hook uses mock data — use direct API or DB for real counts
- **JSON storage**: Raw metadata in `projects.sow_data` field (JSONB)
- **Error limit**: Only first 10 validation errors shown — fix batches
- **No bulk delete**: Must delete imports individually or via DB

## Related
- `/fibre` skill — Fibre network GIS and routing
- `.claude/modules/sow.md` — Full SOW module docs
- `.claude/modules/onemap.md` — 1Map GIS integration (links to SOW data)
- `OneMap` skill — Query and update 1Map layers
