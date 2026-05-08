# Tracker Workspace — Plan 1.0a · Schema & Migration Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the database foundation that every other tracker-workspace deliverable depends on — extend `pon_stage_tracking` to be the canonical PON entity, add the manual-override and audit-log companion tables, expose the denormalised Master Tracker view, and forward-port `pon_tracker_entries` data so the table can be retired.

**Architecture:** Four additive SQL migrations applied in filename order through the existing `npm run db:migrate` runner (`scripts/migrations/run.ts`). One TypeScript forward-port script run once via `tsx`. No application code changes — the API and UI consolidation work belongs to plans 1.0b and 1.0c.

**Tech Stack:** PostgreSQL 15 (self-hosted Supabase, Velocity `100.96.203.105:5437`), `pg` driver via `@/lib/db` singleton, `tsx` for one-off scripts, `vitest` for unit tests, existing migration runner at `scripts/migrations/run.ts`.

**Spec:** `docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md`

---

## File Structure

**New files:**
- `scripts/migrations/sql/335_pon_workspace_extend_stage_tracking.sql` — adds `olt_port`, `hld_pon`, `z_pon`, `scope_string`, `sign_ups`, `homes_po`, `homes_recon`, `available`, `pct_original`, `pct_recon` to `pon_stage_tracking`.
- `scripts/migrations/sql/336_pon_manual_overrides.sql` — new companion table for manual-only string fields.
- `scripts/migrations/sql/337_pon_change_log.sql` — new audit log table.
- `scripts/migrations/sql/338_vw_master_tracker.sql` — new view joining `drops × sow_poles × pon_stage_tracking × oes_activations × contractor_invoices × onemap_*`.
- `scripts/migrations/sql/rollback_335_pon_workspace_extend_stage_tracking.sql` — rollback companion.
- `scripts/migrations/sql/rollback_336_pon_manual_overrides.sql` — rollback companion.
- `scripts/migrations/sql/rollback_337_pon_change_log.sql` — rollback companion.
- `scripts/migrations/sql/rollback_338_vw_master_tracker.sql` — rollback companion.
- `scripts/tracker/forward-port-pon-tracker-entries.ts` — one-shot data migration script.
- `tests/unit/tracker/forward-port-pon-tracker-entries.test.ts` — unit tests for the script's pure logic.
- `.claude/modules/tracker-workspace.md` — full reference doc for the new module.
- `src/modules/projects/tracker-workspace/.claude.md` — quick reference (≤50 lines) auto-loaded when working in this module.

**Modified files:**
- `package.json` — add one npm script `tracker:forward-port` to run the forward-port script.

**No application code is touched in this plan.** API routes and UI components are owned by plans 1.0b and 1.0c.

---

## Pre-flight

- [ ] **P-1: Confirm worktree and branch**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean (or only the spec from brainstorm), branch `spec/tracker-redesign`.

- [ ] **P-2: Confirm database access**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
[ -f .env.local ] && grep -c '^DATABASE_URL' .env.local || echo "MISSING .env.local"
```

Expected: prints `1`. If it prints `MISSING .env.local`, copy from production worktree:

```bash
cp /home/hein/Workspace/FF_Next.js/.env.local /home/hein/Workspace/FF_Next.js-tracker-redesign/.env.local
```

- [ ] **P-3: Confirm next migration number is 335**

```bash
ls scripts/migrations/sql/ | grep -E '^[0-9]{3,}_' | sort -t_ -k1 -n | tail -3
```

Expected: last numeric prefix is `334`. If it is not 334, **stop and ask Hein** which number to use — multiple migrations may have landed since this plan was written.

- [ ] **P-4: Snapshot the three tables we are about to consolidate**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
mkdir -p tmp/tracker-foundation-snapshots
psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\"' )" -c "\d pon_stage_tracking" > tmp/tracker-foundation-snapshots/pon_stage_tracking-before.txt
psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\"' )" -c "\d pon_tracker_entries" > tmp/tracker-foundation-snapshots/pon_tracker_entries-before.txt
psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\"' )" -c "SELECT COUNT(*) FROM pon_tracker_entries; SELECT COUNT(*) FROM pon_stage_tracking;" > tmp/tracker-foundation-snapshots/counts-before.txt
cat tmp/tracker-foundation-snapshots/counts-before.txt
```

Record the row counts for verification later. **Do not commit `tmp/`**; it is in `.gitignore` already.

---

## Task 1 · Migration 335 — extend `pon_stage_tracking`

**Files:**
- Create: `scripts/migrations/sql/335_pon_workspace_extend_stage_tracking.sql`
- Create: `scripts/migrations/sql/rollback_335_pon_workspace_extend_stage_tracking.sql`

- [ ] **Step 1: Write the failing verification query**

Run this SQL — it must FAIL with "column does not exist" before the migration runs:

```bash
psql "$DATABASE_URL" -c "SELECT olt_port, hld_pon, z_pon, scope_string, sign_ups, homes_po, homes_recon, available, pct_original, pct_recon FROM pon_stage_tracking LIMIT 0;"
```

Expected: `ERROR: column "olt_port" does not exist` (or any of the other columns — the first one missing wins).

- [ ] **Step 2: Write the migration**

Create `scripts/migrations/sql/335_pon_workspace_extend_stage_tracking.sql`:

