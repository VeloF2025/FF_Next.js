# Tracker Workspace — Plan 1.0a · Schema & Migration Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the database foundation that every other tracker-workspace deliverable depends on — extend `pon_stage_tracking` to be the canonical PON entity, add manual-override and audit-log companion tables, and verify the existing `master_tracker` table is column-aligned with the spec.

**Architecture:** Three additive SQL migrations (335–337) applied in filename order through `npm run db:migrate`, plus an audit task that confirms `master_tracker` already matches the Excel shape (and emits a fourth small migration if any columns are missing). No application code changes — the API and UI consolidation work belongs to plans 1.0b and 1.0c.

**⚠ Amendment 2026-05-08 (after live DB audit):** The original plan included `vw_master_tracker` (view) and a `pon_tracker_entries` forward-port script. The audit (spec §3.4) showed `master_tracker` already exists as an empty 73-column table and `pon_tracker_entries` was never deployed (`pon_tracker` is the actual table, with 1 test row). Tasks 4–6 are amended below — see the **AMENDED** banner on each. Original tasks remain in git history at commit `5bbcb16d6`.

**Tech Stack:** PostgreSQL 15 (self-hosted Supabase, Velocity `100.96.203.105:5437`), `pg` driver via `@/lib/db` singleton, `tsx` for one-off scripts, `vitest` for unit tests, existing migration runner at `scripts/migrations/run.ts`.

**Spec:** `docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md`

---

## File Structure

**New files (amended):**
- `scripts/migrations/sql/335_pon_workspace_extend_stage_tracking.sql` — adds `olt_port`, `hld_pon`, `z_pon`, `scope_string`, `sign_ups`, `homes_po`, `homes_recon`, `available`, `pct_original`, `pct_recon` to `pon_stage_tracking`.
- `scripts/migrations/sql/336_pon_manual_overrides.sql` — new companion table for manual-only string fields.
- `scripts/migrations/sql/337_pon_change_log.sql` — new audit log table.
- `scripts/migrations/sql/rollback_335_pon_workspace_extend_stage_tracking.sql`
- `scripts/migrations/sql/rollback_336_pon_manual_overrides.sql`
- `scripts/migrations/sql/rollback_337_pon_change_log.sql`
- `scripts/migrations/sql/338_master_tracker_align.sql` — *only if Task 4's audit reveals missing columns; otherwise omit.*
- `scripts/migrations/sql/rollback_338_master_tracker_align.sql` — *paired with above, only if 338 is created.*
- `.claude/modules/tracker-workspace.md` — full reference doc for the new module.
- `src/modules/projects/tracker-workspace/.claude.md` — quick reference (≤50 lines) auto-loaded when working in this module.

**Files removed from this plan vs. original:**
- ~~`scripts/migrations/sql/338_vw_master_tracker.sql`~~ — replaced by use of the existing `master_tracker` table.
- ~~`scripts/tracker/forward-port-pon-tracker-entries.ts`~~ — `pon_tracker_entries` doesn't exist on prod; `pon_tracker` has 1 test row, treated as dormant.
- ~~`tests/unit/tracker/forward-port-pon-tracker-entries.test.ts`~~ — same reason.

**Modified files:** none in `package.json` (no new npm scripts needed).

**No application code is touched in this plan.** API routes and UI components are owned by plans 1.0b and 1.0c.

---

## Pre-flight

> **Status: P-1 to P-4 already executed by the controller on 2026-05-08 09:36–09:48 SAST.** Results below for traceability. Implementer subagents do not need to re-run these.

**Recorded outputs:**
- P-1: branch `spec/tracker-redesign`, working tree clean (only `.superpowers/` untracked).
- P-2: `.env.local` copied from main worktree; `DATABASE_URL` present.
- P-3: last applied migration is `334_vlm_training_dataset.sql`. Next number is **335**, as planned.
- P-4: row counts captured in `tmp/tracker-foundation-snapshots/counts-before.txt`. Key findings:
  - `pon_tracker_entries` does **not** exist on prod (migration file in repo never applied).
  - `pon_tracker` exists with **1 test row**.
  - `master_tracker` exists with **0 rows** but a 73-column schema.
  - `pon_stage_tracking`, `pon_daily_log`, `sp_pon_tracker`, `drops`, `sow_poles`, `oes_activations`, `contractor_invoices` all present.
  - Bonus existing assets: `pon_boundaries` (1,617 rows), `v_pole_completion`, `v_pon_pole_progress` (1,713 rows), `tracker_selectlists` (31 rows), `sharepoint_tracker_pole` (4,965 rows), `onemap.pons` (634 rows).

These findings drove the spec amendment (§3.4) and this plan's amended Task 4. Implementers proceed from Task 1.

#### Original pre-flight (kept for reference)

