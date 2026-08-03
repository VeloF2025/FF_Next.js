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

🚨 **MCP tokens can only issue GET / HEAD / OPTIONS.** `src/lib/auth/readOnly.ts:13` defines `SAFE_METHODS = {GET, HEAD, OPTIONS}`, and `isReadOnlyViolation()` rejects anything else when `user.sessionKind === 'mcp'`. The gate lives inside `withAuth`/`requireAuth`, so **every** route inherits it and no route can opt out. **Both metric endpoints must therefore be GET.** A POST endpoint is unreachable by an MCP token regardless of how it authenticates — the request is rejected in middleware before the handler runs. The first draft of this plan specified `POST /api/metrics-query`, which would have shipped an endpoint Cortex could not call.

🚨 **`project_weekly_zone_pon_uptake.installed` is CUMULATIVE, not per-period.** `scripts/migrations/sql/276_project_weekly_zone_uptake.sql:4` — the source PDFs "contain **cumulative** completion metrics"; the table comment reads "Cumulative zone-level installation uptake snapshot per billing week". Live weekly values run 21,666 → 22,556 → 23,342 → 23,732, which is a running total. Summing across weeks inflates roughly 4× over a month. **Never `SUM` a cumulative measure across periods** — take the latest observation. Its project column is `project_name`, not `project`. This class of error parses cleanly, returns plausible numbers, and is silently wrong; no SQL-execution test catches it. Reading the source migration's comment is the only defence.

**`oes_pp_data.serial_number` is not unique** — 3,483 rows against 3,482 distinct serials (`ALCLB48F4CCD` appears twice). Snapshot entity keys must use `oes_pp_data.id`; keying on serial silently drops a row under `ON CONFLICT DO NOTHING`.

**Import alias:** `tsconfig.json` maps `@/*` → `./src/*`. So `@/modules/metrics/...` is correct and **`@/src/modules/...` resolves to `src/src/...` and fails**. Note `@/lib/*` maps to `./src/lib/*`, while a separate top-level `lib/` also exists — check which one a helper actually lives in before importing.

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

function fakeDeps({ locked = true, alreadyDone = false, insertFails = false } = {}) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql.trim().split('\n')[0]);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return {};
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked }] };
    if (sql.includes('SELECT 1 FROM snapshot_runs')) return { rows: alreadyDone ? [{ '?column?': 1 }] : [] };
    if (sql.includes('DELETE FROM metric_snapshots')) return { rowCount: 0 };
    if (sql.includes('INSERT INTO metric_snapshots')) {
      if (insertFails) throw new Error('boom');
      return { rowCount: 2 };
    }
    if (sql.includes('INSERT INTO snapshot_runs')) return { rowCount: 1 };
    return { rows: [] };
  });
  return { query, calls };
}

const wrote = (deps: { calls: string[] }) =>
  deps.calls.some((c) => c.includes('INSERT INTO metric_snapshots'));