```sql
-- Migration 335: Extend pon_stage_tracking for tracker-workspace consolidation
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.1
--
-- Adds the columns currently held by pon_tracker_entries / sp_pon_tracker so that
-- pon_stage_tracking becomes the canonical PON entity for the new workspace.
-- All columns are nullable — existing rows are unaffected.

BEGIN;

ALTER TABLE pon_stage_tracking
  ADD COLUMN IF NOT EXISTS olt_port      varchar(120),
  ADD COLUMN IF NOT EXISTS hld_pon       integer,
  ADD COLUMN IF NOT EXISTS z_pon         integer,
  ADD COLUMN IF NOT EXISTS scope_string  integer,
  ADD COLUMN IF NOT EXISTS sign_ups      integer,
  ADD COLUMN IF NOT EXISTS homes_po      integer,
  ADD COLUMN IF NOT EXISTS homes_recon   integer,
  ADD COLUMN IF NOT EXISTS available     integer,
  ADD COLUMN IF NOT EXISTS pct_original  numeric(5, 4),
  ADD COLUMN IF NOT EXISTS pct_recon     numeric(5, 4);

-- olt_port is high-cardinality and queried by the workspace; index it.
CREATE INDEX IF NOT EXISTS idx_pon_stage_olt_port
  ON pon_stage_tracking (project_id, olt_port)
  WHERE olt_port IS NOT NULL;

COMMENT ON COLUMN pon_stage_tracking.olt_port     IS 'Runtime PON identifier from Nokia, e.g. LAW.FTS.16.AGG.DM.MH.A004-OLT.01.C1P1';
COMMENT ON COLUMN pon_stage_tracking.hld_pon      IS 'Project-level (HLD) PON number. Distinct from pon_no which is zone-level.';
COMMENT ON COLUMN pon_stage_tracking.z_pon        IS 'Zone-level PON number as recorded in the Excel tracker (mirrors pon_no for legacy parity).';
COMMENT ON COLUMN pon_stage_tracking.scope_string IS 'Scoped stringing length / count for this PON.';
COMMENT ON COLUMN pon_stage_tracking.sign_ups     IS 'Number of homes signed up (manual + 1Map merged).';
COMMENT ON COLUMN pon_stage_tracking.homes_po     IS 'Homes connected via PO drops (original scope).';
COMMENT ON COLUMN pon_stage_tracking.homes_recon  IS 'Homes connected via reconnaissance / re-survey scope.';
COMMENT ON COLUMN pon_stage_tracking.available    IS 'Homes ready to activate but not yet activated.';
COMMENT ON COLUMN pon_stage_tracking.pct_original IS 'Activations as a fraction of homes_po (0.0–1.0).';
COMMENT ON COLUMN pon_stage_tracking.pct_recon    IS 'Activations as a fraction of homes_recon (0.0–1.0).';

COMMIT;
```

- [ ] **Step 3: Write the rollback**

Create `scripts/migrations/sql/rollback_335_pon_workspace_extend_stage_tracking.sql`:

```sql
-- Rollback for Migration 335
-- WARNING: This drops columns; any data in them will be lost. Only run if 335 was applied
-- to an empty/test database OR if forward-port has not yet been performed.

BEGIN;

DROP INDEX IF EXISTS idx_pon_stage_olt_port;

ALTER TABLE pon_stage_tracking
  DROP COLUMN IF EXISTS olt_port,
  DROP COLUMN IF EXISTS hld_pon,
  DROP COLUMN IF EXISTS z_pon,
  DROP COLUMN IF EXISTS scope_string,
  DROP COLUMN IF EXISTS sign_ups,
  DROP COLUMN IF EXISTS homes_po,
  DROP COLUMN IF EXISTS homes_recon,
  DROP COLUMN IF EXISTS available,
  DROP COLUMN IF EXISTS pct_original,
  DROP COLUMN IF EXISTS pct_recon;

COMMIT;
```

- [ ] **Step 4: Apply the migration**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npm run db:migrate
```

Expected: console output ending with `Migration 335 applied`. If output mentions other migrations being applied (e.g. 333, 334), confirm those are expected — the runner applies all pending migrations, not only ours.

- [ ] **Step 5: Re-run the verification query — must now PASS**

```bash
psql "$DATABASE_URL" -c "SELECT olt_port, hld_pon, z_pon, scope_string, sign_ups, homes_po, homes_recon, available, pct_original, pct_recon FROM pon_stage_tracking LIMIT 0;"
```

Expected: `SELECT 0` (zero rows, no error). Also verify the index:

```bash
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename = 'pon_stage_tracking' AND indexname = 'idx_pon_stage_olt_port';"
```

Expected: returns one row with `idx_pon_stage_olt_port`.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/sql/335_pon_workspace_extend_stage_tracking.sql \
        scripts/migrations/sql/rollback_335_pon_workspace_extend_stage_tracking.sql
git commit -m "feat(tracker): mig 335 extend pon_stage_tracking for workspace consolidation"
```

---

## Task 2 · Migration 336 — `pon_manual_overrides`

**Files:**
- Create: `scripts/migrations/sql/336_pon_manual_overrides.sql`
- Create: `scripts/migrations/sql/rollback_336_pon_manual_overrides.sql`

- [ ] **Step 1: Write the failing verification query**

```bash
psql "$DATABASE_URL" -c "SELECT pon_stage_id FROM pon_manual_overrides LIMIT 0;"
```

Expected: `ERROR: relation "pon_manual_overrides" does not exist`.

- [ ] **Step 2: Write the migration**

Create `scripts/migrations/sql/336_pon_manual_overrides.sql`:

```sql
-- Migration 336: pon_manual_overrides — manual-only string fields per PON
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.1
--
-- Companion to pon_stage_tracking. Holds free-text fields that have no
-- automated source feed (1Map / OES / Nokia don't supply these).

BEGIN;

CREATE TABLE IF NOT EXISTS pon_manual_overrides (
  pon_stage_id          uuid PRIMARY KEY REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  blockage              text,
  civil_contractor      text,
  stringing_contractor  text,
  optical_contractor    text,
  optical_splitter      text,
  optical_type          text,
  atp_submitter_notes   text,
  override_notes        text,
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Updated-at trigger reuses the existing update_updated_at_column() function
-- defined alongside pon_stage_tracking (mig 179).
CREATE TRIGGER pon_manual_overrides_updated_at
  BEFORE UPDATE ON pon_manual_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE pon_manual_overrides IS
  'Manual-only string fields per PON. 1:1 with pon_stage_tracking.';
COMMENT ON COLUMN pon_manual_overrides.blockage IS
  'Free-text blockage description; mirrored from Excel tracker "Blockage" column for parity.';
COMMENT ON COLUMN pon_manual_overrides.updated_by IS
  'User id or email of the last editor; written by the workspace UI.';

COMMIT;
```