- [x] **P-1: Confirm worktree and branch**

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
psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\"' )" -c "\d pon_tracker" > tmp/tracker-foundation-snapshots/pon_tracker-before.txt   # NOTE: pon_tracker (not _entries) is the actually-deployed table
psql "$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\"' )" -c "SELECT COUNT(*) FROM pon_tracker; SELECT COUNT(*) FROM pon_stage_tracking;" > tmp/tracker-foundation-snapshots/counts-before.txt
cat tmp/tracker-foundation-snapshots/counts-before.txt
```

Record the row counts for verification later. **Do not commit `tmp/`**; it is in `.gitignore` already.

> **NOTE 2026-05-08:** the original P-4 referenced `pon_tracker_entries` — that table does not exist on prod. The corrected commands above reference `pon_tracker`, the actually-deployed table.

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

## Task 4 · **AMENDED** — Audit `master_tracker` schema, add missing columns only if needed

> **Replaces** the original "Migration 338 — `vw_master_tracker`". The existing `master_tracker` table already has the 73-column Excel shape (see spec §3.4). This task **verifies** alignment and emits a small migration only if any spec-required columns are missing.

**Files (conditional):**
- Create only if needed: `scripts/migrations/sql/338_master_tracker_align.sql`
- Create only if 338 is created: `scripts/migrations/sql/rollback_338_master_tracker_align.sql`

- [ ] **Step 1: Capture the current `master_tracker` columns**

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
DBURL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | sed 's/^"//' | sed 's/"$//')
psql "$DBURL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='master_tracker' ORDER BY ordinal_position;" \
  | sed 's/ //g' | grep -v '^$' \
  | tee tmp/tracker-foundation-snapshots/master_tracker-columns.txt
```

Expected: prints exactly **73** column names. If the count differs, **stop and report** as DONE_WITH_CONCERNS — the table has drifted from the audit captured in spec §3.4.

- [ ] **Step 2: Compare against the spec's required column set**

The spec (§3.1, §3.2, §4.3) implies the master tracker row needs these columns. Cross-check each one against `tmp/tracker-foundation-snapshots/master_tracker-columns.txt`:

```
id, project_id, site, phase, dr, zone_no, hld_pon, zone_pon,
pole_label, unique_pole_label, pole_scope, pole_type, pole_route_type,
pole_permission_date, pole_install_date, pole_cwc_date,
pole_contractor, pole_rate, pole_paid_date, pole_invoice_no, pole_comment,
civil_description, civil_rate, civil_qty, civil_total,
civil_invoice_no, civil_invoice_date, civil_comment,
stringing_description, stringing_rate, stringing_qty, stringing_total,
stringing_invoice_no, stringing_date, stringing_comment,
signup_date, home_install_date, home_contractor, home_rate, home_paid_date, home_invoice_no,
activation_code, activation_date, activation_team, activation_rate, activation_paid_date, activation_invoice_no,
remittance, remittance_date,
cwc_pole_status, cwc_stringing_status, cwc_qa_submit_date, cwc_qa_approved_date,
qa_home_recon_no, exfo_exchange,
optical_contractor, optical_type, optical_splitter, optical_prepping, optical_splicing,
qa_photos_loaded, atp_qa_submit_date, atp_qa_approved_date,
testing_status, test_submitted, olt_port_activation, olt_port_activated, pon_status,
optical_rate, optical_invoice_date, optical_invoice_no,
created_at, updated_at
```

A scriptable diff:

```bash
cd /home/hein/Workspace/FF_Next.js-tracker-redesign
cat > tmp/tracker-foundation-snapshots/required-cols.txt <<'EOF'
id
project_id
site
phase
dr
zone_no
hld_pon
zone_pon
pole_label
unique_pole_label
pole_scope
pole_type
pole_route_type
pole_permission_date
pole_install_date
pole_cwc_date
pole_contractor
pole_rate
pole_paid_date
pole_invoice_no
pole_comment
civil_description
civil_rate
civil_qty
civil_total
civil_invoice_no
civil_invoice_date
civil_comment
stringing_description
stringing_rate
stringing_qty
stringing_total
stringing_invoice_no
stringing_date
stringing_comment
signup_date
home_install_date
home_contractor
home_rate
home_paid_date
home_invoice_no
activation_code
activation_date
activation_team
activation_rate
activation_paid_date
activation_invoice_no
remittance
remittance_date
cwc_pole_status
cwc_stringing_status
cwc_qa_submit_date
cwc_qa_approved_date
qa_home_recon_no
exfo_exchange
optical_contractor
optical_type
optical_splitter
optical_prepping
optical_splicing
qa_photos_loaded
atp_qa_submit_date
atp_qa_approved_date
testing_status
test_submitted
olt_port_activation
olt_port_activated
pon_status
optical_rate
optical_invoice_date
optical_invoice_no
created_at
updated_at
EOF

sort tmp/tracker-foundation-snapshots/required-cols.txt > tmp/req-sorted.txt
sort tmp/tracker-foundation-snapshots/master_tracker-columns.txt > tmp/got-sorted.txt
diff tmp/req-sorted.txt tmp/got-sorted.txt
```

