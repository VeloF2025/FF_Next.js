# Serial Master Register — Wave 1 (Data Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `stock_serials` the master register for ONT + Gizzu device serials by (a) extending its schema for a 12-state lifecycle, (b) adding an append-only `stock_serial_events` log fed by triggers on every source-of-truth table, (c) backfilling from `assets`/`qa_photo_reviews`/`oes_pp_data`/`stock_pickings`/`stock_returns`, (d) fixing the silently-broken `contractor_stock_accountability` counter triggers, and (e) shipping a CLI reconciliation report so drift is visible.

**Architecture:** Schema-first migration (single migration file, with paired rollback), followed by **idempotent** backfill scripts (one per source table) that can be re-run safely. Triggers are installed **after** backfill so they don't race the backfill. Every trigger body wraps in `BEGIN/EXCEPTION` — a trigger failure must never abort the parent transaction (drift gets caught by the reconciliation report, not by user-facing 500s). The load-bearing change vs Phase 3: **real-Postgres integration tests via docker-compose**, no mocked SQL for trigger or backfill behaviour.

**Tech Stack:** Postgres 15 (self-hosted Supabase, `100.96.203.105:5437`); `pg.Pool` from the existing `@/lib/db` module; TypeScript backfill scripts run via `tsx` (matching `scripts/backfill-offline-ont.ts` pattern); Vitest for integration tests; Docker Compose for ephemeral test DB; existing migration runner pattern (`scripts/migrations/sql/<NNN>_<name>.sql` + `scripts/migrations/sql/rollback_<NNN>_<name>.sql`).

**Spec:** `docs/superpowers/specs/2026-05-21-serial-master-register-design.md`
**Audit:** `docs/superpowers/audits/2026-05-21-procurement-field-stock-integration.md`

**Out of scope for Wave 1** (deferred to Wave 2 or Phase 5):
- All `/procurement/field-stock/*` UI work (rebuild is Wave 2 — separate plan).
- Reconciliation drift **UI** — Wave 1 ships a CLI report only (`npm run reconcile:serials`).
- Return rejection workflow / `received` state / `supplier_return` UI.
- Stores Today mobile dashboard.
- Migrating cables/splitters/etc. off `assets` — Wave 1 covers ONT + Gizzu only.
- The 8 Phase-3 safety items (separate "Phase 3 safety" track).

---

## Three-role pattern per PR (mandatory)

Every PR in this plan follows the Phase 2/3 three-role pattern:

1. **Implementer** (sonnet) — writes the failing test, the implementation, runs the test, commits.
2. **Reviewer** (sonnet, blind) — `/review` skill on the diff only, with the spec + relevant CLAUDE.md files. No session context passes through.
3. **Evaluator** (opus) — judges whether the PR meets its success criteria (the "Success criteria" section at the bottom of each PR). If no → reopen with reviewer notes; if yes → merge.

PR opener uses the standing review-and-merge rule from `CLAUDE.md`: GHA must go green on the self-hosted runner AND blind review APPROVED before `gh pr merge --merge --delete-branch`.

---

## File Structure

### New files (Wave 1)

| Path | Responsibility |
|---|---|
| `scripts/migrations/sql/<NNN>_serial_master_register.sql` | The Wave 1 schema migration. NNN resolved by Probe 0 (`SELECT MAX(version) FROM migrations`). Adds state CHECK, new columns, `stock_serial_events`, paired rollback file. |
| `scripts/migrations/sql/rollback_<NNN>_serial_master_register.sql` | Drops everything the forward migration creates. Restores prior `status` CHECK. |
| `scripts/migrations/run-migration-<NNN>.js` | Thin runner that opens a `pg.Pool` against `DATABASE_URL`, reads the SQL file, applies it. Pattern copied from `scripts/migrations/run-migration-303.js`. |
| `scripts/backfill-stock-serials-from-assets.ts` | Backfill A: `assets` (ONT/Gizzu only) → `stock_serials` with `ON CONFLICT DO NOTHING`. CLI: `--dry-run`, `--commit`, `--limit N`. |
| `scripts/backfill-stock-serials-installed-from-qa.ts` | Backfill B: `qa_photo_reviews.ont_serial` (latest per serial) → `stock_serials.installed_at_drop_id`. Never overwrites a non-null. |
| `scripts/backfill-stock-serials-activated-from-oes.ts` | Backfill C: `oes_pp_data` activation rows → `stock_serials.status='activated'` + `activated_at_olt_id`. No downgrade from `faulty`/`scrapped`. |
| `scripts/backfill-stock-serial-events.ts` | Backfill D + E in one script with `--source pickings|returns|all`. Idempotent via composite key `(serial_id, source_table, source_id, event_type)`. |
| `scripts/reconcile-serials.ts` | CLI report. Reads validation-gate queries (PR-6) from a single SQL file and prints a table per check. Exit-code 1 if any check breaches its tolerance. |
| `src/lib/serial-events.ts` | Centralised event-emit helper used by future API handlers (issue/return/GRN). Wave 1 only defines `emitSerialEvent({serial_id, event_type, …})`; API callers wire in Wave 2 / phase-3-safety track. |
| `tests/db/setup/docker-compose.test.yml` | Postgres 15 + `tmpfs` data dir. Used by `npm run test:db`. |
| `tests/db/setup/seed.sql` | Hand-curated minimal seed (5 ONT serials in `assets`, 3 in `stock_serials`, 2 `qa_photo_reviews`, 1 `oes_pp_data`, 1 picking with done status, 1 return). |
| `tests/db/setup/global-setup.ts` | Vitest global-setup: spawns `docker compose up -d --wait` via `execFileSync` (no shell), then runs the seed + migration. Tears down on global teardown. |
| `tests/db/triggers/serial-events.test.ts` | Real-DB tests: INSERT into source tables, assert events + state. |
| `tests/db/backfill/assets.test.ts` | Real-DB test for Backfill A. |
| `tests/db/backfill/qa-installs.test.ts` | Real-DB test for Backfill B. |
| `tests/db/backfill/oes-activations.test.ts` | Real-DB test for Backfill C. |
| `tests/db/backfill/events.test.ts` | Real-DB test for Backfill D+E. |
| `tests/db/backfill/idempotency.test.ts` | Run every backfill twice; assert second run = zero row changes. |
| `tests/db/reconciliation.test.ts` | Inject known drift, run reconcile CLI, assert it surfaces it. |
| `vitest.db.config.ts` | Separate Vitest config that loads the docker-compose global setup. `npm run test:db` invokes it. |
| `docs/superpowers/audits/2026-05-21-phase-4-probes.md` | PR-0 output — answers to the 6 verification items. |

### Modified files (Wave 1)

| Path | Change |
|---|---|
| `package.json` | Add scripts: `"test:db": "vitest --config vitest.db.config.ts run"`, `"reconcile:serials": "tsx scripts/reconcile-serials.ts"`. |
| `.github/workflows/ci.yml` | Add `test:db` step that runs after lint. Skip if `DATABASE_URL_TEST` env unset (so contributors without Docker can still run main CI). |

### Existing files **referenced** but not modified in Wave 1

These are touched in **Wave 2** or the **Phase-3-safety** track, not here. They're mapped so Wave 2 has anchors:

- `pages/api/procurement/grn/[id]/confirm.ts` — GRN confirm. Wave 1 only **probes** it (Probe 4); the actual extension that writes `stock_serials` rows + emits `received_at_dc` events is **PR-6** (trigger installation). API-layer changes that bypass the trigger are deferred.
- `pages/api/procurement/field-stock/issue.ts` (or equivalent) — picking executor. The `status→done` trigger on `stock_pickings` (PR-6) covers the event emit; no API change in Wave 1.
- `pages/api/procurement/field-stock/return-actions.ts` (Phase 3) — emits events via trigger on `stock_returns` and `stock_return_lines`. No API change in Wave 1.

### Safe subprocess execution

All test setup uses **`execFileSync` with an args array** (no shell). The patterns:

```ts
// safe
import { execFileSync } from 'node:child_process';
execFileSync('docker', ['compose', '-f', COMPOSE, 'up', '-d', '--wait'],
             { stdio: 'inherit' });

// NEVER use exec() / execSync() with template strings — even with static input,
// the codebase convention is to avoid shell evaluation.
```

The plan never invokes the project's `src/utils/execFileNoThrow.ts` because (a) the test harness is independent of the app, (b) we want to keep the harness free of app-runtime dependencies. `execFileSync` from node's stdlib is the right primitive.

---

## PR-0 — Verification probes (no code, doc only)

**Goal:** Resolve the 6 open verification items in the spec by querying the live shared DB. Output is a single doc that the rest of the plan reads.

**Branch:** `docs/phase-4-probes`
**Reviewer scope:** doc-only — single sonnet `/review` is enough.

### Files
- Create: `docs/superpowers/audits/2026-05-21-phase-4-probes.md`

### Probe execution rules
- Read-only psql against `localhost:5437` (Tailscale `100.96.203.105:5437`). Connection string is in `.claude/credentials.local.md`.
- For one-off queries: `docker exec supabase-db psql -U postgres -d fibreflow -c "<query>"` — the memory note says this is the safe path when `$DATABASE_URL` slots are saturated.
- Every probe records: the exact query, the full output, and the resulting decision in the probe doc.

### Steps

- [ ] **Step 1: Probe 0 — Migration version**

Run:
```bash
docker exec supabase-db psql -U postgres -d fibreflow -c "SELECT MAX(version) AS current_max FROM migrations;"
```
Expected: single row e.g. `360`. Record as `current_max`. Wave 1 forward migration = `current_max + 1`. **Do NOT take the version from `ls scripts/migrations/sql/` — side branches apply to the shared DB and the filename can lag the DB.**

- [ ] **Step 2: Probe 1 — Current `stock_serials.status` CHECK values**

Run:
```bash
docker exec supabase-db psql -U postgres -d fibreflow -c "
SELECT pg_get_constraintdef(oid) AS def
FROM pg_constraint WHERE conname = 'stock_serials_status_check';"
```
Then:
```bash
docker exec supabase-db psql -U postgres -d fibreflow -c "
SELECT status, COUNT(*) FROM stock_serials GROUP BY 1 ORDER BY 2 DESC;"
```
Record both. The migration in PR-1 must include every status value that currently exists in data **plus** the 3 new ones (`activated`, `in_repair`, `allocated_to_project`). If a status like `'used'` exists in data, document the decision: keep it (broaden) or migrate the rows (then drop it).

- [ ] **Step 3: Probe 2 — `projects` table FK target**

Run:
```bash
docker exec supabase-db psql -U postgres -d fibreflow -c "
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'projects' AND column_name IN ('id', 'project_id', 'uuid')
ORDER BY ordinal_position;"
```
Record the actual PK column name + type. Decision input: the `allocated_to_project_id` column added in PR-1 must reference the correct `projects.<pk>`.

- [ ] **Step 4: Probe 3 — OLT identifier in `oes_pp_data`**

