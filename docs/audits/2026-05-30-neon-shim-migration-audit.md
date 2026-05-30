# FibreFlow — Neon Serverless Shim Migration Audit

**Date:** 2026-05-30  ·  **Scope:** read-only static analysis (no edits, no PRs)  ·  **Method:** inline scout (grep + codegraph) → 28 classifier agents over 498 files → independent adversarial verification of every BROKEN-NOW/AT-RISK row → opus synthesis.

> **Bottom line:** Of 498 shim-dependent files, only **2 are confirmed BROKEN-NOW** (both verified with file:line evidence). **38 are AT-RISK** (fragile dynamic-SQL via `sql.query()`/`sql.unsafe()`/concatenation — not broken today but one fragment-interpolation away from it). **433 are TRIVIAL-MIGRATE** (static tagged-templates — mechanical 1-line import swap). **25 are already SAFE** (pg.Pool-backed). The single highest-leverage change is migrating `lib/db-logger.ts` (codegraph: 56 symbols / 54 callers), which de-risks both BROKEN-NOW files at once.

---

## 1. Totals

- **Total shim-dependent files:** 498  (476 API routes + 22 shared helpers/services)
- **Verification:** every BROKEN-NOW/AT-RISK row was re-read by an independent agent; 2 original BROKEN-NOW claims (`lib/db/pool.js`, `pages/api/field/export.ts`) were **refuted on inspection and demoted to AT-RISK**.

### Per-bucket counts

| Bucket | Count | Meaning |
|--------|------:|---------|
| 🔴 BROKEN-NOW | 2 | Shim-backed **and** uses conditional/nested `sql\`fragment\`` interpolation — fails at runtime today |
| 🟠 AT-RISK | 38 | Shim-backed **and** builds dynamic SQL via `sql.query()`/`sql.unsafe()`/string-concat — fragile, not guaranteed to match pg.Pool |
| 🟡 TRIVIAL-MIGRATE | 433 | Shim-backed but only static tagged-templates with scalar `${param}` bindings — mechanical import swap |
| 🟢 SAFE | 25 | Already pg.Pool-backed (or neon `Pool` with parameterized `.query()`) — unaffected |

### Per-import-style counts

| Import style | Count | Backing |
|--------------|------:|---------|
| `neon-tagged` | 419 | SHIM (`neon()` tagged-template) |
| `db-logger` | 54 | SHIM (`createLoggedSql` wraps `neon()`) |
| `neon-Pool` | 16 | pg-compatible (shim `Pool` *is* `pg.Pool`) |
| `pg-safe` | 7 | pg.Pool (`@/lib/db` / `@/lib/db-pool` / `pg`) |
| `mixed` | 2 | both shim + pg paths in one file |

---

## 2. 🔴 BROKEN-NOW (fix immediately, out-of-band)

Both are `db-logger`-backed (shim) and mutate/read on the **single shared dev+prod DB**. Independently verified.

| # | File | Hotness | Pattern | Evidence (file:line) |
|---|------|---------|---------|----------------------|
| 1 | `pages/api/projects/[projectId]/client-pos/[poId]/assign-drops.ts` | WARM | nested/ternary `sql\`fragment\`` on shim client | pages/api/projects/[projectId]/client-pos/[poId]/assign-drops.ts:159-179 — let whereConditions = sql`WHERE d.client_po_id = ${poId}`; then line 161: whereConditions = sql`${whereConditions} AND oa.id IS NULL`; and line 164: whereConditions = sql`${whereConditions} AND d.invoiced = false`; interpolated at line 179: ${whereConditions} inside main sql`` query — fragment-in-fragment pattern on shim-backed client (line 10: import createLoggedSql from '@/lib/db-logger'; line 15: const sql = createLoggedSql(...)) |
| 2 | `pages/api/projects/[projectId]/requirements/[requirementId].ts` | WARM | nested/ternary `sql\`fragment\`` on shim client | pages/api/projects/[projectId]/requirements/[requirementId].ts:123 — `completed_at = ${updates.completed_at !== undefined ? updates.completed_at : sql\`completed_at\`}` (and identical pattern on lines 124, 126, 127, 128). Client is shim-backed: line 10 `import { createLoggedSql } from '@/lib/db-logger'`, line 16 `const sql = createLoggedSql(process.env.DATABASE_URL!)`. |