- [ ] **Step 3: Write the rollback**

Create `scripts/migrations/sql/rollback_336_pon_manual_overrides.sql`:

```sql
-- Rollback for Migration 336
BEGIN;
DROP TRIGGER IF EXISTS pon_manual_overrides_updated_at ON pon_manual_overrides;
DROP TABLE IF EXISTS pon_manual_overrides;
COMMIT;
```

- [ ] **Step 4: Apply the migration**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npm run db:migrate
```

Expected: `Migration 336 applied`.

- [ ] **Step 5: Re-run verification — must PASS**

```bash
psql "$DATABASE_URL" -c "\d pon_manual_overrides"
```

Expected: shows the table with all columns and the `pon_manual_overrides_updated_at` trigger.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/sql/336_pon_manual_overrides.sql \
        scripts/migrations/sql/rollback_336_pon_manual_overrides.sql
git commit -m "feat(tracker): mig 336 add pon_manual_overrides table"
```

---

## Task 3 · Migration 337 — `pon_change_log`

**Files:**
- Create: `scripts/migrations/sql/337_pon_change_log.sql`
- Create: `scripts/migrations/sql/rollback_337_pon_change_log.sql`

- [ ] **Step 1: Write the failing verification query**

```bash
psql "$DATABASE_URL" -c "SELECT id FROM pon_change_log LIMIT 0;"
```

Expected: `ERROR: relation "pon_change_log" does not exist`.

- [ ] **Step 2: Write the migration**

Create `scripts/migrations/sql/337_pon_change_log.sql`:

```sql
-- Migration 337: pon_change_log — append-only audit log
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.5
--
-- Every write through the tracker workspace inserts a row here. Sources include
-- the workspace UI, automated feeds (1Map / OES / Nokia / SP sync), the Lawley
-- snapshot importer, and the one-shot forward-port migration.

BEGIN;

CREATE TABLE IF NOT EXISTS pon_change_log (
  id            bigserial PRIMARY KEY,
  pon_stage_id  uuid REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  drop_id       uuid REFERENCES drops(id) ON DELETE CASCADE,
  field         text NOT NULL,
  old_value     text,
  new_value     text,
  source        text NOT NULL CHECK (source IN ('ui','1map','oes','nokia','sp_sync','import','migration')),
  changed_by    text,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pon_or_drop CHECK (pon_stage_id IS NOT NULL OR drop_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pon_change_log_pon_stage ON pon_change_log (pon_stage_id, changed_at DESC) WHERE pon_stage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pon_change_log_drop      ON pon_change_log (drop_id, changed_at DESC)      WHERE drop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pon_change_log_recent    ON pon_change_log (changed_at DESC);

COMMENT ON TABLE pon_change_log IS
  'Append-only audit log for tracker-workspace edits and feed-sourced updates.';
COMMENT ON COLUMN pon_change_log.source IS
  'Origin of the change: ui (workspace edit), 1map/oes/nokia/sp_sync (feed), import (Lawley snapshot), migration (forward-port).';

COMMIT;
```

- [ ] **Step 3: Write the rollback**

Create `scripts/migrations/sql/rollback_337_pon_change_log.sql`:

```sql
-- Rollback for Migration 337
BEGIN;
DROP TABLE IF EXISTS pon_change_log;
COMMIT;
```

- [ ] **Step 4: Apply the migration**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npm run db:migrate
```

Expected: `Migration 337 applied`.

- [ ] **Step 5: Re-run verification — must PASS**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pon_change_log;"
```

Expected: `0`. Also confirm constraint:

```bash
psql "$DATABASE_URL" -c "INSERT INTO pon_change_log (field, source) VALUES ('test', 'ui');"
```

Expected: `ERROR: new row for relation "pon_change_log" violates check constraint "chk_pon_or_drop"` — proves the constraint works.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/sql/337_pon_change_log.sql \
        scripts/migrations/sql/rollback_337_pon_change_log.sql
git commit -m "feat(tracker): mig 337 add pon_change_log audit table"
```

---

## Task 4 · Migration 338 — `vw_master_tracker`

**Files:**
- Create: `scripts/migrations/sql/338_vw_master_tracker.sql`
- Create: `scripts/migrations/sql/rollback_338_vw_master_tracker.sql`

- [ ] **Step 1: Confirm join targets exist**

This view depends on tables created by other modules. Confirm each one exists before writing the view:

```bash
psql "$DATABASE_URL" -c "\dt drops sow_poles oes_activations contractor_invoices"
```

Expected: all four tables listed. If any are missing, **stop**: a dependency we assumed is not present. Search the codebase (`grep -r "CREATE TABLE.*<missing>" scripts migrations`) for the real table name and adjust the view accordingly before proceeding.

- [ ] **Step 2: Write the failing verification query**

```bash
psql "$DATABASE_URL" -c "SELECT 1 FROM vw_master_tracker LIMIT 0;"
```

Expected: `ERROR: relation "vw_master_tracker" does not exist`.

- [ ] **Step 3: Write the migration**

Create `scripts/migrations/sql/338_vw_master_tracker.sql`. The column list below covers the v1.0 read path; later phases extend it via a new migration.

```sql
-- Migration 338: vw_master_tracker — denormalised master tracker view
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.3
--
-- One row per drop, with pole / PON / activation / billing fields joined.
-- Read-only: workspace edits dispatch to the owning table per the spec.
-- If query latency exceeds 500ms p95 we promote this to a MATERIALIZED VIEW
-- per spec risk R3.