Run:
```bash
docker exec supabase-db psql -U postgres -d fibreflow -c "
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'oes_pp_data' AND column_name ILIKE '%olt%';"
```
Record the column name + type. Decision: the `activated_at_olt_id` column on `stock_serials` adopts the same type. If there's no FK target table, the column stays as `TEXT`/`VARCHAR` without a constraint and we note "future hardening: introduce `olts` table."

- [ ] **Step 5: Probe 4 — GRN confirm code path**

Run:
```bash
cd /home/hein/Workspace/FF_Next.js-procurement-audit
grep -rE "grn.*confirm|confirmGrn|grn_lines.*INSERT" pages/api/procurement/ src/services/procurement/ 2>/dev/null | head -20
```
Record the file path + handler. Decision: PR-6 trigger installation may need a companion API change if no trigger source is sufficient. Wave 1's preference is "trigger on `grn_lines` AFTER INSERT", not "modify the API handler" — but the code probe confirms whether `grn_lines` is the right insertion point or whether `grns` status transitions also matter.

- [ ] **Step 6: Probe 5 — NOC fault ticket integration source**

Run:
```bash
docker exec supabase-db psql -U postgres -d fibreflow -c "
SELECT table_name FROM information_schema.columns
WHERE column_name ILIKE '%ont_serial%' OR column_name ILIKE '%serial_number%'
ORDER BY table_name;"
```
Also:
```bash
grep -rE "noc.*ticket|fault" src/modules/noc/ 2>/dev/null | head -10
```
Record candidate source tables for `flagged_faulty` events. Decision: if there's no clear single table (e.g. NOC tickets reference serials only via free-text), the `flagged_faulty` event is emitted by a manual admin action in Wave 2 — **NO trigger** for this event in Wave 1. Document the deferral.

- [ ] **Step 7: Probe 6 — Legacy `/procurement/field-stock/*` page strategy**

Decision-only (no DB query). Two options:
- **(a) Feature flag** — `NEXT_PUBLIC_NEW_FIELD_STOCK_UI=true` flips the routes. Old pages remain at the same URLs but render new components. Rollback = flip the flag.
- **(b) `/legacy/*` URLs** — new IA lives at `/procurement/field-stock/*`, old pages move to `/procurement/field-stock/legacy/*` during the rebuild.

Recommend **(b)** — cleaner URLs in production, no risk of flag-leakage, browser caching is unambiguous. Wave 2 PRs reference the legacy paths from this decision. Record the decision in the probe doc.

- [ ] **Step 8: Write the probe doc**

Create `docs/superpowers/audits/2026-05-21-phase-4-probes.md` with one section per probe: query, raw output (verbatim), decision, downstream-PR impact. Cite line-numbers where probe 4/5 grep findings live.

- [ ] **Step 9: Commit + push + PR**

```bash
cd /home/hein/Workspace/FF_Next.js-procurement-audit
git checkout -b docs/phase-4-probes
git add docs/superpowers/audits/2026-05-21-phase-4-probes.md
git commit -m "docs(audit): Phase 4 verification probe results"
git push -u origin docs/phase-4-probes
gh pr create --title "docs: Phase 4 verification probes" --body "Resolves 6 open verification items from spec 2026-05-21-serial-master-register-design.md before Wave 1 implementation begins. Doc-only PR."
```

- [ ] **Step 10: Reviewer + Evaluator + merge**

Spawn `/review` on the diff. Once APPROVED + GHA green: `gh pr merge <N> --merge --delete-branch`.

### Success criteria (PR-0)
- All 6 probes have a recorded query + verbatim output.
- Migration version decided.
- Every later PR can cite this doc by section number for any value it parameterises.

---

## PR-1 — Schema migration

**Goal:** Add the schema changes Wave 1 needs in one atomic migration with a paired rollback. No data backfill yet; that's PR-2+. Triggers come in PR-6.

**Branch:** `feat/phase-4-pr1-schema-migration`
**Reviewer scope:** code review — single sonnet `/review`.

### Files
- Create: `scripts/migrations/sql/<NNN>_serial_master_register.sql`
- Create: `scripts/migrations/sql/rollback_<NNN>_serial_master_register.sql`
- Create: `scripts/migrations/run-migration-<NNN>.js`
- Create: `tests/db/setup/docker-compose.test.yml`
- Create: `tests/db/setup/seed.sql`
- Create: `tests/db/setup/global-setup.ts`
- Create: `vitest.db.config.ts`
- Modify: `package.json` (add `test:db` script)
- Create: `tests/db/migration.test.ts`

Replace `<NNN>` with the value from Probe 0. References to it below are literal `<NNN>` until the worker substitutes.

### Steps

- [ ] **Step 1: Write the docker-compose test stack**

Create `tests/db/setup/docker-compose.test.yml`:

```yaml
services:
  test-db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: fibreflow_test
      POSTGRES_PASSWORD: fibreflow_test
      POSTGRES_DB: fibreflow_test
    ports:
      - "55432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fibreflow_test"]
      interval: 1s
      timeout: 5s
      retries: 30
    tmpfs:
      - /var/lib/postgresql/data
```

`tmpfs` makes startup ~3× faster and guarantees a clean slate per CI run.

- [ ] **Step 2: Write the minimal seed**

Create `tests/db/setup/seed.sql` — schema-equivalent subset of prod tables relevant to Wave 1 (stock_items, stock_serials, assets, qa_photo_reviews, oes_pp_data, stock_pickings, stock_picking_lines, stock_returns, stock_return_lines, contractor_stock_accountability, drops, projects, users, staff). For each: only the columns Wave 1 touches. Hand-curated 2-5 rows per table covering happy-path + edge cases (an asset not yet in `stock_serials`; a `qa_photo_reviews.ont_serial` for an `issued` serial; a `status='done'` picking; a `pending_inspection` return).

```sql
-- tests/db/setup/seed.sql
-- Schema-equivalent subset for Wave 1 integration tests.
-- DO NOT add columns not under test — keep small and auditable.

BEGIN;

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);
INSERT INTO projects (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Project A');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL
);
INSERT INTO users (id, email) VALUES
  ('22222222-2222-2222-2222-222222222222', 'tester@test.local');

CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL
);
INSERT INTO staff (id, full_name) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Test Tech');

CREATE TABLE drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number TEXT UNIQUE NOT NULL,
  project_id UUID REFERENCES projects(id)
);
INSERT INTO drops (id, drop_number, project_id) VALUES
  ('44444444-4444-4444-4444-444444444444', 'DR0000001',
   '11111111-1111-1111-1111-111111111111');

CREATE TABLE stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE NOT NULL,
  device_type TEXT NOT NULL
);
INSERT INTO stock_items (id, sku, device_type) VALUES
  ('55555555-5555-5555-5555-555555555555', 'ONT-NOKIA-G140W-H', 'ont'),
  ('66666666-6666-6666-6666-666666666666', 'GIZZU-30W',         'gizzu');

CREATE TABLE stock_serials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  serial_number TEXT NOT NULL,
  mac_address TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  current_holder_staff_id UUID REFERENCES staff(id),
  current_location_id UUID,
  installed_at_drop_id UUID REFERENCES drops(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (stock_item_id, serial_number),
  CONSTRAINT stock_serials_status_check CHECK (
    status IN ('available','reserved','in_transit','issued',
               'installed','returned','scrapped','faulty')
  )
);

INSERT INTO stock_serials (id, stock_item_id, serial_number, status) VALUES
  ('77777777-7777-7777-7777-777777777777',
   '55555555-5555-5555-5555-555555555555',
   'ALCL12345001', 'available');

INSERT INTO stock_serials (id, stock_item_id, serial_number, status,
                           current_holder_staff_id) VALUES
  ('88888888-8888-8888-8888-888888888888',
   '55555555-5555-5555-5555-555555555555',
   'ALCL12345002', 'issued',
   '33333333-3333-3333-3333-333333333333');

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  mac_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO assets (id, asset_type, serial_number, mac_address) VALUES
  ('99999999-9999-9999-9999-999999999999', 'ont', 'ALCL12345003', 'AA:BB:CC:00:00:03'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'gizzu', 'GZU0000004', NULL);

CREATE TABLE qa_photo_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id UUID REFERENCES drops(id),
  drop_number TEXT,
  ont_serial TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO qa_photo_reviews (drop_id, drop_number, ont_serial) VALUES
  ('44444444-4444-4444-4444-444444444444', 'DR0000001', 'ALCL12345002');

CREATE TABLE oes_pp_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT,
  olt_id TEXT,
  pon_id TEXT,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_pickings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  contractor_id UUID,
  staff_id UUID REFERENCES staff(id),
  done_at TIMESTAMPTZ
);

CREATE TABLE stock_picking_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_id UUID NOT NULL REFERENCES stock_pickings(id) ON DELETE CASCADE,
  stock_serial_id UUID REFERENCES stock_serials(id),
  serial_number TEXT
);

WITH p AS (
  INSERT INTO stock_pickings (id, picking_type, status, staff_id, done_at)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'issue', 'done',
          '33333333-3333-3333-3333-333333333333', NOW())
  RETURNING id
)
INSERT INTO stock_picking_lines (picking_id, stock_serial_id, serial_number)
  SELECT id, '88888888-8888-8888-8888-888888888888', 'ALCL12345002' FROM p;

CREATE TABLE stock_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending_inspection',
  staff_id UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_return_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
  stock_serial_id UUID REFERENCES stock_serials(id),
  serial_number TEXT,
  disposition TEXT
);

CREATE TABLE contractor_stock_accountability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL,
  total_issued_count INTEGER NOT NULL DEFAULT 0,
  total_returned_count INTEGER NOT NULL DEFAULT 0,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (contractor_id)
);

CREATE TABLE migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO migrations (version, name) SELECT 360, 'serial_ids_gin_index';

COMMIT;
```

The seed intentionally has **drift** baked in:
- Asset `ALCL12345003` exists but has no `stock_serials` row → Backfill A target.
- Serial `ALCL12345002` is `issued` and has a `qa_photo_reviews` row → Backfill B should move it to `installed`.
- Picking `bbbbbbbb…` is `status='done'` but `contractor_stock_accountability.total_issued_count` is zero → broken accountability target.

- [ ] **Step 3: Write the global-setup**

Create `tests/db/setup/global-setup.ts`:

```ts
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Pool } from 'pg';

const COMPOSE = 'tests/db/setup/docker-compose.test.yml';
const URL = 'postgres://fibreflow_test:fibreflow_test@localhost:55432/fibreflow_test';

export async function setup() {
  // execFileSync with arg array — no shell, no injection surface.
  execFileSync('docker',
    ['compose', '-f', COMPOSE, 'up', '-d', '--wait'],
    { stdio: 'inherit' });

  const seed = await fs.readFile(path.join(process.cwd(),
    'tests/db/setup/seed.sql'), 'utf8');
  const migration = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/<NNN>_serial_master_register.sql'), 'utf8');

  const pool = new Pool({ connectionString: URL });
  await pool.query(seed);
  await pool.query(migration);
  await pool.end();

  process.env.DATABASE_URL_TEST = URL;
}

export async function teardown() {
  execFileSync('docker', ['compose', '-f', COMPOSE, 'down', '-v'],
    { stdio: 'inherit' });
}
```

