# FibreFlow — Neon Shim Elimination & DB-Layer Hardening Plan

**Date:** 2026-05-30  ·  **Author:** Claude (Opus) + Hein  ·  **Status:** approved approach, staged execution
**Companion audit:** `docs/audits/2026-05-30-neon-shim-migration-audit.md`

---

## 0. The actual problem (verified against code)

`@neondatabase/serverless` is webpack-aliased to `src/lib/neon-shim.ts`, a `pg.Pool` adapter. **The shim is a faithful adapter for every usage pattern except two divergences from the real Neon driver.** It is not "498 broken files" — it is a working compatibility seam with two sharp edges and a large mechanical-debt tail.

### Divergence class 1 — nested `${sql\`fragment\`}` interpolation
The interpolated value is a `Promise<rows[]>`, not a fragment, so the shim pushes it as a bind parameter → wrong/garbage SQL. **Breaks at runtime today.**

### Divergence class 2 — `await sql.unsafe(text, params)` used as a query executor
The real Neon driver's `sql.unsafe(query, params?)` *executes* and returns rows. The shim (`neon-shim.ts:116`) **and** the migration target `db-pool.ts` (~line 145) define `.unsafe(raw)` as a **1-arg sentinel** for verbatim interpolation. So `await sql.unsafe(text, params)` returns a sentinel object, not rows → downstream `.map()` throws. **Breaks at runtime today.** (This class was missed by the automated audit; found during plan grilling.)

### Everything else is faithful
- Static tagged-templates → rebuilt to `$N` params → `pool.query()` — identical to pg.
- `.query(text, params)` → literally `pool.query(text, params)` — identical to pg.
- `${sql.unsafe(rawString)}` **interpolation** form → inlined verbatim — correct.
- No use of `sql.transaction([...])`, `.array()`, `fullResults`, `arrayMode`, or 2-arg `neon(url, opts)` (swept; the only `.transaction()` hits are IndexedDB in fleet offline storage).

---

## 1. Corrected scope

| Bucket | Count | Note |
|--------|------:|------|
| 🔴 BROKEN-NOW | **3** | audit found 2 (class 1); +1 class-2 (`budget/items.ts`) |
| 🟠 AT-RISK | 37 | fragile dynamic SQL via `.query()`/concat — works on shim today, not a shim-breakage risk |
| 🟡 TRIVIAL-MIGRATE | 433 | static templates — correct today; mechanical import swap only |
| 🟢 SAFE | 25 | already pg.Pool-backed |
| **Total shim-dependent** | **498** | 476 routes + 22 helpers |

### The 3 BROKEN-NOW (fix first, with evidence)
1. `pages/api/projects/[projectId]/client-pos/[poId]/assign-drops.ts:159-188` — class 1: `whereConditions = sql\`${whereConditions} AND …\`` chained, interpolated at `:179`/`:188`. Client = db-logger (shim).
2. `pages/api/projects/[projectId]/requirements/[requirementId].ts:123-128` — class 1: five `${cond ? value : sql\`column\`}` ternaries in a PATCH UPDATE. Client = db-logger (shim).
3. `pages/api/projects/[projectId]/budget/items.ts:127,139` — class 2: `await sql.unsafe(query, params)` executor form; `items.map()` at `:143` throws. Client = `neon()` (shim).

---

## 2. Strategy: hybrid, staged — not big-bang

**Correctness is achieved at Stage 1.** Shim elimination (Stages 3–4) is optional tech-debt paydown, sequenced safely behind the guardrail so it can stop at any point without leaving the system broken.

> **Single shared dev+prod DB:** every merged PR can reach production. Every stage deploys dev → verify → prod after-hours via `scripts/deploy-local.sh`. No manual `git pull + build + restart`.

---

### Stage 0 — Pin the divergence contract (1 PR, ~½ day)
Make the two failure modes impossible to reintroduce *before* touching call sites.

1. **ESLint local rule** `no-neon-shim-sql-divergence` (register in `scripts/setup-eslint-plugin.js` — postinstall, per repo convention; **not** a root file). Flags:
   - a `sql\`…\`` tagged template whose interpolation expression is itself a `sql\`…\`` call or a ternary with a `sql\`…\`` branch (class 1);
   - `sql.unsafe(` called with **2+ args** or whose result is `await`ed/assigned-then-iterated (class 2).
2. Add to the lint **ratchet at error level for new code** (baseline = current 0 errors; do not retro-fail the 3 known files in the same PR — fix them in Stage 1).
3. **Gate:** `npm run ci:quick` green; rule unit-tested with a positive + negative fixture (DGTS — no tautology tests).

*Rollback:* revert the PR; rule is additive, zero runtime impact.

---

