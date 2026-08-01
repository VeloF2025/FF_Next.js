# FibreFlow Metrics Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a declarative metric registry in FibreFlow, exposed over MCP, so Cortex (and any other consumer) can answer operational questions with dimensioned, point-in-time-correct, cited numbers — and so the marginal cost of metric #40 is a registry row plus a test.

**Architecture:** FibreFlow owns metric *definitions*, co-located with the schema so they receive migrations, CI and tests. Two MCP tools (`metrics.list`, `metrics.query`) replace all future bridge edits. Cortex's `apps/bridge/brain/metrics.py` becomes a thin HTTP client and stops holding SQL and stops connecting directly to Postgres. A generic nightly snapshot writer captures point-in-time state from day one, because that history is only obtainable going forward.

**Tech Stack:** Next.js 14 (Pages Router for the MCP endpoints), TypeScript, `pg.Pool` via `@/lib/db`, vitest, self-hosted Supabase Postgres on Velocity.

## Global Constraints

- All changes go through a Pull Request. Never commit to master. Work happens in the worktree `/home/hein/Workspace/FF_Next.js-metrics-platform` (branch `feat/metrics-platform-plan`); split into per-task branches off `origin/master` as needed.
- Files < 300 lines, components < 200 lines. 100% type coverage. No `console.log` — use `log` from `@/lib/logger`. No empty catch blocks.
- API responses use `apiResponse` from `@/lib/apiResponse`. Flattened API routes (`pages/api/metrics-query.ts`, not `pages/api/metrics/[x]/query.ts`).
- **Migration numbering:** do NOT hardcode. At implementation time run `SELECT filename FROM schema_migrations ORDER BY applied_at DESC LIMIT 10;` and take MAX+1. As of 2026-08-01 the max on `origin/master` is `472`, **and an unmerged branch also claims 472** (`472_velocity_review_export.sql` vs `472_works_qa_pole_planning_view.sql`). Check `git log --all --name-only | grep '<N>_'` for a collision before claiming a number.
- Migration files live in `scripts/migrations/sql/`. Every forward migration needs a matching `rollback_<N>_<name>.sql`. **Never wrap the forward file in BEGIN/COMMIT** — the runner manages the transaction. Rollback SQL must be re-runnable, guard every statement, and delete its own `schema_migrations` row. That table is keyed on **`filename`**, not `version`.
- Run `npm run ci:quick` before every PR, and `bash scripts/test-ratchet.sh --changed origin/master` to catch pre-existing tests a hand-picked glob would miss. Never `--no-verify`.
- CI does **not** run `next build`. Verify the build manually in this worktree (with `.env.local` present) before opening the PR.
- No credentials in any tracked file, including this plan and commit messages.

---

## Context: what the investigation established

Read this before writing code. Several intuitive assumptions are false.

**The MCP bridge is a pure proxy.** `pages/api/cortex-remote-mcp/[...path].ts` (99 lines) forwards to `127.0.0.1:7414`. No metric logic exists in FibreFlow today.

**Metric definitions currently live in the Cortex repo** at `/home/hein/Workspace/Cortex/apps/bridge/brain/metrics.py` — a frozen `Metric` dataclass with five entries (`preprovisions`, `activations`, `drops_by_status`, `open_snags`, `open_tickets`). `metrics_db.py` opens a direct read-only psycopg2 connection using `FIBREFLOW_DB_URL`, bypassing FibreFlow RBAC entirely, and **returns `None` on any failure so the caller silently falls back to RAG prose**.

**Ranges already work.** `Period` carries `from_date`/`to_date` and the SQL uses `BETWEEN`. What is missing is a daily *series* (only a total is returned) and *any* dimension.

**`pre_prov_resolved` already exists** — 2,101 rows since 2026-04-18, emitted by `oesPostImportService.ts:363`, consumed by the Action Centre rule engine. It is not a missing exit event.

**OES retains no nightly history.** `oes_activations` has a UNIQUE index on `drop_number` (25,059 rows / 25,059 distinct drops / only 6 surviving `import_batch_id` values). Nightly imports upsert. Row-level history is destroyed. `oes_import_batches` keeps 753 batch headers (6/night since 2026-01-16) but not the rows.

**The in-house snapshot precedent is `offline_devices`** — 925,206 rows across 119 distinct nightly `report_date` values (2026-01-20 → 2026-07-31), append-only, carrying `zone`, `planned_pon`, `offline_bucket`, `recovered_at`. Task 1 generalises this pattern; do not invent a new one.

**The PP list has no exit path other than activation.** In `oes_pp_data` (3,483 rows, back to 2025-07-23): `activated_at` populated on 2,354; **`decommissioned_at` populated on 0**; `decommissioned_reason` NULL on all 3,483. Every faulty ONT, false positive and cancelled drop is still on the list. The open balance is 1,061 entries of which **884 (83%) are older than 31 days** — Mohadin 708 (oldest 2025-09-03), Lawley 226 (oldest 2025-07-24). Fibertime's "no new ports where PP > 100" rule is enforced against that polluted number.

**Conversion is observed movement, not a typed field.** A DR moves from the PP list to OES active in the nightly report; `oesPostImportService` already detects this. The Exit Reason column being added to the source spreadsheet is therefore only needed for the *non-activation* exits.

**Dimensions are unconformed.** `project` is free text. `TEM` and `TEM-3` coexist; so do `Etwatwa` and `ETW-2`. `oes_pp_data` carries `olt_name`/`olt_lt`/`olt_pon` (the POP/zone source). 371 of 3,043 resolved PP rows (12.2%) reference a `resolved_drop_number` absent from `oes_activations`. 68 rows have `resolution_status='activated'` with a NULL `activated_at` — invisible to any date-ranged metric.

**FibreFlow already has 153 report/analytics endpoints.** These are presentation (PDF, xlsx, paginated lists), not measurement. Reuse their *SQL logic* where useful; do not proxy them as metrics.

**PORT the existing definition; never re-derive it from table names that sound right.** A blind review of this plan's first draft caught `install_activation_gap` defined as `drops LEFT JOIN oes_activations`, which is wrong twice over: `drops` has no `project` column (it has `project_id uuid` → `projects.project_name`), and `drops.created_at` is the SOW-import timestamp, not the install date — June 2026 shows 3,755 rows against July's 9, which is import batching, not field activity. The metric would have parsed, returned plausible numbers, and been business-wrong. The real definition is on `dr_photo_unified_reviews` (`installation-gaps.ts:102-105`). Before registering any metric that has an existing endpoint, read that endpoint's WHERE clause and port it verbatim.

**Column-type traps verified on the live DB:** `maintenance_tickets.project_id` is **text** holding uuid strings (not a uuid column), and 1,871 rows hold the empty string — `''::uuid` throws, so any join to `projects` must `NULLIF(...,'')::uuid` first. Today zero *open* tickets carry an empty string, so a naive cast happens to pass; the WHERE clause is the only thing preventing the break.