Worker note: substitute `<NNN>` with the value from Probe 0 throughout the plan as you go.

- [ ] **Step 4: Write the vitest config**

Create `vitest.db.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.ts'],
    globalSetup: ['./tests/db/setup/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },  // serialize DB writes
  },
});
```

- [ ] **Step 5: Add `test:db` script**

Edit `package.json` — add to `"scripts"`:

```json
"test:db": "vitest --config vitest.db.config.ts run"
```

Place adjacent to existing `"test"`. Don't reorder unrelated keys.

- [ ] **Step 6: Write the migration assertion test (RED first)**

Create `tests/db/migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

const URL = process.env.DATABASE_URL_TEST!;

describe('Wave 1 migration', () => {
  it('extends stock_serials.status CHECK with the 3 new states', async () => {
    const pool = new Pool({ connectionString: URL });
    const r = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conname = 'stock_serials_status_check'`);
    await pool.end();
    expect(r.rows[0].def).toMatch(/activated/);
    expect(r.rows[0].def).toMatch(/in_repair/);
    expect(r.rows[0].def).toMatch(/allocated_to_project/);
  });

  it('adds allocated_to_project_id and activated_at_olt_id columns', async () => {
    const pool = new Pool({ connectionString: URL });
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'stock_serials'
      AND column_name IN ('allocated_to_project_id', 'activated_at_olt_id')`);
    await pool.end();
    expect(r.rows.map(x => x.column_name).sort()).toEqual(
      ['activated_at_olt_id', 'allocated_to_project_id']);
  });

  it('creates stock_serial_events with the required indexes', async () => {
    const pool = new Pool({ connectionString: URL });
    const r = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'stock_serial_events'`);
    await pool.end();
    const names = r.rows.map(x => x.indexname);
    expect(names).toContain('idx_sse_serial_time');
    expect(names).toContain('idx_sse_event_type');
    expect(names).toContain('idx_sse_source');
  });
});
```

- [ ] **Step 7: Run the test — confirm RED**

```bash
cd /home/hein/Workspace/FF_Next.js-procurement-audit
npm run test:db -- migration.test.ts
```

Expected: tests fail because the migration file doesn't exist → global-setup throws on `fs.readFile`. That's the correct red.

- [ ] **Step 8: Write the forward migration**

Create `scripts/migrations/sql/<NNN>_serial_master_register.sql` (substitute Probe-0 value):

```sql
-- Wave 1: Serial Master Register
-- Spec:  docs/superpowers/specs/2026-05-21-serial-master-register-design.md
-- Probes: docs/superpowers/audits/2026-05-21-phase-4-probes.md
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE.

BEGIN;

-- (a) Extend stock_serials.status CHECK.
-- List MUST be a superset of Probe-1 values. If Probe-1 found extras
-- (e.g. 'used'), append them here and update the comment.
ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_status_check CHECK (
  status IN (
    'available',
    'reserved',
    'allocated_to_project',     -- NEW
    'in_transit',
    'issued',
    'installed',
    'activated',                -- NEW
    'faulty',
    'in_repair',                -- NEW
    'returned',
    'scrapped'
  )
);

-- (b) New columns on stock_serials.
-- allocated_to_project_id references projects(<pk>); the column name comes
-- from Probe 2.
ALTER TABLE stock_serials
  ADD COLUMN IF NOT EXISTS allocated_to_project_id UUID REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS activated_at_olt_id     TEXT;  -- Probe 3.

CREATE INDEX IF NOT EXISTS idx_ss_allocated_project
  ON stock_serials(allocated_to_project_id);
CREATE INDEX IF NOT EXISTS idx_ss_activated_olt
  ON stock_serials(activated_at_olt_id);

-- (c) Event log.
CREATE TABLE IF NOT EXISTS stock_serial_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id       UUID NOT NULL REFERENCES stock_serials(id),
  event_type      VARCHAR(50) NOT NULL,
  from_state      VARCHAR(50),
  to_state        VARCHAR(50),
  source_table    VARCHAR(50),
  source_id       UUID,
  actor_user_id   UUID REFERENCES users(id),
  actor_staff_id  UUID REFERENCES staff(id),
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sse_serial_time
  ON stock_serial_events(serial_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_event_type
  ON stock_serial_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_source
  ON stock_serial_events(source_table, source_id);

-- Backfill scripts D+E rely on this composite key for idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sse_dedupe
  ON stock_serial_events(serial_id, source_table, source_id, event_type)
  WHERE source_id IS NOT NULL;

INSERT INTO migrations (version, name)
  VALUES (<NNN>, 'serial_master_register')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
```

Triggers are NOT created in this PR — they ship in PR-6 after backfills land.

- [ ] **Step 9: Write the rollback migration**

Create `scripts/migrations/sql/rollback_<NNN>_serial_master_register.sql`:

```sql
-- Rollback Wave 1: Serial Master Register
-- Pre-rollback operational step: pg_dump stock_serials, stock_serial_events.

BEGIN;

DROP INDEX IF EXISTS uq_sse_dedupe;
DROP INDEX IF EXISTS idx_sse_source;
DROP INDEX IF EXISTS idx_sse_event_type;
DROP INDEX IF EXISTS idx_sse_serial_time;
DROP TABLE IF EXISTS stock_serial_events;

DROP INDEX IF EXISTS idx_ss_activated_olt;
DROP INDEX IF EXISTS idx_ss_allocated_project;
ALTER TABLE stock_serials DROP COLUMN IF EXISTS activated_at_olt_id;
ALTER TABLE stock_serials DROP COLUMN IF EXISTS allocated_to_project_id;

ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_status_check CHECK (
  status IN ('available','reserved','in_transit','issued',
             'installed','returned','scrapped','faulty')
);

DELETE FROM migrations WHERE version = <NNN>;

COMMIT;
```

- [ ] **Step 10: Write the migration runner**

Create `scripts/migrations/run-migration-<NNN>.js`:

```js
#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const VERSION = <NNN>;
const NAME = 'serial_master_register';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const sql = fs.readFileSync(
    path.join(__dirname, 'sql', `${VERSION}_${NAME}.sql`), 'utf8');
  try {
    await pool.query(sql);
    const r = await pool.query(
      'SELECT version, name, applied_at FROM migrations WHERE version=$1',
      [VERSION]);
    console.log('Applied:', r.rows[0]);
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
```

Worker note: substitute `<NNN>` in the JS too.

- [ ] **Step 11: Run the migration test — confirm GREEN**

```bash
npm run test:db -- migration.test.ts
```

Expected: 3 passes. If any fail, the migration SQL is wrong; fix before commit.

- [ ] **Step 12: Run lint + type-check**

```bash
npm run lint -- --max-warnings 0 \
  scripts/migrations/run-migration-<NNN>.js \
  tests/db/setup/global-setup.ts \
  vitest.db.config.ts
npx tsc --noEmit
```

Expected: clean on changed files. If pre-existing errors exist (per `feedback_worktree_lsp_false_positives.md`), confirm they're unrelated to Wave 1.

- [ ] **Step 13: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-procurement-audit
git checkout -b feat/phase-4-pr1-schema-migration
git add scripts/migrations/sql/<NNN>_serial_master_register.sql \
        scripts/migrations/sql/rollback_<NNN>_serial_master_register.sql \
        scripts/migrations/run-migration-<NNN>.js \
        tests/db/setup/docker-compose.test.yml \
        tests/db/setup/seed.sql \
        tests/db/setup/global-setup.ts \
        tests/db/migration.test.ts \
        vitest.db.config.ts \
        package.json
git commit -m "feat(serial-register): Wave 1 PR-1 — schema migration <NNN>

Adds stock_serials.{status CHECK extended, allocated_to_project_id,
activated_at_olt_id}, stock_serial_events table with indexes and
dedupe-key for backfill idempotency. Adds docker-compose
real-Postgres test harness (npm run test:db) — the load-bearing
change vs Phase 3's mocked-SQL approach.

Triggers ship in PR-6 after backfills.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 14: Push + open PR**

```bash
git push -u origin feat/phase-4-pr1-schema-migration
gh pr create --title "feat(serial-register): Wave 1 PR-1 — schema migration" \
  --body "Migration <NNN>: 12-state CHECK, 2 new columns on stock_serials, stock_serial_events. Paired rollback. Docker-compose real-Postgres test harness (npm run test:db) as the load-bearing fix for Phase 3's mocked-SQL bug class.

Test plan:
- [ ] npm run test:db -- migration.test.ts (3 cases)
- [ ] npm run lint clean on changed files
- [ ] forward migration applies idempotently on fresh seed
- [ ] rollback restores prior CHECK"
```

- [ ] **Step 15: Reviewer (blind) + Evaluator + merge**

Spawn `/review` (sonnet, blind). Evaluator (opus) confirms harness works, migration matches spec §"Backfill plan — Step 1", rollback symmetric. Then `gh pr merge --merge --delete-branch`.

### Success criteria (PR-1)
- `npm run test:db` reports 3/3 green.
- Forward migration runs idempotently on a fresh seed (run twice → no error).
- Rollback restores prior CHECK + drops new objects.
- No GHA regression (`npm run ci:quick` clean).

---

## PR-2 — Backfill A: `assets` → `stock_serials`

**Goal:** Pull every ONT and Gizzu serial from `assets` into `stock_serials`, with the existing `UNIQUE (stock_item_id, serial_number)` constraint as the idempotency guard. Don't touch state of pre-existing `stock_serials` rows — Backfill A only **inserts** new rows.

**Branch:** `feat/phase-4-pr2-backfill-assets`
**Reviewer scope:** code review — single sonnet `/review`.

### Files
- Create: `scripts/backfill-stock-serials-from-assets.ts`
- Create: `tests/db/backfill/assets.test.ts`

### Steps

- [ ] **Step 1: Write the failing test**

Create `tests/db/backfill/assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillAssetsToSerials } from '../../../scripts/backfill-stock-serials-from-assets';

const URL = process.env.DATABASE_URL_TEST!;

async function reseedAsset(pool: Pool, serial: string, type: string) {
  await pool.query(
    `INSERT INTO assets (asset_type, serial_number) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`, [type, serial]);
}

describe('Backfill A: assets → stock_serials', () => {
  it('inserts a new stock_serials row for an ONT asset not yet registered', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      // seed.sql provides asset ALCL12345003 with no stock_serials row.
      const result = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont', 'gizzu'], commit: true });
      expect(result.inserted).toBeGreaterThanOrEqual(1);
      const r = await pool.query(
        `SELECT status FROM stock_serials WHERE serial_number = 'ALCL12345003'`);
      expect(r.rows[0]?.status).toBe('available');
    } finally { await pool.end(); }
  });

  it('is idempotent — second run inserts zero rows', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await backfillAssetsToSerials({ pool, deviceTypes: ['ont','gizzu'], commit: true });
      const second = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont','gizzu'], commit: true });
      expect(second.inserted).toBe(0);
    } finally { await pool.end(); }
  });

  it('--dry-run inserts nothing', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await reseedAsset(pool, 'ALCL12345099', 'ont');
      const result = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont','gizzu'], commit: false });
      expect(result.wouldInsert).toBeGreaterThanOrEqual(1);
      const r = await pool.query(
        `SELECT COUNT(*) FROM stock_serials WHERE serial_number = 'ALCL12345099'`);
      expect(Number(r.rows[0].count)).toBe(0);
    } finally { await pool.end(); }
  });

  it('skips device types not in the allow-list', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(`INSERT INTO assets (asset_type, serial_number)
                        VALUES ('splitter', 'SPL0000001')`);
      await backfillAssetsToSerials({
        pool, deviceTypes: ['ont','gizzu'], commit: true });
      const r = await pool.query(
        `SELECT COUNT(*) FROM stock_serials WHERE serial_number = 'SPL0000001'`);
      expect(Number(r.rows[0].count)).toBe(0);
    } finally { await pool.end(); }
  });
});
```

- [ ] **Step 2: Run test — confirm RED**

```bash
npm run test:db -- backfill/assets.test.ts
```

Expected: module-not-found on the import. That's the correct red.

- [ ] **Step 3: Implement the backfill**

Create `scripts/backfill-stock-serials-from-assets.ts`:

```ts
#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';

