# PRD-047: Project Import System Consolidation

## Overview
Consolidate and fix the project data import system for drops, poles, and fibre from Excel files. Address schema mismatches, mapping inconsistencies, and create a unified import pipeline with proper validation.

## Problem Statement

### Current Issues Identified

1. **Database Schema Mismatch**: The `sow_drops` table is missing 5 columns that the TypeScript types and data processors expect
2. **Script Bugs**: The batch import script (`run-import-drops.cjs`) incorrectly maps lat/lon as null and uses wrong field for address
3. **API Insert Incomplete**: The API handler only inserts 5 fields but the processor returns 15+ fields
4. **Naming Inconsistency**: Fibre table uses `cable_id` but type uses `segment_id`
5. **Multiple Parallel Systems**: Three different systems (API, Scripts, Processors) with inconsistent mappings
6. **No Validation**: Import can fail silently or with unclear errors
7. **No Claude Skill**: The `onemap-import` skill was referenced but never created

### Affected Components

| Component | File | Issue |
|-----------|------|-------|
| API Handler | `pages/api/sow/import.ts` | Incomplete INSERT |
| Data Processor | `src/services/sow/processor/dataProcessors.ts` | Good mappings, not used by API |
| TypeScript Types | `src/services/sow/types.ts` | Complete but not aligned with DB |
| Batch Script | `scripts/sow-import/run-import-drops.cjs` | Lat/lon null, wrong address |
| Database | `sow_drops`, `sow_fibre` | Missing columns |

## Goals

1. **Align Schema**: Add missing columns to database tables
2. **Fix Mappings**: Ensure Excel → Processor → API → DB pipeline is consistent
3. **Unified Import**: Single entry point for all project data imports
4. **Validation**: Pre-import validation with clear error messages
5. **Claude Skill**: Create `/project-import` skill for AI-assisted imports
6. **Documentation**: Complete mapping reference for future maintenance

## Data Sources

### Excel File Types

#### 1. Drops File (SOW/PlanNet Export)
- **Sheet**: `HLD_Home`
- **Records**: ~23,000 per project
- **Example**: `docs/Uploads/Lawley/Drops_Lawley.xlsx`

#### 2. Fibre File (SOW/PlanNet Export)
- **Sheet**: `JDW_Exp`
- **Records**: ~5,000 per project
- **Example**: `docs/Uploads/Lawley/Fibre_Lawley.xlsx`

#### 3. Poles File (SOW/PlanNet Export)
- **Sheet**: `HLD_Pole` or similar
- **Records**: ~4,500 per project

#### 4. 1Map Full Export
- **Sheet**: `SHEET1`
- **Columns**: 160+
- **Records**: Full property database
- **Example**: `pages/onemap/sample-data/Lawley_08092025.xlsx`

## Corrected Field Mappings

### DROPS: Excel → Database

| # | Excel Header | Description | DB Column | Type | Required |
|---|--------------|-------------|-----------|------|----------|
| 1 | `label` | Drop ID (DR1234567) | `drop_number` | VARCHAR(50) | Yes |
| 2 | `strtfeat` | Start pole reference | `pole_number` | VARCHAR(50) | No |
| 3 | `type` | Cable type | `cable_type` | VARCHAR(50) | No |
| 4 | `spec` | Fibre specification | `cable_spec` | VARCHAR(100) | No |
| 5 | `dim2` | Cable length (e.g., "40m") | `cable_length` | VARCHAR(20) | No |
| 6 | `cblcpty` | Fibre count (e.g., "1F") | `cable_capacity` | VARCHAR(20) | No |
| 7 | `strtfeat` | Start feature | `start_point` | VARCHAR(100) | No |
| 8 | `endfeat` | End feature (ONT ref) | `end_point` | VARCHAR(100) | No |
| 9 | `lat` | Latitude | `latitude` | DECIMAL(10,8) | No |
| 10 | `lon` | Longitude | `longitude` | DECIMAL(11,8) | No |
| 11 | `address` | Street address | `address` | TEXT | No |
| 12 | `pon_no` | PON number | `pon_no` | INTEGER | No |
| 13 | `zone_no` | Zone number | `zone_no` | INTEGER | No |
| 14 | `mun` | Municipality | `municipality` | VARCHAR(100) | No |
| 15 | `datecrtd` | Created date | `created_date` | TIMESTAMP | No |
| 16 | `crtdby` | Created by | `created_by` | VARCHAR(100) | No |
| 17 | `comments` | Comments | `comments` | TEXT | No |
| 18 | `subtyp` | Type indicator | `status` | VARCHAR(50) | No |
| — | (all fields) | Original row | `raw_data` | JSONB | No |

