---
name: project-import
description: Project data import skill. Import drops, poles, and fibre data from Excel files into FibreFlow projects. USE WHEN user says 'import project data', 'import drops', 'import poles from Excel'.
---

# Project Data Import Skill

**Purpose:** Import drops, poles, and fibre data from Excel files into FibreFlow projects.

## Quick Reference

```bash
# Import command
DATABASE_URL='<connection_string>' node scripts/import-project-data.js <projectId> <file.xlsx> [dataType] [sheetName]

# Examples
node scripts/import-project-data.js abc-123 ./Drops.xlsx drops
node scripts/import-project-data.js abc-123 ./Poles.xlsx poles Poles
node scripts/import-project-data.js abc-123 ./data.xlsx  # auto-detect type
```

## Data Model & Relationships

```
┌─────────────┐       ┌─────────────┐       ┌─────────────────┐
│   poles     │◄──────│   drops     │       │ fibre_segments  │
│─────────────│ 1:N   │─────────────│       │─────────────────│
│ pole_number │       │ drop_number │       │ segment_id      │
│ latitude    │       │ pole_number │──────►│ from_point      │
│ longitude   │       │ latitude    │       │ to_point        │
│ type        │       │ longitude   │       │ length          │
│ project_id  │       │ project_id  │       │ project_id      │
└─────────────┘       └─────────────┘       └─────────────────┘

Relationships:
- Each DROP links to ONE pole (many-to-one via pole_number)
- Each POLE can have MANY drops (one-to-many)
- FIBRE segments connect points in the network
```

## Database Tables

### public.drops
| Column | Type | Required | Source Headers |
|--------|------|----------|----------------|
| drop_number | varchar | YES | label, label (drop), drop_number |
| pole_number | varchar | NO | strtfeat, strtfeat (Pole), pole_number |
| latitude | numeric | NO | lat, latitude |
| longitude | numeric | NO | lon, longitude |
| cable_type | varchar | NO | type, cable_type |
| cable_length | numeric | NO | dim2, length, cable_length |
| cable_capacity | numeric | NO | cblcpty, cable_capacity |
| pon_no | varchar | NO | pon_no, pon |
| zone_no | varchar | NO | zone_no, zone |
| project_id | uuid | YES | (provided as argument) |

### public.poles
| Column | Type | Required | Source Headers |
|--------|------|----------|----------------|
| pole_number | varchar | YES | label (Pole), label_1, pole_number |
| latitude | numeric | NO | Planned Location (Latitude), lat |
| longitude | numeric | NO | Planned Location (Longitude), lon |
| type | varchar | NO | type, pole_type |
| status | varchar | NO | status |
| project_id | uuid | YES | (provided as argument) |

### public.fibre_segments
| Column | Type | Required | Source Headers |
|--------|------|----------|----------------|
| segment_id | varchar | YES | label, segment_id |
| cable_size | varchar | NO | cable size, cable_size |
| layer | varchar | NO | layer |
| length | numeric | NO | length |
| from_point | varchar | NO | from_pole, strtfeat |
| to_point | varchar | NO | to_pole, endfeat |
| contractor | varchar | NO | Contractor |
| is_complete | boolean | NO | Complete, completed |
| project_id | uuid | YES | (provided as argument) |

## Step-by-Step Import Process

### 1. Prepare Database Credentials

```bash
# Production
export DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'

# Development
export DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-aged-poetry-a9bbd8e9.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
```

### 2. Find Project ID

```bash
# Query existing projects
DATABASE_URL='...' node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() =>
  client.query(\"SELECT id, project_name FROM projects ORDER BY created_at DESC LIMIT 10\")
).then(r => {
  r.rows.forEach(p => console.log(p.id, '-', p.project_name));
  client.end();
});
"
```

### 3. Create Backups (Important!)

```bash
DATABASE_URL='...' node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function backup() {
  await client.connect();
  const ts = new Date().toISOString().slice(0,10).replace(/-/g, '');

  await client.query(\`CREATE TABLE drops_backup_\${ts} AS SELECT * FROM drops\`);
  await client.query(\`CREATE TABLE poles_backup_\${ts} AS SELECT * FROM poles\`);
  await client.query(\`CREATE TABLE fibre_segments_backup_\${ts} AS SELECT * FROM fibre_segments\`);

  console.log('Backups created: drops_backup_' + ts + ', poles_backup_' + ts + ', fibre_segments_backup_' + ts);
  await client.end();
}
backup();
"
```

### 4. Ensure Unique Constraints Exist