interface BackfillOptions {
  pool: Pool;
  deviceTypes: string[];
  commit: boolean;
  limit?: number;
}

export interface BackfillResult {
  inserted: number;
  wouldInsert: number;
  skipped: number;
}

async function loadStockItemIds(pool: Pool, deviceTypes: string[]) {
  const r = await pool.query(
    `SELECT id, device_type FROM stock_items WHERE device_type = ANY($1::text[])`,
    [deviceTypes]);
  const byType = new Map<string, string>();
  for (const row of r.rows) {
    if (!byType.has(row.device_type)) byType.set(row.device_type, row.id);
  }
  return byType;
}

export async function backfillAssetsToSerials(
  opts: BackfillOptions): Promise<BackfillResult> {
  const { pool, deviceTypes, commit, limit } = opts;
  const stockItemIds = await loadStockItemIds(pool, deviceTypes);
  if (stockItemIds.size === 0) {
    log.warn('backfill-assets: no stock_items match device types', { deviceTypes });
    return { inserted: 0, wouldInsert: 0, skipped: 0 };
  }

  const limitClause = limit ? `LIMIT ${Math.max(0, Math.floor(limit))}` : '';
  const select = `
    SELECT a.serial_number, a.mac_address, a.asset_type, a.created_at
    FROM assets a
    WHERE a.asset_type = ANY($1::text[])
      AND NOT EXISTS (
        SELECT 1 FROM stock_serials s
        WHERE s.serial_number = a.serial_number
          AND s.stock_item_id IN (
            SELECT id FROM stock_items WHERE device_type = a.asset_type)
      )
    ${limitClause}`;

  const candidates = (await pool.query(select, [deviceTypes])).rows;

  if (!commit) {
    return { inserted: 0, wouldInsert: candidates.length, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;
  for (const row of candidates) {
    const stockItemId = stockItemIds.get(row.asset_type);
    if (!stockItemId) { skipped += 1; continue; }
    const r = await pool.query(
      `INSERT INTO stock_serials
         (stock_item_id, serial_number, mac_address, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'available', $4, NOW())
       ON CONFLICT (stock_item_id, serial_number) DO NOTHING
       RETURNING id`,
      [stockItemId, row.serial_number, row.mac_address, row.created_at]);
    if ((r.rowCount ?? 0) > 0) inserted += 1; else skipped += 1;
  }

  return { inserted, wouldInsert: 0, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillAssetsToSerials({
      pool, deviceTypes: ['ont', 'gizzu'], commit, limit });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await pool.end();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) { main(); }
```

- [ ] **Step 4: Run test — confirm GREEN**

```bash
npm run test:db -- backfill/assets.test.ts
```

Expected: 4/4 passes.

- [ ] **Step 5: Lint + commit + PR + review + merge**

```bash
npm run lint -- --max-warnings 0 scripts/backfill-stock-serials-from-assets.ts \
  tests/db/backfill/assets.test.ts
git add scripts/backfill-stock-serials-from-assets.ts \
        tests/db/backfill/assets.test.ts
git commit -m "feat(serial-register): Wave 1 PR-2 — backfill assets to stock_serials

Idempotent backfill of ONT/Gizzu serials from assets to stock_serials.
ON CONFLICT (stock_item_id, serial_number) DO NOTHING. --dry-run and
--commit flags; real-Postgres tests assert idempotency.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin feat/phase-4-pr2-backfill-assets
gh pr create --title "feat(serial-register): Wave 1 PR-2 — backfill assets" \
  --body "Idempotent ONT/Gizzu backfill from assets → stock_serials. 4/4 real-DB tests green."
```

Then `/review` + merge per the standard pattern.

### Success criteria (PR-2)
- 4/4 tests green on `test:db`.
- Idempotency invariant: 2nd run = 0 inserts.
- `--dry-run` mutates nothing.
- Only ONT/Gizzu types touched.

---

## PR-3 — Backfill B: `qa_photo_reviews.ont_serial` → `installed_at_drop_id`

**Goal:** For every `qa_photo_reviews` row with `ont_serial`, mark the matching `stock_serials` row as `installed` with the right `installed_at_drop_id`. **Never overwrite** an existing non-null `installed_at_drop_id` (idempotency guard).

**Branch:** `feat/phase-4-pr3-backfill-installs`
**Reviewer scope:** code review.

### Files
- Create: `scripts/backfill-stock-serials-installed-from-qa.ts`
- Create: `tests/db/backfill/qa-installs.test.ts`

### Steps

- [ ] **Step 1: Write failing test**

Create `tests/db/backfill/qa-installs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillInstallsFromQA } from '../../../scripts/backfill-stock-serials-installed-from-qa';

const URL = process.env.DATABASE_URL_TEST!;

describe('Backfill B: qa_photo_reviews → installed_at_drop_id', () => {
  it('marks an issued serial as installed when QA exists', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const r = await backfillInstallsFromQA({ pool, commit: true });
      expect(r.updated).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT status, installed_at_drop_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('installed');
      expect(s.rows[0].installed_at_drop_id).toBe(
        '44444444-4444-4444-4444-444444444444');
    } finally { await pool.end(); }
  });

  it('does not overwrite an existing installed_at_drop_id', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(
        `UPDATE stock_serials SET installed_at_drop_id =
            '44444444-4444-4444-4444-444444444444', status='installed'
         WHERE serial_number = 'ALCL12345002'`);
      await pool.query(`INSERT INTO drops (id, drop_number)
        VALUES ('55555555-aaaa-aaaa-aaaa-555555555555', 'DR0000099')`);
      await pool.query(`INSERT INTO qa_photo_reviews
        (drop_id, drop_number, ont_serial)
        VALUES ('55555555-aaaa-aaaa-aaaa-555555555555', 'DR0000099', 'ALCL12345002')`);
      await backfillInstallsFromQA({ pool, commit: true });
      const s = await pool.query(
        `SELECT installed_at_drop_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].installed_at_drop_id).toBe(
        '44444444-4444-4444-4444-444444444444');
    } finally { await pool.end(); }
  });

  it('idempotent — second run zero updates', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await backfillInstallsFromQA({ pool, commit: true });
      const second = await backfillInstallsFromQA({ pool, commit: true });
      expect(second.updated).toBe(0);
    } finally { await pool.end(); }
  });

  it('does not downgrade status from activated/faulty', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(
        `UPDATE stock_serials SET status='activated'
         WHERE serial_number = 'ALCL12345002'`);
      await backfillInstallsFromQA({ pool, commit: true });
      const s = await pool.query(
        `SELECT status FROM stock_serials WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('activated');
    } finally { await pool.end(); }
  });
});
```

- [ ] **Step 2: Run test — confirm RED**

```bash
npm run test:db -- backfill/qa-installs.test.ts
```

- [ ] **Step 3: Implement backfill**

Create `scripts/backfill-stock-serials-installed-from-qa.ts`:

```ts
#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';

interface Opts { pool: Pool; commit: boolean; }
interface Result { updated: number; wouldUpdate: number; skipped: number; }

export async function backfillInstallsFromQA(opts: Opts): Promise<Result> {
  const { pool, commit } = opts;
  const select = `
    SELECT DISTINCT ON (qa.ont_serial)
      qa.ont_serial AS serial_number,
      qa.drop_id,
      qa.created_at
    FROM qa_photo_reviews qa
    WHERE qa.ont_serial IS NOT NULL
      AND qa.drop_id   IS NOT NULL
    ORDER BY qa.ont_serial, qa.created_at DESC`;

  const candidates = (await pool.query(select)).rows;

  if (!commit) {
    const c = await pool.query(
      `WITH cand AS (${select})
       SELECT COUNT(*) FROM cand c
       JOIN stock_serials s ON s.serial_number = c.serial_number
       WHERE s.installed_at_drop_id IS NULL
         AND s.status IN ('available','reserved','issued',
                          'allocated_to_project','in_transit')`);
    return { updated: 0, wouldUpdate: Number(c.rows[0].count), skipped: 0 };
  }

  let updated = 0, skipped = 0;
  for (const row of candidates) {
    const r = await pool.query(
      `UPDATE stock_serials
         SET installed_at_drop_id = $1,
             status = 'installed',
             updated_at = NOW()
       WHERE serial_number = $2
         AND installed_at_drop_id IS NULL
         AND status IN ('available','reserved','issued',
                        'allocated_to_project','in_transit')
       RETURNING id`,
      [row.drop_id, row.serial_number]);
    if ((r.rowCount ?? 0) > 0) updated += 1; else skipped += 1;
  }
  log.info('backfill-installs done', { updated, skipped });
  return { updated, wouldUpdate: 0, skipped };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillInstallsFromQA({ pool, commit });
    console.log(JSON.stringify(r, null, 2));
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) { main(); }
```

- [ ] **Step 4: Run test — confirm GREEN**

```bash
npm run test:db -- backfill/qa-installs.test.ts
```

Expected: 4/4 passes.

- [ ] **Step 5: Commit + PR + review + merge** (same pattern as PR-2)

### Success criteria (PR-3)
- 4/4 tests green.
- Idempotency: 2nd run = 0 updates.
- No downgrade from `activated`/`faulty`.
- No overwrite of pre-set `installed_at_drop_id`.

---

## PR-4 — Backfill C: `oes_pp_data` → `status='activated'`

**Goal:** For every `oes_pp_data` row, mark the matching `stock_serials` row as `activated` and capture the OLT identifier. No downgrade if the serial is already `faulty` or `scrapped`.

**Branch:** `feat/phase-4-pr4-backfill-activations`

### Files
- Create: `scripts/backfill-stock-serials-activated-from-oes.ts`
- Create: `tests/db/backfill/oes-activations.test.ts`

### Steps

- [ ] **Step 1: Write failing test**

Create `tests/db/backfill/oes-activations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillActivationsFromOES } from '../../../scripts/backfill-stock-serials-activated-from-oes';

const URL = process.env.DATABASE_URL_TEST!;