## Scope

This plan delivers **the platform** — snapshot spine, conformed dimensions, registry, MCP surface — proven by three deliberately shape-diverse metrics. It does **not** deliver the PP lifecycle metrics, reconciliation, the wider catalogue, or the weekly sheet. Those become registry rows once this exists:

- Plan 2 — PP lifecycle (exit reasons via the OES import column, cohort tagging, dwell window, the 7 PP metrics)
- Plan 3 — Reconciliation identity + exceptions table
- Plan 4 — Catalogue breadth (~40 metrics across the 8 domains)
- Plan 5 — Reporting surface (weekly OES sheet, POP threshold flag)

**Task 1 has a clock on it.** Every day it is not deployed is a permanently lost day of point-in-time history. It ships first and independently — do not batch it behind the rest.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/migrations/sql/<N>_metrics_snapshot_spine.sql` | `metric_snapshots` table + indexes |
| `scripts/migrations/sql/rollback_<N>_metrics_snapshot_spine.sql` | Guarded, re-runnable rollback |
| `scripts/migrations/sql/<N+1>_conformed_dimensions.sql` | `canonical_project()` SQL function |
| `scripts/migrations/sql/rollback_<N+1>_conformed_dimensions.sql` | Guarded, re-runnable rollback |
| `src/modules/metrics/snapshot/types.ts` | `SnapshotSource` interface |
| `src/modules/metrics/snapshot/sources.ts` | Registered snapshot sources |
| `src/modules/metrics/snapshot/writer.ts` | Idempotent nightly writer |
| `src/modules/metrics/dimensions/canonical.ts` | Project/zone/POP alias resolution |
| `src/modules/metrics/registry/types.ts` | `MetricDefinition`, `Grain` |
| `src/modules/metrics/registry/index.ts` | The registry: definitions only |
| `src/modules/metrics/registry/queryBuilder.ts` | Parametrized SQL from definition + query |
| `src/modules/metrics/registry/execute.ts` | Runs it, shapes series + citation envelope |
| `src/modules/metrics/registry/intent.ts` | Alias matching that fails loudly |
| `pages/api/metrics-list.ts` | MCP tool: catalogue |
| `pages/api/metrics-query.ts` | MCP tool: query |
| `pages/api/cron/metrics-snapshot.ts` | Nightly trigger |
| `docs/metrics/README.md` | How to register a new metric |

---

### Task 1: Snapshot spine

**Files:**
- Create: `scripts/migrations/sql/<N>_metrics_snapshot_spine.sql`
- Create: `scripts/migrations/sql/rollback_<N>_metrics_snapshot_spine.sql`
- Create: `src/modules/metrics/snapshot/types.ts`
- Create: `src/modules/metrics/snapshot/sources.ts`
- Create: `src/modules/metrics/snapshot/writer.ts`
- Create: `pages/api/cron/metrics-snapshot.ts`
- Test: `src/modules/metrics/snapshot/__tests__/writer.test.ts`

**Interfaces:**
- Consumes: nothing — deliberately standalone so it can ship before the rest.
- Produces: `SnapshotSource` (`{ key, description, sql }`), `SNAPSHOT_SOURCES`, `findSource(key)`, `writeSnapshot(sourceKey, asOf, deps): Promise<{ rows: number; skipped: boolean }>`

**Design note:** one generic table, not one per source. `offline_devices` proves the pattern but hardcodes its columns; storing dimensions and measures as JSONB keyed by `(source_key, as_of_date, entity_id)` makes a new snapshot source a row in `sources.ts` rather than a migration.

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/metrics/snapshot/__tests__/writer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { writeSnapshot } from '../writer';

const asOf = '2026-08-01';

function fakeDeps(existingCount = 0) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT count(*)')) return { rows: [{ count: existingCount }] };
    if (sql.includes('INSERT INTO metric_snapshots')) return { rowCount: 2 };
    return { rows: [] };
  });
  return { query };
}

describe('writeSnapshot', () => {
  it('writes rows for a known source', async () => {
    const result = await writeSnapshot('pp_open', asOf, fakeDeps(0));
    expect(result.skipped).toBe(false);
    expect(result.rows).toBe(2);
  });

  it('is idempotent — a second run for the same as_of writes nothing', async () => {
    const result = await writeSnapshot('pp_open', asOf, fakeDeps(5));
    expect(result.skipped).toBe(true);
    expect(result.rows).toBe(0);
  });

  it('rejects an unregistered source rather than silently writing nothing', async () => {
    await expect(writeSnapshot('not_a_source', asOf, fakeDeps(0))).rejects.toThrow(
      /unknown snapshot source/i,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/metrics/snapshot/__tests__/writer.test.ts`
Expected: FAIL — cannot resolve `../writer`.

- [ ] **Step 3: Write the migration**

Derive `<N>` first per the Global Constraints.

```sql
-- scripts/migrations/sql/<N>_metrics_snapshot_spine.sql
-- Generic point-in-time snapshot store. Generalises the offline_devices pattern
-- (925k rows across 119 nightly report_date values) so a new source needs no migration.
-- NOTE: no BEGIN/COMMIT — the runner manages the transaction.

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  source_key   TEXT        NOT NULL,
  as_of_date   DATE        NOT NULL,
  entity_id    TEXT        NOT NULL,
  dims         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  measures     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_source_date_entity_key
  ON metric_snapshots (source_key, as_of_date, entity_id);

CREATE INDEX IF NOT EXISTS metric_snapshots_source_date_idx
  ON metric_snapshots (source_key, as_of_date DESC);

CREATE INDEX IF NOT EXISTS metric_snapshots_dims_gin
  ON metric_snapshots USING GIN (dims);

COMMENT ON TABLE metric_snapshots IS
  'Append-only point-in-time snapshots. One row per (source, day, entity). Never updated in place.';
```

```sql
-- scripts/migrations/sql/rollback_<N>_metrics_snapshot_spine.sql
-- Re-runnable. Guards every statement. Clears its own schema_migrations row.

DROP INDEX IF EXISTS metric_snapshots_dims_gin;
DROP INDEX IF EXISTS metric_snapshots_source_date_idx;
DROP INDEX IF EXISTS metric_snapshots_source_date_entity_key;
DROP TABLE IF EXISTS metric_snapshots;

DELETE FROM schema_migrations WHERE filename = '<N>_metrics_snapshot_spine.sql';
```

- [ ] **Step 4: Write the source definitions**

```typescript
// src/modules/metrics/snapshot/types.ts
export interface SnapshotSource {
  /** Stable key stored in metric_snapshots.source_key */
  key: string;
  /** Human description, surfaced in docs and the catalogue */
  description: string;
  /**
   * SELECT returning exactly: entity_id TEXT, dims JSONB, measures JSONB.
   * Must be a pure read and must NOT reference metric_snapshots.
   */
  sql: string;
}
```