Expected: empty diff (all required columns present). The 73 columns in `master_tracker` likely match exactly.

If diff shows **lines starting with `<`** (required but missing), proceed to Step 3 to write a migration adding those columns.

If diff shows **lines starting with `>`** (extra columns we didn't list as required), that's fine — they're project-specific extras retained for parity. Don't drop them.

If diff is empty, **skip Steps 3–6** and go straight to Step 7 (commit verification artifacts only).

- [ ] **Step 3: Write migration 338 (only if Step 2 reports missing columns)**

Create `scripts/migrations/sql/338_master_tracker_align.sql`. Replace `<list>` with the actual missing column names from the diff:

```sql
-- Migration 338: Align master_tracker columns with tracker-workspace spec
-- Spec: docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md §4.3 (amended)
--
-- Adds any spec-required columns missing from the existing master_tracker table.
-- Only runs if the Task 4 audit found drift; if the table already matched, no
-- 338 migration is created and this file is absent.

BEGIN;

ALTER TABLE master_tracker
  ADD COLUMN IF NOT EXISTS <missing_col_1> <type>,
  ADD COLUMN IF NOT EXISTS <missing_col_2> <type>;

COMMIT;
```

For each missing column, choose the type by reference to the corresponding Excel column intent (dates → `date`, free text → `text`, currency → `numeric`, counts → `integer`, booleans → `boolean`).

If you are uncertain about a column's type, **stop and ask the controller** — do not guess. Report status DONE_WITH_CONCERNS naming the unknown columns.

- [ ] **Step 4: Write the rollback (only if Step 3 created 338)**

```sql
-- Rollback for Migration 338
BEGIN;
ALTER TABLE master_tracker
  DROP COLUMN IF EXISTS <missing_col_1>,
  DROP COLUMN IF EXISTS <missing_col_2>;
COMMIT;
```

- [ ] **Step 5: Apply (only if Step 3 created 338)**

```bash
npm run db:migrate
```

- [ ] **Step 6: Re-run the diff (only if Step 3 created 338)**

```bash
psql "$DBURL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='master_tracker' ORDER BY ordinal_position;" \
  | sed 's/ //g' | grep -v '^$' | sort > tmp/got-sorted.txt
diff tmp/req-sorted.txt tmp/got-sorted.txt
```

Expected: empty diff.

- [ ] **Step 7: Commit**

If 338 was created:

```bash
git add scripts/migrations/sql/338_master_tracker_align.sql \
        scripts/migrations/sql/rollback_338_master_tracker_align.sql
git commit -m "feat(tracker): mig 338 align master_tracker columns with workspace spec"
```

If 338 was **not** needed (existing schema matched), commit the audit artifact instead so the verification is captured in history:

```bash
git add tmp/tracker-foundation-snapshots/master_tracker-columns.txt
# tmp/ is in .gitignore — force-add if needed; otherwise put the audit under docs/
# Easiest: skip the commit and proceed. The plan file already documents the result.
```

(If `tmp/` is gitignored, no commit is needed for this task — the spec already documents that `master_tracker` matches.)

## Task 5 · **REMOVED** — forward-port `pon_tracker_entries`

> **Removed.** The §3.4 audit confirmed `pon_tracker_entries` does not exist on prod. The actually-deployed `pon_tracker` table holds 1 test row. Forward-port is not needed; `pon_tracker` is treated as dormant and will be retired with the legacy UI in plan 1.0c.

## Task 6 · **REMOVED** — forward-port script implementation

> **Removed.** See Task 5 above.


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

### Master tracker — existing `master_tracker` table
- Already exists with the 73-column Excel shape (no view created).
- Lawley snapshot importer (plan 1.0d) inserts rows; workspace UI reads/writes
  rows directly (plan 1.0c).
- Mig 338 only emitted if Task 4's audit found columns missing — most likely
  the existing schema matches the spec exactly.
- `master_tracker.project_id` is `text` (storing uuid strings) — application
  code casts at the boundary.

## Free wins (already on prod, reuse don't rebuild)
- `v_pole_completion` + `v_pon_pole_progress` (1,713 rows) — per-pole and
  per-PON completion aggregations. Use for the home dashboard (plan 1.0c).
- `pon_boundaries` (1,617 rows) — PON polygon geometries. Use for the C-lens
  map (plan 1.2).

## Legacy tables (parallel-cutover window)
| Table | Status | Retirement |
|-------|--------|-----------|
| `pon_tracker` | Dormant on prod (1 test row). Not referenced by new code. | Drop in 1.0c with the legacy UI. |
| `sp_pon_tracker` | SharePoint cron continues writing; new workspace never reads | Archive in 1.2 |
| `sp_project_summary` | Replaced by server-computed rollup of `pon_stage_tracking` | Drop in 1.2 |
| `sp_tracker_config` | Retire with the SP cron | Drop in 1.2 |
| `sharepoint_tracker_pole` | 4,965 rows of SP-synced pole data | Snapshot to `_archive_*` then drop in 1.2 |
| `sharepoint_tracker_home` | 0 rows, dormant | Drop in 1.2 |

## Known invariants
- `pon_stage_tracking.pon_no` is the zone-level PON number (= Excel `Z PON`).
- `pon_stage_tracking.hld_pon` is project-level, not unique by itself.
- Excel "PON STATUS" column maps to `pon_stage_tracking.overall_stage`
  (`activation` ≈ ACTIVE, anything else ≈ NOT ACTIVE).
- Master Tracker pole columns are denormalised in Excel (blank on subsequent
  drops sharing a pole). `master_tracker` rows mirror that exactly so the
  handover xlsx export (plan 1.0d) is a faithful round-trip.
- `master_tracker.project_id` and `pon_tracker.project_id` are `text`; all
  other tables use `uuid`. Cast at boundaries.
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
- Master row storage: existing `master_tracker` table (no view, no new mig unless Task 4 audit found drift)
- Free aggregations: `v_pole_completion`, `v_pon_pole_progress`
- Free geometry: `pon_boundaries` (1,617 polygons, for the v1.2 map)

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
SELECT 'pon_stage_tracking new cols' AS check, COUNT(*) AS value
FROM information_schema.columns
WHERE table_name = 'pon_stage_tracking' AND column_name IN
  ('olt_port','hld_pon','z_pon','scope_string','sign_ups','homes_po','homes_recon','available','pct_original','pct_recon')
UNION ALL
SELECT 'pon_manual_overrides exists', COUNT(*) FROM information_schema.tables WHERE table_name='pon_manual_overrides'
UNION ALL
SELECT 'pon_change_log exists',       COUNT(*) FROM information_schema.tables WHERE table_name='pon_change_log'
UNION ALL
SELECT 'master_tracker exists',       COUNT(*) FROM information_schema.tables WHERE table_name='master_tracker'
UNION ALL
SELECT 'master_tracker col count',    COUNT(*) FROM information_schema.columns WHERE table_name='master_tracker';
"
```

Expected:
- `pon_stage_tracking new cols` = `10`
- `pon_manual_overrides exists` = `1`
- `pon_change_log exists` = `1`
- `master_tracker exists` = `1`
- `master_tracker col count` ≥ `73` (will be `73` if no align migration was needed; higher if Task 4 added columns)

- [ ] **Step 3: Push the branch**

```bash
git push -u origin spec/tracker-redesign
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "feat(tracker): plan 1.0a schema foundation" --body "$(cat <<'EOF'
## Summary
- Extends `pon_stage_tracking` to be the canonical PON entity (mig 335).
- Adds `pon_manual_overrides`, `pon_change_log` (migs 336–337).
- Audits the existing `master_tracker` table; emits a small alignment migration only if columns were missing.
- Documents the new module in `.claude/modules/tracker-workspace.md` and an auto-loaded quick reference.

## Amended after live DB audit
- The original plan included a `vw_master_tracker` view and a forward-port for `pon_tracker_entries`. The DB audit (spec §3.4) showed `master_tracker` already exists with the right shape and `pon_tracker_entries` was never deployed. Both are removed from this plan.

Spec: `docs/superpowers/specs/2026-05-08-project-tracker-workspace-design.md`
Plan: `docs/superpowers/plans/2026-05-08-tracker-workspace-1.0a-schema-foundation.md`

This is plan 1 of 4 for v1.0. No application code is touched.

## Test plan
- [x] Each migration's verification query fails before, passes after (Tasks 1–3).
- [x] `master_tracker` audit (Task 4) reports diff is empty, **or** a 338 alignment migration was emitted and re-run shows empty diff.
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
1. The DB has the canonical PON entity (`pon_stage_tracking` extended), the manual-override table, and the audit log.
2. The existing `master_tracker` table is confirmed column-aligned with the spec; it stays empty until plan 1.0d's Lawley snapshot importer populates it.
3. Plan 1.0b (API consolidation + RBAC) can begin against this foundation.
4. No application code has been changed — the cutover risk is contained to "DB has new shape, app does not see it yet".