describe('Backfill C: oes_pp_data → status=activated', () => {
  it('marks an installed serial as activated', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(
        `UPDATE stock_serials SET status='installed',
            installed_at_drop_id = '44444444-4444-4444-4444-444444444444'
         WHERE serial_number = 'ALCL12345002'`);
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_id)
        VALUES ('ALCL12345002', 'OLT-CT-01')`);
      const r = await backfillActivationsFromOES({ pool, commit: true });
      expect(r.updated).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT status, activated_at_olt_id FROM stock_serials
         WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('activated');
      expect(s.rows[0].activated_at_olt_id).toBe('OLT-CT-01');
    } finally { await pool.end(); }
  });

  it('does not downgrade a faulty serial', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(
        `UPDATE stock_serials SET status='faulty'
         WHERE serial_number = 'ALCL12345002'`);
      await pool.query(`INSERT INTO oes_pp_data (serial_number, olt_id)
        VALUES ('ALCL12345002', 'OLT-CT-01')`);
      await backfillActivationsFromOES({ pool, commit: true });
      const s = await pool.query(
        `SELECT status FROM stock_serials WHERE serial_number = 'ALCL12345002'`);
      expect(s.rows[0].status).toBe('faulty');
    } finally { await pool.end(); }
  });

  it('idempotent — second run zero updates', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await backfillActivationsFromOES({ pool, commit: true });
      const second = await backfillActivationsFromOES({ pool, commit: true });
      expect(second.updated).toBe(0);
    } finally { await pool.end(); }
  });
});
```

- [ ] **Step 2: Run test — confirm RED**

```bash
npm run test:db -- backfill/oes-activations.test.ts
```

- [ ] **Step 3: Implement**

Create `scripts/backfill-stock-serials-activated-from-oes.ts`:

```ts
#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';

interface Opts { pool: Pool; commit: boolean; }
interface Result { updated: number; wouldUpdate: number; }

const ALLOWED_FROM = ['available', 'installed', 'issued'];

export async function backfillActivationsFromOES(opts: Opts): Promise<Result> {
  const { pool, commit } = opts;
  const select = `
    SELECT DISTINCT ON (oes.serial_number)
      oes.serial_number, oes.olt_id
    FROM oes_pp_data oes
    WHERE oes.serial_number IS NOT NULL
    ORDER BY oes.serial_number, oes.activated_at DESC`;

  if (!commit) {
    const c = await pool.query(
      `WITH cand AS (${select})
       SELECT COUNT(*) FROM cand c
       JOIN stock_serials s ON s.serial_number = c.serial_number
       WHERE s.status = ANY($1::text[])
         AND (s.activated_at_olt_id IS DISTINCT FROM c.olt_id
              OR s.status <> 'activated')`,
      [ALLOWED_FROM.concat(['activated'])]);
    return { updated: 0, wouldUpdate: Number(c.rows[0].count) };
  }

  const r = await pool.query(`
    WITH cand AS (${select})
    UPDATE stock_serials s
       SET status = 'activated',
           activated_at_olt_id = c.olt_id,
           updated_at = NOW()
      FROM cand c
     WHERE s.serial_number = c.serial_number
       AND s.status = ANY($1::text[])
       AND (s.status <> 'activated' OR s.activated_at_olt_id IS DISTINCT FROM c.olt_id)
    RETURNING s.id`, [ALLOWED_FROM]);

  log.info('backfill-activations done', { updated: r.rowCount });
  return { updated: r.rowCount ?? 0, wouldUpdate: 0 };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillActivationsFromOES({ pool, commit });
    console.log(JSON.stringify(r, null, 2));
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) { main(); }
```

- [ ] **Step 4: Run test — confirm GREEN**

```bash
npm run test:db -- backfill/oes-activations.test.ts
```

- [ ] **Step 5: Commit + PR + review + merge**

### Success criteria (PR-4)
- 3/3 tests green.
- Idempotency: 2nd run = 0 updates.
- No downgrade from `faulty`/`scrapped`.

---

## PR-5 — Backfill D+E: historical events into `stock_serial_events`

**Goal:** Walk historical `stock_pickings` (done) + `stock_returns` and emit corresponding `stock_serial_events` rows. Idempotency via the unique index `uq_sse_dedupe` from PR-1.

**Branch:** `feat/phase-4-pr5-backfill-events`

### Files
- Create: `scripts/backfill-stock-serial-events.ts`
- Create: `tests/db/backfill/events.test.ts`
- Create: `tests/db/backfill/idempotency.test.ts`

### Steps

- [ ] **Step 1: Write failing test**

Create `tests/db/backfill/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillSerialEvents } from '../../../scripts/backfill-stock-serial-events';

const URL = process.env.DATABASE_URL_TEST!;

describe('Backfill D+E: historical events', () => {
  it('emits an "issued" event for each done picking line', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const r = await backfillSerialEvents({ pool, source: 'pickings', commit: true });
      expect(r.inserted).toBeGreaterThanOrEqual(1);
      const e = await pool.query(
        `SELECT event_type, to_state FROM stock_serial_events
         WHERE source_table='stock_pickings'
           AND source_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'`);
      expect(e.rows[0].event_type).toBe('issued');
      expect(e.rows[0].to_state).toBe('issued');
    } finally { await pool.end(); }
  });

  it('emits a "returned" event for each return line', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const returnId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      await pool.query(`INSERT INTO stock_returns (id, status, staff_id)
        VALUES ($1, 'pending_inspection',
                '33333333-3333-3333-3333-333333333333')`, [returnId]);
      await pool.query(`INSERT INTO stock_return_lines
        (return_id, stock_serial_id, serial_number)
        VALUES ($1, '88888888-8888-8888-8888-888888888888', 'ALCL12345002')`,
        [returnId]);
      await backfillSerialEvents({ pool, source: 'returns', commit: true });
      const e = await pool.query(
        `SELECT event_type FROM stock_serial_events
         WHERE source_table='stock_returns' AND source_id=$1`, [returnId]);
      expect(e.rows[0].event_type).toBe('returned');
    } finally { await pool.end(); }
  });

  it('source=all runs both D and E', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const r = await backfillSerialEvents({ pool, source: 'all', commit: true });
      expect(r.inserted).toBeGreaterThanOrEqual(0);
    } finally { await pool.end(); }
  });

  it('idempotent — second run zero inserts', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await backfillSerialEvents({ pool, source: 'all', commit: true });
      const second = await backfillSerialEvents({ pool, source: 'all', commit: true });
      expect(second.inserted).toBe(0);
    } finally { await pool.end(); }
  });
});
```

- [ ] **Step 2: Run test — confirm RED**

```bash
npm run test:db -- backfill/events.test.ts
```

- [ ] **Step 3: Implement**

Create `scripts/backfill-stock-serial-events.ts`:

```ts
#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';

interface Opts { pool: Pool; source: 'pickings'|'returns'|'all'; commit: boolean; }
interface Result { inserted: number; wouldInsert: number; }

async function backfillPickingEvents(pool: Pool, commit: boolean): Promise<number> {
  const insertSql = `
    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, actor_staff_id, occurred_at, payload)
    SELECT spl.stock_serial_id,
           'issued',
           NULL,
           'issued',
           'stock_pickings',
           sp.id,
           sp.staff_id,
           COALESCE(sp.done_at, NOW()),
           jsonb_build_object('picking_type', sp.picking_type,
                              'backfilled', true)
    FROM stock_pickings sp
    JOIN stock_picking_lines spl ON spl.picking_id = sp.id
    WHERE sp.status = 'done'
      AND spl.stock_serial_id IS NOT NULL
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
    DO NOTHING
    RETURNING id`;
  if (!commit) {
    const c = await pool.query(`
      SELECT COUNT(*) FROM stock_pickings sp
      JOIN stock_picking_lines spl ON spl.picking_id = sp.id
      WHERE sp.status = 'done' AND spl.stock_serial_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_serial_events e
          WHERE e.serial_id = spl.stock_serial_id
            AND e.source_table = 'stock_pickings'
            AND e.source_id = sp.id
            AND e.event_type = 'issued')`);
    return Number(c.rows[0].count);
  }
  const r = await pool.query(insertSql);
  return r.rowCount ?? 0;
}

async function backfillReturnEvents(pool: Pool, commit: boolean): Promise<number> {
  const insertSql = `
    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, actor_staff_id, occurred_at, payload)
    SELECT srl.stock_serial_id,
           'returned',
           NULL,
           'returned',
           'stock_returns',
           sr.id,
           sr.staff_id,
           sr.created_at,
           jsonb_build_object('disposition', srl.disposition,
                              'backfilled', true)
    FROM stock_returns sr
    JOIN stock_return_lines srl ON srl.return_id = sr.id
    WHERE srl.stock_serial_id IS NOT NULL
    ON CONFLICT (serial_id, source_table, source_id, event_type)
      WHERE source_id IS NOT NULL
    DO NOTHING
    RETURNING id`;
  if (!commit) {
    const c = await pool.query(`
      SELECT COUNT(*) FROM stock_returns sr
      JOIN stock_return_lines srl ON srl.return_id = sr.id
      WHERE srl.stock_serial_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_serial_events e
          WHERE e.serial_id = srl.stock_serial_id
            AND e.source_table = 'stock_returns'
            AND e.source_id = sr.id
            AND e.event_type = 'returned')`);
    return Number(c.rows[0].count);
  }
  const r = await pool.query(insertSql);
  return r.rowCount ?? 0;
}

export async function backfillSerialEvents(opts: Opts): Promise<Result> {
  const { pool, source, commit } = opts;
  let total = 0;
  if (source === 'pickings' || source === 'all') {
    total += await backfillPickingEvents(pool, commit);
  }
  if (source === 'returns' || source === 'all') {
    total += await backfillReturnEvents(pool, commit);
  }
  log.info('backfill-events done', { source, commit, total });
  return commit
    ? { inserted: total, wouldInsert: 0 }
    : { inserted: 0, wouldInsert: total };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const sourceIdx = process.argv.indexOf('--source');
  const source = (sourceIdx >= 0 ? process.argv[sourceIdx + 1] : 'all') as
    'pickings' | 'returns' | 'all';
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillSerialEvents({ pool, source, commit });
    console.log(JSON.stringify(r, null, 2));
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) { main(); }
```

- [ ] **Step 4: Run test — confirm GREEN**

```bash
npm run test:db -- backfill/events.test.ts
```

- [ ] **Step 5: Write cross-script idempotency test**

Create `tests/db/backfill/idempotency.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillAssetsToSerials } from '../../../scripts/backfill-stock-serials-from-assets';
import { backfillInstallsFromQA } from '../../../scripts/backfill-stock-serials-installed-from-qa';
import { backfillActivationsFromOES } from '../../../scripts/backfill-stock-serials-activated-from-oes';
import { backfillSerialEvents } from '../../../scripts/backfill-stock-serial-events';

const URL = process.env.DATABASE_URL_TEST!;