### FIBRE: Excel → Database

| # | Excel Header | Description | DB Column | Type | Required |
|---|--------------|-------------|-----------|------|----------|
| 1 | `label` | Segment ID | `segment_id` | VARCHAR(255) | Yes |
| 2 | `cable size` | Cable size (e.g., "288F") | `cable_size` | VARCHAR(50) | No |
| 3 | `layer` | Layer type | `layer` | VARCHAR(50) | No |
| 4 | `pon_no` | PON number | `pon_no` | INTEGER | No |
| 5 | `zone_no` | Zone number | `zone_no` | INTEGER | No |
| 6 | `length` | Length in meters | `length` | DECIMAL(10,2) | No |
| 7 | `String Com` | String completed distance | `string_completed` | DECIMAL(10,2) | No |
| 8 | `Date Comp` | Completion date | `date_completed` | TIMESTAMP | No |
| 9 | `Contractor` | Contractor name | `contractor` | VARCHAR(100) | No |
| 10 | `Complete` | Is complete (Yes/No) | `is_complete` | BOOLEAN | No |
| — | (all fields) | Original row | `raw_data` | JSONB | No |

### POLES: Excel → Database

| # | Excel Header | Description | DB Column | Type | Required |
|---|--------------|-------------|-----------|------|----------|
| 1 | `label_1` / `label` | Pole number | `pole_number` | VARCHAR(50) | Yes |
| 2 | `lat` | Latitude | `latitude` | DECIMAL(10,8) | No |
| 3 | `lon` | Longitude | `longitude` | DECIMAL(11,8) | No |
| 4 | `type_1` / `type` | Pole type | `pole_type` | VARCHAR(50) | No |
| 5 | `spec_1` / `spec` | Specification | `pole_spec` | VARCHAR(100) | No |
| 6 | `dim1` | Height | `height` | VARCHAR(20) | No |
| 7 | `dim2` | Diameter | `diameter` | VARCHAR(20) | No |
| 8 | `cmpownr` | Owner | `owner` | VARCHAR(100) | No |
| 9 | `pon_no` | PON number | `pon_no` | INTEGER | No |
| 10 | `zone_no` | Zone number | `zone_no` | INTEGER | No |
| 11 | `address` | Address | `address` | TEXT | No |
| 12 | `mun` | Municipality | `municipality` | VARCHAR(100) | No |
| 13 | `datecrtd` | Created date | `created_date` | TIMESTAMP | No |
| 14 | `crtdby` | Created by | `created_by` | VARCHAR(100) | No |
| 15 | `comments` | Comments | `comments` | TEXT | No |
| — | (all fields) | Original row | `raw_data` | JSONB | No |

## Database Migrations

### Migration 047a: Add Missing Columns to sow_drops

```sql
-- Migration: 047a_sow_drops_missing_columns.sql
-- Description: Add missing columns to sow_drops table

ALTER TABLE sow_drops ADD COLUMN IF NOT EXISTS cable_type VARCHAR(50);
ALTER TABLE sow_drops ADD COLUMN IF NOT EXISTS cable_spec VARCHAR(100);
ALTER TABLE sow_drops ADD COLUMN IF NOT EXISTS cable_length VARCHAR(20);
ALTER TABLE sow_drops ADD COLUMN IF NOT EXISTS start_point VARCHAR(100);
ALTER TABLE sow_drops ADD COLUMN IF NOT EXISTS end_point VARCHAR(100);

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_sow_drops_pon_zone ON sow_drops(project_id, pon_no, zone_no);

COMMENT ON COLUMN sow_drops.cable_type IS 'Cable type from Excel "type" column';
COMMENT ON COLUMN sow_drops.cable_spec IS 'Fibre specification from Excel "spec" column';
COMMENT ON COLUMN sow_drops.cable_length IS 'Cable length from Excel "dim2" column';
COMMENT ON COLUMN sow_drops.start_point IS 'Start feature from Excel "strtfeat" column';
COMMENT ON COLUMN sow_drops.end_point IS 'End feature from Excel "endfeat" column';
```