describe('writeSnapshot', () => {
  it('writes rows and logs completion when it takes the lock', async () => {
    const deps = fakeDeps();
    expect(await writeSnapshot('pp_open', asOf, deps)).toEqual({ rows: 2, skipped: false, written: true });
    expect(deps.calls).toContain('COMMIT');
    expect(deps.calls.some((c) => c.includes('INSERT INTO snapshot_runs'))).toBe(true);
  });

  it('reports NOT written when a concurrent run holds the lock', async () => {
    const deps = fakeDeps({ locked: false });
    // written:false is the point — the caller must not treat this as a success.
    expect(await writeSnapshot('pp_open', asOf, deps)).toEqual({ rows: 0, skipped: true, written: false });
    expect(wrote(deps)).toBe(false);
    expect(deps.calls).toContain('ROLLBACK');
  });

  it('reports written when the day is already complete', async () => {
    const deps = fakeDeps({ alreadyDone: true });
    expect(await writeSnapshot('pp_open', asOf, deps)).toEqual({ rows: 0, skipped: true, written: true });
    expect(wrote(deps)).toBe(false);
  });

  it('rolls back and records nothing when the insert throws, so the day retries', async () => {
    const deps = fakeDeps({ insertFails: true });
    await expect(writeSnapshot('pp_open', asOf, deps)).rejects.toThrow('boom');
    expect(deps.calls).toContain('ROLLBACK');
    // No completion row: absence of it is what makes the next run retry.
    expect(deps.calls.some((c) => c.includes('INSERT INTO snapshot_runs'))).toBe(false);
  });

  it('surfaces the original error even when ROLLBACK itself fails', async () => {
    const deps = fakeDeps({ insertFails: true });
    const inner = deps.query;
    deps.query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.trim().startsWith('ROLLBACK')) throw new Error('rollback exploded');
      return inner(sql, params);
    }) as typeof inner;
    await expect(writeSnapshot('pp_open', asOf, deps)).rejects.toThrow('boom');
  });

  it('rejects an unregistered source rather than silently writing nothing', async () => {
    await expect(writeSnapshot('not_a_source', asOf, fakeDeps())).rejects.toThrow(
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

-- Completion LOG — deliberately not a lock.
--
-- "Has this day been written?" cannot be answered by count(*) > 0 on
-- metric_snapshots, because that cannot distinguish COMPLETE from PARTIAL, so a
-- half-written day would be skipped forever and silently under-report. This table
-- answers it: a day is written iff a 'complete' row exists here.
--
-- Mutual exclusion is handled by a transaction-scoped ADVISORY LOCK in the writer,
-- NOT by a claim row here. An earlier draft used a claim row with a status machine
-- (running/failed, DO UPDATE WHERE status='failed', a failure marker written after
-- ROLLBACK). Review found four defects in it: unbounded lock waiting on the unique
-- index, a permanently unreclaimable 'running' state, a stale failure marker able to
-- overwrite a later success, and a recovery path that could not occur as documented.
-- The advisory lock has none of those: it is non-blocking, and it is released
-- automatically on commit, rollback, crash or disconnect. Do not reintroduce a
-- status machine here.
CREATE TABLE IF NOT EXISTS snapshot_runs (
  id           BIGSERIAL PRIMARY KEY,
  source_key   TEXT        NOT NULL,
  as_of_date   DATE        NOT NULL,
  row_count    INTEGER     NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS snapshot_runs_source_date_key
  ON snapshot_runs (source_key, as_of_date);

COMMENT ON TABLE snapshot_runs IS
  'Completion log. A (source, day) is written iff a row exists here. Mutual exclusion is an advisory lock in the writer, not this table.';
```

```sql
-- scripts/migrations/sql/rollback_<N>_metrics_snapshot_spine.sql
-- Re-runnable. Guards every statement. Clears its own schema_migrations row.

DROP INDEX IF EXISTS snapshot_runs_source_date_key;
DROP TABLE IF EXISTS snapshot_runs;

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
   *
   * It is embedded in the writer's INSERT, where two parameters are already bound:
   *   $1 = source_key, $2 = as_of date.
   * Use `$2::date` for anything date-relative — **never `CURRENT_DATE` or `NOW()`**.
   * A snapshot is an immutable record of a specific day; deriving an age from the
   * clock instead of from `as_of` makes a backfilled or retried run produce
   * different measures than the original, and makes a run between 00:00 and 02:00
   * SAST record the previous UTC day. Cast TIMESTAMPTZ columns explicitly with
   * `AT TIME ZONE 'Africa/Johannesburg'` rather than relying on the session default.
   *
   * `entity_id` MUST be unique within the source. There is no ON CONFLICT clause —
   * a duplicate aborts the transaction so the day is retried rather than silently
   * undercounted.
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
    // ⚠️ entity_id is `p.id`, NOT `p.serial_number`. Verified: 3,483 rows but only
    // 3,482 distinct serials (ALCLB48F4CCD appears twice). Keying on serial would
    // silently drop a row via ON CONFLICT DO NOTHING and under-report the balance.
    sql: `
      SELECT
        p.id::text AS entity_id,
        jsonb_build_object(
          'project',  p.project,
          'olt_name', p.olt_name,
          'olt_pon',  p.olt_pon,
          'serial',   p.serial_number
        ) AS dims,
        jsonb_build_object(
          'age_days',          ($2::date - p.date_registered),
          'resolution_status', p.resolution_status,
          'registered_on',     p.date_registered
        ) AS measures
      FROM oes_pp_data p
      WHERE p.activated_at IS NULL
        AND p.resolution_status IS DISTINCT FROM 'activated'
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
          'age_days', ($2::date - (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date)
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
  /** True when this call did not write (already done, or lock held elsewhere). */
  skipped: boolean;
  /**
   * True only when a completion row for (source, day) is known to exist — either
   * this call wrote it, or it was already there. False means the day is NOT
   * recorded and must be re-run. `skipped` alone cannot express that difference:
   * "someone else is doing it" and "it is done" are not the same outcome.
   */
  written: boolean;
}

/**
 * Write one day's snapshot for `sourceKey`, exactly once.
 *
 * Concurrency: a transaction-scoped ADVISORY LOCK, taken with the non-blocking
 * `pg_try_advisory_xact_lock`. Everything happens in one transaction, so:
 *   - two concurrent runs      -> the second gets `false` IMMEDIATELY and skips
 *                                 (non-blocking: no unbounded wait on a unique index)
 *   - crash / disconnect       -> lock auto-released, no snapshot_runs row written,
 *                                 so the next run simply retries. There is no stuck
 *                                 state to reclaim and no lease to expire.
 *   - already done             -> a snapshot_runs row exists, so it skips
 *   - previous attempt failed  -> no snapshot_runs row exists, so it retries
 *
 * There is deliberately NO status machine and NO failure marker. Absence of a
 * snapshot_runs row IS the retry signal. An earlier draft used a claim row with
 * running/failed states; review found four defects in it (unbounded lock waiting,
 * an unreclaimable 'running' state, a stale failure marker overwriting a later
 * success, and an impossible documented recovery path). Do not reintroduce it.
 *
 * A pre-count on metric_snapshots is NOT a substitute: it cannot distinguish a
 * COMPLETE snapshot from a PARTIAL one.
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

  await deps.query('BEGIN');
  try {
    // Non-blocking. hashtext() is stable within a major version, and a hash collision
    // across two different sources on the same night only costs one skipped run,
    // which the next night's run corrects — it can never corrupt data.
    const lock = await deps.query(
      `SELECT pg_try_advisory_xact_lock(hashtext($1 || ':' || $2)) AS locked`,
      [sourceKey, asOf],
    );
    if ((lock.rows?.[0] as { locked?: boolean })?.locked !== true) {
      // Losing the lock is NOT success. The winner may still fail and roll back,
      // and a hashtext collision means the holder might be a different source
      // entirely. Reporting `skipped` here would let the caller return 200 for a
      // night that never got written. Signal not-done so the cron reports non-2xx
      // and the day can be re-run.
      await deps.query('ROLLBACK');
      log.warn('Snapshot lock held by a concurrent run — not written', { sourceKey, asOf });
      return { rows: 0, skipped: true, written: false };
    }

    const done = await deps.query(
      `SELECT 1 FROM snapshot_runs WHERE source_key = $1 AND as_of_date = $2::date`,
      [sourceKey, asOf],
    );
    if (done.rows?.length) {
      await deps.query('ROLLBACK');
      log.info('Snapshot already complete — skipping', { sourceKey, asOf });
      return { rows: 0, skipped: true, written: true };
    }

    // Clear anything a previous rolled-back attempt somehow left, so this is a clean
    // write rather than a partial merge.
    await deps.query(
      `DELETE FROM metric_snapshots WHERE source_key = $1 AND as_of_date = $2::date`,
      [sourceKey, asOf],
    );

    const inserted = await deps.query(
      `INSERT INTO metric_snapshots (source_key, as_of_date, entity_id, dims, measures)
       SELECT $1, $2::date, s.entity_id, s.dims, s.measures FROM (${source.sql}) s`,
      // Deliberately NO "ON CONFLICT DO NOTHING". A duplicate entity_id means the
      // source's key is not unique; silently dropping the row and then recording
      // the day complete would bake in an undercount permanently. Let the unique
      // index raise, abort the transaction, and leave the day to be retried.
      // (This is how oes_pp_data.serial_number would have failed loudly rather
      // than silently, had it still been used as the key.)
      [sourceKey, asOf],
    );
    const rows = inserted.rowCount ?? 0;

    await deps.query(
      `INSERT INTO snapshot_runs (source_key, as_of_date, row_count) VALUES ($1, $2::date, $3)`,
      [sourceKey, asOf, rows],
    );

    await deps.query('COMMIT');
    log.info('Snapshot written', { sourceKey, asOf, rows });
    return { rows, skipped: false, written: true };
  } catch (error) {
    // Roll back, but never let a rollback failure mask the original error.
    try {
      await deps.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('Snapshot rollback failed', { sourceKey, asOf, rollbackError });
    }
    throw error;
  }
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
import { SNAPSHOT_SOURCES } from '@/modules/metrics/snapshot/sources';
import { writeSnapshot } from '@/modules/metrics/snapshot/writer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // An unset CRON_SECRET must NOT authenticate. Without this guard the comparison
  // becomes `Bearer undefined === Bearer undefined`, so anyone who sends the literal
  // string "Bearer undefined" is authorised on any environment missing the variable.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error('CRON_SECRET is not configured — refusing to run snapshot');
    return apiResponse.internalError(
      res,
      new Error('CRON_SECRET is not set'),
      'Cron secret not configured',
    );
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  // SAST date — the server runs UTC, and a UTC date would roll the snapshot at 02:00 local.
  // An explicit ?date= makes a missed or failed night re-runnable. Without it,
  // "absence of a completion row is the retry signal" has no consumer: the route
  // would only ever address today, so any night lost to a crash stays lost.
  const requested = req.query.date;
  if (requested !== undefined && (typeof requested !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(requested))) {
    return apiResponse.badRequest(res, 'date must be YYYY-MM-DD');
  }
  const asOf = requested ?? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const client = await pool.connect();
  const results: Record<string, unknown> = {};
  const failed: string[] = [];
  try {
    for (const source of SNAPSHOT_SOURCES) {
      try {
        const result = await writeSnapshot(source.key, asOf, client);
        results[source.key] = result;
        // Not written = the day is not recorded. Treat it as a failure so the
        // cron reports non-2xx rather than a green run over a missing snapshot.
        if (!result.written) failed.push(source.key);
      } catch (error) {
        // One bad source must not stop the others — a skipped day is unrecoverable.
        // But the RESPONSE must not be 200, or a failed snapshot looks like a success
        // to whatever is monitoring the cron.
        log.error('Snapshot source failed', { sourceKey: source.key, asOf, error });
        results[source.key] = { error: error instanceof Error ? error.message : String(error) };
        failed.push(source.key);
      }
    }
  } finally {
    client.release();
  }

  if (failed.length) {
    return apiResponse.internalError(
      res,
      new Error(`Snapshot sources failed: ${failed.join(', ')}`),
      `Snapshot sources failed: ${failed.join(', ')}`,
    );
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
  // ::text is explicit because source columns vary — project_weekly_zone_pon_uptake
  // .project_name is VARCHAR(100) while oes_pp_data.project is text. Relying on
  // implicit varchar->text resolution works but fails opaquely if a source ever
  // supplies a different string type.
  { key: 'project', label: 'Project',   expression: 'canonical_project(src.project::text)' },
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
import { canonicalProject } from '@/modules/metrics/dimensions/canonical';

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
  /**
   * How this measure may be aggregated. **The single most important field here.**
   *
   * Three review rounds each found a different instance of the same error —
   * summing something that cannot be summed over time — so this is a required
   * three-way choice, not an optional boolean. There is no default: every metric
   * must state its additivity explicitly, because guessing is what caused the bug.
   *
   *  'additive'      Sum freely across time AND dimensions. An event count.
   *                  e.g. install_activation_gap — each row is a distinct event.
   *
   *  'semi-additive' Sum across DIMENSIONS but NEVER across time. A level, a
   *                  balance, a running total, or a point-in-time stock. The
   *                  value for a span is the LATEST period's value.
   *                  e.g. zone_uptake (a running total: 21,666 → 22,556 → 23,342
   *                  → 23,732, so summing July reports ~91k against a true ~23.7k)
   *                  and pp_open_balance (a nightly stock: an entity open for
   *                  eight nights appears in eight snapshots and would be counted
   *                  eight times).
   *
   *  'non-additive'  Cannot be summed at all — ratios, percentages, averages.
   *                  Must be recomputed from components at each grain. No metric
   *                  uses this yet; it exists so nobody reaches for 'additive'
   *                  when registering a rate.
   *
   * Nothing in the SQL reveals which applies. Read the source table's
   * documentation before choosing, and record why in the definition's comment.
   */
  additivity: 'additive' | 'semi-additive' | 'non-additive';
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
    description:
      'Cumulative installed drops per zone and PON, as at each billing week. A running total, not a weekly delta.',
    // ⚠️ `installed` is CUMULATIVE (migration 276 line 4 and the table comment).
    // Summing across weeks inflates ~4x over a month. 'semi-additive' makes
    // executeMetric report the LAST period's value as the total instead of a sum.
    // Within a single week_ending, summing across zones IS correct — that is what
    // the per-period aggregate does. Grains are therefore restricted to week/range;
    // 'month' is deliberately absent because a month is several running totals.
    // The project column here is `project_name`, NOT `project`.
    from: `(
      SELECT src0.week_ending,
             src0.project_name AS project,
             src0.zone_no,
             src0.installed
      FROM project_weekly_zone_pon_uptake src0
    ) src`,
    measure: 'sum(src.installed)',
    dateColumn: 'src.week_ending',
    additivity: 'semi-additive',
    grains: ['week'],
    dimensions: ['project', 'zone'],
    aliases: ['zone uptake', 'uptake', 'installed per zone', 'homes installed'],
    cite: 'FibreFlow project_weekly_zone_pon_uptake (cumulative installed, latest week in range) by week_ending',
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
    // Each row is one drop installed-but-not-activated on a given date: a
    // distinct event, so summing across days and projects is correct.
    additivity: 'additive',
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
    // A nightly STOCK, not an event count. The same DR appears in every night's
    // snapshot while it stays open, so summing across days counts one entity once
    // per night it was open — 1,061 open PPs over a week would report ~7,400.
    // 'semi-additive' makes the builder reject 'range' and the executor report the
    // latest night. Summing across project/POP within one night is still correct.
    additivity: 'semi-additive',
    grains: ['day'],
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

  // A cumulative measure collapsed to a single bucket would sum several running
  // totals into a meaningless number. Refuse rather than return it.
  if (def.additivity !== 'additive' && query.grain === 'range') {
    throw new Error(
      `unsupported grain 'range' for ${def.additivity} metric '${def.key}' — ` +
        `collapsing the period would sum values that are not summable over time. ` +
        `Request a periodic grain and read the final period.`,
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
  // to_char, NOT ::date. node-postgres parses a DATE column (OID 1082) into a JS
  // Date object, and `String(thatDate).slice(0,10)` yields "Mon Jul 21" — not an
  // ISO date. That corrupts the API's `period` field AND breaks any lexical
  // comparison built on it (which is how the cumulative total picks its period).
  // Returning text from SQL makes the value ISO by construction and removes the
  // JS date-marshalling step entirely. Verified against the live DB.
  const periodExpr = hasPeriod
    ? `to_char(date_trunc('${GRAIN_TRUNC[query.grain as Exclude<Grain, 'range'>]}', ${def.dateColumn}), 'YYYY-MM-DD')`
    : 'NULL::text';

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
    // HALF-OPEN, not BETWEEN. `to` arrives as a date; on a TIMESTAMP column
    // `BETWEEN '2026-07-01' AND '2026-07-31'` resolves the upper bound to
    // 2026-07-31 00:00:00 and silently discards ~24h of the final day.
    // `>= from AND < to + 1 day` is correct for both date and timestamp columns.
    where.push(`${def.dateColumn} >= $1::date AND ${def.dateColumn} < ($2::date + 1)`);
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
import { METRICS } from '@/modules/metrics/registry';
import { buildMetricQuery } from '@/modules/metrics/registry/queryBuilder';

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
import type { MetricDefinition } from '../types';

/** Minimal valid definition; each test overrides only key + aliases. */
const stub: MetricDefinition = {
  key: 'stub', label: 'stub', description: 'stub',
  from: 'x src', measure: 'count(*)', dateColumn: null,
  grains: ['range'], dimensions: [], aliases: [],
  cite: 'stub', permission: 'analytics.reports',
};

describe('matchMetric', () => {
  it('matches an unambiguous question exactly', () => {
    const r = matchMetric('how many open pre-provisions are there');
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.metric.key).toBe('pp_open_balance');
  });

  // ⚠️ Do NOT weaken this to `expect(['ambiguous','exact']).toContain(r.kind)`.
  // That assertion passes whatever happens and proves nothing — a fake test, and a
  // DGTS violation. Ambiguity reporting is the whole point of this module, so it
  // gets a real test: inject two metrics that genuinely tie.
  it('returns candidates rather than guessing when two metrics tie', () => {
    const tied = [
      { ...stub, key: 'metric_a', aliases: ['backlog'] },
      { ...stub, key: 'metric_b', aliases: ['backlog'] },
    ];
    const r = matchMetric('how many backlog', tied);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.candidates.map((c) => c.key).sort()).toEqual(['metric_a', 'metric_b']);
    }
  });

  it('prefers the longer, more specific alias over a generic one', () => {
    const metrics = [
      { ...stub, key: 'generic',  aliases: ['pre-provisions'] },
      { ...stub, key: 'specific', aliases: ['open pre-provisions'] },
    ];
    const r = matchMetric('how many open pre-provisions', metrics);
    expect(r.kind).toBe('exact');
    if (r.kind === 'exact') expect(r.metric.key).toBe('specific');
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
 *
 * `metrics` is injectable so the tie path can be tested with a controlled pair.
 * With only three registered metrics no natural tie exists, and a test that
 * cannot reach the branch it claims to cover is not a test.
 */
export function matchMetric(
  question: string,
  metrics: readonly MetricDefinition[] = METRICS,
): MatchResult {
  const q = question.toLowerCase();

  const scored = metrics.map((metric) => ({
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
- Produces: `MetricSeriesPoint`, `MetricResponse`, `executeMetric(def, query)`, and the HTTP contract `GET /api/metrics-list` / `GET /api/metrics-query?key=&from=&to=&grain=&dimensions=` (GET is mandatory — MCP tokens cannot POST).

**Response contract:** every response states `as_of` and the `grain` it was computed at, and carries the same 5-field citation envelope Cortex already emits (`source`, `source_id`, `channel`, `timestamp`, `snippet`).

- [ ] **Step 1: Write the failing test**

```typescript
// pages/api/__tests__/metrics-query.test.ts
import { describe, it, expect, vi } from 'vitest';
// Import the NAMED handler, not the default export. The default is wrapped in
// withAuth, so an unauthenticated request returns 401 before reaching any of the
// 400/404/405 paths below — the assertions would pass against the wrong status.
// Auth itself is covered separately in the RBAC tests.
import { handler } from '../metrics-query';

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  // methodNotAllowed sets the Allow header; without this the 405 test throws
  // "res.setHeader is not a function" instead of asserting the status.
  res.setHeader = vi.fn().mockReturnValue(res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
}

const get = (query: Record<string, string>) => ({ method: 'GET', query }) as never;

describe('GET /api/metrics-query', () => {
  it('rejects POST — MCP tokens are GET-only, so POST must never be accepted', async () => {
    const res = mockRes();
    await handler({ method: 'POST', query: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('rejects an unknown metric key with 404, not a zero', async () => {
    const res = mockRes();
    await handler(get({ key: 'nope', from: '2026-07-01', to: '2026-07-31', grain: 'week' }), res as never);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('rejects an unsupported grain with 400 rather than silently downgrading it', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake', from: '2026-07-01', to: '2026-07-31', grain: 'day' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a missing required field with 400', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a malformed date with 400', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake', from: '01-07-2026', to: '2026-07-31', grain: 'week' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a real-looking but non-existent date with 400', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake', from: '2026-02-31', to: '2026-07-31', grain: 'week' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an inverted range with 400', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake', from: '2026-07-31', to: '2026-07-01', grain: 'week' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a range beyond the maximum with 400', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake', from: '2020-01-01', to: '2026-07-31', grain: 'week' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects year 0000, which JS accepts but PostgreSQL cannot parse', async () => {
    const res = mockRes();
    await handler(get({ key: 'zone_uptake', from: '0000-01-01', to: '0000-01-02', grain: 'week' }), res as never);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a duplicated query parameter rather than silently taking the first', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', query: { key: ['zone_uptake', 'pp_open_balance'], from: '2026-07-01', to: '2026-07-31', grain: 'week' } } as never,
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects an empty dimension token rather than normalising it away', async () => {
    const res = mockRes();
    await handler(
      get({ key: 'zone_uptake', from: '2026-07-01', to: '2026-07-31', grain: 'week', dimensions: 'project,,zone' }),
      res as never,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('counts an inclusive range correctly at the boundary', async () => {
    // 2026-01-01..2027-01-01 is exactly 366 inclusive days — the limit, allowed.
    // 2027-01-02 is 367 and must be rejected. Asserting only the reject side would
    // also pass if the +1 were missing, so both sides are checked.
    const ok = mockRes();
    await handler(get({ key: 'zone_uptake', from: '2026-01-01', to: '2027-01-01', grain: 'week' }), ok as never);
    expect(ok.status).not.toHaveBeenCalledWith(400);

    const tooLong = mockRes();
    await handler(get({ key: 'zone_uptake', from: '2026-01-01', to: '2027-01-02', grain: 'week' }), tooLong as never);
    expect(tooLong.status).toHaveBeenCalledWith(400);
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
  /** How `total` was derived: 'additive' sums the series; anything else takes the latest period. */
  additivity: 'additive' | 'semi-additive' | 'non-additive';
  /** For a non-additive/semi-additive metric, the period `total` is "as at". Null otherwise. */
  total_period: string | null;
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
    // SET LOCAL requires a transaction block. Outside one it emits
    // "SET LOCAL can only be used in transaction blocks" and is DISCARDED — the
    // query would then run with no timeout at all against the shared production DB.
    // Plain SET would work but leaks the setting to the next borrower of this
    // pooled connection. BEGIN + SET LOCAL + COMMIT is the only correct form.
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '8s'");
    // Pin the session timezone. `date_trunc` and the date-range comparison on a
    // TIMESTAMPTZ column both resolve against it, so leaving it at the server
    // default (UTC) silently shifts every day/week boundary by 2 hours — a row
    // captured at 01:00 SAST would land in the previous day. The business day is
    // SAST, so the metric layer must say so rather than inherit whatever the
    // connection happened to have.
    await client.query("SET LOCAL TIME ZONE 'Africa/Johannesburg'");
    const result = await client.query(sql, params);
    rows = result.rows;
    await client.query('COMMIT');
  } catch (error) {
    // Must roll back before release, or the connection returns to the pool
    // inside a failed transaction and poisons the next caller.
    await client.query('ROLLBACK').catch((rollbackError) =>
      log.error('Metric rollback failed', { key: def.key, rollbackError }),
    );
    log.error('Metric execution failed', { key: def.key, error });
    throw error;
  } finally {
    client.release();
  }

  const series: MetricSeriesPoint[] = rows.map((r) => {
    const dimensions: Record<string, string | null> = {};
    for (const d of query.dimensions) dimensions[d] = (r[d] as string | null) ?? null;
    return {
      // Already 'YYYY-MM-DD' text from to_char — no Date marshalling, no slicing.
      period: (r.period as string | null) ?? null,
      dimensions,
      value: Number(r.value ?? 0),
    };
  });

  // A cumulative series is a sequence of running totals; summing it is meaningless.
  // `total` is the sum across dimensions WITHIN the latest period present, and
  // `total_period` names that period so the consumer is never guessing.
  //
  // Documented limitation: if one dimension value stops reporting earlier than
  // another, it is absent from the latest period and so excluded from `total`.
  // That is the correct reading of "as at the latest period" and is why
  // `total_period` is returned — a caller comparing totals across requests can
  // see the as-at date shift. Do not silently carry values forward.
  let total: number;
  let totalPeriod: string | null = null;
  if (def.additivity !== 'additive') {
    const periods = series.map((p) => p.period).filter((p): p is string => p !== null);
    // Lexical max is correct because to_char guarantees zero-padded ISO.
    totalPeriod = periods.length ? periods.reduce((a, b) => (a > b ? a : b)) : null;
    total = series.filter((p) => p.period === totalPeriod).reduce((sum, p) => sum + p.value, 0);
  } else {
    total = series.reduce((sum, p) => sum + p.value, 0);
  }

  const periodLabel = query.from === query.to ? query.from : `${query.from}..${query.to}`;

  return {
    key: def.key,
    label: def.label,
    grain: query.grain,
    additivity: def.additivity,
    total_period: totalPeriod,
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
// GET-only and authenticated. The catalogue enumerates internal table names and
// predicates in `cite`, which is operational detail — it does not belong on an
// anonymous endpoint. GET-only both matches the MCP restriction and stops the
// route answering to verbs it has no handler for.
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { METRICS } from '@/modules/metrics/registry';

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  return apiResponse.success(
    res,
    METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
      grains: m.grains,
      dimensions: m.dimensions,
      aliases: m.aliases,
      // Consumers must know this to interpret `total` — for a cumulative metric it
      // is the latest period's running total, not a sum of the series.
      additivity: m.additivity,
      source: m.cite,
    })),
  );
}

export default withAuth(handler);
```

**All three endpoints export the wrapped handler as default and the bare handler as a named export.** Tests import the *named* `handler` so they exercise the 400/404/405 paths directly; a test hitting the wrapped default gets 401 before reaching any of them, which is how the first draft's endpoint tests were silently asserting nothing.

`metrics-list` also filters by caller permission — authentication alone is not authorisation, and the catalogue exposes internal table names and predicates in `cite`:

```typescript
// inside the metrics-list handler, after auth:
const authReq = req as AuthenticatedNextApiRequest;
const visible = await Promise.all(
  METRICS.map(async (m) =>
    authReq.user.role === 'super_admin' ||
    (await userHasPermission(authReq.user.id, m.permission, 'view'))
      ? m
      : null,
  ),
);
// ...then map over visible.filter(Boolean) instead of METRICS.
```

- [ ] **Step 4a: Add the match endpoint — otherwise `matchMetric` is dead code**

`matchMetric()` is TypeScript inside FibreFlow. Cortex is a separate Python process, and `metrics-list`/`metrics-query` only expose *query by key*. Without an endpoint, nothing can reach the matcher, its unit test proves only that local dead code works, and Cortex has no way to return candidates for an ambiguous question — which was the whole point of building it.

Exposing it here (rather than reimplementing the matcher in Python) keeps the aliases in exactly one place: the registry. Cortex stays a thin client, which is the architectural decision this plan rests on.

```typescript
// pages/api/metrics-match.ts
// GET /api/metrics-match?q=how+many+open+pre-provisions
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { matchMetric } from '@/modules/metrics/registry/intent';

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  const q = req.query.q;
  if (typeof q !== 'string' || !q.trim()) {
    return apiResponse.badRequest(res, 'q is required');
  }

  const match = matchMetric(q);
  // The shape is deliberately explicit about which case occurred, so the caller
  // cannot mistake "ambiguous" for "no match" and quietly pick one.
  if (match.kind === 'none') return apiResponse.success(res, { kind: 'none' });
  if (match.kind === 'ambiguous') {
    return apiResponse.success(res, {
      kind: 'ambiguous',
      candidates: match.candidates.map((m) => ({
        key: m.key, label: m.label, description: m.description,
      })),
    });
  }
  return apiResponse.success(res, {
    kind: 'exact',
    metric: {
      key: match.metric.key,
      label: match.metric.label,
      grains: match.metric.grains,
      dimensions: match.metric.dimensions,
    },
  });
}

export default withAuth(handler);
```

```typescript
// pages/api/metrics-query.ts
//
// ⚠️ MUST BE GET. MCP tokens are restricted to GET/HEAD/OPTIONS by
// src/lib/auth/readOnly.ts:13, enforced inside withAuth. A POST route is
// unreachable by Cortex no matter how it authenticates. Do not "modernise"
// this to POST for a cleaner body — it would silently break the only consumer.
//
// Contract: /api/metrics-query?key=..&from=YYYY-MM-DD&to=YYYY-MM-DD&grain=day&dimensions=project,pop
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { findMetric } from '@/modules/metrics/registry';
import { executeMetric } from '@/modules/metrics/registry/execute';

// Year 0000 is rejected: it satisfies the JS Date round-trip but PostgreSQL has no
// year zero and errors at parse time, which would surface as a 500 rather than a 400.
const ISO_DATE = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/**
 * Query params arrive as string | string[] | undefined. A repeated param
 * (`?key=a&key=b`) is REJECTED rather than silently resolved to the first value —
 * a caller sending two values has a bug, and picking one hides it.
 */
function one(name: string, v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) throw new Error(`duplicate query parameter: ${name}`);
  return v;
}

/** A real calendar date, not just the right shape — rejects 2026-02-31. */
function isValidDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    // Signature is (res, method, allowedMethods) — three args. Two throws downstream.
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  let key: string | undefined, from: string | undefined, to: string | undefined;
  let grain: string | undefined, rawDims: string;
  try {
    key = one('key', req.query.key as string | string[] | undefined);
    from = one('from', req.query.from as string | string[] | undefined);
    to = one('to', req.query.to as string | string[] | undefined);
    grain = one('grain', req.query.grain as string | string[] | undefined);
    rawDims = one('dimensions', req.query.dimensions as string | string[] | undefined) ?? '';
  } catch (error) {
    return apiResponse.badRequest(res, error instanceof Error ? error.message : 'bad query');
  }

  if (!key || !from || !to || !grain) {
    return apiResponse.badRequest(res, 'key, from, to and grain are required');
  }
  if (!isValidDate(from) || !isValidDate(to)) {
    return apiResponse.badRequest(res, 'from and to must be valid YYYY-MM-DD dates');
  }
  if (from > to) {
    return apiResponse.badRequest(res, `from (${from}) must not be after to (${to})`);
  }
  // The range is INCLUSIVE of both ends, so a from==to request spans 1 day.
  // Comparing the raw difference would allow MAX_RANGE_DAYS + 1 calendar days.
  const spanDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    return apiResponse.badRequest(
      res,
      `range of ${spanDays} days exceeds the ${MAX_RANGE_DAYS}-day maximum`,
    );
  }

  // Comma-separated, trimmed, de-duplicated, order preserved. An empty token
  // (`dimensions=project,,pop`) is a caller bug, so reject rather than normalise.
  const dimTokens = rawDims ? rawDims.split(',').map((d) => d.trim()) : [];
  if (dimTokens.some((d) => d === '')) {
    return apiResponse.badRequest(res, 'dimensions must not contain empty values');
  }
  const dimensions = [...new Set(dimTokens)];

  const def = findMetric(key);
  if (!def) return apiResponse.notFound(res, 'Metric', key);

  try {
    const result = await executeMetric(def, { from, to, grain: grain as never, dimensions });
    return apiResponse.success(res, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Validation errors are the caller's fault; anything else is ours.
    if (/unsupported (grain|dimension)/i.test(message)) {
      return apiResponse.badRequest(res, message);
    }
    log.error('Metric query failed', { key, error });
    return apiResponse.internalError(res, error, 'Metric execution failed');
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
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

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

// ...and at the bottom of the file (the handler itself stays a NAMED export so
// tests can exercise the 400/404/405 paths without authenticating):
export default withAuth(handler);
```

Then add the RBAC tests against the **default** export, which is the wrapped one:

```typescript
// pages/api/__tests__/metrics-query.auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import wrapped from '../metrics-query';

// mockRes() as above, including setHeader.
describe('metrics-query auth', () => {
  it('returns 401 with no session', async () => {
    const res = mockRes();
    await wrapped({ method: 'GET', query: {}, headers: {}, cookies: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when req.user is absent even though withAuth ran', async () => {
    // Guards the fail-open shape directly: a null user must deny, not fall through
    // to the super_admin comparison and past it.
    const res = mockRes();
    await handler({ method: 'GET', query: { key: 'zone_uptake', from: '2026-07-01', to: '2026-07-31', grain: 'week' } } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

Add tests asserting an unauthenticated request returns **401**, an authenticated-but-unpermitted one returns **403**, and — critically — that a request with **no user object at all** returns 401 rather than falling through to success.

- [ ] **Step 7: Verify end-to-end against dev**

```bash
PORT=3004 npm run dev   # in this worktree

curl -s localhost:3004/api/metrics-list | head -40

curl -s 'localhost:3004/api/metrics-query?key=pp_open_balance&from=2026-07-25&to=2026-08-01&grain=day&dimensions=project'

# Must be 405 — MCP tokens cannot POST, so POST must never be a working alternative:
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3004/api/metrics-query
```

Expected: a daily series plus a total, with `as_of`, `grain`, `additivity:'semi-additive'`, `total_period` and the citation envelope present. Mohadin should dominate the open balance (≈708 of ≈1,061). **A zero total means the snapshot cron has not run yet, not that the metric is broken** — check `snapshot_runs` for a `complete` row before debugging the metric.

Also verify the semi-additive path explicitly, because this is the one that fails silently:

```bash
curl -s 'localhost:3004/api/metrics-query?key=zone_uptake&from=2026-07-01&to=2026-07-31&grain=week'
```

Expected: `additivity:'semi-additive'`, a `total_period` naming the final week, a rising weekly series (≈21,666 → 22,556 → 23,342 → 23,732), and a `total` equal to the **last** week (≈23,732) — **not** their sum (≈91,296). If the total is ~91k the semi-additive handling is broken; the numbers look plausible, so only this comparison catches it.

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
- Consumes: `GET /api/metrics-list`, `GET /api/metrics-query`.

**The Cortex change is a separate PR in a separate repo.** Do not merge it before the FibreFlow side is deployed to dev and verified.

- [x] ~~**Step 1: Leave `metric:preprovisions` byte-identical**~~ — **WITHDRAWN 2026-08-03. Do not execute this step.**

> ⚠️ **The number this step told you to preserve is wrong by ~5x.** Measured on the live DB
> 2026-08-03: `dr_activity_log` does not log a pre-provision once, it **re-logs an unresolved
> one roughly daily** — three drops carry 141 rows each spanning 2026-04-30..2026-07-12. For
> July the original SQL returns **1,107** against **264** distinct drops touched and **219**
> first-ever additions. It is the same "summing something that cannot be summed over time"
> failure as `zone_uptake`, reached by re-logging rather than cumulative snapshotting.
>
> Cortex #164 deleted the metric; FF #2363 deliberately did **not** restore it, and a registry
> test now asserts it stays absent along with its `pre-provisions` alias (which also stole
> backlog questions from `pp_open_balance`). The question falls through to prose, which is
> honest — a confident 1,107 is not.
>
> **Do not restore it to satisfy "byte-identical".** Doing so re-implements a proven defect.
> Which number is meant — 219 new / 264 touched / 1,107 events — is a business decision, and
> belongs with `pp_new` in Plan 2. A correct definition needs a first-occurrence or DISTINCT
> basis and a value-assertion test.

The original intent — do not change a response shape until an equivalent replacement is
verified — was sound. It failed only because it assumed the existing number was correct.
Verify that assumption before preserving any legacy metric.

- [ ] **Step 2: Remove the silent-RAG fallback for registry-backed metrics entirely**

`run_metric` currently returns `None` on any failure, so the caller silently falls back to RAG prose.

An earlier draft of this step kept that fallback for 5xx and timeouts. That was self-contradictory: this plan exists because a confidently wrong answer is worse than no answer, and a 5xx is *precisely* the case where authoritative measurement is unavailable. Falling back to uncited prose there preserves the exact failure mode being fixed, at the worst possible moment.

So: once a question has matched a registry metric, **every** outcome is reported as itself.

| Outcome | Response |
|---|---|
| `kind: 'exact'` + 200 | the number, with its citation |
| `kind: 'ambiguous'` | the candidate list — "did you mean X or Y?" |
| `kind: 'none'` | fall through to RAG (it was never a metric question) |
| 4xx | explain the problem (unknown metric, unsupported grain, bad range) |
| **5xx / timeout / unreachable** | **"the metrics service is unavailable" — never prose** |

Only `kind: 'none'` reaches RAG, and that is correct: the question was not a metric question in the first place.

Cortex calls `/api/metrics-match` first, then `/api/metrics-query` with the resolved key. Add tests asserting (a) an ambiguous question returns candidates rather than a number, and (b) a simulated 500 from the metrics service returns an unavailability message rather than a RAG answer.

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
| Snapshot spine | Rows land 3 nights running; a second same-day run changes no counts; `snapshot_runs` has exactly one row per source per day |
| Snapshot concurrency | Two `writeSnapshot` calls raced against the live DB → exactly one writes, the other returns `skipped` **without blocking**, and the loser changes no counts |
| Snapshot recovery | Kill a run mid-write → **no** `snapshot_runs` row and **no** partial `metric_snapshots` rows survive (the transaction rolled back and the advisory lock auto-released); the next run writes the day cleanly |
| Period type | `period` in every response matches `^\d{4}-\d{2}-\d{2}$`. A `Date`-stringified value like `Mon Jul 21` means the `to_char` was reverted |
| Conformed dimensions | `TEM-3` and `ETW-2` appear in no metric output; SQL/TS parity test passes |
| Registry | Every metric executes for every declared grain × dimension against the live schema |
| **Additivity** | `zone_uptake` over multiple weeks returns `total` = the **last** week (≈23,732), not the sum (≈91,296). `pp_open_balance` rejects `range` grain. Every registered metric declares `additivity` explicitly |
| **Transport** | `GET /api/metrics-query` succeeds; `POST` returns 405. An MCP-kind session can reach both endpoints |
| Date bounds | A metric on a timestamp column returns rows dated on the `to` date itself (half-open bound, not `BETWEEN`) |
| Input validation | Malformed date, impossible date (`2026-02-31`), inverted range, and >366-day range each return 400 |
| Intent | An ambiguous question returns candidates, never a number — proven against an injected tied pair, not a tautological assertion |
| Contract | Every response carries `as_of`, `grain`, `additivity`, `total_period`, and the 5-field citation envelope |
| RBAC | Unauthenticated → 401; unpermitted → 403; null session denies rather than fails open |
| Cron auth | Unset `CRON_SECRET` returns 500, not success; a failed source returns non-2xx |
| Timeout | `statement_timeout` demonstrably applies — a deliberately slow query aborts at 8s rather than running unbounded |
| ~~Compatibility~~ | ~~`metric:preprovisions` response byte-identical to today's~~ — **gate withdrawn**, see Task 7 Step 1. The metric was proven ~5x wrong and deliberately not restored (FF #2363); there is no response to be compatible with. |
| CI | `npm run ci:quick` passes; `bash scripts/test-ratchet.sh --changed origin/master` passes; `next build` verified manually |

## Known follow-ups (not in this plan)

- `pp_new`, `pp_reentered`, `pp_to_oes_active`, `pp_cleared_other`, `pp_age_at_clear`, `pp_reentry_rate` — Plan 2.
- **The PP list has no exit path.** 1,061 open entries, 884 of them >31 days old, `decommissioned_at` populated on zero rows. Faulty ONTs and false positives never leave the list, so the open balance gating Fibertime's ">100 per POP, no new ports" rule is inflated. Plan 2 adds the exit path fed by the new Exit Reason column in the source spreadsheet — with blanks landing in an explicit `unknown` bucket that appears in the exceptions report, **never silently as zero**, plus a fill-rate metric so the gap stays visible.
- **68 rows** have `resolution_status='activated'` with a NULL `activated_at` — invisible to any date-ranged conversion metric. First entry in the exceptions table (Plan 3).
- **371 of 3,043** resolved PP rows reference a `resolved_drop_number` absent from `oes_activations` (12.2%). Second entry in the exceptions table.
- Dwell-window flap detection cannot be backfilled; it begins accruing the day Task 1 deploys. Flapping is large — 4,914 `pre_prov_reentered` against 1,238 `pre_prov_added`.
- `zone` is declared as a dimension but only `zone_uptake` currently exposes a `zone_no` column; `pp_open_balance` would need `olt_pon` promoted into `dims`. Confirm before adding `zone` to another metric.