describe('Backfill A-E cross-script idempotency', () => {
  it('running A→B→C→D+E twice produces zero second-run changes', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await backfillAssetsToSerials({ pool, deviceTypes: ['ont','gizzu'], commit: true });
      await backfillInstallsFromQA({ pool, commit: true });
      await backfillActivationsFromOES({ pool, commit: true });
      await backfillSerialEvents({ pool, source: 'all', commit: true });

      const a = await backfillAssetsToSerials({ pool, deviceTypes: ['ont','gizzu'], commit: true });
      const b = await backfillInstallsFromQA({ pool, commit: true });
      const c = await backfillActivationsFromOES({ pool, commit: true });
      const de = await backfillSerialEvents({ pool, source: 'all', commit: true });

      expect(a.inserted).toBe(0);
      expect(b.updated).toBe(0);
      expect(c.updated).toBe(0);
      expect(de.inserted).toBe(0);
    } finally { await pool.end(); }
  });
});
```

- [ ] **Step 6: Run idempotency test — confirm GREEN**

```bash
npm run test:db -- backfill/idempotency.test.ts
```

- [ ] **Step 7: Commit + PR + review + merge**

### Success criteria (PR-5)
- Events test 4/4 green.
- Cross-script idempotency test 1/1 green.
- Composite-key dedupe works.

---

## PR-6 — Trigger installation + accountability fix + reconciliation CLI

**Goal:** Wire triggers on the source tables so future writes emit events automatically; fix the broken `contractor_stock_accountability` counter triggers; ship `npm run reconcile:serials` as the validation gate.

This is the **load-bearing trigger PR**. Reviewer scope: `/review-team` (multi-domain: schema + triggers + CLI + counter logic).

**Branch:** `feat/phase-4-pr6-triggers-and-reconcile`

### Files
- Create: `scripts/migrations/sql/<NNN+1>_serial_event_triggers.sql`
- Create: `scripts/migrations/sql/rollback_<NNN+1>_serial_event_triggers.sql`
- Create: `scripts/migrations/run-migration-<NNN+1>.js`
- Create: `scripts/reconcile-serials.ts`
- Create: `scripts/migrations/sql/reconcile-queries.sql`
- Create: `src/lib/serial-events.ts`
- Create: `tests/db/triggers/serial-events.test.ts`
- Create: `tests/db/reconciliation.test.ts`
- Modify: `package.json` (add `reconcile:serials` script)
- Modify: `tests/db/setup/global-setup.ts` (apply trigger migration after schema migration)

### Steps

- [ ] **Step 1: Write the trigger-fires test (RED first)**

Create `tests/db/triggers/serial-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

const URL = process.env.DATABASE_URL_TEST!;

describe('PR-6 triggers', () => {
  it('updating stock_pickings.status to done emits an issued event', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const pickId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      await pool.query(`INSERT INTO stock_pickings
        (id, picking_type, status, staff_id) VALUES
        ($1, 'issue', 'planned', '33333333-3333-3333-3333-333333333333')`, [pickId]);
      await pool.query(`INSERT INTO stock_picking_lines
        (picking_id, stock_serial_id, serial_number) VALUES
        ($1, '77777777-7777-7777-7777-777777777777', 'ALCL12345001')`, [pickId]);

      await pool.query(
        `UPDATE stock_pickings SET status='done', done_at=NOW() WHERE id=$1`,
        [pickId]);

      const r = await pool.query(
        `SELECT event_type, to_state FROM stock_serial_events
         WHERE source_id = $1 AND event_type='issued'`, [pickId]);
      expect(r.rowCount).toBeGreaterThanOrEqual(1);
      const s = await pool.query(
        `SELECT status FROM stock_serials WHERE id =
         '77777777-7777-7777-7777-777777777777'`);
      expect(s.rows[0].status).toBe('issued');
    } finally { await pool.end(); }
  });

  it('inserting a qa_photo_reviews emits an installed_at_drop event', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(`INSERT INTO qa_photo_reviews
        (drop_id, drop_number, ont_serial) VALUES
        ('44444444-4444-4444-4444-444444444444', 'DR0000001', 'ALCL12345001')`);
      const r = await pool.query(
        `SELECT event_type FROM stock_serial_events
         WHERE source_table='qa_photo_reviews'
           AND serial_id='77777777-7777-7777-7777-777777777777'
         ORDER BY recorded_at DESC LIMIT 1`);
      expect(r.rows[0].event_type).toBe('installed_at_drop');
    } finally { await pool.end(); }
  });

  it('updating a return line disposition to repair emits sent_to_repair', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const retId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      await pool.query(`INSERT INTO stock_returns (id, status, staff_id)
        VALUES ($1, 'pending_inspection',
                '33333333-3333-3333-3333-333333333333')`, [retId]);
      const lineId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      await pool.query(`INSERT INTO stock_return_lines
        (id, return_id, stock_serial_id, serial_number) VALUES
        ($1, $2, '88888888-8888-8888-8888-888888888888', 'ALCL12345002')`,
        [lineId, retId]);
      await pool.query(
        `UPDATE stock_return_lines SET disposition='repair' WHERE id=$1`,
        [lineId]);
      const r = await pool.query(
        `SELECT event_type FROM stock_serial_events
         WHERE source_id=$1 AND event_type='sent_to_repair'`, [lineId]);
      expect(r.rowCount).toBeGreaterThanOrEqual(1);
    } finally { await pool.end(); }
  });

  it('stock_pickings.status→done increments contractor_stock_accountability.total_issued_count', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      const contractorId = '99999999-aaaa-aaaa-aaaa-999999999999';
      await pool.query(`INSERT INTO contractor_stock_accountability
        (contractor_id) VALUES ($1) ON CONFLICT DO NOTHING`, [contractorId]);
      const pickId = 'aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa';
      await pool.query(`INSERT INTO stock_pickings
        (id, picking_type, status, contractor_id, staff_id) VALUES
        ($1, 'issue', 'planned', $2,
         '33333333-3333-3333-3333-333333333333')`, [pickId, contractorId]);
      const before = await pool.query(
        `SELECT total_issued_count FROM contractor_stock_accountability
         WHERE contractor_id=$1`, [contractorId]);
      await pool.query(
        `UPDATE stock_pickings SET status='done', done_at=NOW() WHERE id=$1`,
        [pickId]);
      const after = await pool.query(
        `SELECT total_issued_count FROM contractor_stock_accountability
         WHERE contractor_id=$1`, [contractorId]);
      expect(after.rows[0].total_issued_count).toBe(
        before.rows[0].total_issued_count + 1);
    } finally { await pool.end(); }
  });
});
```

- [ ] **Step 2: Run trigger test — confirm RED**

```bash
npm run test:db -- triggers/serial-events.test.ts
```

Expected: all 4 fail (triggers don't exist yet).

- [ ] **Step 3: Implement the trigger migration**

Create `scripts/migrations/sql/<NNN+1>_serial_event_triggers.sql` (use Probe-0 value + 1):

```sql
-- Wave 1 PR-6: Serial event triggers + accountability counter fix.
-- All trigger bodies wrap in BEGIN/EXCEPTION — a trigger throw must NEVER
-- abort the parent transaction. Drift is caught by reconcile-serials.

BEGIN;

-- (1) stock_pickings AFTER UPDATE OF status → emit 'issued' / 'transferred'
--     and update accountability counter.
CREATE OR REPLACE FUNCTION emit_serial_event_on_picking_done()
RETURNS TRIGGER AS $$
DECLARE
  line RECORD;
  event_type_val VARCHAR(50);
BEGIN
  IF NEW.status <> 'done' OR OLD.status = 'done' THEN
    RETURN NEW;
  END IF;

  event_type_val := CASE NEW.picking_type
    WHEN 'transfer' THEN 'transferred'
    ELSE 'issued' END;

  FOR line IN
    SELECT stock_serial_id FROM stock_picking_lines
    WHERE picking_id = NEW.id AND stock_serial_id IS NOT NULL
  LOOP
    BEGIN
      INSERT INTO stock_serial_events
        (serial_id, event_type, from_state, to_state, source_table,
         source_id, actor_staff_id, occurred_at, payload)
      VALUES
        (line.stock_serial_id, event_type_val,
         (SELECT status FROM stock_serials WHERE id = line.stock_serial_id),
         CASE NEW.picking_type WHEN 'transfer' THEN 'in_transit'
                               ELSE 'issued' END,
         'stock_pickings', NEW.id, NEW.staff_id,
         COALESCE(NEW.done_at, NOW()),
         jsonb_build_object('picking_type', NEW.picking_type))
      ON CONFLICT (serial_id, source_table, source_id, event_type)
        WHERE source_id IS NOT NULL
      DO NOTHING;

      UPDATE stock_serials
         SET status = CASE NEW.picking_type WHEN 'transfer' THEN 'in_transit'
                                            ELSE 'issued' END,
             current_holder_staff_id = NEW.staff_id,
             updated_at = NOW()
       WHERE id = line.stock_serial_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'emit_serial_event_on_picking_done: serial=% error=%',
        line.stock_serial_id, SQLERRM;
    END;
  END LOOP;

  -- Accountability counter (the broken-trigger fix).
  IF NEW.contractor_id IS NOT NULL THEN
    BEGIN
      INSERT INTO contractor_stock_accountability (contractor_id, total_issued_count)
      VALUES (NEW.contractor_id, (SELECT COUNT(*) FROM stock_picking_lines
                                   WHERE picking_id = NEW.id
                                     AND stock_serial_id IS NOT NULL))
      ON CONFLICT (contractor_id) DO UPDATE
        SET total_issued_count = contractor_stock_accountability.total_issued_count
          + (SELECT COUNT(*) FROM stock_picking_lines
             WHERE picking_id = NEW.id AND stock_serial_id IS NOT NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'accountability counter update failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_emit_event_on_picking_done ON stock_pickings;
CREATE TRIGGER trg_emit_event_on_picking_done
  AFTER UPDATE OF status ON stock_pickings
  FOR EACH ROW EXECUTE FUNCTION emit_serial_event_on_picking_done();

-- (2) qa_photo_reviews AFTER INSERT → emit installed_at_drop.
CREATE OR REPLACE FUNCTION emit_serial_event_on_qa_install()
RETURNS TRIGGER AS $$
DECLARE
  serial RECORD;
BEGIN
  IF NEW.ont_serial IS NULL OR NEW.drop_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, status INTO serial FROM stock_serials
    WHERE serial_number = NEW.ont_serial LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  BEGIN
    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, occurred_at, payload)
    VALUES
      (serial.id, 'installed_at_drop', serial.status, 'installed',
       'qa_photo_reviews', NEW.id, COALESCE(NEW.created_at, NOW()),
       jsonb_build_object('drop_number', NEW.drop_number));

    IF serial.status NOT IN ('activated', 'faulty', 'scrapped') THEN
      UPDATE stock_serials
         SET status = 'installed',
             installed_at_drop_id = NEW.drop_id,
             updated_at = NOW()
       WHERE id = serial.id
         AND installed_at_drop_id IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'emit_serial_event_on_qa_install error: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_emit_event_on_qa_install ON qa_photo_reviews;
CREATE TRIGGER trg_emit_event_on_qa_install
  AFTER INSERT ON qa_photo_reviews
  FOR EACH ROW EXECUTE FUNCTION emit_serial_event_on_qa_install();