### Stage 1 — Hotfix the 3 BROKEN-NOW (1 PR, ~½ day)  ← **the real "harden the system" win**
Switch each to `@/lib/db-pool` and remove the divergent pattern:
- **assign-drops.ts** — rewrite GET to explicit query branches (the repo's documented workaround) or build the WHERE with `${sql.unsafe(trustedFragmentString)}`; values stay `$N`-bound.
- **requirements/[requirementId].ts** — replace the 5 ternary-fragment columns with `COALESCE(${scalarOrNull}, column)` (the file already does this for `is_completed`/`sort_order` on lines 122/129).
- **budget/items.ts** — replace `await sql.unsafe(text, params)` → `await sql.query(text, params)` (executor); sort column already whitelisted.

**Gate:** `npm run ci:quick`; **exercise each route** on dev (browser/curl) — GET drops list, PATCH a requirement, GET budget items — confirm 200 + correct rows, not just compile. Re-enable the Stage 0 rule at error level for these files.

*Rollback:* revert PR; pre-fix behaviour was already broken, so no regression risk.

---

### Stage 2 — Harden the shared DB layer (1 PR, ~1 day)
De-risk the highest-fan-in seams so all later swaps are mechanical.
1. **`src/lib/db-pool.ts`** — confirm/harden as the single migration target (it already mirrors `.query`/`.unsafe`/tagged-template). Add a typed `query`/`queryOne`/`transaction` surface if missing.
2. **`lib/db-logger.ts`** (54 callers / 56 symbols per codegraph) — re-implement `createLoggedSql` to wrap **`pg.Pool` via db-pool** instead of `neon()`, preserving **both** the tagged-template call and `.query()`/`.unsafe()` surface. This instantly moves 54 files off the shim with no per-file edits.
3. **`lib/db/pool.js`** (mixed/HOT) — re-point its internal serverless client off `neon()`; keep the exported `query()`/`transaction()` API stable.

**Gate:** `npm run ci:quick`; smoke-test a sample of accounting + budget + projects routes (the db-logger cluster) on dev; `npm run antihall`.

*Rollback:* these are internal-implementation swaps behind stable APIs — revert the single PR.

---

### Stage 3 — Migrate the tail, helper-first, in safe batches (optional; N PRs)
Only correctness-neutral mechanical work remains. Order per the audit DAG:
1. Remaining shared service helpers (snagGroupNotifications, eodReconciliationService, sharepointSyncService, snag-repeat-detector, auditService, staff services).
2. Routes in **batches of ≤15**, grouped by module, each batch = 1 PR. The swap is one line: `import { neon } from '@neondatabase/serverless'; const sql = neon(url)` → `import { sql } from '@/lib/db-pool'`.
3. Convert the 37 AT-RISK files in their module's batch — keep `$N` params, route dynamic identifiers through the existing whitelists (no new injection surface), prefer `sql.query(text, params)` over `.unsafe()` executor.

**Gate per batch:** `npm run ci:quick`; smoke-test one representative route per batch on dev; deploy dev, soak, then prod after-hours.

*Rollback:* per-batch PR revert; the shim still backs any un-migrated file, so partial completion is always safe.

---

### Stage 4 — Retire the shim (final PR, only when zero importers remain)
1. Prove it: `grep -rl "@neondatabase/serverless" pages src lib` returns **0** (excluding the shim + its alias).
2. Remove the webpack alias + `transpilePackages` entry in `next.config.js`; delete `src/lib/neon-shim.ts`, `src/lib/db-neon.ts`, `src/lib/neon.ts`; drop `@neondatabase/serverless` from `package.json`.
3. Demote the Stage 0 ESLint rule to ban *any* import of `@neondatabase/serverless` outright.

**Gate:** full `npm run ci`; production build; deploy dev → full smoke → prod after-hours.

*Rollback:* revert the deletion PR; alias + package restore the seam.

---

## 3. Migration DAG (dependency order)

```
neon-shim.ts ........ KEEP until Stage 4 (compatibility seam; remove LAST)
  └─ db-pool.ts ..... TARGET — harden first (Stage 2)
       ├─ db-logger.ts ... ★ 54 callers — biggest single de-risk (Stage 2)
       ├─ lib/db/pool.js .. @/lib/db internals (Stage 2)
       └─ service helpers → route batches (Stage 3)
```

## 4. Validation matrix

| Stage | Static gate | Runtime gate | Deploy |
|-------|-------------|--------------|--------|
| 0 | `ci:quick` + rule unit tests | — | dev only |
| 1 | `ci:quick` | exercise all 3 routes on dev | dev → prod after-hours |
| 2 | `ci:quick` + `antihall` | smoke db-logger cluster on dev | dev → prod after-hours |
| 3 | `ci:quick` per batch | 1 route/batch on dev | dev soak → prod after-hours |
| 4 | full `ci` + prod build | full smoke | dev → prod after-hours |

## 5. Explicit non-goals
- Not rewriting working static-template queries beyond the import swap.
- Not adding new injection-hardening to already-whitelisted dynamic identifiers (mention, don't gold-plate).
- Not introducing an ORM / query builder.
- Not touching `pg.Pool` config/pool sizing (separate concern).

## 6. First action
Ship **Stage 0 + Stage 1 together or back-to-back** — that fully hardens the system against both divergence classes and fixes all 3 live bugs. Stages 2–4 follow only if/when full shim removal is desired.