**`pages/api/projects/[projectId]/client-pos/[poId]/assign-drops.ts`** — Classification confirmed. The GET handler (lines 150-216) builds whereConditions by chaining sql fragment interpolations into new sql templates across up to 3 branches, then interpolates the accumulated fragment at lines 179 and 188 into two separate main queries. The client is shim-backed via db-logger (createLoggedSql wraps neon()). The broken pattern is unambiguous: nested ${sql`...`} fragment interpolation on a neon-shim client. The POST and DELETE handlers only use scalar bindings and are not themselves broken, but the GET path is definitively BROKEN-NOW.

**`pages/api/projects/[projectId]/requirements/[requirementId].ts`** — Five ternary expressions in the PATCH UPDATE query (lines 123-128) each interpolate a sql`column_name` fragment as the else-branch when a field is not being updated. This is the exact conditional SQL-fragment pattern that breaks the Neon serverless shim. The fix is to switch to pg.Pool (import from @/lib/db-pool) and rewrite the UPDATE using explicit conditional query branches, or use COALESCE with a scalar null like the is_completed and sort_order columns already do on lines 122 and 129.

---

## 3. Ranked migration worklist (risk × hotness)

All 40 BROKEN-NOW + AT-RISK files, highest priority first.

| Rank | Bucket | File | Hot | Risk reason | Evidence |
|-----:|--------|------|-----|-------------|----------|
| 1 | AT-RISK | `lib/db/pool.js` | HOT | HOT shared helper (DAG root for @/lib/db callers) that exposes the shim-backed neon() client via a plain function-call API sql(query, params), bypassing the tagged-template parameter-binding contract. Any caller-side string concatenation flows through the shim. Structural, broad blast radius across an unknown caller set. | lib/db/pool.js:183 |
| 2 | AT-RISK | `pages/api/procurement/purchase-orders/index.ts` | HOT | HOT procurement list endpoint. handleGet builds countQuery/dataQuery by JS string concatenation of dynamic WHERE + ORDER BY column/direction, executed via sql.query() on the neon shim. High traffic, high data exposure. | pages/api/procurement/purchase-orders/index.ts:64 |
| 3 | AT-RISK | `pages/api/procurement/stock-takes/index.ts` | HOT | HOT. GET builds a query string across up to 7 conditional AND branches then executes via sql.query(query, params) on the shim client. Frequently hit stock-take listing. | pages/api/procurement/stock-takes/index.ts:86 |
| 4 | AT-RISK | `pages/api/projects.ts` | HOT | HOT core projects endpoint, db-logger shim-backed. List GET assembles query by string concatenation with $N placeholders then sql.query(query, params); shim handling of pg-style positional params via .query() is untested. | pages/api/projects.ts:136 |
| 5 | BROKEN-NOW | `pages/api/projects/[projectId]/client-pos/[poId]/assign-drops.ts` | WARM | CONFIRMED BROKEN: GET chains nested ${sql`fragment`} interpolations (whereConditions built across 3 branches) on the db-logger shim client — the exact conditional-fragment pattern that breaks the shim. Will fail at runtime now. | pages/api/projects/[projectId]/client-pos/[poId]/assign-drops.ts:159 |
| 6 | BROKEN-NOW | `pages/api/projects/[projectId]/requirements/[requirementId].ts` | WARM | CONFIRMED BROKEN: five ternary expressions in the PATCH UPDATE each interpolate a sql`column_name` fragment as the else-branch on the db-logger shim client. Breaks the shim at runtime; corrupts updates on a shared dev+prod DB. | pages/api/projects/[projectId]/requirements/[requirementId].ts:123 |
| 7 | AT-RISK | `pages/api/field/tasks/index.ts` | WARM | WARM field PWA endpoint, db-logger shim-backed. GET filtered branch builds a plain SQL string by array-join concatenation interpolating whereClause then sql.query(baseQuery, params). Field-stock hot path. | pages/api/field/tasks/index.ts:98 |
| 8 | AT-RISK | `pages/api/procurement/purchase-orders/[id].ts` | WARM | WARM. update_fields case builds UPDATE SET via array-join of column assignments then sql.query(updateQuery, values) on neon shim. Mutating path on shared DB. | pages/api/procurement/purchase-orders/[id].ts:566 |
| 9 | AT-RISK | `pages/api/poles/index.ts` | WARM | WARM. GET builds whereClause by array-join then sql.query(countQuery/dataQuery, params) on neon shim. Core poles listing. | pages/api/poles/index.ts:99 |
| 10 | AT-RISK | `pages/api/projects/[projectId]/budget/items.ts` | WARM | WARM. Uses sql.unsafe(query, params) with a concatenated string including ORDER BY ${sortColumn} ${sortDir} on the shim — sql.unsafe() is especially brittle on the Neon shim. super_admin scoped. | pages/api/projects/[projectId]/budget/items.ts:127 |
| 11 | AT-RISK | `pages/api/materials/catalog.ts` | WARM | WARM. GET builds whereClause + injects unparameterized sortColumn/sortDir into the string then sql.query() on neon shim. | pages/api/materials/catalog.ts:105 |
| 12 | AT-RISK | `pages/api/procurement/adjustments/index.ts` | WARM | WARM. GET assembles raw SQL by concatenation with conditional appends then sql.query(query, params) on neon shim. | pages/api/procurement/adjustments/index.ts:91 |
| 13 | AT-RISK | `pages/api/procurement/cost-centers/index.ts` | WARM | WARM. handleGet builds query via repeated string concatenation then sql.query() at two call sites on neon shim. | pages/api/procurement/cost-centers/index.ts:95 |
| 14 | AT-RISK | `pages/api/procurement/cost-centers/[id]/transactions.ts` | WARM | WARM. Query string built by += concatenation with up to 5 conditional AND clauses, executed via sql.query() twice on neon shim. | pages/api/procurement/cost-centers/[id]/transactions.ts:104 |
| 15 | AT-RISK | `pages/api/procurement/categories/index.ts` | WARM | WARM. GET assembles dynamic SQL via conditional query+= branches then sql.query(query, params) on neon shim. | pages/api/procurement/categories/index.ts:83 |
| 16 | AT-RISK | `pages/api/procurement/bundles/index.ts` | WARM | WARM. handleGet builds dynamic query by concatenation with optional AND clauses then sql.query(query, params) on neon shim. | pages/api/procurement/bundles/index.ts:72 |
| 17 | AT-RISK | `pages/api/procurement/stock-takes/[id]/lines.ts` | WARM | WARM. handleGet builds query via concatenation with optional AND clauses then sql.query(query, params) on neon shim. | pages/api/procurement/stock-takes/[id]/lines.ts:66 |
| 18 | AT-RISK | `pages/api/procurement/stock-takes/reasons.ts` | WARM | WARM. Query string built by concatenation then sql.query(query, params) on neon shim. | pages/api/procurement/stock-takes/reasons.ts:44 |
| 19 | AT-RISK | `pages/api/qfield/qa-validations.ts` | WARM | WARM. countQuery/dataQuery built by interpolating dynamic fragments (dropsFilterJoin, whereClause) plus bare LIMIT/OFFSET, executed via sql.query() on neon shim. QA pipeline path. | pages/api/qfield/qa-validations.ts:176 |
| 20 | AT-RISK | `pages/api/snags/resolution-report.ts` | WARM | WARM. sql.unsafe(dateCol) with a runtime-variable string from query param on the shim — sql.unsafe with a dynamic value is the most fragile shim path of the AT-RISK set. | pages/api/snags/resolution-report.ts:252 |
| 21 | AT-RISK | `pages/api/sow/list.ts` | WARM | WARM. data/count queries built by concatenating safeTable, whereClause, safeSortBy, safeSortOrder + LIMIT/OFFSET then sql.query() on neon shim. | pages/api/sow/list.ts:246 |
| 22 | AT-RISK | `pages/api/sow/drops/search.ts` | WARM | WARM. whereClause built by array-join then interpolated into query string passed to sql.query() on neon shim. | pages/api/sow/drops/search.ts:58 |
| 23 | AT-RISK | `pages/api/fleet/vehicles/[id]/insurance.ts` | WARM | WARM. handleGet builds raw SQL by concatenation with conditional appends then calls (sql as any)(query, params) — invoking the neon-tagged client as a plain function, bypassing the tagged-template interface. | pages/api/fleet/vehicles/[id]/insurance.ts:81 |
| 24 | AT-RISK | `pages/api/fleet/check-in/audit.ts` | WARM | WARM. whereClause via filters.join(' AND ') plus literal LIMIT/OFFSET injected into the query string then sql.query(string, params) on neon shim. | pages/api/fleet/check-in/audit.ts:184 |
| 25 | AT-RISK | `pages/api/pole-photos-upload.ts` | WARM | WARM. Dynamic column name photo_${photoType} (whitelist-validated) interpolated into UPDATE string then sql.query(string, params) on neon shim. | pages/api/pole-photos-upload.ts:147 |
| 26 | AT-RISK | `pages/api/pole-photos-delete.ts` | WARM | WARM. Dynamic column name photo_${photoType} embedded into UPDATE string then sql.query(string, params) on neon shim. | pages/api/pole-photos-delete.ts:78 |
| 27 | AT-RISK | `pages/api/reminder-preferences.ts` | WARM | WARM. PUT assembles query via updates.push()/join() then sql.query(query, params) on neon shim. Mutating path. | pages/api/reminder-preferences.ts:85 |
| 28 | AT-RISK | `pages/api/reminders-update.ts` | WARM | WARM. UPDATE built via updates.push(col = $N) + join then sql.query(query, params) on neon shim. Mutating path. | pages/api/reminders-update.ts:69 |
| 29 | AT-RISK | `pages/api/reminders.ts` | WARM | WARM. GET builds query by concatenation with optional status clause then sql.query(query, params) on neon shim. | pages/api/reminders.ts:43 |
| 30 | AT-RISK | `pages/api/wa-monitor-drops/[id].ts` | WARM | WARM. UPDATE qa_photo_reviews SET built via setClauses.join(', ') then sql.query(query, values) on neon shim. WhatsApp QA mutating path. | pages/api/wa-monitor-drops/[id].ts:88 |
| 31 | AT-RISK | `pages/api/system/data-sync/history.ts` | WARM | WARM. UNION query assembled by interpolating a WHERE fragment + LIMIT into the string then rawSql.query(fullQuery) on neon shim (allowlist-validated typeFilter). | pages/api/system/data-sync/history.ts:213 |
| 32 | AT-RISK | `pages/api/field/export.ts` | WARM | WARM. Uses sql`${sql.unsafe(BASE)} ... ${sql.unsafe(TAIL)}` with static consts on the shim — currently safe (no dynamic input to unsafe) but brittle: any future variable into sql.unsafe() becomes BROKEN-NOW. | pages/api/field/export.ts:78 |
| 33 | AT-RISK | `pages/api/procurement/purchase-orders-export.ts` | COLD | COLD admin export. WHERE built via conditions.join(' AND ') then sql.query(query, params) on neon shim. | pages/api/procurement/purchase-orders-export.ts:75 |
| 34 | AT-RISK | `pages/api/procurement/requisitions-export.ts` | COLD | COLD admin export. WHERE built via conditions.join(' AND ') then sql.query(query, params) on neon shim. | pages/api/procurement/requisitions-export.ts:68 |
| 35 | AT-RISK | `pages/api/stock-items/stock-items-export.ts` | COLD | COLD admin CSV export. WHERE via conditions.join(' AND ') then sql.query(query, params) on neon shim. Mechanical fix. | pages/api/stock-items/stock-items-export.ts:61 |
| 36 | AT-RISK | `pages/api/suppliers/suppliers-export.ts` | COLD | COLD admin CSV export. WHERE via conditions.join(' AND ') then sql.query(query, params) on neon shim. Mechanical fix. | pages/api/suppliers/suppliers-export.ts:61 |
| 37 | AT-RISK | `pages/api/procurement/bundles/reports/usage.ts` | COLD | COLD report. Query built by concatenation with conditional AND clauses then sql.query(query, params) on neon shim. | pages/api/procurement/bundles/reports/usage.ts:76 |
| 38 | AT-RISK | `pages/api/procurement/bundles/reports/consumption.ts` | COLD | COLD report. Query built by conditional concatenation then sql.query(query, params) on neon shim. | pages/api/procurement/bundles/reports/consumption.ts:86 |
| 39 | AT-RISK | `pages/api/procurement/bundles/reports/cost-analysis.ts` | COLD | COLD report. Query built by concatenation then sql.query(query, params) on neon shim. | pages/api/procurement/bundles/reports/cost-analysis.ts:59 |
| 40 | AT-RISK | `pages/api/procurement/bundles/reports/inventory-value.ts` | COLD | COLD report. Query built by concatenation with conditional AND clauses then sql.query(query, params) on neon shim. | pages/api/procurement/bundles/reports/inventory-value.ts:55 |