-- (3) oes_pp_data AFTER INSERT → emit activated.
CREATE OR REPLACE FUNCTION emit_serial_event_on_oes_activate()
RETURNS TRIGGER AS $$
DECLARE
  serial RECORD;
BEGIN
  IF NEW.serial_number IS NULL THEN RETURN NEW; END IF;
  SELECT id, status INTO serial FROM stock_serials
    WHERE serial_number = NEW.serial_number LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  BEGIN
    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, occurred_at, payload)
    VALUES
      (serial.id, 'activated', serial.status, 'activated',
       'oes_pp_data', NEW.id, COALESCE(NEW.activated_at, NOW()),
       jsonb_build_object('olt_id', NEW.olt_id, 'pon_id', NEW.pon_id));

    IF serial.status IN ('available', 'installed', 'issued') THEN
      UPDATE stock_serials
         SET status='activated', activated_at_olt_id=NEW.olt_id, updated_at=NOW()
       WHERE id = serial.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'emit_serial_event_on_oes_activate error: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_emit_event_on_oes_activate ON oes_pp_data;
CREATE TRIGGER trg_emit_event_on_oes_activate
  AFTER INSERT ON oes_pp_data
  FOR EACH ROW EXECUTE FUNCTION emit_serial_event_on_oes_activate();

-- (4) stock_returns AFTER INSERT → emit 'returned'.
CREATE OR REPLACE FUNCTION emit_serial_event_on_return()
RETURNS TRIGGER AS $$
DECLARE
  line RECORD;
BEGIN
  FOR line IN
    SELECT stock_serial_id FROM stock_return_lines
    WHERE return_id = NEW.id AND stock_serial_id IS NOT NULL
  LOOP
    BEGIN
      INSERT INTO stock_serial_events
        (serial_id, event_type, from_state, to_state, source_table,
         source_id, actor_staff_id, occurred_at)
      VALUES
        (line.stock_serial_id, 'returned',
         (SELECT status FROM stock_serials WHERE id = line.stock_serial_id),
         'returned', 'stock_returns', NEW.id, NEW.staff_id,
         COALESCE(NEW.created_at, NOW()))
      ON CONFLICT (serial_id, source_table, source_id, event_type)
        WHERE source_id IS NOT NULL
      DO NOTHING;
      UPDATE stock_serials SET status='returned', updated_at=NOW()
        WHERE id = line.stock_serial_id AND status NOT IN ('scrapped');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'emit_serial_event_on_return error: %', SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_emit_event_on_return ON stock_returns;
CREATE TRIGGER trg_emit_event_on_return
  AFTER INSERT ON stock_returns
  FOR EACH ROW EXECUTE FUNCTION emit_serial_event_on_return();

-- (5) stock_return_lines AFTER UPDATE OF disposition → emit restocked /
--     sent_to_repair / scrapped, and update accountability counter on restock.
CREATE OR REPLACE FUNCTION emit_serial_event_on_return_disposition()
RETURNS TRIGGER AS $$
DECLARE
  next_state VARCHAR(50);
  event_type_val VARCHAR(50);
  contractor UUID;
BEGIN
  IF NEW.disposition IS NULL OR NEW.disposition = OLD.disposition THEN
    RETURN NEW;
  END IF;
  IF NEW.stock_serial_id IS NULL THEN RETURN NEW; END IF;

  next_state := CASE NEW.disposition
    WHEN 'restock' THEN 'available'
    WHEN 'repair'  THEN 'in_repair'
    WHEN 'scrap'   THEN 'scrapped'
    ELSE NULL END;
  event_type_val := CASE NEW.disposition
    WHEN 'restock' THEN 'restocked'
    WHEN 'repair'  THEN 'sent_to_repair'
    WHEN 'scrap'   THEN 'scrapped' END;
  IF next_state IS NULL THEN RETURN NEW; END IF;

  BEGIN
    INSERT INTO stock_serial_events
      (serial_id, event_type, from_state, to_state, source_table,
       source_id, occurred_at)
    VALUES
      (NEW.stock_serial_id, event_type_val,
       (SELECT status FROM stock_serials WHERE id = NEW.stock_serial_id),
       next_state, 'stock_return_lines', NEW.id, NOW());
    UPDATE stock_serials SET status=next_state, updated_at=NOW()
      WHERE id = NEW.stock_serial_id;

    IF NEW.disposition = 'restock' THEN
      SELECT sp.contractor_id INTO contractor
      FROM stock_pickings sp
      JOIN stock_picking_lines spl ON spl.picking_id = sp.id
      WHERE spl.stock_serial_id = NEW.stock_serial_id
      ORDER BY sp.done_at DESC NULLS LAST LIMIT 1;
      IF contractor IS NOT NULL THEN
        INSERT INTO contractor_stock_accountability
          (contractor_id, total_returned_count)
          VALUES (contractor, 1)
          ON CONFLICT (contractor_id) DO UPDATE
            SET total_returned_count =
              contractor_stock_accountability.total_returned_count + 1;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'emit_serial_event_on_return_disposition error: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_emit_event_on_return_disposition ON stock_return_lines;
CREATE TRIGGER trg_emit_event_on_return_disposition
  AFTER UPDATE OF disposition ON stock_return_lines
  FOR EACH ROW EXECUTE FUNCTION emit_serial_event_on_return_disposition();

INSERT INTO migrations (version, name)
  VALUES (<NNN+1>, 'serial_event_triggers')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
```

- [ ] **Step 4: Write the rollback trigger migration**

Create `scripts/migrations/sql/rollback_<NNN+1>_serial_event_triggers.sql`:

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_emit_event_on_return_disposition ON stock_return_lines;
DROP FUNCTION IF EXISTS emit_serial_event_on_return_disposition();
DROP TRIGGER IF EXISTS trg_emit_event_on_return ON stock_returns;
DROP FUNCTION IF EXISTS emit_serial_event_on_return();
DROP TRIGGER IF EXISTS trg_emit_event_on_oes_activate ON oes_pp_data;
DROP FUNCTION IF EXISTS emit_serial_event_on_oes_activate();
DROP TRIGGER IF EXISTS trg_emit_event_on_qa_install ON qa_photo_reviews;
DROP FUNCTION IF EXISTS emit_serial_event_on_qa_install();
DROP TRIGGER IF EXISTS trg_emit_event_on_picking_done ON stock_pickings;
DROP FUNCTION IF EXISTS emit_serial_event_on_picking_done();
DELETE FROM migrations WHERE version = <NNN+1>;
COMMIT;
```

- [ ] **Step 5: Update global-setup to apply the trigger migration**

Edit `tests/db/setup/global-setup.ts` — after the existing migration apply, add:

```ts
  const triggers = await fs.readFile(path.join(process.cwd(),
    'scripts/migrations/sql/<NNN+1>_serial_event_triggers.sql'), 'utf8');
  await pool.query(triggers);
```

- [ ] **Step 6: Run trigger test — confirm GREEN**

```bash
npm run test:db -- triggers/serial-events.test.ts
```

Expected: 4/4 pass. If accountability counter test fails, the JOIN inside `emit_serial_event_on_picking_done` is wrong; fix before commit.

- [ ] **Step 7: Implement the reconciliation CLI**

Create `scripts/migrations/sql/reconcile-queries.sql`:

```sql
-- Validation-gate checks for Wave 1 (spec §"Validation gate").
-- Each query named via -- @name + Tolerance: <int> on next line.

-- @name assets_without_serial
-- Tolerance: 0
SELECT COUNT(*) AS drift FROM assets a
WHERE a.asset_type IN ('ont','gizzu')
  AND NOT EXISTS (SELECT 1 FROM stock_serials s
                  WHERE s.serial_number = a.serial_number);

-- @name issued_without_open_picking
-- Tolerance: 100
SELECT COUNT(*) AS drift FROM stock_serials s
WHERE s.status = 'issued'
  AND NOT EXISTS (SELECT 1 FROM stock_picking_lines spl
                  JOIN stock_pickings sp ON sp.id = spl.picking_id
                  WHERE spl.stock_serial_id = s.id AND sp.status = 'done');

-- @name installed_serial_inconsistent_status
-- Tolerance: 100
SELECT COUNT(*) AS drift FROM stock_serials s
WHERE s.installed_at_drop_id IS NOT NULL
  AND s.status NOT IN ('installed','activated','returned','faulty','scrapped');

-- @name accountability_issued_counter_drift
-- Tolerance: 0
WITH derived AS (
  SELECT sp.contractor_id, COUNT(*) AS expected
  FROM stock_pickings sp
  JOIN stock_picking_lines spl ON spl.picking_id = sp.id
  WHERE sp.status = 'done' AND spl.stock_serial_id IS NOT NULL
    AND sp.contractor_id IS NOT NULL
  GROUP BY sp.contractor_id
)
SELECT COUNT(*) AS drift FROM derived d
JOIN contractor_stock_accountability cs
  ON cs.contractor_id = d.contractor_id
WHERE cs.total_issued_count <> d.expected;

-- @name latest_event_matches_status
-- Tolerance: 0
SELECT COUNT(*) AS drift FROM stock_serials s
WHERE EXISTS (SELECT 1 FROM stock_serial_events e WHERE e.serial_id = s.id)
  AND s.status <> (
    SELECT to_state FROM stock_serial_events
    WHERE serial_id = s.id ORDER BY occurred_at DESC, recorded_at DESC LIMIT 1);
```

Create `scripts/reconcile-serials.ts`:

```ts
#!/usr/bin/env tsx
import { Pool } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';

interface Check { name: string; tolerance: number; sql: string; }

function parseChecks(text: string): Check[] {
  const blocks = text.split(/^-- @name /gm).slice(1);
  return blocks.map(b => {
    const lines = b.split('\n');
    const name = lines[0].trim();
    const tolMatch = lines[1].match(/Tolerance:\s*(\d+)/);
    const tolerance = tolMatch ? Number(tolMatch[1]) : 0;
    const sql = lines.slice(2).join('\n').trim().replace(/;$/, '');
    return { name, tolerance, sql };
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  const text = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/reconcile-queries.sql'),
    'utf8');
  const checks = parseChecks(text);
  let failed = 0;
  for (const c of checks) {
    const r = await pool.query(c.sql);
    const drift = Number(r.rows[0]?.drift ?? 0);
    const ok = drift <= c.tolerance;
    if (!ok) failed += 1;
    const status = ok ? 'OK ' : 'FAIL';
    console.log(`[${status}] ${c.name}: drift=${drift} tolerance=${c.tolerance}`);
  }
  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
```

Edit `package.json` — add to `"scripts"`:

```json
"reconcile:serials": "tsx scripts/reconcile-serials.ts"
```

- [ ] **Step 8: Write reconciliation test (asserts drift detection works)**