### Migration 047b: Standardize sow_fibre Table

```sql
-- Migration: 047b_sow_fibre_standardize.sql
-- Description: Ensure sow_fibre has all required columns

-- Add segment_id if using cable_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'sow_fibre' AND column_name = 'cable_id') THEN
    ALTER TABLE sow_fibre RENAME COLUMN cable_id TO segment_id;
  END IF;
END $$;

-- Ensure all columns exist
ALTER TABLE sow_fibre ADD COLUMN IF NOT EXISTS segment_id VARCHAR(255);
ALTER TABLE sow_fibre ADD COLUMN IF NOT EXISTS layer VARCHAR(50);
ALTER TABLE sow_fibre ADD COLUMN IF NOT EXISTS pon_no INTEGER;
ALTER TABLE sow_fibre ADD COLUMN IF NOT EXISTS zone_no INTEGER;
ALTER TABLE sow_fibre ADD COLUMN IF NOT EXISTS string_completed DECIMAL(10,2);
ALTER TABLE sow_fibre ADD COLUMN IF NOT EXISTS date_completed TIMESTAMP;
ALTER TABLE sow_fibre ADD COLUMN IF NOT EXISTS raw_data JSONB;

-- Add unique constraint
ALTER TABLE sow_fibre DROP CONSTRAINT IF EXISTS sow_fibre_project_segment_unique;
ALTER TABLE sow_fibre ADD CONSTRAINT sow_fibre_project_segment_unique
  UNIQUE (project_id, segment_id);

-- Add index
CREATE INDEX IF NOT EXISTS idx_sow_fibre_pon_zone ON sow_fibre(project_id, pon_no, zone_no);
```

### Migration 047c: Add Unique Constraints

```sql
-- Migration: 047c_sow_unique_constraints.sql
-- Description: Add unique constraints for upsert operations

-- sow_drops unique constraint
ALTER TABLE sow_drops DROP CONSTRAINT IF EXISTS sow_drops_project_drop_unique;
ALTER TABLE sow_drops ADD CONSTRAINT sow_drops_project_drop_unique
  UNIQUE (project_id, drop_number);

-- sow_poles unique constraint
ALTER TABLE sow_poles DROP CONSTRAINT IF EXISTS sow_poles_project_pole_unique;
ALTER TABLE sow_poles ADD CONSTRAINT sow_poles_project_pole_unique
  UNIQUE (project_id, pole_number);
```

## API Design

### Unified Import Endpoint

**Endpoint**: `POST /api/project-import`

```typescript
interface ProjectImportRequest {
  projectId: string;
  dataType: 'drops' | 'poles' | 'fibre' | '1map';
  fileData: string; // Base64 encoded Excel file
  options?: {
    clearExisting?: boolean;  // Default: true
    validateOnly?: boolean;   // Default: false
    batchSize?: number;       // Default: 500
  };
}

interface ProjectImportResponse {
  success: boolean;
  dataType: string;
  projectId: string;
  stats: {
    totalRows: number;
    imported: number;
    skipped: number;
    errors: number;
  };
  errors?: ImportError[];
  duration: number; // milliseconds
}

interface ImportError {
  row: number;
  field: string;
  value: any;
  message: string;
}
```

### Validation Endpoint

**Endpoint**: `POST /api/project-import/validate`