BEGIN;

CREATE OR REPLACE VIEW vw_master_tracker AS
SELECT
  d.id                     AS drop_id,
  d.project_id,
  d.drop_number,
  d.pon_no,
  d.zone_no,
  d.pole_number,
  d.address,
  d.latitude,
  d.longitude,

  -- Pole columns (denormalised; only meaningful on the first drop per pole in Excel parity)
  p.id                     AS pole_id,
  p.pole_type,
  p.pole_route_type,
  p.permission_date        AS pole_permission_date,
  p.installation_date      AS pole_installation_date,
  p.cwc_date               AS pole_cwc_date,
  p.contractor_id          AS pole_contractor_id,

  -- PON stage rollup
  pst.id                   AS pon_stage_id,
  pst.overall_stage,
  pst.cwc_complete,
  pst.cwc_target_date,
  pst.optical_complete,
  pst.optical_target_date,
  pst.activation_complete,
  pst.activation_target_date,
  pst.olt_port,
  pst.blockage             AS pon_blockage,

  -- Manual overrides
  pmo.civil_contractor,
  pmo.stringing_contractor,
  pmo.optical_contractor,
  pmo.optical_splitter,
  pmo.optical_type,

  -- Activation feed
  oa.activation_date,
  oa.activation_status,
  oa.olt_port_activated,

  -- Billing references
  ci.invoice_number        AS pole_invoice_number,
  ci.paid_at               AS pole_paid_date

FROM drops d
LEFT JOIN sow_poles            p   ON p.project_id = d.project_id AND p.pole_number = d.pole_number
LEFT JOIN pon_stage_tracking   pst ON pst.project_id = d.project_id AND pst.zone_no = d.zone_no AND pst.pon_no = d.pon_no
LEFT JOIN pon_manual_overrides pmo ON pmo.pon_stage_id = pst.id
LEFT JOIN oes_activations      oa  ON oa.drop_number = d.drop_number
LEFT JOIN contractor_invoices  ci  ON ci.pole_id = p.id;

COMMENT ON VIEW vw_master_tracker IS
  'Read-only denormalised projection over drops × sow_poles × pon_stage_tracking × pon_manual_overrides × oes_activations × contractor_invoices. Edits go to the owning table.';

COMMIT;
```

> **Safeguard:** if `psql` reports an error like `column "x" does not exist on relation "y"` for a join target, **do not invent a substitute column**. Stop and inspect the real schema with `\d <table>`; the join condition was wrong, not the column name. Adjust the join and re-apply.

- [ ] **Step 4: Write the rollback**

Create `scripts/migrations/sql/rollback_338_vw_master_tracker.sql`:

```sql
-- Rollback for Migration 338
BEGIN;
DROP VIEW IF EXISTS vw_master_tracker;
COMMIT;
```

- [ ] **Step 5: Apply the migration**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npm run db:migrate
```

Expected: `Migration 338 applied`.

- [ ] **Step 6: Re-run verification — must PASS**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM vw_master_tracker;"
psql "$DATABASE_URL" -c "SELECT drop_id, drop_number, pole_number, pon_no, overall_stage, activation_date FROM vw_master_tracker WHERE project_id = (SELECT id FROM projects WHERE project_name = 'Lawley') LIMIT 5;"
```

Expected: first query returns the same number as `SELECT COUNT(*) FROM drops`; second query returns ≤ 5 sample rows for Lawley.

- [ ] **Step 7: Sanity-check query latency**

```bash
psql "$DATABASE_URL" -c "EXPLAIN ANALYZE SELECT * FROM vw_master_tracker WHERE project_id = (SELECT id FROM projects WHERE project_name = 'Lawley');"
```

Note the "Execution Time" line. If it is **> 500 ms p95**, the spec's risk R3 is triggered — flag this in the commit message so plan 1.0b knows to promote to `MATERIALIZED VIEW` with refresh triggers. **Do not change the view in this plan** — the trigger work belongs to 1.0b.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrations/sql/338_vw_master_tracker.sql \
        scripts/migrations/sql/rollback_338_vw_master_tracker.sql
git commit -m "feat(tracker): mig 338 add vw_master_tracker denormalised view"
```

---

## Task 5 · Forward-port script — write tests first

**Files:**
- Create: `tests/unit/tracker/forward-port-pon-tracker-entries.test.ts`

The forward-port script's central piece of pure logic is mapping a `pon_tracker_entries` row onto the `(pon_stage_tracking, pon_manual_overrides)` pair. Test that mapping in isolation; the DB plumbing is exercised by the live run in Task 7.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tracker/forward-port-pon-tracker-entries.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  mapEntryToCanonical,
  type PonTrackerEntryRow,
  type CanonicalUpdate,
} from '@/scripts/tracker/forward-port-pon-tracker-entries';