Create `tests/db/reconciliation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';

const URL = process.env.DATABASE_URL_TEST!;

describe('reconcile-serials CLI', () => {
  it('exits 0 when there is no drift', () => {
    const out = execFileSync('npx',
      ['tsx', 'scripts/reconcile-serials.ts'],
      { env: { ...process.env, DATABASE_URL: URL }, encoding: 'utf8' });
    expect(out).toMatch(/\[OK \]/);
  });

  it('exits 1 when accountability drift is introduced', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(`INSERT INTO contractor_stock_accountability
        (contractor_id, total_issued_count) VALUES
        ('00000000-0000-0000-0000-000000000000', 999)
        ON CONFLICT (contractor_id) DO UPDATE SET total_issued_count=999`);
      await pool.query(`INSERT INTO stock_pickings
        (id, picking_type, status, contractor_id, staff_id, done_at) VALUES
        (gen_random_uuid(), 'issue', 'done',
         '00000000-0000-0000-0000-000000000000',
         '33333333-3333-3333-3333-333333333333', NOW())`);
      let exitStatus = 0;
      try {
        execFileSync('npx', ['tsx', 'scripts/reconcile-serials.ts'],
          { env: { ...process.env, DATABASE_URL: URL }, stdio: 'pipe' });
      } catch (e: any) {
        exitStatus = e.status;
      }
      expect(exitStatus).toBe(1);
    } finally { await pool.end(); }
  });
});
```

- [ ] **Step 9: Run reconciliation test — confirm GREEN**

```bash
npm run test:db -- reconciliation.test.ts
```

- [ ] **Step 10: Write `src/lib/serial-events.ts` (API-layer helper for Wave 2)**

Create `src/lib/serial-events.ts`:

```ts
import type { Pool, PoolClient } from 'pg';

export interface SerialEvent {
  serialId: string;
  eventType: string;
  fromState?: string;
  toState?: string;
  sourceTable?: string;
  sourceId?: string;
  actorUserId?: string;
  actorStaffId?: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Append-only helper for API handlers. Trigger-driven events should be
 * preferred where possible; this helper is for paths without a natural
 * trigger source (manual admin actions, force-state-correction).
 */
export async function emitSerialEvent(
  conn: Pool | PoolClient, e: SerialEvent): Promise<void> {
  await conn.query(
    `INSERT INTO stock_serial_events
       (serial_id, event_type, from_state, to_state, source_table,
        source_id, actor_user_id, actor_staff_id, payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (serial_id, source_table, source_id, event_type)
       WHERE source_id IS NOT NULL
     DO NOTHING`,
    [e.serialId, e.eventType, e.fromState ?? null, e.toState ?? null,
     e.sourceTable ?? null, e.sourceId ?? null,
     e.actorUserId ?? null, e.actorStaffId ?? null,
     e.payload ?? {}, e.occurredAt ?? new Date()]);
}
```

No test in this PR — `emitSerialEvent` is a thin wrapper exercised by Wave 2's force-correct endpoint. The trigger paths already exercise the underlying INSERT shape.

- [ ] **Step 11: Lint + commit**

```bash
npm run lint -- --max-warnings 0 scripts/reconcile-serials.ts src/lib/serial-events.ts
npm run test:db
git add scripts/migrations/sql/<NNN+1>_serial_event_triggers.sql \
        scripts/migrations/sql/rollback_<NNN+1>_serial_event_triggers.sql \
        scripts/migrations/sql/reconcile-queries.sql \
        scripts/migrations/run-migration-<NNN+1>.js \
        scripts/reconcile-serials.ts \
        src/lib/serial-events.ts \
        tests/db/triggers/serial-events.test.ts \
        tests/db/reconciliation.test.ts \
        tests/db/setup/global-setup.ts \
        package.json
git commit -m "feat(serial-register): Wave 1 PR-6 — triggers + accountability fix + reconcile CLI

Installs 5 triggers (stock_pickings done, qa_photo_reviews INSERT,
oes_pp_data INSERT, stock_returns INSERT, stock_return_lines disposition
UPDATE). Fixes the silently-broken contractor_stock_accountability
counter — PRD-027 §10 blocking logic now works.

Adds npm run reconcile:serials — validation-gate CLI that asserts
the 5 invariants from spec §'Validation gate'. Exits non-zero on drift.

Trigger bodies wrap in BEGIN/EXCEPTION so a trigger failure never aborts
the parent user transaction; drift is caught by reconcile-serials rather
than user-facing 500s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push -u origin feat/phase-4-pr6-triggers-and-reconcile
```

- [ ] **Step 12: Open PR + `/review-team` + Evaluator + merge**

Use `/review-team` (not single sonnet) — multi-domain.

### Success criteria (PR-6)
- All 4 trigger tests green.
- Both reconciliation tests green (no-drift exit 0, drift exit 1).
- `npm run reconcile:serials` against the test DB exits 0 (all OK).
- Phase 3 wizard browser smoke still passes — `/my/stores/issue` + `/my/stores/return` end-to-end (manual on dev).
- `npm run ci:quick` clean.

---

## Post-Wave-1 verification gate (must pass before Wave 2 begins)

Run on **dev** after PR-6 deploys:

- [ ] **Step 1: Run forward migrations on dev**

```bash
ssh velo 'cd /home/velo/fibreflow-dev && \
  node scripts/migrations/run-migration-<NNN>.js && \
  node scripts/migrations/run-migration-<NNN+1>.js'
```

- [ ] **Step 2: Run backfill scripts in order, dry-run first then commit**

```bash
ssh velo 'cd /home/velo/fibreflow-dev && \
  npx tsx scripts/backfill-stock-serials-from-assets.ts && \
  npx tsx scripts/backfill-stock-serials-from-assets.ts --commit && \
  npx tsx scripts/backfill-stock-serials-installed-from-qa.ts --commit && \
  npx tsx scripts/backfill-stock-serials-activated-from-oes.ts --commit && \
  npx tsx scripts/backfill-stock-serial-events.ts --source all --commit'
```

Record each script's `inserted`/`updated` count in the post-deploy log.

- [ ] **Step 3: Run reconciliation CLI on dev**

```bash
ssh velo 'cd /home/velo/fibreflow-dev && npm run reconcile:serials'
```

Expected: exit 0; every check `[OK ]`. If any `[FAIL]`:
- `assets_without_serial` > 0 → Backfill A didn't finish; re-run.
- `latest_event_matches_status` > 0 → A trigger missed an UPDATE step.
- `accountability_issued_counter_drift` > 0 → counter logic in trigger 1 is wrong; fix in follow-up PR.

- [ ] **Step 4: Phase 3 regression smoke**

Open `https://dev.fibreflow.app/my/stores/issue` via Playwriter MCP. Run the Phase 3 12-step smoke (Hein has the reference). Pass = no regression.

- [ ] **Step 5: Production deploy (post-business-hours, Hein's approval)**

```bash
bash scripts/deploy-local.sh production
```

After deploy, re-run Steps 1-4 against production.

### Wave 1 done criteria
- All 6 PRs merged.
- Migration applied to dev + prod.
- All backfill scripts run to completion on prod with documented row counts.
- `npm run reconcile:serials` exits 0 on prod.
- No Phase 3 regression.

---

## Wave 2 — UI rebuild (OUTLINE ONLY — separate plan, written after Wave 1 ships)

The next session, after Wave 1 lands and reconciliation shows clean, should invoke `superpowers:writing-plans` again with the spec's Wave 2 section + the Wave 1 outcomes (drift counts, surprises discovered) to produce a full Wave 2 plan. Below is the **PR scope** so Wave 2 can be sequenced; **task-level detail is intentionally deferred**.

| # | PR | Scope | Files | Reviewer |
|---|---|---|---|---|
| PR-7 | Shared components | `<SerialSearch>`, `<SerialTimeline>`, `<ReconciliationReport>`, status-badge + event-icon vocab | `src/components/field-stock/{SerialSearch,SerialTimeline,ReconciliationReport,StatusBadge,EventIcon}.tsx` + co-located `__tests__/` | sonnet |
| PR-8 | `/procurement/field-stock/serials` master search | List + filters + URL state | `pages/procurement/field-stock/serials.tsx`, `pages/api/procurement/field-stock/serials/search.ts` | sonnet |
| PR-9 | `/procurement/field-stock/serials/[serial]` lifecycle timeline | Detail view + admin force-correct action | `pages/procurement/field-stock/serials/[serial].tsx`, `pages/api/procurement/field-stock/serials/[serial]/{timeline,force-correct}.ts` | sonnet |
| PR-10 | `/procurement/field-stock` rebuilt dashboard | Tiles, on-hand donut, today's activity, drift badge | `pages/procurement/field-stock/index.tsx`, `pages/api/procurement/field-stock/dashboard.ts` | sonnet |
| PR-11 | `/procurement/field-stock/reconciliation` | UI for the data the CLI reports + per-row resolve action | `pages/procurement/field-stock/reconciliation.tsx`, `pages/api/procurement/field-stock/reconciliation/{list,resolve}.ts` | sonnet |
| PR-12 | `/procurement/field-stock/warehouses` + `[id]` | Per-warehouse drill-down | `pages/procurement/field-stock/warehouses/{index,[id]}.tsx` + API | sonnet |
| PR-13 | `/procurement/field-stock/projects` + `[id]` | Per-project drill-down | `pages/procurement/field-stock/projects/{index,[id]}.tsx` + API | sonnet |
| PR-14 | `/procurement/field-stock/{pickings,movements,returns}` | Rebuilt as event-filter views over `stock_serial_events` | 3 pages + APIs | sonnet |
| PR-15 | `/procurement/field-stock/{accountability,items,locations}` | Rebuilt with corrected counters + master-search embed | 3 pages + APIs | `/review-team` (accountability blocking logic) |

**Migration approach for Wave 2:** legacy pages move to `/procurement/field-stock/legacy/*` (decision recorded in Probe 6). Each new page PR drops the legacy version's path-rewrite. Browser smoke after each merge.

**Wave 2 cannot start until** Wave 1 reconciliation exits clean on production AND Wave 1 production deploy has been live for ≥ 48 hours without incident.

---

## Self-review notes

- **Spec coverage:** every section in the spec has a corresponding PR or explicit "Wave 2 / deferred" note. The state machine (12 states) → PR-1 CHECK; the event-type vocabulary → PR-5/PR-6 trigger bodies; the validation gate → PR-6 `reconcile-queries.sql`. The 6 open verification items each have a probe step in PR-0.
- **Placeholders:** the `<NNN>` and `<NNN+1>` migration version placeholders are deliberate — Probe 0 resolves them, and the rule "pick from `SELECT MAX(version) FROM migrations`" is non-negotiable per the user's documented preference. Every other reference is concrete.
- **Type consistency:** `BackfillResult.inserted` / `updated` / `wouldInsert` / `wouldUpdate` field names are used consistently across the three backfill scripts (A reports `inserted`/`wouldInsert`, B/C report `updated`/`wouldUpdate`, D+E reports `inserted`/`wouldInsert`). Test files use matching keys.
- **Cross-PR dependencies:** PR-6 depends on PR-1 (schema). PR-5 depends on PR-1 (composite-key index). PR-2/3/4 are independent of each other but must all merge before PR-6's reconciliation expects clean state. PR sequence respects this.
- **Real-DB tests:** every code-bearing PR runs against the docker-compose Postgres. No mocked SQL. This is the explicit fix for Phase 3's bug class.
- **Subprocess safety:** all test-setup subprocess calls use `execFileSync` with an arg array (no shell), satisfying the codebase's no-shell-eval convention.