```typescript
interface ValidationRequest {
  projectId: string;
  dataType: 'drops' | 'poles' | 'fibre' | '1map';
  fileData: string;
}

interface ValidationResponse {
  valid: boolean;
  rowCount: number;
  headers: string[];
  mappings: FieldMapping[];
  issues: ValidationIssue[];
  preview: any[]; // First 10 rows as they would be imported
}

interface FieldMapping {
  excelHeader: string;
  dbColumn: string;
  sampleValue: any;
  status: 'mapped' | 'unmapped' | 'ignored';
}

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedRows?: number;
}
```

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `pages/api/project-import/index.ts` | Unified import endpoint |
| `pages/api/project-import/validate.ts` | Validation endpoint |
| `pages/api/project-import/status.ts` | Import status tracking |
| `src/services/project-import/index.ts` | Service exports |
| `src/services/project-import/importService.ts` | Main import logic |
| `src/services/project-import/validators.ts` | Validation functions |
| `src/services/project-import/mappings.ts` | Field mapping definitions |
| `scripts/migrations/047a_sow_drops_missing_columns.sql` | DB migration |
| `scripts/migrations/047b_sow_fibre_standardize.sql` | DB migration |
| `scripts/migrations/047c_sow_unique_constraints.sql` | DB migration |
| `scripts/run-047-migrations.js` | Migration runner |
| `.claude/skills/project-import/SKILL.md` | Claude skill |

### Files to Modify

| File | Changes |
|------|---------|
| `pages/api/sow/import.ts` | Use new importService, full field mapping |
| `scripts/sow-import/run-import-drops.cjs` | Fix lat/lon/address bugs |
| `src/services/sow/types.ts` | Align with final schema |

## Implementation Plan

### Phase 1: Database Schema (Day 1)
1. Create migration files
2. Run migrations on dev database
3. Verify schema changes
4. Update TypeScript types

### Phase 2: Import Service (Day 2-3)
1. Create field mapping definitions
2. Build validation service
3. Create unified import service
4. Write unit tests

### Phase 3: API Endpoints (Day 3-4)
1. Create `/api/project-import` endpoint
2. Create `/api/project-import/validate` endpoint
3. Add progress tracking
4. Integration tests

### Phase 4: Fix Existing Code (Day 4)
1. Update `pages/api/sow/import.ts`
2. Fix `run-import-drops.cjs` script
3. Ensure backward compatibility

### Phase 5: Claude Skill & Docs (Day 5)
1. Create `/project-import` skill
2. Update CLAUDE.md with import instructions
3. Create usage documentation

## Testing Plan

### Unit Tests
- Field mapping functions
- Value extraction helpers
- Validation rules

### Integration Tests
- Full import cycle with sample files
- Error handling scenarios
- Large file handling (23K+ rows)

### Sample Data
Use existing files in `docs/Uploads/Lawley/`:
- `Drops_Lawley.xlsx` (23,709 rows)
- `Fibre_Lawley.xlsx` (~5,000 rows)

## Acceptance Criteria

1. [ ] All 3 migrations run successfully
2. [ ] `sow_drops` has all 18 columns mapped
3. [ ] `sow_fibre` has standardized column names
4. [ ] Validation endpoint returns accurate field mappings
5. [ ] Import endpoint handles 23K+ rows in < 60 seconds
6. [ ] Existing lat/lon data imports correctly (not null)
7. [ ] Address field maps correctly (not endfeat)
8. [ ] `/project-import` Claude skill works
9. [ ] All existing import scripts still function
10. [ ] Error messages are clear and actionable

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Backup before migration, raw_data JSONB preserves original |
| Breaking existing imports | Keep old endpoints, add deprecation warnings |
| Large file timeouts | Batch processing, progress tracking |
| Schema conflicts | Use IF NOT EXISTS, handle existing columns |

## Success Metrics

- Import success rate > 99%
- Average import time < 60s for 20K records
- Zero data loss (verified via raw_data comparison)
- All field mappings documented and tested

## References

- PRD-024: 1Map GIS Integration (original onemap work)
- `docs/DATABASE_TABLES.md` - Schema reference
- `src/modules/wa-monitor/README.md` - Similar import patterns

## Changelog

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-01-15 | 1.0 | Claude | Initial PRD creation |
