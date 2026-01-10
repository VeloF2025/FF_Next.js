# PRD-026: Rename Installations to Drops

## Overview
Rename "installations" terminology to "drops" throughout the OneMap integration for consistency with fiber industry terminology.

## Problem Statement
The initial OneMap integration used "installations" but the fiber industry standard term is "drops" (referring to the fiber drop from pole to customer premises). This inconsistency causes confusion.

## Goals
1. Rename `onemap.installations` table to `onemap.drops`
2. Update all column references from `installation_*` to `drop_*`
3. Update all scripts and services to use "drops" terminology

## Changes Required

### Database Schema Changes
```sql
-- Rename table
ALTER TABLE onemap.installations RENAME TO onemap.drops;

-- Rename columns in poles table
ALTER TABLE onemap.poles
  RENAME COLUMN installation_count TO drop_count;

-- Rename columns in projects table
ALTER TABLE onemap.projects
  RENAME COLUMN total_installations TO total_drops;
```

### Files to Modify

#### Scripts
- [ ] `scripts/create-onemap-schema.js`
  - Change `CREATE TABLE onemap.installations` to `onemap.drops`
  - Change `total_installations` to `total_drops`
  - Change `installation_count` to `drop_count`

- [ ] `scripts/import-onemap-excel.js`
  - Change `INSERT INTO onemap.installations` to `onemap.drops`

- [ ] `scripts/onemap-sync.js`
  - Update all references

- [ ] `scripts/update-poles-from-hld.js`
  - Update column references

- [ ] `scripts/link-poles-to-pons.js`
  - Update join conditions

- [ ] `scripts/import-lawley-excel.js`
  - Update table references

#### Services
- [ ] `src/services/onemap/oneMapClient.ts`
  - Change `getInstallations()` to `getDrops()`
  - Update interface names

- [ ] `src/services/onemap/oneMapSyncService.ts`
  - Change `installationsCreated` to `dropsCreated`
  - Change `installationsUpdated` to `dropsUpdated`
  - Update all method names and variables

## Naming Convention

| Old Term | New Term |
|----------|----------|
| `installations` | `drops` |
| `installation_count` | `drop_count` |
| `total_installations` | `total_drops` |
| `getInstallations()` | `getDrops()` |
| `syncInstallations()` | `syncDrops()` |

## Migration Script

```javascript
// scripts/rename-installations-to-drops.js
const { neon } = require('@neondatabase/serverless');

async function migrate() {
  const sql = neon(process.env.DATABASE_URL);

  // Check if table needs renaming
  const tableExists = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'onemap'
      AND table_name = 'installations'
    )
  `;

  if (tableExists[0].exists) {
    // Rename table
    await sql`ALTER TABLE onemap.installations RENAME TO drops`;

    // Rename columns
    await sql`ALTER TABLE onemap.poles RENAME COLUMN installation_count TO drop_count`;
    await sql`ALTER TABLE onemap.projects RENAME COLUMN total_installations TO total_drops`;

    console.log('Migration complete: installations → drops');
  } else {
    console.log('Table already named drops or does not exist');
  }
}
```

## Acceptance Criteria
1. `onemap.drops` table exists (not `installations`)
2. `poles.drop_count` column exists
3. `projects.total_drops` column exists
4. All scripts use "drops" terminology
5. All services use "drops" in method names
6. Existing data preserved after migration
7. All 64,030 drops accessible via new table name

## Testing
```sql
-- Verify table name
SELECT * FROM onemap.drops LIMIT 5;

-- Verify column names
SELECT drop_count FROM onemap.poles LIMIT 5;
SELECT total_drops FROM onemap.projects;

-- Verify data integrity
SELECT COUNT(*) FROM onemap.drops;  -- Should be 64,030
```

## Original PR
- PR #26: https://github.com/VelocityFibre/FF_Next.js/pull/26
- 7 files changed, +51 additions, -51 deletions