```typescript
// src/modules/metrics/snapshot/sources.ts
import type { SnapshotSource } from './types';

export const SNAPSHOT_SOURCES: readonly SnapshotSource[] = [
  {
    key: 'pp_open',
    description: 'Open pre-provisions — on the list, not yet activated',
    sql: `
      SELECT
        p.serial_number AS entity_id,
        jsonb_build_object(
          'project',  p.project,
          'olt_name', p.olt_name,
          'olt_pon',  p.olt_pon
        ) AS dims,
        jsonb_build_object(
          'age_days',          (CURRENT_DATE - p.date_registered),
          'resolution_status', p.resolution_status,
          'registered_on',     p.date_registered
        ) AS measures
      FROM oes_pp_data p
      WHERE p.activated_at IS NULL
        AND p.resolution_status <> 'activated'
    `,
  },
  {
    key: 'tickets_open',
    description: 'Open maintenance tickets by status and age',
    // ⚠️ `maintenance_tickets.project_id` is TEXT holding uuid strings, NOT a uuid
    // column, so joining `projects.id uuid` needs an explicit cast — and `''::uuid`
    // throws `invalid input syntax for type uuid: ""`.
    // Measured today: 1,871 rows carry the empty string, but ZERO of them are in an
    // open status, so a bare `t.project_id::uuid` currently succeeds. That is luck,
    // not safety — the WHERE clause is the only thing preventing it. The first open
    // ticket created with an empty project_id kills the whole nightly snapshot, and
    // Task 1 Step 7 catches the error per-source, so the failure would be silent in
    // the response body. NULLIF is free insurance; keep it.
    sql: `
      SELECT
        t.id::text AS entity_id,
        jsonb_build_object('project', p.project_name) AS dims,
        jsonb_build_object(
          'status',   t.status,
          'age_days', (CURRENT_DATE - t.created_at::date)
        ) AS measures
      FROM maintenance_tickets t
      LEFT JOIN projects p ON p.id = NULLIF(t.project_id, '')::uuid
      WHERE t.status NOT IN ('resolved','cancelled','verified')
    `,
  },
] as const;

export function findSource(key: string): SnapshotSource | undefined {
  return SNAPSHOT_SOURCES.find((s) => s.key === key);
}
```

- [ ] **Step 5: Write the writer**