```bash
DATABASE_URL='...' node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function setup() {
  await client.connect();

  // Drops constraint
  try {
    await client.query('ALTER TABLE public.drops ADD CONSTRAINT drops_project_drop_unique UNIQUE (project_id, drop_number)');
    console.log('✓ drops constraint added');
  } catch (e) { console.log('drops:', e.message.includes('already exists') ? 'exists' : e.message); }

  // Poles constraint
  try {
    await client.query('ALTER TABLE public.poles ADD CONSTRAINT poles_project_pole_unique UNIQUE (project_id, pole_number)');
    console.log('✓ poles constraint added');
  } catch (e) { console.log('poles:', e.message.includes('already exists') ? 'exists' : e.message); }

  // Fibre constraint
  try {
    await client.query('ALTER TABLE public.fibre_segments ADD CONSTRAINT fibre_segments_project_segment_unique UNIQUE (project_id, segment_id)');
    console.log('✓ fibre_segments constraint added');
  } catch (e) { console.log('fibre:', e.message.includes('already exists') ? 'exists' : e.message); }

  await client.end();
}
setup();
"
```

### 5. Import Data

```bash
# Import poles FIRST (they are referenced by drops)
DATABASE_URL='...' node scripts/import-project-data.js <projectId> "path/to/file.xlsx" poles Poles

# Import drops SECOND
DATABASE_URL='...' node scripts/import-project-data.js <projectId> "path/to/file.xlsx" drops Drops

# Import fibre (independent)
DATABASE_URL='...' node scripts/import-project-data.js <projectId> "path/to/Fibre.xlsx" fibre
```

### 6. Verify Import

```bash
DATABASE_URL='...' node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function verify() {
  await client.connect();
  const projectId = '<PROJECT_ID>';

  const drops = await client.query('SELECT COUNT(*) FROM drops WHERE project_id = \$1', [projectId]);
  const poles = await client.query('SELECT COUNT(*) FROM poles WHERE project_id = \$1', [projectId]);
  const fibre = await client.query('SELECT COUNT(*) FROM fibre_segments WHERE project_id = \$1', [projectId]);

  const linked = await client.query(\`
    SELECT COUNT(*) FROM drops d
    JOIN poles p ON d.pole_number = p.pole_number AND d.project_id = p.project_id
    WHERE d.project_id = \$1
  \`, [projectId]);

  console.log('Drops:', drops.rows[0].count);
  console.log('Poles:', poles.rows[0].count);
  console.log('Fibre:', fibre.rows[0].count);
  console.log('Drops linked to poles:', linked.rows[0].count);

  await client.end();
}
verify();
"
```

## Troubleshooting

### "column does not exist"
Add missing columns:
```sql
ALTER TABLE public.drops ADD COLUMN latitude NUMERIC;
ALTER TABLE public.drops ADD COLUMN longitude NUMERIC;
ALTER TABLE public.poles ADD COLUMN raw_data JSONB;
```

### "no unique constraint matching ON CONFLICT"
Add the constraint (see Step 4 above).

### "duplicate key value violates unique constraint"
Drop old single-column constraints:
```sql
ALTER TABLE public.fibre_segments DROP CONSTRAINT fibre_segments_segment_id_key;
```

### "ON CONFLICT cannot affect row a second time"
Excel file has duplicate primary keys. The script auto-deduplicates, keeping the last occurrence.

### Excel date shows as number (e.g., "45859")
The script converts Excel serial dates automatically for fields marked with `type: 'date'`.

## File Locations

- **Import Script:** `scripts/import-project-data.js`
- **Service Layer:** `src/services/project-import/`
- **API Endpoints:** `pages/api/project-import/`
- **Migrations:** `scripts/migrations/047*.sql`
- **PRD:** `docs/PRDs/PRD-047-project-import-system.md`

## Example: Lawley Project Import

```bash
# Project ID: 4eb13426-b2a1-472d-9b3c-277082ae9b55
# File: docs/Drops and Poles/FT Data Needed (Lawley).xlsx

# 1. Import poles (4,471 records)
DATABASE_URL='...' node scripts/import-project-data.js \
  4eb13426-b2a1-472d-9b3c-277082ae9b55 \
  "docs/Drops and Poles/FT Data Needed (Lawley).xlsx" \
  poles Poles

# 2. Import drops (23,708 records)
DATABASE_URL='...' node scripts/import-project-data.js \
  4eb13426-b2a1-472d-9b3c-277082ae9b55 \
  "docs/Drops and Poles/FT Data Needed (Lawley).xlsx" \
  drops Drops

# 3. Import fibre (681 records)
DATABASE_URL='...' node scripts/import-project-data.js \
  4eb13426-b2a1-472d-9b3c-277082ae9b55 \
  "docs/Uploads/Lawley/Fibre_Lawley.xlsx" \
  fibre

# Results:
# - 23,740 drops (20,108 with GPS)
# - 4,471 poles (100% with GPS)
# - 681 fibre segments
# - 23,707 drops linked to poles
# - ~2,200 rows/sec import speed
```

## Rollback

```sql
-- Restore from backup
TRUNCATE public.drops;
INSERT INTO public.drops SELECT * FROM public.drops_backup_20260115;

TRUNCATE public.poles;
INSERT INTO public.poles SELECT * FROM public.poles_backup_20260115;

TRUNCATE public.fibre_segments;
INSERT INTO public.fibre_segments SELECT * FROM public.fibre_segments_backup_20260115;
```