describe('mapEntryToCanonical', () => {
  const baseEntry: PonTrackerEntryRow = {
    id: 'entry-1',
    project_id: 'proj-lawley',
    zone_no: 1,
    hld_pon: 1,
    z_pon: 1,
    olt_port: 'LAW.FTS.16.AGG.DM.MH.A004-OLT.01.C1P1',
    scope_poles: 20,
    scope_drops: 120,
    pole_permission: '2026-01-12',
    poles_planted: 20,
    cwc_poles_date: '2026-01-12',
    cwc_stringing_date: '2026-01-12',
    ready_for_optical: '2026-01-12',
    cwc_qa: true,
    optical_splicing_date: '2026-01-12',
    optical_submitted_date: '2026-01-13',
    optical_activated_date: '2026-01-14',
    atp_qa: true,
    sign_ups: 98,
    homes_po: 120,
    homes_recon: 77,
    activated: 70,
    available: 50,
    blockage: 'Ward 8 (restricted resources)',
    updated_by: 'pm@velocityfibre.co.za',
  };

  it('routes scope/count fields onto pon_stage_tracking', () => {
    const result: CanonicalUpdate = mapEntryToCanonical(baseEntry);
    expect(result.stage).toMatchObject({
      project_id: 'proj-lawley',
      zone_no: 1,
      pon_no: 1,                 // z_pon → pon_no per spec §4.2
      hld_pon: 1,
      z_pon: 1,
      olt_port: 'LAW.FTS.16.AGG.DM.MH.A004-OLT.01.C1P1',
      scope_string: null,        // not present in entry, must be null not undefined
      sign_ups: 98,
      homes_po: 120,
      homes_recon: 77,
      available: 50,
    });
  });

  it('routes blockage string onto pon_manual_overrides, not pon_stage_tracking', () => {
    const result = mapEntryToCanonical(baseEntry);
    expect(result.overrides.blockage).toBe('Ward 8 (restricted resources)');
    expect(result.overrides.updated_by).toBe('pm@velocityfibre.co.za');
    expect((result.stage as Record<string, unknown>).blockage).toBeUndefined();
  });

  it('matches join key on (project_id, zone_no, z_pon→pon_no)', () => {
    const result = mapEntryToCanonical(baseEntry);
    expect(result.matchKey).toEqual({
      project_id: 'proj-lawley',
      zone_no: 1,
      pon_no: 1,
    });
  });

  it('returns null overrides when entry has no manual fields set', () => {
    const lean: PonTrackerEntryRow = {
      ...baseEntry,
      blockage: null,
    };
    const result = mapEntryToCanonical(lean);
    expect(result.overrides).toBeNull();
  });

  it('emits a change-log entry per non-null field that lands on the canonical side', () => {
    const result = mapEntryToCanonical(baseEntry);
    expect(result.changeLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'sign_ups',    new_value: '98',  source: 'migration' }),
        expect.objectContaining({ field: 'homes_po',    new_value: '120', source: 'migration' }),
        expect.objectContaining({ field: 'olt_port',    source: 'migration' }),
        expect.objectContaining({ field: 'blockage',    new_value: 'Ward 8 (restricted resources)', source: 'migration' }),
      ]),
    );
  });

  it('skips fields where value is null (no spurious change-log rows)', () => {
    const lean: PonTrackerEntryRow = {
      ...baseEntry,
      sign_ups: null,
      blockage: null,
    };
    const result = mapEntryToCanonical(lean);
    const fields = result.changeLog.map((c) => c.field);
    expect(fields).not.toContain('sign_ups');
    expect(fields).not.toContain('blockage');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npx vitest run tests/unit/tracker/forward-port-pon-tracker-entries.test.ts
```

Expected: FAIL with module-not-found error pointing at `@/scripts/tracker/forward-port-pon-tracker-entries`. (Path alias resolves the import; the test runner discovers the file does not yet exist.)

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/tracker/forward-port-pon-tracker-entries.test.ts
git commit -m "test(tracker): forward-port mapEntryToCanonical (RED)"
```

---

## Task 6 · Forward-port script — implementation

**Files:**
- Create: `scripts/tracker/forward-port-pon-tracker-entries.ts`
- Modify: `package.json` — add `tracker:forward-port` npm script

- [ ] **Step 1: Implement the script**

Create `scripts/tracker/forward-port-pon-tracker-entries.ts`:

```typescript
#!/usr/bin/env tsx
/**
 * One-shot forward-port: pon_tracker_entries → pon_stage_tracking + pon_manual_overrides
 *
 * Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.2
 *
 * Idempotent — safe to re-run. Each value forward-ported writes a pon_change_log row
 * with source='migration' so any post-migration drift is auditable.
 *
 * Usage:
 *   npm run tracker:forward-port -- --dry-run
 *   npm run tracker:forward-port
 */

import { Pool } from 'pg';

// ──────────────────────────────────────────────────────────────────────────────
// Pure mapping (unit-tested). Keep DB-free so vitest can run it cheaply.
// ──────────────────────────────────────────────────────────────────────────────

export interface PonTrackerEntryRow {
  id: string;
  project_id: string;
  zone_no: number | null;
  hld_pon: number | null;
  z_pon: number | null;
  olt_port: string | null;
  scope_poles: number | null;
  scope_drops: number | null;
  pole_permission: string | null;
  poles_planted: number | null;
  cwc_poles_date: string | null;
  cwc_stringing_date: string | null;
  ready_for_optical: string | null;
  cwc_qa: boolean | null;
  optical_splicing_date: string | null;
  optical_submitted_date: string | null;
  optical_activated_date: string | null;
  atp_qa: boolean | null;
  sign_ups: number | null;
  homes_po: number | null;
  homes_recon: number | null;
  activated: number | null;
  available: number | null;
  blockage: string | null;
  updated_by: string | null;
}

export interface MatchKey {
  project_id: string;
  zone_no: number;
  pon_no: number;
}

export interface StagePatch {
  project_id: string;
  zone_no: number;
  pon_no: number;            // ← entry.z_pon
  hld_pon: number | null;
  z_pon: number | null;
  olt_port: string | null;
  scope_string: number | null;
  sign_ups: number | null;
  homes_po: number | null;
  homes_recon: number | null;
  available: number | null;
}

export interface OverridesPatch {
  blockage: string | null;
  updated_by: string | null;
}

export interface ChangeLogEntry {
  field: string;
  new_value: string;
  source: 'migration';
  changed_by: string | null;
}

export interface CanonicalUpdate {
  matchKey: MatchKey;
  stage: StagePatch;
  overrides: OverridesPatch | null;
  changeLog: ChangeLogEntry[];
}

const STAGE_FIELDS: Array<keyof StagePatch> = [
  'hld_pon', 'z_pon', 'olt_port', 'scope_string',
  'sign_ups', 'homes_po', 'homes_recon', 'available',
];

const OVERRIDE_FIELDS: Array<keyof OverridesPatch> = ['blockage'];

export function mapEntryToCanonical(entry: PonTrackerEntryRow): CanonicalUpdate {
  if (entry.zone_no == null || entry.z_pon == null) {
    throw new Error(`Entry ${entry.id} missing zone_no or z_pon — cannot match a canonical row`);
  }

  const matchKey: MatchKey = {
    project_id: entry.project_id,
    zone_no: entry.zone_no,
    pon_no: entry.z_pon,
  };

  const stage: StagePatch = {
    project_id: entry.project_id,
    zone_no: entry.zone_no,
    pon_no: entry.z_pon,
    hld_pon: entry.hld_pon,
    z_pon: entry.z_pon,
    olt_port: entry.olt_port,
    scope_string: null,                  // Not present in pon_tracker_entries; left null
    sign_ups: entry.sign_ups,
    homes_po: entry.homes_po,
    homes_recon: entry.homes_recon,
    available: entry.available,
  };

  const hasOverride = entry.blockage != null && entry.blockage !== '';
  const overrides: OverridesPatch | null = hasOverride
    ? { blockage: entry.blockage, updated_by: entry.updated_by }
    : null;

  const changeLog: ChangeLogEntry[] = [];
  for (const field of STAGE_FIELDS) {
    const value = stage[field];
    if (value !== null && value !== undefined) {
      changeLog.push({
        field,
        new_value: String(value),
        source: 'migration',
        changed_by: entry.updated_by,
      });
    }
  }
  for (const field of OVERRIDE_FIELDS) {
    const value = overrides?.[field];
    if (value !== null && value !== undefined) {
      changeLog.push({
        field,
        new_value: String(value),
        source: 'migration',
        changed_by: entry.updated_by,
      });
    }
  }

  return { matchKey, stage, overrides, changeLog };
}

// ──────────────────────────────────────────────────────────────────────────────
// DB execution. Skipped during unit tests — only runs when invoked as a script.
// ──────────────────────────────────────────────────────────────────────────────

async function run(dryRun: boolean): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });

  try {
    const { rows } = await pool.query<PonTrackerEntryRow>(`
      SELECT id, project_id, zone_no, hld_pon, z_pon, olt_port,
             scope_poles, scope_drops,
             pole_permission::text, poles_planted,
             cwc_poles_date::text, cwc_stringing_date::text, ready_for_optical::text,
             cwc_qa,
             optical_splicing_date::text, optical_submitted_date::text, optical_activated_date::text,
             atp_qa, sign_ups, homes_po, homes_recon, activated, available,
             blockage, updated_by
      FROM pon_tracker_entries
      ORDER BY project_id, zone_no NULLS LAST, hld_pon NULLS LAST
    `);

    console.log(`[forward-port] ${rows.length} pon_tracker_entries rows to process${dryRun ? ' (dry-run)' : ''}`);

    let portedStage = 0;
    let portedOverrides = 0;
    let logRows = 0;
    let skipped = 0;

    for (const entry of rows) {
      let update: CanonicalUpdate;
      try {
        update = mapEntryToCanonical(entry);
      } catch (err) {
        console.warn(`[forward-port] skip entry ${entry.id}:`, (err as Error).message);
        skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(`[forward-port] would write ${update.changeLog.length} field(s) for ${update.matchKey.project_id} z${update.matchKey.zone_no} pon${update.matchKey.pon_no}`);
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert pon_stage_tracking row keyed by (project_id, zone_no, pon_no).
        // The unique constraint on (project_id, zone_no, pon_no) backs this ON CONFLICT.
        const stageRes = await client.query<{ id: string }>(`
          INSERT INTO pon_stage_tracking (project_id, zone_no, pon_no, hld_pon, z_pon, olt_port,
                                          scope_string, sign_ups, homes_po, homes_recon, available)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (project_id, zone_no, pon_no) DO UPDATE SET
            hld_pon      = COALESCE(pon_stage_tracking.hld_pon,      EXCLUDED.hld_pon),
            z_pon        = COALESCE(pon_stage_tracking.z_pon,        EXCLUDED.z_pon),
            olt_port     = COALESCE(pon_stage_tracking.olt_port,     EXCLUDED.olt_port),
            scope_string = COALESCE(pon_stage_tracking.scope_string, EXCLUDED.scope_string),
            sign_ups     = COALESCE(pon_stage_tracking.sign_ups,     EXCLUDED.sign_ups),
            homes_po     = COALESCE(pon_stage_tracking.homes_po,     EXCLUDED.homes_po),
            homes_recon  = COALESCE(pon_stage_tracking.homes_recon,  EXCLUDED.homes_recon),
            available    = COALESCE(pon_stage_tracking.available,    EXCLUDED.available)
          RETURNING id
        `, [
          update.stage.project_id, update.stage.zone_no, update.stage.pon_no,
          update.stage.hld_pon, update.stage.z_pon, update.stage.olt_port,
          update.stage.scope_string, update.stage.sign_ups,
          update.stage.homes_po, update.stage.homes_recon, update.stage.available,
        ]);

        const ponStageId = stageRes.rows[0].id;
        portedStage += 1;

        if (update.overrides) {
          await client.query(`
            INSERT INTO pon_manual_overrides (pon_stage_id, blockage, updated_by)
            VALUES ($1, $2, $3)
            ON CONFLICT (pon_stage_id) DO UPDATE SET
              blockage   = COALESCE(EXCLUDED.blockage,   pon_manual_overrides.blockage),
              updated_by = COALESCE(EXCLUDED.updated_by, pon_manual_overrides.updated_by),
              updated_at = now()
          `, [ponStageId, update.overrides.blockage, update.overrides.updated_by]);
          portedOverrides += 1;
        }

        for (const c of update.changeLog) {
          await client.query(`
            INSERT INTO pon_change_log (pon_stage_id, field, new_value, source, changed_by)
            VALUES ($1, $2, $3, $4, $5)
          `, [ponStageId, c.field, c.new_value, c.source, c.changed_by]);
          logRows += 1;
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    console.log(`[forward-port] done. stage upserts=${portedStage}, override upserts=${portedOverrides}, change_log rows=${logRows}, skipped=${skipped}`);
  } finally {
    await pool.end();
  }
}

// Only execute when run directly, not when imported by tests.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const dryRun = process.argv.includes('--dry-run');
  run(dryRun).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Wire the npm script**

Open `package.json` and locate the `"scripts"` block. Add the following line **above** the existing `"db:migrate"` entry to keep tracker scripts grouped together:

```json
    "tracker:forward-port": "tsx scripts/tracker/forward-port-pon-tracker-entries.ts",
```

- [ ] **Step 3: Run the test — must now PASS**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npx vitest run tests/unit/tracker/forward-port-pon-tracker-entries.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 4: Run the script in dry-run mode against the dev DB**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npm run tracker:forward-port -- --dry-run
```

Expected: prints "X pon_tracker_entries rows to process (dry-run)" and one "would write …" line per entry. **Do not proceed if the count is unexpectedly zero** — first verify with `psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pon_tracker_entries;"` that the source table actually has data on the dev DB.

- [ ] **Step 5: Run the script for real**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npm run tracker:forward-port
```

Expected: `[forward-port] done. stage upserts=N, override upserts=M, change_log rows=K, skipped=0`. If `skipped > 0`, capture stderr and stop — investigate which entries are missing zone_no or z_pon before continuing.

- [ ] **Step 6: Verify the forward-port landed**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pon_tracker_entries;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pon_stage_tracking WHERE olt_port IS NOT NULL;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pon_manual_overrides;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pon_change_log WHERE source = 'migration';"
psql "$DATABASE_URL" -c "SELECT * FROM pon_change_log WHERE source = 'migration' ORDER BY changed_at DESC LIMIT 5;"
```

Expected: `pon_stage_tracking WHERE olt_port IS NOT NULL` count is ≥ stage upserts from step 5; `pon_change_log WHERE source = 'migration'` count is ≥ change_log rows from step 5; the 5-row sample shows realistic field/value pairs.

- [ ] **Step 7: Commit**

```bash
git add scripts/tracker/forward-port-pon-tracker-entries.ts \
        package.json
git commit -m "feat(tracker): forward-port pon_tracker_entries to canonical PON entity"
```

> **Note:** the legacy `pon_tracker_entries` table is **NOT dropped in this plan**. It stays in place during the parallel-cutover window so the old UI keeps working. Plan 1.0c retires it once the new workspace UI is the only writer.

---

## Task 7 · Documentation

**Files:**
- Create: `.claude/modules/tracker-workspace.md`
- Create: `src/modules/projects/tracker-workspace/.claude.md`

The CLAUDE.md project rules require both an explicit-load deep doc and an auto-loaded quick-reference for new modules.

- [ ] **Step 1: Create the deep doc**

Create `.claude/modules/tracker-workspace.md`:

```markdown
# Tracker Workspace — full reference

The unified per-project tracker workspace that replaces the multi-sheet Excel
project trackers (Lawley, Mohadin, Mamelodi, …).

## Spec & plans
- Spec: `docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md`
- Plan 1.0a (this plan): `docs/superpowers/plans/2026-05-08-tracker-workspace-1.0a-schema-foundation.md`

## Database

### Canonical PON entity — `pon_stage_tracking`
- Existing table (mig 179, 232) extended in mig 335 with `olt_port`, `hld_pon`,
  `z_pon`, `scope_string`, `sign_ups`, `homes_po`, `homes_recon`, `available`,
  `pct_original`, `pct_recon`.
- Sourced from 1Map (`/api/onemap/sync-stages`) + OES (`oes_activations`) +
  manual edits routed through the workspace UI (plan 1.0b).
- Unique key: `(project_id, zone_no, pon_no)`. `pon_no` is the **zone-level**
  PON number — same as the Excel `Z PON` column.

### Manual overrides — `pon_manual_overrides`
- Mig 336. 1:1 with `pon_stage_tracking` via primary key `pon_stage_id`.
- Holds free-text fields with no source feed: `blockage`, contractor names,
  optical type/splitter, ATP submitter notes.

### Audit log — `pon_change_log`
- Mig 337. Append-only. Every workspace edit + every feed-sourced update
  inserts a row.
- `source` ∈ {`ui`, `1map`, `oes`, `nokia`, `sp_sync`, `import`, `migration`}.
- Constraint enforces at least one of `pon_stage_id` / `drop_id` is set.

### Master tracker view — `vw_master_tracker`
- Mig 338. Read-only. Joins `drops × sow_poles × pon_stage_tracking ×
  pon_manual_overrides × oes_activations × contractor_invoices`.
- Edits dispatched per-field to the owning table by the workspace API
  (plan 1.0b).
- If query latency > 500ms p95, promote to a `MATERIALIZED VIEW` per spec
  risk R3 — that work belongs to plan 1.0b.

## Legacy tables (parallel-cutover window)
| Table | Status | Retirement |
|-------|--------|-----------|
| `pon_tracker_entries` | Read-only at app layer once 1.0c ships | Drop in 1.0c |
| `sp_pon_tracker` | SharePoint cron continues writing; UI never reads | Archive in 1.2 |
| `sp_project_summary` | Replaced by server-computed rollup of `pon_stage_tracking` | Drop in 1.2 |
| `sp_tracker_config` | Retire with the SP cron | Drop in 1.2 |

## One-shot scripts
- `npm run tracker:forward-port` — copies `pon_tracker_entries` rows into
  `pon_stage_tracking` + `pon_manual_overrides`, writing `pon_change_log`
  rows with `source = 'migration'`. Idempotent.

## Known invariants
- `pon_stage_tracking.pon_no` = `pon_tracker_entries.z_pon` (zone-level PON).
- `pon_stage_tracking.hld_pon` is project-level, not unique by itself.
- Excel "PON STATUS" column maps to `pon_stage_tracking.overall_stage`
  (`activation` ≈ ACTIVE, anything else ≈ NOT ACTIVE).
- Master Tracker pole columns are denormalised in Excel (blank on subsequent
  drops sharing a pole). The view shows pole columns on every row; the
  handover xlsx export (plan 1.0d) replicates Excel's blanking for parity.
```

- [ ] **Step 2: Create the quick reference**

Create `src/modules/projects/tracker-workspace/.claude.md`. Note that the directory does not exist yet — create it as part of this step.

```bash
mkdir -p src/modules/projects/tracker-workspace
```

```markdown
<!-- src/modules/projects/tracker-workspace/.claude.md -->
# Tracker Workspace (quick ref)

Per-project unified tracker. Replaces Excel + the two legacy `tracker/` UI sets.

**Full doc:** `.claude/modules/tracker-workspace.md`

## DB at a glance
- Canonical PON: `pon_stage_tracking` (mig 179/232/335)
- Manual fields: `pon_manual_overrides` (mig 336, 1:1 with pon_stage_tracking)
- Audit: `pon_change_log` (mig 337)
- Master row view: `vw_master_tracker` (mig 338, read-only)

## Identifier gotcha
`pon_no` is **zone-level** (= Excel `Z PON`). `hld_pon` is **project-level**.

## API stack
Pages-router + `pg.Pool` (`import pool from '@/lib/db'`). Do **not** use the
Neon shim (`@/lib/db-neon`) — flagged as tech debt.

## Plans
- 1.0a (DB foundation) — shipped
- 1.0b (API consolidation + RBAC) — TODO
- 1.0c (workspace UI shell + Home + Master + PON drawer) — TODO
- 1.0d (Lawley snapshot importer + handover xlsx) — TODO
```

- [ ] **Step 3: Commit**

```bash
git add .claude/modules/tracker-workspace.md \
        src/modules/projects/tracker-workspace/.claude.md
git commit -m "docs(tracker): module reference + auto-loaded quick ref"
```

---

## Task 8 · Final verification & PR

- [ ] **Step 1: Run CI quick gates**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
npm run ci:quick
```

Expected: passes. If lint warnings increase, **revisit the SQL files / TS file** — the quick gates ratchet on warnings (170 baseline). Do not raise the baseline.

- [ ] **Step 2: Re-confirm DB state**

```bash
psql "$DATABASE_URL" -c "
SELECT 'pon_stage_tracking columns' AS check, COUNT(*) AS value
FROM information_schema.columns
WHERE table_name = 'pon_stage_tracking' AND column_name IN
  ('olt_port','hld_pon','z_pon','scope_string','sign_ups','homes_po','homes_recon','available','pct_original','pct_recon')
UNION ALL
SELECT 'pon_manual_overrides exists', COUNT(*) FROM information_schema.tables WHERE table_name='pon_manual_overrides'
UNION ALL
SELECT 'pon_change_log exists',       COUNT(*) FROM information_schema.tables WHERE table_name='pon_change_log'
UNION ALL
SELECT 'vw_master_tracker exists',    COUNT(*) FROM information_schema.views  WHERE table_name='vw_master_tracker';
"
```

Expected:
- `pon_stage_tracking columns` = `10`
- `pon_manual_overrides exists` = `1`
- `pon_change_log exists` = `1`
- `vw_master_tracker exists` = `1`

- [ ] **Step 3: Push the branch**

```bash
git push -u origin spec/tracker-redesign
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat(tracker): plan 1.0a schema foundation" --body "$(cat <<'EOF'
## Summary
- Extends `pon_stage_tracking` to be the canonical PON entity (mig 335).
- Adds `pon_manual_overrides`, `pon_change_log`, `vw_master_tracker` (migs 336–338).
- Forward-ports `pon_tracker_entries` data with full audit trail.
- Documents the new module in `.claude/modules/tracker-workspace.md` and an auto-loaded quick reference.

Spec: `docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md`
Plan: `docs/superpowers/plans/2026-05-08-tracker-workspace-1.0a-schema-foundation.md`

This is plan 1 of 4 for v1.0. No application code is touched.

## Test plan
- [x] Each migration's verification query fails before, passes after.
- [x] `npx vitest run tests/unit/tracker/forward-port-pon-tracker-entries.test.ts` passes.
- [x] `npm run tracker:forward-port -- --dry-run` reports a non-zero candidate count.
- [x] `npm run tracker:forward-port` reports `skipped=0` and writes `pon_change_log` rows with `source='migration'`.
- [x] Final verification SQL block in plan Task 8 returns the expected values.
- [x] `npm run ci:quick` passes with no new lint regressions.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Block on review**

Per CLAUDE.md "standing review-and-merge rule":
1. Invoke `/review` (the blind-reviewer skill). Doc-only or single-domain PR → single sonnet reviewer.
2. Wait for the self-hosted GHA runner: `gh run watch <run-id> --exit-status`. If GHA does not schedule, fall back to a `git worktree add /tmp/ff-pr-ci origin/spec/tracker-redesign && bash scripts/ci-local.sh` and post the result as a PR comment.
3. **Merge ONLY after BOTH the blind review APPROVED and CI passed**: `gh pr merge <N> --merge --delete-branch`.
4. After merge, run `git worktree remove /home/hein/Workspace/FF_Next.js-tracker-redesign` per `feedback_worktree_cleanup`.

---

## Done

When this plan completes:
1. The DB has the canonical PON entity, audit log, manual-override table, and master tracker view.
2. Legacy `pon_tracker_entries` data has been forward-ported and the legacy table still exists for reads.
3. Plan 1.0b (API consolidation + RBAC) can begin against this foundation.
4. No application code has been changed — the cutover risk is contained to "DB has new shape, app does not see it yet".