```typescript
// src/modules/metrics/snapshot/writer.ts
import { log } from '@/lib/logger';
import { findSource } from './sources';

interface QueryDeps {
  query: (sql: string, params?: unknown[]) => Promise<{ rows?: unknown[]; rowCount?: number }>;
}

export interface SnapshotResult {
  rows: number;
  skipped: boolean;
}

/**
 * Write one day's snapshot for `sourceKey`. Idempotent: if rows already exist for
 * (source_key, as_of_date) it writes nothing and reports skipped, so a re-run or a
 * double-fired cron cannot double-count.
 */
export async function writeSnapshot(
  sourceKey: string,
  asOf: string,
  deps: QueryDeps,
): Promise<SnapshotResult> {
  const source = findSource(sourceKey);
  if (!source) {
    throw new Error(`unknown snapshot source: ${sourceKey}`);
  }

  const existing = await deps.query(
    `SELECT count(*)::int AS count FROM metric_snapshots WHERE source_key = $1 AND as_of_date = $2`,
    [sourceKey, asOf],
  );
  const alreadyWritten = Number((existing.rows?.[0] as { count?: number })?.count ?? 0);
  if (alreadyWritten > 0) {
    log.info('Snapshot already written — skipping', { sourceKey, asOf, alreadyWritten });
    return { rows: 0, skipped: true };
  }

  const inserted = await deps.query(
    `INSERT INTO metric_snapshots (source_key, as_of_date, entity_id, dims, measures)
     SELECT $1, $2::date, s.entity_id, s.dims, s.measures FROM (${source.sql}) s
     ON CONFLICT (source_key, as_of_date, entity_id) DO NOTHING`,
    [sourceKey, asOf],
  );

  const rows = inserted.rowCount ?? 0;
  log.info('Snapshot written', { sourceKey, asOf, rows });
  return { rows, skipped: false };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/modules/metrics/snapshot/__tests__/writer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Add the cron route**

```typescript
// pages/api/cron/metrics-snapshot.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { SNAPSHOT_SOURCES } from '@/src/modules/metrics/snapshot/sources';
import { writeSnapshot } from '@/src/modules/metrics/snapshot/writer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  // SAST date — the server runs UTC, and a UTC date would roll the snapshot at 02:00 local.
  const asOf = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const client = await pool.connect();
  const results: Record<string, unknown> = {};
  try {
    for (const source of SNAPSHOT_SOURCES) {
      try {
        results[source.key] = await writeSnapshot(source.key, asOf, client);
      } catch (error) {
        // One bad source must not stop the others — a skipped day is unrecoverable.
        log.error('Snapshot source failed', { sourceKey: source.key, asOf, error });
        results[source.key] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  } finally {
    client.release();
  }
  return apiResponse.success(res, { asOf, results });
}
```

- [ ] **Step 8: Verify against the live DB**

Apply the migration to dev, then hit the cron route once and confirm rows land:

```sql
SELECT source_key, as_of_date, count(*) FROM metric_snapshots GROUP BY 1,2 ORDER BY 2 DESC;
```

Expected: `pp_open` ≈ 1,061 rows and `tickets_open` ≈ 3,368 rows for today. Run it a **second** time and confirm the counts do not change — that is the idempotency proof.

- [ ] **Step 9: Commit**

```bash
git add scripts/migrations/sql src/modules/metrics/snapshot pages/api/cron/metrics-snapshot.ts
git commit -m "feat(metrics): add generic nightly snapshot spine

Point-in-time history accrues only from deploy date, so this ships ahead
of the registry that will read it."
```

- [ ] **Step 10: Register the cron on Velocity**

Add the nightly entry pointing at the **production** directory, scheduled in SAST, sourcing the DB URL from the standard cron env layout. Confirm with `crontab -l` over SSH that it fired the next morning.

---

### Task 2: Conformed dimensions

**Files:**
- Create: `scripts/migrations/sql/<N+1>_conformed_dimensions.sql`
- Create: `scripts/migrations/sql/rollback_<N+1>_conformed_dimensions.sql`
- Create: `src/modules/metrics/dimensions/canonical.ts`
- Test: `src/modules/metrics/dimensions/__tests__/canonical.test.ts`
- Test: `tests/migrations/canonical-project-parity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `canonicalProject(raw): string`, `UNKNOWN_PROJECT`, `DimensionSpec`, `DIMENSIONS`, and the SQL function `canonical_project(text)`.

**Why this exists:** `project` is free text. `TEM`/`TEM-3` and `Etwatwa`/`ETW-2` coexist in `oes_pp_data`. Without conformance, `pp_new` by project and `zone_uptake` by project return lists that cannot be added together — and they fail silently, which is the dangerous part. Same failure class as the Mohadin `MOH`→`MOA` re-code that stranded 15k drops.

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/metrics/dimensions/__tests__/canonical.test.ts
import { describe, it, expect } from 'vitest';
import { canonicalProject } from '../canonical';

describe('canonicalProject', () => {
  it('folds known aliases to one canonical name', () => {
    expect(canonicalProject('TEM-3')).toBe('TEM');
    expect(canonicalProject('ETW-2')).toBe('Etwatwa');
    expect(canonicalProject('MOH')).toBe('Mohadin');
    expect(canonicalProject('MOA')).toBe('Mohadin');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(canonicalProject('  lawley ')).toBe('Lawley');
  });

  it('passes an unknown project through unchanged rather than dropping it', () => {
    expect(canonicalProject('Brand New Site')).toBe('Brand New Site');
  });

  it('maps null/empty to an explicit Unknown bucket, never to empty string', () => {
    expect(canonicalProject(null)).toBe('Unknown');
    expect(canonicalProject('')).toBe('Unknown');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/metrics/dimensions/__tests__/canonical.test.ts`
Expected: FAIL — cannot resolve `../canonical`.

- [ ] **Step 3: Implement the TypeScript side**

```typescript
// src/modules/metrics/dimensions/canonical.ts

/** Alias -> canonical project name. Keys are lowercased. Mirrored in canonical_project() SQL. */
const PROJECT_ALIASES: Readonly<Record<string, string>> = {
  'tem-3': 'TEM',
  'tem3': 'TEM',
  'etw-2': 'Etwatwa',
  'etw2': 'Etwatwa',
  'moh': 'Mohadin',
  'moa': 'Mohadin',
  'law': 'Lawley',
  'mam': 'Mamelodi',
};

const KNOWN_CANONICAL = ['TEM', 'Etwatwa', 'Mohadin', 'Lawley', 'Mamelodi'] as const;

export const UNKNOWN_PROJECT = 'Unknown';

/**
 * Fold a free-text project string to its canonical name.
 * Unknown values pass through unchanged — dropping them would silently shrink
 * totals, which is worse than an unmapped label appearing in the output.
 */
export function canonicalProject(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return UNKNOWN_PROJECT;

  const alias = PROJECT_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  const known = KNOWN_CANONICAL.find((k) => k.toLowerCase() === trimmed.toLowerCase());
  return known ?? trimmed;
}

export interface DimensionSpec {
  key: string;
  label: string;
  /** SQL expression producing the dimension value, given the metric's `src` alias. */
  expression: string;
}

export const DIMENSIONS: readonly DimensionSpec[] = [
  { key: 'project', label: 'Project',   expression: 'canonical_project(src.project)' },
  { key: 'pop',     label: 'POP / OLT', expression: 'src.olt_name' },
  { key: 'zone',    label: 'Zone',      expression: 'src.zone_no' },
] as const;
```

- [ ] **Step 4: Implement the SQL counterpart**

Grouping must happen in the database, so the alias map needs a SQL twin. Step 6 proves the two agree.

```sql
-- scripts/migrations/sql/<N+1>_conformed_dimensions.sql
-- Canonical project folding, mirroring src/modules/metrics/dimensions/canonical.ts.
-- IMMUTABLE so it can be indexed and grouped efficiently.

CREATE OR REPLACE FUNCTION canonical_project(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(coalesce(raw, '')))
    WHEN ''         THEN 'Unknown'
    WHEN 'tem-3'    THEN 'TEM'
    WHEN 'tem3'     THEN 'TEM'
    WHEN 'etw-2'    THEN 'Etwatwa'
    WHEN 'etw2'     THEN 'Etwatwa'
    WHEN 'moh'      THEN 'Mohadin'
    WHEN 'moa'      THEN 'Mohadin'
    WHEN 'law'      THEN 'Lawley'
    WHEN 'mam'      THEN 'Mamelodi'
    WHEN 'tem'      THEN 'TEM'
    WHEN 'etwatwa'  THEN 'Etwatwa'
    WHEN 'mohadin'  THEN 'Mohadin'
    WHEN 'lawley'   THEN 'Lawley'
    WHEN 'mamelodi' THEN 'Mamelodi'
    ELSE btrim(raw)
  END;
$$;

COMMENT ON FUNCTION canonical_project(text) IS
  'Folds free-text project names to canonical form. Mirrors canonicalProject() in TypeScript.';
```

```sql
-- scripts/migrations/sql/rollback_<N+1>_conformed_dimensions.sql
DROP FUNCTION IF EXISTS canonical_project(text);
DELETE FROM schema_migrations WHERE filename = '<N+1>_conformed_dimensions.sql';
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `npx vitest run src/modules/metrics/dimensions/__tests__/canonical.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write an execution test proving SQL and TypeScript agree**

A stub test cannot catch the two implementations drifting, nor a parse-time SQL error. This one runs the real function against the real DB.

```typescript
// tests/migrations/canonical-project-parity.test.ts
import { describe, it, expect } from 'vitest';
import pool from '@/lib/db';
import { canonicalProject } from '@/src/modules/metrics/dimensions/canonical';

const SAMPLES = ['TEM-3', 'ETW-2', 'MOH', 'MOA', 'Lawley', '  lawley ', '', 'Brand New Site'];

describe('canonical_project parity', () => {
  it('SQL and TypeScript produce identical output for every sample', async () => {
    const client = await pool.connect();
    try {
      for (const sample of SAMPLES) {
        const { rows } = await client.query('SELECT canonical_project($1::text) AS v', [sample]);
        expect(rows[0].v, `mismatch for ${JSON.stringify(sample)}`).toBe(canonicalProject(sample));
      }
    } finally {
      client.release();
    }
  });

  it('folds every project present in oes_pp_data to a canonical name', async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT DISTINCT canonical_project(project) AS v FROM oes_pp_data ORDER BY 1`,
      );
      const names = rows.map((r) => r.v);
      expect(names).not.toContain('TEM-3');
      expect(names).not.toContain('ETW-2');
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Step 7: Run the execution test**

Run: `npx vitest run tests/migrations/canonical-project-parity.test.ts`
Expected: PASS. If the second test fails, an alias is missing — add it to **both** files.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrations/sql src/modules/metrics/dimensions tests/migrations
git commit -m "feat(metrics): add conformed project dimension with SQL/TS parity test"
```

---

### Task 3: Registry types and definitions

**Files:**
- Create: `src/modules/metrics/registry/types.ts`
- Create: `src/modules/metrics/registry/index.ts`
- Test: `src/modules/metrics/registry/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `DimensionSpec` from Task 2.
- Produces: `Grain`, `MetricDefinition`, `METRICS`, `findMetric(key)`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/metrics/registry/__tests__/registry.test.ts
import { describe, it, expect } from 'vitest';
import { METRICS, findMetric } from '../index';

describe('metric registry', () => {
  it('exposes every metric with a unique key', () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('requires a citation source on every metric', () => {
    for (const m of METRICS) expect(m.cite, `${m.key} missing cite`).toBeTruthy();
  });

  it('requires at least one alias so intent matching can work', () => {
    for (const m of METRICS) expect(m.aliases.length, `${m.key} has no aliases`).toBeGreaterThan(0);
  });

  it('declares only dimensions that exist in the dimension registry', async () => {
    const { DIMENSIONS } = await import('../../dimensions/canonical');
    const known = new Set(DIMENSIONS.map((d) => d.key));
    for (const m of METRICS) {
      for (const d of m.dimensions) expect(known.has(d), `${m.key} declares unknown dim ${d}`).toBe(true);
    }
  });

  it('finds a metric by key and returns undefined otherwise', () => {
    expect(findMetric('zone_uptake')?.key).toBe('zone_uptake');
    expect(findMetric('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/metrics/registry/__tests__/registry.test.ts`
Expected: FAIL — cannot resolve `../index`.

- [ ] **Step 3: Define the types**

```typescript
// src/modules/metrics/registry/types.ts
export type Grain = 'day' | 'week' | 'month' | 'range';

export interface MetricDefinition {
  key: string;
  label: string;
  /** Prose shown in metrics.list so a caller can choose between near-neighbours. */
  description: string;
  /** FROM clause body, aliased as `src`. Must expose the columns its dimensions reference. */
  from: string;
  /** Aggregate expression, e.g. 'count(*)' or 'sum(src.installed)'. */
  measure: string;
  /** Column used for period filtering. Null means current-state-only. */
  dateColumn: string | null;
  /** Extra always-on predicate, without the WHERE keyword. */
  filter?: string;
  grains: readonly Grain[];
  dimensions: readonly string[];
  aliases: readonly string[];
  /** Citation channel string — documents the predicate, shown to the user. */
  cite: string;
  /** RBAC resource checked before execution. */
  permission: string;
}
```

- [ ] **Step 4: Write the registry with three shape-diverse metrics**

```typescript
// src/modules/metrics/registry/index.ts
import type { MetricDefinition } from './types';

/**
 * Three deliberately different shapes, to prove the contract generalises:
 *   zone_uptake            — pre-aggregated table
 *   install_activation_gap — derived join
 *   pp_open_balance        — point-in-time snapshot (Task 1)
 */
export const METRICS: readonly MetricDefinition[] = [
  {
    key: 'zone_uptake',
    label: 'zone uptake',
    description: 'Planned vs installed drops per zone and PON, from the weekly uptake sheet.',
    from: 'project_weekly_zone_pon_uptake src',
    measure: 'sum(src.installed)',
    dateColumn: 'src.week_ending',
    grains: ['week', 'month', 'range'],
    dimensions: ['project', 'zone'],
    aliases: ['zone uptake', 'uptake', 'installed per zone', 'homes installed'],
    cite: 'FibreFlow project_weekly_zone_pon_uptake (sum of installed) by week_ending',
    permission: 'analytics.reports',
  },
  {
    key: 'install_activation_gap',
    label: 'installed but not activated',
    description:
      'Drops with an install recorded but no OES activation — work done and paid for that never went live.',
    // ⚠️ This is a PORT of the existing definition in
    // `pages/api/activate/reporting/installation-gaps.ts:102-105`, NOT a re-derivation.
    // Do not "simplify" it back to `drops LEFT JOIN oes_activations`. Two reasons,
    // both verified against the live DB:
    //   1. `drops` has no `project` column (it has `project_id uuid` -> `projects`),
    //      so `d.project` errors with "column d.project does not exist".
    //   2. `drops.created_at` is the SOW-import timestamp, not the install date —
    //      June 2026 shows 3,755 and July 2026 shows 9, which is import batching,
    //      not installation activity. The metric would be dimensionally valid and
    //      business-wrong.
    // The real definition lives on `dr_photo_unified_reviews`: installed = a WA
    // submission OR a 1Map installer name; not activated = `oes_activated_at IS NULL`;
    // the date basis is COALESCE(wa_received_at, created_at). `u.project` is free
    // text, so canonical_project() applies directly.
    // Verified: 2026-06 → Mohadin 154, Lawley 50, Thembisa POP 1 17, Mamelodi 12.
    from: `(
      SELECT u.drop_number,
             u.project,
             COALESCE(u.wa_received_at, u.created_at) AS installed_at
      FROM dr_photo_unified_reviews u
      WHERE u.oes_activated_at IS NULL
        AND (u.wa_received_at IS NOT NULL OR u.installer_name IS NOT NULL)
    ) src`,
    measure: 'count(*)',
    dateColumn: 'src.installed_at',
    grains: ['day', 'week', 'month', 'range'],
    dimensions: ['project'],
    aliases: ['installation gap', 'installed not activated', 'activation gap', 'never went live'],
    cite: 'FibreFlow dr_photo_unified_reviews (oes_activated_at IS NULL AND installed via WA or 1Map) by COALESCE(wa_received_at, created_at)',
    permission: 'analytics.reports',
  },
  {
    key: 'pp_open_balance',
    label: 'open pre-provisions',
    description:
      'Point-in-time count of pre-provisions on the list and not yet activated, from the nightly snapshot.',
    from: `(
      SELECT s.as_of_date,
             s.dims->>'project'  AS project,
             s.dims->>'olt_name' AS olt_name,
             (s.measures->>'age_days')::int AS age_days
      FROM metric_snapshots s
      WHERE s.source_key = 'pp_open'
    ) src`,
    measure: 'count(*)',
    dateColumn: 'src.as_of_date',
    grains: ['day', 'range'],
    dimensions: ['project', 'pop'],
    aliases: ['open pre-provisions', 'pp balance', 'pre-provision backlog', 'pp open'],
    cite: 'FibreFlow metric_snapshots (source_key=pp_open) by as_of_date',
    permission: 'analytics.reports',
  },
] as const;

export function findMetric(key: string): MetricDefinition | undefined {
  return METRICS.find((m) => m.key === key);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/modules/metrics/registry/__tests__/registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/metrics/registry
git commit -m "feat(metrics): add metric registry with three shape-diverse definitions"
```

---

### Task 4: Query builder

**Files:**
- Create: `src/modules/metrics/registry/queryBuilder.ts`
- Test: `src/modules/metrics/registry/__tests__/queryBuilder.test.ts`
- Test: `tests/migrations/metric-sql-executes.test.ts`

**Interfaces:**
- Consumes: `MetricDefinition` (Task 3), `DIMENSIONS` (Task 2).
- Produces: `MetricQuery` (`{ from, to, grain, dimensions }`), `buildMetricQuery(def, query): { sql: string; params: unknown[] }`.

**Design note:** the definition supplies SQL fragments; the *caller* supplies only a key, dates, dimension names and a grain. No caller input is ever interpolated into SQL — dimension names are looked up against `DIMENSIONS` and rejected if unknown.

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/metrics/registry/__tests__/queryBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { buildMetricQuery } from '../queryBuilder';
import { findMetric } from '../index';

const zoneUptake = findMetric('zone_uptake')!;
const base = { from: '2026-07-01', to: '2026-07-31', dimensions: [] as string[] };

describe('buildMetricQuery', () => {
  it('parametrizes dates rather than interpolating them', () => {
    const { sql, params } = buildMetricQuery(zoneUptake, { ...base, grain: 'week' });
    expect(sql).not.toContain('2026-07-01');
    expect(params).toEqual(['2026-07-01', '2026-07-31']);
  });

  it('emits a period column so the caller gets a series, not just a total', () => {
    const { sql } = buildMetricQuery(zoneUptake, { ...base, grain: 'week' });
    expect(sql).toContain('date_trunc');
    expect(sql).toContain('GROUP BY');
  });

  it('rejects an unknown dimension instead of ignoring it', () => {
    expect(() => buildMetricQuery(zoneUptake, { ...base, grain: 'week', dimensions: ['nonsense'] }))
      .toThrow(/unsupported dimension/i);
  });

  it('rejects a dimension the metric does not declare, even if globally valid', () => {
    expect(() => buildMetricQuery(zoneUptake, { ...base, grain: 'week', dimensions: ['pop'] }))
      .toThrow(/unsupported dimension/i);
  });

  it('rejects a grain the metric does not declare', () => {
    expect(() => buildMetricQuery(zoneUptake, { ...base, grain: 'day' }))
      .toThrow(/unsupported grain/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/metrics/registry/__tests__/queryBuilder.test.ts`
Expected: FAIL — cannot resolve `../queryBuilder`.

- [ ] **Step 3: Implement**

```typescript
// src/modules/metrics/registry/queryBuilder.ts
import { DIMENSIONS } from '../dimensions/canonical';
import type { Grain, MetricDefinition } from './types';

export interface MetricQuery {
  from: string;   // ISO date, inclusive
  to: string;     // ISO date, inclusive
  grain: Grain;
  dimensions: readonly string[];
}

const GRAIN_TRUNC: Record<Exclude<Grain, 'range'>, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

export function buildMetricQuery(
  def: MetricDefinition,
  query: MetricQuery,
): { sql: string; params: unknown[] } {
  if (!def.grains.includes(query.grain)) {
    throw new Error(
      `unsupported grain '${query.grain}' for metric '${def.key}' (supports: ${def.grains.join(', ')})`,
    );
  }

  const selected = query.dimensions.map((name) => {
    if (!def.dimensions.includes(name)) {
      throw new Error(
        `unsupported dimension '${name}' for metric '${def.key}' ` +
          `(supports: ${def.dimensions.join(', ') || 'none'})`,
      );
    }
    const spec = DIMENSIONS.find((d) => d.key === name);
    if (!spec) throw new Error(`unsupported dimension '${name}' — not a registered dimension`);
    return spec;
  });

  const hasPeriod = query.grain !== 'range' && Boolean(def.dateColumn);
  const periodExpr = hasPeriod
    ? `date_trunc('${GRAIN_TRUNC[query.grain as Exclude<Grain, 'range'>]}', ${def.dateColumn})::date`
    : 'NULL::date';

  const groupCols = [...(hasPeriod ? ['period'] : []), ...selected.map((s) => s.key)];

  const selectParts = [
    `${periodExpr} AS period`,
    ...selected.map((s) => `${s.expression} AS ${s.key}`),
    `${def.measure} AS value`,
  ];

  const where: string[] = [];
  const params: unknown[] = [];
  if (def.dateColumn) {
    params.push(query.from, query.to);
    where.push(`${def.dateColumn} BETWEEN $1 AND $2`);
  }
  if (def.filter) where.push(`(${def.filter})`);

  const sql = [
    `SELECT ${selectParts.join(', ')}`,
    `FROM ${def.from}`,
    where.length ? `WHERE ${where.join(' AND ')}` : '',
    groupCols.length ? `GROUP BY ${groupCols.join(', ')}` : '',
    groupCols.length ? `ORDER BY ${groupCols.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { sql, params };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/metrics/registry/__tests__/queryBuilder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the execution test — stub tests are blind to parse-time SQL errors**

Every metric's SQL must actually parse against the live schema, for every grain and dimension it declares. This is the check that catches the `42P08` class of bug that shipped a 500 past green CI.

```typescript
// tests/migrations/metric-sql-executes.test.ts
import { describe, it, expect } from 'vitest';
import pool from '@/lib/db';
import { METRICS } from '@/src/modules/metrics/registry';
import { buildMetricQuery } from '@/src/modules/metrics/registry/queryBuilder';

describe('every registered metric executes against the live schema', () => {
  for (const def of METRICS) {
    it(`${def.key} runs for each declared grain and dimension`, async () => {
      const client = await pool.connect();
      try {
        for (const grain of def.grains) {
          for (const dims of [[], ...def.dimensions.map((d) => [d])]) {
            const { sql, params } = buildMetricQuery(def, {
              from: '2026-07-01', to: '2026-07-31', grain, dimensions: dims,
            });
            const result = await client.query(sql, params);
            expect(Array.isArray(result.rows)).toBe(true);
          }
        }
      } finally {
        client.release();
      }
    });
  }
});
```

- [ ] **Step 6: Run the execution test**

Run: `npx vitest run tests/migrations/metric-sql-executes.test.ts`
Expected: PASS. A failure means a definition's `from`/`measure`/`dateColumn` does not match the real schema — fix the definition, not the test.

- [ ] **Step 7: Commit**

```bash
git add src/modules/metrics/registry tests/migrations
git commit -m "feat(metrics): add query builder with grain/dimension validation and execution test"
```

---

### Task 5: Intent matching that fails loudly

**Files:**
- Create: `src/modules/metrics/registry/intent.ts`
- Test: `src/modules/metrics/registry/__tests__/intent.test.ts`

**Interfaces:**
- Consumes: `METRICS` (Task 3).
- Produces: `MatchResult` = `{ kind: 'exact', metric } | { kind: 'ambiguous', candidates } | { kind: 'none' }`, and `matchMetric(question)`.

**Why:** the current Cortex behaviour is `patterns=(r"pre.?prov",)` — any counting question mentioning pre-provisions returns the added-count, including questions explicitly about conversions. Returning a confidently wrong number is the failure mode being fixed.

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/metrics/registry/__tests__/intent.test.ts
import { describe, it, expect } from 'vitest';
import { matchMetric } from '../intent';

describe('matchMetric', () => {
  it('matches an unambiguous question exactly', () => {
    const r = matchMetric('how many open pre-provisions are there');
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.metric.key).toBe('pp_open_balance');
  });

  it('returns candidates rather than guessing when two metrics tie', () => {
    const r = matchMetric('how many uptake');
    expect(['ambiguous', 'exact']).toContain(r.kind);
  });

  it('returns none for an unrelated question so the caller can fall back to RAG', () => {
    expect(matchMetric('what did we discuss about fibre splicing').kind).toBe('none');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/metrics/registry/__tests__/intent.test.ts`
Expected: FAIL — cannot resolve `../intent`.

- [ ] **Step 3: Implement**

```typescript
// src/modules/metrics/registry/intent.ts
import { METRICS } from './index';
import type { MetricDefinition } from './types';

export type MatchResult =
  | { kind: 'exact'; metric: MetricDefinition }
  | { kind: 'ambiguous'; candidates: MetricDefinition[] }
  | { kind: 'none' };

/** Longest matching alias wins — a more specific phrase beats a generic one. */
function score(question: string, alias: string): number {
  return question.includes(alias.toLowerCase()) ? alias.length : 0;
}

/**
 * Match a question to exactly one metric, or report ambiguity.
 * Never guesses: when two metrics tie, the caller receives the candidate list
 * so it can ask which was meant rather than returning a confident wrong number.
 */
export function matchMetric(question: string): MatchResult {
  const q = question.toLowerCase();

  const scored = METRICS.map((metric) => ({
    metric,
    score: Math.max(0, ...metric.aliases.map((a) => score(q, a))),
  })).filter((s) => s.score > 0);

  if (scored.length === 0) return { kind: 'none' };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const tied = scored.filter((s) => s.score === best.score);

  if (tied.length > 1) return { kind: 'ambiguous', candidates: tied.map((t) => t.metric) };
  return { kind: 'exact', metric: best.metric };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/metrics/registry/__tests__/intent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/metrics/registry/intent.ts src/modules/metrics/registry/__tests__/intent.test.ts
git commit -m "feat(metrics): add intent matching that returns candidates instead of guessing"
```

---

### Task 6: MCP endpoints

**Files:**
- Create: `src/modules/metrics/registry/execute.ts`
- Create: `pages/api/metrics-list.ts`
- Create: `pages/api/metrics-query.ts`
- Test: `pages/api/__tests__/metrics-query.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `MetricSeriesPoint`, `MetricResponse`, `executeMetric(def, query)`, and the HTTP contract `GET /api/metrics-list` / `POST /api/metrics-query { key, from, to, grain, dimensions }`.

**Response contract:** every response states `as_of` and the `grain` it was computed at, and carries the same 5-field citation envelope Cortex already emits (`source`, `source_id`, `channel`, `timestamp`, `snippet`).

- [ ] **Step 1: Write the failing test**

```typescript
// pages/api/__tests__/metrics-query.test.ts
import { describe, it, expect, vi } from 'vitest';
import handler from '../metrics-query';

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('POST /api/metrics-query', () => {
  it('rejects an unknown metric key with 404, not a zero', async () => {
    const res = mockRes();
    await handler(
      { method: 'POST', body: { key: 'nope', from: '2026-07-01', to: '2026-07-31', grain: 'week' } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects an unsupported grain with 400 rather than silently downgrading it', async () => {
    const res = mockRes();
    await handler(
      { method: 'POST', body: { key: 'zone_uptake', from: '2026-07-01', to: '2026-07-31', grain: 'day' } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a missing required field with 400', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { key: 'zone_uptake' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run pages/api/__tests__/metrics-query.test.ts`
Expected: FAIL — cannot resolve `../metrics-query`.

- [ ] **Step 3: Implement the executor**

```typescript
// src/modules/metrics/registry/execute.ts
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { buildMetricQuery, type MetricQuery } from './queryBuilder';
import type { MetricDefinition } from './types';

export interface MetricSeriesPoint {
  period: string | null;
  dimensions: Record<string, string | null>;
  value: number;
}

export interface MetricResponse {
  key: string;
  label: string;
  grain: string;
  as_of: string;
  total: number;
  series: MetricSeriesPoint[];
  citation: {
    source: 'fibreflow';
    source_id: string;
    channel: string;
    timestamp: string;
    snippet: string;
  };
}

/** Execute a metric. Throws on failure — callers must not silently degrade to prose. */
export async function executeMetric(
  def: MetricDefinition,
  query: MetricQuery,
): Promise<MetricResponse> {
  const { sql, params } = buildMetricQuery(def, query);
  const asOf = new Date().toISOString();

  const client = await pool.connect();
  let rows: Record<string, unknown>[];
  try {
    await client.query('SET LOCAL statement_timeout = 8000');
    const result = await client.query(sql, params);
    rows = result.rows;
  } catch (error) {
    log.error('Metric execution failed', { key: def.key, error });
    throw error;
  } finally {
    client.release();
  }

  const series: MetricSeriesPoint[] = rows.map((r) => {
    const dimensions: Record<string, string | null> = {};
    for (const d of query.dimensions) dimensions[d] = (r[d] as string | null) ?? null;
    return {
      period: r.period ? String(r.period).slice(0, 10) : null,
      dimensions,
      value: Number(r.value ?? 0),
    };
  });

  const total = series.reduce((sum, p) => sum + p.value, 0);
  const periodLabel = query.from === query.to ? query.from : `${query.from}..${query.to}`;

  return {
    key: def.key,
    label: def.label,
    grain: query.grain,
    as_of: asOf,
    total,
    series,
    citation: {
      source: 'fibreflow',
      source_id: `metric:${def.key}:${periodLabel}`,
      channel: def.cite,
      timestamp: asOf,
      snippet: `${def.cite} - ${total} ${def.label} (${periodLabel})`,
    },
  };
}
```

- [ ] **Step 4: Implement the endpoints**

```typescript
// pages/api/metrics-list.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { METRICS } from '@/src/modules/metrics/registry';

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  return apiResponse.success(
    res,
    METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      grains: m.grains,
      dimensions: m.dimensions,
      aliases: m.aliases,
      source: m.cite,
    })),
  );
}
```

```typescript
// pages/api/metrics-query.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { findMetric } from '@/src/modules/metrics/registry';
import { executeMetric } from '@/src/modules/metrics/registry/execute';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, ['POST']);

  const { key, from, to, grain, dimensions } = (req.body ?? {}) as {
    key?: string; from?: string; to?: string; grain?: string; dimensions?: string[];
  };

  if (!key || !from || !to || !grain) {
    return apiResponse.badRequest(res, 'key, from, to and grain are required');
  }

  const def = findMetric(key);
  if (!def) return apiResponse.notFound(res, 'Metric', key);

  try {
    const result = await executeMetric(def, {
      from, to, grain: grain as never, dimensions: dimensions ?? [],
    });
    return apiResponse.success(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Validation errors are the caller's fault; anything else is ours.
    if (/unsupported (grain|dimension)/i.test(message)) {
      return apiResponse.badRequest(res, message);
    }
    log.error('Metric query failed', { key, error });
    return apiResponse.internalError(res, 'Metric execution failed');
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run pages/api/__tests__/metrics-query.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Add RBAC and assert the negative case**

The repo's usual composition is static — `export default withAuth(withPermission('activate.reports', 'view')(handler))` (see `pages/api/activate/reporting/installation-gaps.ts:_last line_`). **That does not work here**, because the required permission is `def.permission`, which is only known after the body is parsed. Use `withAuth` for authentication and check the permission at runtime:

```typescript
// pages/api/metrics-query.ts — replace the bare export
import { withAuth } from '@/lib/auth';
import { userHasPermission } from '@/lib/permissions';
import type { AuthenticatedNextApiRequest } from '@/src/lib/auth/middleware';

// ...inside the handler, after `const def = findMetric(key)` succeeds:
  const authReq = req as AuthenticatedNextApiRequest;
  const userId = authReq.user?.id;
  // Explicit null check FIRST — an optional-chained comparison evaluates false
  // on a null user and would read as "not super admin", granting access below.
  if (!userId) return apiResponse.unauthorized(res, 'Authentication required');

  const allowed =
    authReq.user.role === 'super_admin' ||
    (await userHasPermission(userId, def.permission, 'view'));
  if (!allowed) return apiResponse.forbidden(res, `Permission required: ${def.permission}`);

// ...and at the bottom of the file:
export default withAuth(handler);
```

Add tests asserting an unauthenticated request returns **401**, an authenticated-but-unpermitted one returns **403**, and — critically — that a request with **no user object at all** returns 401 rather than falling through to success.

- [ ] **Step 7: Verify end-to-end against dev**

```bash
PORT=3004 npm run dev   # in this worktree
curl -s localhost:3004/api/metrics-list | head -40
curl -s -X POST localhost:3004/api/metrics-query \
  -H 'content-type: application/json' \
  -d '{"key":"pp_open_balance","from":"2026-07-25","to":"2026-08-01","grain":"day","dimensions":["project"]}'
```

Expected: a daily series plus a total, with `as_of`, `grain` and the citation envelope present. Mohadin should dominate the open balance (≈708 of ≈1,061). **A zero total means the snapshot cron has not run yet, not that the metric is broken** — check `metric_snapshots` first.

- [ ] **Step 8: Commit**

```bash
git add src/modules/metrics/registry/execute.ts pages/api/metrics-list.ts pages/api/metrics-query.ts pages/api/__tests__
git commit -m "feat(metrics): expose metrics.list and metrics.query with RBAC and citation envelope"
```

---

### Task 7: Cortex thin client + README

**Files:**
- Create: `docs/metrics/README.md` (FibreFlow)
- Modify: `/home/hein/Workspace/Cortex/apps/bridge/brain/metrics.py`
- Modify: `/home/hein/Workspace/Cortex/apps/bridge/brain/metrics_db.py`

**Interfaces:**
- Consumes: `GET /api/metrics-list`, `POST /api/metrics-query`.

**The Cortex change is a separate PR in a separate repo.** Do not merge it before the FibreFlow side is deployed to dev and verified.

- [ ] **Step 1: Leave `metric:preprovisions` byte-identical**

The constraint is explicit: do not change the existing response shape until `pp_new` is registered and verified equivalent. `pp_new` lands in **Plan 2**, not here. So `preprovisions` stays exactly as it is, still reading `dr_activity_log`. Only the three new metrics route through the registry.

- [ ] **Step 2: Replace the silent-None fallback for registry-backed metrics**

`run_metric` currently returns `None` on any failure, so the caller silently falls back to RAG prose. For registry metrics: a **4xx** must surface as an answer explaining the problem (unknown metric, ambiguous question, unsupported grain); only a **5xx or timeout** should fall back to RAG. Add a test asserting an ambiguous question returns the candidate list rather than a number.

- [ ] **Step 3: Write the README**

`docs/metrics/README.md` must cover:
- the shape of a `MetricDefinition` and a worked example of adding one;
- that adding a project alias means editing **both** `canonical.ts` and the `canonical_project()` SQL function, and that `canonical-project-parity.test.ts` will fail if you forget;
- that every new metric is automatically covered by `tests/migrations/metric-sql-executes.test.ts` — no per-metric test needed for SQL validity, but a value-assertion test is still expected;
- that adding a snapshot source is a row in `sources.ts` with **no migration**;
- that a metric must never be added without at least one alias, or intent matching cannot reach it.

- [ ] **Step 4: Commit**

```bash
git add docs/metrics/README.md
git commit -m "docs(metrics): how to register a new metric"
```

---

## Validation gates

| Gate | Check |
|---|---|
| Snapshot spine | Rows land 3 nights running; a second same-day run changes no counts |
| Conformed dimensions | `TEM-3` and `ETW-2` appear in no metric output; SQL/TS parity test passes |
| Registry | Every metric executes for every declared grain × dimension against the live schema |
| Intent | An ambiguous question returns candidates, never a number |
| Contract | Every response carries `as_of`, `grain`, and the 5-field citation envelope |
| RBAC | Unauthenticated → 401; unpermitted → 403; null session denies rather than fails open |
| Compatibility | `metric:preprovisions` response byte-identical to today's |
| CI | `npm run ci:quick` passes; `bash scripts/test-ratchet.sh --changed origin/master` passes; `next build` verified manually |

## Known follow-ups (not in this plan)

- `pp_new`, `pp_reentered`, `pp_to_oes_active`, `pp_cleared_other`, `pp_age_at_clear`, `pp_reentry_rate` — Plan 2.
- **The PP list has no exit path.** 1,061 open entries, 884 of them >31 days old, `decommissioned_at` populated on zero rows. Faulty ONTs and false positives never leave the list, so the open balance gating Fibertime's ">100 per POP, no new ports" rule is inflated. Plan 2 adds the exit path fed by the new Exit Reason column in the source spreadsheet — with blanks landing in an explicit `unknown` bucket that appears in the exceptions report, **never silently as zero**, plus a fill-rate metric so the gap stays visible.
- **68 rows** have `resolution_status='activated'` with a NULL `activated_at` — invisible to any date-ranged conversion metric. First entry in the exceptions table (Plan 3).
- **371 of 3,043** resolved PP rows reference a `resolved_drop_number` absent from `oes_activations` (12.2%). Second entry in the exceptions table.
- Dwell-window flap detection cannot be backfilled; it begins accruing the day Task 1 deploys. Flapping is large — 4,914 `pre_prov_reentered` against 1,238 `pre_prov_added`.
- `zone` is declared as a dimension but only `zone_uptake` currently exposes a `zone_no` column; `pp_open_balance` would need `olt_pon` promoted into `dims`. Confirm before adding `zone` to another metric.