> The remaining **433 TRIVIAL-MIGRATE** and **25 SAFE** files are not individually listed here — TRIVIAL files are mechanical `import { neon } from '@neondatabase/serverless'` → `import { sql } from '@/lib/db-pool'` swaps with no correctness risk, and SAFE files need no change. Full per-file classification is in the workflow result JSON.

---

## 4. Migration DAG (dependency-ordered — shared helpers first)

Migrate top-down. Each helper migrated removes the shim dependency from all its callers, making downstream route swaps mechanical.

```
neon-shim.ts  ← compatibility seam: KEEP until the very last caller is migrated (remove LAST)
   │
   ├─ db-pool.ts (TARGET, pg.Pool)  ← harden first; every fix imports from here
   │
   ├─ db-logger.ts  ★ HIGHEST LEVERAGE (56 symbols / 54 callers via codegraph)
   │     └─ de-risks BOTH BROKEN-NOW files + dozens of AT-RISK routes
   │
   ├─ lib/db/pool.js (HOT, mixed)  ← re-point @/lib/db internals off neon()
   │
   └─ service helpers → then routes (per ranked worklist)
```

| Order | File | Why it goes here | Blocks / fan-in |
|------:|------|------------------|-----------------|
| 1 | `src/lib/neon-shim.ts` | The shim root: maps @neondatabase/serverless onto pg.Pool (neon() at line 75). Every neon-tagged and db-logger caller ultimately routes through this. Already pg-safe/SAFE — do not migrate the shim itself; it is the compatibility seam that keeps un-migrated routes alive. Listed first so the DAG is anchored: it must remain stable until the LAST neon caller is gone. | All 419 neon-tagged + 54 db-logger files transitively depend on this. It is the thing being retired, so it is removed only after everything below it is migrated off it — it is the DAG root by dependency, last by removal. |
| 2 | `src/lib/db-pool.ts` | The migration TARGET: pg.Pool wrapper, pg-safe, HOT. Confirm/harden its query(text, params) contract first so every route migration is a mechanical import swap to this module. | Every BROKEN-NOW/AT-RISK file's fix imports from here. Must be proven solid before any route is moved. |
| 3 | `lib/db-logger.ts` | createLoggedSql wraps neon() and is the single highest fan-in helper — codegraph_impact shows 56 affected symbols / 54 db-logger callers (verified). It is TRIVIAL-MIGRATE (no broken fragment pattern internally) but HOT. Migrating it to wrap pg.Pool while preserving the same query()/tagged-template surface instantly de-risks 54 downstream files including the BROKEN-NOW assign-drops.ts and requirements/[requirementId].ts. | 56 symbols verified via codegraph (accounting/*, budget/*, client-pos/*, requirements/*, field/tasks/*, projects.ts getSql, activationService, documentCrossValidationService). Highest-leverage single change. |
| 4 | `lib/db/pool.js` | AT-RISK, HOT, mixed import style. Imports neon() (line 4) and exports sql=createServerlessClient(); exposes a plain function-call API sql(query, params) to @/lib/db callers, bypassing the tagged-template binding contract. Re-point its internals to pg.Pool so @/lib/db consumers inherit a safe path. | All callers of @/lib/db / the exported query() helper that pass raw query strings. Structural AT-RISK affecting an unknown set of route callers — migrate right after db-logger. |
| 5 | `src/modules/noc/services/snagGroupNotifications.ts` | neon-tagged, TRIVIAL-MIGRATE, HOT. Service-layer helper consumed by NOC routes; mechanical import swap to db-pool removes a hot shim dependency feeding multiple endpoints. | NOC notification routes that import it; HOT path, so migrate before its dependent route files. |
| 6 | `src/modules/projects/services/activationService.ts` | db-logger style, TRIVIAL-MIGRATE, WARM. Already covered by the db-logger migration but call sites should be confirmed pg-safe after the helper swap. | Projects/activation routes consuming it; depends on lib/db-logger.ts being migrated first. |
| 7 | `src/modules/projects/services/documentCrossValidationService.ts` | db-logger style, TRIVIAL-MIGRATE, WARM. Same dependency chain as activationService; verify after db-logger swap. | Document cross-validation route callers; depends on lib/db-logger.ts. |
| 8 | `src/modules/data-sync/services/eodReconciliationService.ts` | neon-tagged, TRIVIAL-MIGRATE, WARM. Shared data-sync helper; mechanical swap to db-pool. | data-sync routes and the data-sync/history.ts AT-RISK endpoint that share reconciliation logic. |
| 9 | `src/modules/construction-qa/services/sharepointSyncService.ts` | neon-tagged, TRIVIAL-MIGRATE, WARM. Construction-QA shared service; swap import to db-pool. | Construction-QA sync routes/crons consuming it. |
| 10 | `src/modules/construction-qa/services/snag-repeat-detector.ts` | neon-tagged, TRIVIAL-MIGRATE, WARM. Shared snag-detection helper feeding snag/QA routes. | Snag and resolution-report endpoints (resolution-report.ts is AT-RISK) that consume detection logic. |
| 11 | `src/services/procurement/auditService.ts` | neon-tagged, TRIVIAL-MIGRATE, WARM. Shared procurement audit helper used across the large procurement AT-RISK cluster. | Procurement routes (adjustments, bundles, cost-centers, stock-takes, purchase-orders) that log audit entries. |
| 12 | `src/services/staff/staffCreateService.ts` | neon-tagged, TRIVIAL-MIGRATE, WARM. Staff write-path helper; mechanical swap. | Staff create endpoints. |
| 13 | `src/services/staff/staffUpdateDeleteService.ts` | neon-tagged, TRIVIAL-MIGRATE, WARM. Staff update/delete helper. | Staff update/delete endpoints. |
| 14 | `src/services/procurement/import/columnDetector.ts` | neon-tagged, TRIVIAL-MIGRATE, COLD. Import-path helper; low urgency, swap when touching procurement import. | Procurement import routes. |
| 15 | `src/services/fireflies/firefliesService.ts` | neon-tagged, TRIVIAL-MIGRATE, COLD. Standalone Fireflies helper; isolated, low fan-in. | Fireflies integration routes only. |

---

## 5. Synthesis narrative

Risk posture: Only 2 files are CONFIRMED BROKEN-NOW (assign-drops.ts, requirements/[requirementId].ts) — both use the nested/ternary sql`fragment` interpolation pattern that the Neon shim cannot execute, and both are db-logger-backed and mutate data on the single shared dev+prod DB, so they should be fixed FIRST and out-of-band of the bulk migration. The original classifier's BROKEN-NOW claims for lib/db/pool.js and pages/api/field/export.ts are REFUTED on inspection: pool.js line 183 is a plain function call (not fragment interpolation), and export.ts wraps only static consts in sql.unsafe(). Both are correctly downgraded to AT-RISK. The remaining 36 AT-RISK files all share one mechanical pattern: a query string assembled by JS concatenation/array-join (parameterized $N values are safe) executed via the shim client's .query() or .unsafe() method, whose behavior is not guaranteed to match pg.Pool. None are actively broken, but all are fragile and become BROKEN-NOW the moment anyone interpolates a fragment.

Recommended sequence: (1) Hotfix the 2 BROKEN-NOW files immediately — swap to @/lib/db-pool (pg.Pool) and rewrite the conditional UPDATE/WHERE using explicit branches or COALESCE-with-scalar-null. (2) Migrate the DAG roots in dependency order: confirm src/lib/db-pool.ts (the target), then migrate lib/db-logger.ts internals to wrap pg.Pool — codegraph_impact CONFIRMS 56 affected symbols / 54 callers, the single highest-leverage change, which de-risks both BROKEN-NOW files and dozens of AT-RISK routes at once. Then re-point lib/db/pool.js (mixed, HOT) off neon(). Then migrate the WARM service helpers (snagGroupNotifications, eodReconciliationService, sharepointSyncService, snag-repeat-detector, auditService, staff services). (3) Migrate routes top-down by risk×hotness per the rankedWorklist; most are 1-line import swaps from neon to @/lib/db-pool since the .query(text, params) signature is identical. (4) Only after the last neon caller is migrated, retire src/lib/neon-shim.ts itself — it is the DAG root by dependency but MUST remain in place until the very end as the compatibility seam keeping ~400 un-migrated routes alive.

Caveats: (a) sql.unsafe() callers (budget/items.ts, snags/resolution-report.ts, field/export.ts) are the most brittle and resolution-report passes a genuinely runtime value — prioritize within their hotness tier. (b) Single shared DB means every migration PR can hit production immediately; deploy to dev first, batch small, verify via the deploy script — no manual git pull+build+restart. (c) Allowlist-validated dynamic identifiers (sort columns, photo_${type} columns) are not injection risks but still need identifier-quoting review when moved to pg.Pool. (d) Migrating db-logger.ts must preserve BOTH its query() method and tagged-template surface, since callers use both forms.

---

## 6. Method & caveats (NLNH)

- **Scout (Phase 0):** `grep`/`ripgrep` for `@neondatabase/serverless` importers + `createLoggedSql` (db-logger) consumers; multiline scan for the conditional-fragment signature; codegraph for helper fan-in. Verified no `.claude/worktrees/` or `node_modules` leakage.
- **Classify (Phase 1):** 28 agents, ~18 files each, each agent **opened every file** (no filename-only calls).
- **Verify (Phase 2):** every BROKEN-NOW/AT-RISK row was re-read by an independent agent instructed to default to *refuted*; 2 false BROKEN-NOW claims were caught and demoted.
- **Counts** in §1 are computed deterministically from the verified rows, not asserted by a model.
- **Key distinction applied throughout:** a scalar `${value}` is a safe **bound parameter**, NOT dynamic SQL. Only `${sql\`fragment\`}` / `${cond ? sql\`\` : sql\`\`}` / `sql.unsafe(variable)` / concatenated query strings count as risk.
- **Deploy caveat:** single shared dev+prod DB — every migration PR can hit production immediately. Deploy to dev first, batch small, verify via `scripts/deploy-local.sh` (never manual pull+build+restart).
- This is an **analysis artifact only** — no code was modified.
