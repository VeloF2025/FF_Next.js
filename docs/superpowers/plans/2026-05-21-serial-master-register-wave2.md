# Serial Master Register — Wave 2 Implementation Plan (UI Augmentation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Supersession notice:** This file replaces the previous Wave 2 plan from PR #1716 (merged 2026-05-21 21:03 SAST, branch `plan/wave2-ui`). The original plan scoped a 9-PR REBUILD of `/procurement/field-stock/*` with a `/legacy/*` re-mount pattern. A subsequent grill on 2026-05-21 22:50 SAST surfaced that the existing UI is in active production use by procurement staff and that Wave 1's investment can be exposed via 3 net-new pages without touching any existing surface — comparable user value at one-third the PR count and a fraction of the regression risk. The augment-first decision is recorded in the locked-decisions table below. The original plan's content is preserved in git history. The two grills crossed because the parallel-session collision check (`gh pr list --search 'wave2 in:title'`) was not run before either grill started — that's now a mandatory pre-step in §"Mandatory guardrails" below.

> **Revision history:**
> - 2026-05-21 22:50 SAST — first draft of the augment-first amendment.
> - 2026-05-22 00:10 SAST — addressed blind-review findings on PR #1720: (a) flattened the nested dynamic API route per the CLAUDE.md "no nested dynamic API routes" rule, (b) wrapped both pages in `<AppLayout>`, (c) moved shared types from `src/components/field-stock/*.types.ts` to `src/types/field-stock/` so services no longer import from components, (d) restored Playwright/Claude-in-Chrome MCP browser-smoke evidence per CLAUDE.md Hard Rule 4, (e) corrected the docker-compose test harness specifics (`tests/db/setup/docker-compose.test.yml`, env var `DATABASE_URL_TEST`), (f) added UNVERIFIED markers on `stock_serials.previous_status` + `status_changed_at` column references pending the PR-0 probe, (g) added explicit "orphaned page" discovery note to §Scope, (h) added `apiResponse.internalError` to the conventions block, (i) updated memory reference. See PR #1720 review comment for the originating issue list.

**Goal:** Augment the existing `/procurement/field-stock/*` admin UI with two new read-only pages — a master serial search and a serial lifecycle timeline — that expose the `stock_serials` register and `stock_serial_events` event log shipped in Wave 1.

**Architecture:** Two new pages added to the existing admin surface. No changes to existing pages, routes, or APIs. New API routes follow the established `withAuth` + `apiResponse` + `pg.Pool` patterns AND the CLAUDE.md "no nested dynamic API routes" rule — the timeline endpoint is FLAT (`pages/api/procurement/field-stock/serials/timeline.ts?serialNumber=…`), not `[serialNumber]/timeline.ts`. Shared types live in `src/types/field-stock/` so the service layer never imports from `src/components/`. Pages wrap in `<AppLayout>` from `@/components/layout` (matching the established pattern in `pages/procurement/field-stock/index.tsx`). Tests run against real Postgres via the Wave-1 docker-compose harness at `tests/db/setup/docker-compose.test.yml`.

**Tech Stack:** Next.js Pages Router, React 18 + TypeScript, `pg.Pool` via `@/lib/db-pool` (NOT the Neon serverless shim), `withAuth` from `@/lib/auth`, `apiResponse` from `@/lib/apiResponse`, `log` from `@/lib/logger`. Tests: Vitest + @testing-library/react for components; Vitest + real Postgres for API integration tests via `tests/db/setup/global-setup.ts` which exports `DATABASE_URL_TEST`.

**Spec reference:** `docs/superpowers/specs/2026-05-21-serial-master-register-design.md` §"UI structure" (lines 277-378) and §"Open verification items" (lines 398-410). This plan addresses only the master-search and lifecycle-timeline sections of the spec; reconciliation UI, dashboard rebuild, drill-downs, and accountability rebuild are all deferred.

---

## Scope (locked)

**In:**
- **PR-0** — Probe doc capturing prod schema + row counts + index list. Committed as `docs/superpowers/probes/2026-05-21-wave2-schema-probe.md`. Non-negotiable per Wave 1's lessons (schema drift was the #1 bug source).
- **PR-7** — Shared components: `<SerialSearch>` and `<SerialTimeline>` with unit tests. Shared types live in `src/types/field-stock/`.
- **PR-8** — `/procurement/field-stock/serials` master search page + `GET /api/procurement/field-stock/serials/search` API.
- **PR-9a** — `/procurement/field-stock/serials/[serialNumber]` lifecycle timeline page + `GET /api/procurement/field-stock/serials/timeline?serialNumber=…` API (FLAT route per CLAUDE.md rule). **Read-only.**

**Discovery note for the orphaned pages:** Both new pages are *deliberately orphaned* in this Wave — no sidebar link, no ModuleNav tab, no breadcrumb parent is added. Reason: Locked decision #2 says we don't touch existing pages, and the navigation surface lives inside existing pages. Engineers and power users will navigate by URL during Wave 2 (Hein + procurement managers know the URL pattern). If a follow-up demand surfaces, a tiny separate PR adds the link — that PR is intentionally NOT in this plan because pre-building speculative discovery for an as-yet-unproven feature is exactly the kind of scope creep this amendment exists to prevent.

**Out (deferred until proven demand):**
- **PR-9b** — Force-correct write API. Today's evidence (the 807-false-activation incident remediated via direct SQL in <2 minutes) shows the alternative works. A UI footgun without proven user demand is over-engineering. If/when a non-DBA needs to remediate state, open a separate PR with strict RBAC + audit-trail tests.
- **PR-10** — Dashboard rebuild. Existing `pages/procurement/field-stock/index.tsx` works for current users; no evidence of pain.
- **PR-11** — Reconciliation UI. The `reconcile-serials` CLI is sufficient for ops. UI only helps if non-engineers need to resolve drift.
- **PR-12, PR-13** — Per-warehouse and per-project drill-downs. Existing pages cover the use-cases.
- **PR-14, PR-15** — Pickings/movements/returns/accountability/items/locations rebuilds. All existing pages work.

**Explicitly NOT in scope:**
- Any changes to `/my/stores/*` PWA (different project, different auth surface).
- Any changes to existing `/procurement/field-stock/*` pages (augment, not replace — that's the entire reason this plan supersedes the original).
- Performance benchmarking the search endpoint (no pre-optimization). Use sensible indexes; revisit if measured slow in prod.
- New RBAC permissions (reuse existing `procurement.field-stock` key — confirmed to exist via PR-0 probe).
- A navigation link to the new pages (see "Discovery note" above).

---

## Locked decisions (do not re-litigate during execution)

| # | Decision | Source |
|---|---|---|
| 1 | Persona = procurement admins/managers, desktop. `/stock/portal` and `/my/stores/*` are out of scope. | Original plan grill + this session's grill (unchanged) |
| 2 | **Augment, not replace.** Existing pages stay untouched. No `/legacy/*` re-mount. Each new page is a greenfield route. | This session's grill (2026-05-21 22:50 SAST) — **supersedes** original plan's "hard cutover" |
| 3 | `<SerialTimeline>` ships with no pagination (66 events across 36k serials per PR-0 probe → no volume justification). | Original plan; still valid |
| 4 | **Force-correct deferred indefinitely.** Direct SQL remediation works; no UI footgun without proven demand. | This session's grill — **supersedes** original PR-9 scope |
| 5 | **Reconciliation UI deferred indefinitely.** CLI is sufficient. | This session's grill — **supersedes** original PR-11 |
| 6 | All field-stock API endpoints use `withAuth` (main app `ff_auth_token`). No new auth surface in Wave 2. | Spec + audit (unchanged) |
| 7 | Existing `pages/stock/portal.tsx`, `pages/procurement/field-stock/index.tsx`, and `pages/procurement/field-stock/reconciliation.tsx` MUST keep working through Wave 2. Not touched. | This session's grill |
| 8 | `event_type` column on `stock_serial_events` has no CHECK constraint — adding a new event type is code-only (only relevant if PR-9b is ever resurrected). | Spec line 196 |
| 9 | No migrations in this plan. PR-0 probe MUST confirm `procurement.field-stock` permission key exists; if it doesn't, the plan needs amendment. | This session's grill |
| 10 | **Pseudo entries on the timeline.** Per PR-0 probe finding (66 events / 36,264 serials → 99.82% have no events), the timeline page derives synthetic entries from `stock_serials.received_date`, `installed_date`, `activated_at_olt_id`, and `status_changed_at`. Two of those (`previous_status`, `status_changed_at`) carry UNVERIFIED markers in PR-9a's service code pending PR-0 probe confirmation. | PR-0 schema probe (2026-05-21 22:55 SAST) |
| 11 | **No nav link to the new pages in Wave 2.** Discovery by URL only (orphaned pages). See §Scope "Discovery note". | PR #1720 review (2026-05-22) — review flagged the absence; locked decision elevates the absence from "oversight" to "intentional scope cut". |
| 12 | **API routes follow the FLAT-route rule.** `pages/api/procurement/field-stock/serials/timeline.ts?serialNumber=<n>` — NOT `serials/[serialNumber]/timeline.ts`. CLAUDE.md "Flatten nested dynamic routes — they fail in Vercel" + "Use flattened routes (contractors-stages.ts not [id]/stages.ts)". | PR #1720 review (2026-05-22) — the first revision violated this. |
| 13 | **Shared types live in `src/types/field-stock/`.** Components, services, API routes, and pages all import from there. Services MUST NOT depend on `src/components/*`. | PR #1720 review (2026-05-22) — first revision had services importing from components. |
| 14 | **Pages wrap in `<AppLayout>`** from `@/components/layout` (barrel export). The existing `pages/procurement/field-stock/index.tsx` does this at line 293 — same pattern. | PR #1720 review (2026-05-22) — first revision had bare `<div>` pages. |
| 15 | **Browser smoke uses Playwright MCP (`mcp__playwriter__execute`)** with screenshots embedded in PR body. Per `feedback_browser_playwright` and CLAUDE.md Hard Rule 4. | PR #1720 review (2026-05-22) — first revision said "manual browser smoke" without evidence. |

---

## Pre-Wave-2 execution gates

These MUST be true before PR-7 enters the queue. Verify in the PR description.

- [ ] **Wave 1 has been live ≥ 48h incident-free.** Wave 1 deployed 2026-05-21 ~22:43 SAST → earliest PR-7 start is **2026-05-23 ~22:43 SAST**. Check `gh issue list --label incident --search "created:>=2026-05-21"` returns no Wave-1-related incidents.
- [ ] **`reconcile-serials` exits 0** against prod (all 6 checks at drift=0).
- [ ] **`npm run ci:quick` clean** on origin/master.
- [ ] **Lint ratchet baselines unchanged** — 77 errors / ~1833 warnings / 94 catches per memory `project_local_ci_pipeline`.
- [ ] **PR-0 probe doc merged** (the probe is its own PR — see "PR-0" section below).

---

## Mandatory guardrails (every PR)

1. **Parallel-session collision check BEFORE opening any PR** — run `gh pr list --search 'field-stock in:title' --state open`, `gh pr list --search 'serial in:title' --state open`, and `gh pr list --search 'wave2 in:title' --state open`. If another open PR touches the same surface, pause and check with Hein. **This plan exists because that check failed in PR #1716's session.** A new memory `feedback_parallel_session_collision_check` should be added covering all PR types (not just migrations); the existing `feedback_parallel_session_migration_coordination` is narrower and was incorrectly cited in the first revision of this plan.
2. **Worktree workflow** — every code PR happens in `/home/hein/Workspace/FF_Next.js-wave2-pr<N>` off `origin/master`. Hook at `~/.claude/hooks/ff-next-worktree-guard.sh` enforces this. Remove worktree after merge.
3. **Real-Postgres tests** via the docker-compose harness established in Wave 1: `tests/db/setup/docker-compose.test.yml` + `tests/db/setup/global-setup.ts` (sets env var `DATABASE_URL_TEST`). NO SQL mocking on backend changes.
4. **API responses use `apiResponse` envelope** from `@/lib/apiResponse`. Standard shapes only.
5. **Files ≤ 300 lines / components ≤ 200 lines.** Reviewer-enforced.
6. **No new `console.log`** — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage.
7. **Auth uses `withAuth`** from `@/lib/auth` on every API endpoint.
8. **Lint ratchet** — `npm run ci:quick` must show no regression against baselines.
9. **No migrations in this plan.** If a probe reveals one is needed, pick the version from `SELECT MAX(version)+1 FROM migrations` AT PUSH TIME, never branch time. See memory `feedback_migration_version_collision`.
10. **DB access via `@/lib/db-pool` (pg.Pool).** Forbidden: `@/lib/db-neon` (Neon shim — known to break conditional SQL).
11. **Production deploy** post-business-hours only (after 17:00 SAST), with Hein's explicit approval, via `bash scripts/deploy-local.sh production`.
12. **API routes are FLAT** — no nested dynamic segments. Convention: `serials/timeline.ts?serialNumber=…`, not `serials/[serialNumber]/timeline.ts`. (Page routes — `pages/procurement/field-stock/serials/[serialNumber].tsx` — are fine, the rule is API-route-specific.)
13. **Pages wrap in `<AppLayout>`** from `@/components/layout` (barrel export). Confirmed pattern: `pages/procurement/field-stock/index.tsx` wraps at line 293–349.
14. **Shared types live in `src/types/field-stock/`** — not in `src/components/`. Services MUST NOT import from `@/components/*`.
15. **Browser smoke uses Playwright MCP** (`mcp__playwriter__execute`) — screenshots per smoke step embedded in PR body. Per `feedback_browser_playwright` and CLAUDE.md Hard Rule 4.

---

## File structure

```
docs/superpowers/probes/
  2026-05-21-wave2-schema-probe.md           NEW (PR-0)

src/types/field-stock/
  index.ts                                   NEW (PR-7)  — barrel for serialFilters + timelineEntry types
  serialFilters.ts                           NEW (PR-7)  — SerialSearchFilters
  timelineEntry.ts                           NEW (PR-7)  — TimelineEntry

src/components/field-stock/
  SerialSearch.tsx                           NEW (PR-7)  — search box + filters (≤200 lines)
  SerialSearch.props.ts                      NEW (PR-7)  — SerialSearchProps (component-local; consumes shared filters from src/types/field-stock)
  SerialTimeline.tsx                         NEW (PR-7)  — timeline display (≤200 lines)
  SerialTimeline.props.ts                    NEW (PR-7)  — SerialTimelineProps (component-local)
  __tests__/SerialSearch.test.tsx            NEW (PR-7)
  __tests__/SerialTimeline.test.tsx          NEW (PR-7)

pages/api/procurement/field-stock/serials/
  search.ts                                  NEW (PR-8)  — GET search endpoint
  timeline.ts                                NEW (PR-9a) — GET timeline endpoint (FLAT, ?serialNumber=…)

src/services/field-stock/serials/
  searchSerials.ts                           NEW (PR-8)  — pg.Pool query layer (≤200 lines)
  getSerialTimeline.ts                       NEW (PR-9a) — pg.Pool query layer (≤200 lines)
  __tests__/searchSerials.test.ts            NEW (PR-8)  — real-DB integration test
  __tests__/getSerialTimeline.test.ts        NEW (PR-9a) — real-DB integration test

pages/procurement/field-stock/serials/
  index.tsx                                  NEW (PR-8)  — search page (≤200 lines), wraps <AppLayout>
  [serialNumber].tsx                         NEW (PR-9a) — timeline page (≤200 lines), wraps <AppLayout>
```

**Components NOT built** (originally in PR #1716, dropped by this amendment): `ReconciliationReport.tsx`, `StatusBadge.tsx`, `EventIcon.tsx`, `statusVocabulary.ts`, `eventVocabulary.ts`. Reason: each has zero consumers in the augment scope. Build them when a second real consumer materialises.

**No existing files are modified.** No migrations. No permission seeds.

---

## Conventions all PRs follow

**API response envelope** (`src/lib/apiResponse.ts` — existing):
```typescript
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);                       // 200
return apiResponse.badRequest(res, message);                 // 400
return apiResponse.notFound(res, kind, id);                  // 404
return apiResponse.methodNotAllowed(res, m, ['GET']);        // 405
return apiResponse.internalError(res, err);                  // 500 (used in every handler's catch block)
```

**Auth middleware** (`src/lib/auth/middleware.ts` — existing):
```typescript
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  // authReq.user available
}
export default withAuth(handler);
```

**DB access** (`@/lib/db-pool` — existing, uses `pg.Pool`):
```typescript
import { pool, sql } from '@/lib/db-pool';
// `sql` for parameterised templates with static shape
// `pool` for dynamic queries (built WHERE clauses, etc.)
```

**Layout wrapper** (existing barrel export):
```typescript
import { AppLayout } from '@/components/layout';
export default function Page() {
  return (
    <AppLayout>
      {/* page content */}
    </AppLayout>
  );
}
```

**Logger** (`@/lib/logger` — existing):
```typescript
import { log } from '@/lib/logger';
log.info('message', { contextField }, 'ComponentName');
log.error('message', { error }, 'ComponentName');
```

**RBAC gate:** All new endpoints use `withAuth`. Page-level permission check against existing `procurement.field-stock` permission. No new permission keys.

**Worktree workflow:**
```bash
git fetch origin master --quiet
git worktree add /home/hein/Workspace/FF_Next.js-wave2-pr<N> -b feat/wave2-pr<N>-<short-description> origin/master
ln -s /home/hein/Workspace/FF_Next.js/node_modules /home/hein/Workspace/FF_Next.js-wave2-pr<N>/node_modules
cd /home/hein/Workspace/FF_Next.js-wave2-pr<N>
# ...work...
gh pr create --title "..." --body "..."
# After merge:
cd /home/hein/Workspace/FF_Next.js
git worktree remove /home/hein/Workspace/FF_Next.js-wave2-pr<N>
```

---

## PR-0: Schema probe (mandatory before any code)

**Files:**
- Create: `docs/superpowers/probes/2026-05-21-wave2-schema-probe.md`

**Why this is its own PR:** Wave 1 shipped 5 follow-up migrations because seed data didn't match prod schema. Probe-first eliminates that class of bug. The probe is also the canonical reference the test-seed in PR-8/PR-9a must match.

- [ ] **Step 1: Create worktree and probe doc**

```bash
git fetch origin master --quiet
git worktree add /home/hein/Workspace/FF_Next.js-wave2-pr0 -b docs/wave2-schema-probe origin/master
ln -s /home/hein/Workspace/FF_Next.js/node_modules /home/hein/Workspace/FF_Next.js-wave2-pr0/node_modules
cd /home/hein/Workspace/FF_Next.js-wave2-pr0
mkdir -p docs/superpowers/probes
```

- [ ] **Step 2: Capture verbatim schema for every table this plan references**

DB connection: read `DATABASE_URL` from `.claude/credentials.local.md` (NEVER inline credentials in commits). Then:

```bash
psql "$DATABASE_URL" <<'SQL' > /tmp/probe-output.txt
\echo === stock_serials ===
\d stock_serials
\echo === stock_serial_events ===
\d stock_serial_events
\echo === stock_items ===
\d stock_items
\echo === stock_locations ===
\d stock_locations
\echo === projects ===
\d projects
\echo === drops ===
\d drops
\echo === oes_pp_data ===
\d oes_pp_data
\echo === users ===
\d users
\echo === staff ===
\d staff
\echo === access_permissions for procurement ===
SELECT key, label, route FROM access_permissions WHERE key LIKE 'procurement.%' ORDER BY key;
\echo === stock_serials row counts by status ===
SELECT status, COUNT(*) FROM stock_serials GROUP BY status ORDER BY 2 DESC;
\echo === stock_serial_events event_type / source_table distribution ===
SELECT event_type, source_table, COUNT(*) FROM stock_serial_events GROUP BY event_type, source_table ORDER BY 3 DESC;
\echo === stock_serial_events state transitions ===
SELECT from_state, to_state, COUNT(*) FROM stock_serial_events GROUP BY from_state, to_state ORDER BY 3 DESC;
\echo === stock_items category distribution ===
SELECT category, tracking_type, COUNT(*) FROM stock_items GROUP BY category, tracking_type ORDER BY 3 DESC;
\echo === Sample serial from Mohadin Loeks (for validation gate) ===
SELECT ss.id, ss.serial_number, ss.status, ss.mac_address, si.name, si.category, ss.installed_at_drop_number, ss.received_date
FROM stock_serials ss
JOIN stock_items si ON si.id = ss.stock_item_id
WHERE ss.installed_at_drop_number LIKE 'DR%MOH%' OR ss.received_reference ILIKE '%mohadin%' OR ss.received_reference ILIKE '%loeks%'
LIMIT 5;
\echo === Confirm pseudo-trigger columns exist (UNVERIFIED in plan) ===
SELECT column_name FROM information_schema.columns WHERE table_name='stock_serials' AND column_name IN ('previous_status','status_changed_at') ORDER BY column_name;
\echo === migrations max version ===
SELECT MAX(version) FROM migrations;
SQL
cat /tmp/probe-output.txt
```

Paste the COMPLETE output into the probe doc under a section per table. Do not abbreviate.

- [ ] **Step 3: Add interpretation section to probe doc**

Below the raw output, write a section "Interpretation for Wave 2" answering:

1. **Search-by-mac feasibility** — is there an index on `stock_serials.mac_address`? If not, what's the row count? Is ILIKE prefix-only acceptable (≤50ms expected at 36k rows) or do we need a CREATE INDEX migration? Recommendation default: defer index until measured slow in prod.
2. **Timeline emptiness** — what % of serials have ≥1 event? If <5% (probe expectation: ~0.18%), the timeline MUST surface pseudo entries from `stock_serials` columns. Locked decision #10 already commits to this.
3. **Permission key confirmation** — confirm `procurement.field-stock` exists. If not, the plan needs amendment (add a permission seed migration as a precondition).
4. **Pseudo-trigger column confirmation** — confirm `stock_serials.previous_status` AND `stock_serials.status_changed_at` exist. If either is missing, the PR-9a service code's UNVERIFIED markers need to be addressed (either by removing the corresponding pseudo entries from `getSerialTimeline`, or by adding a schema migration as a precondition).
5. **Sample serial for validation gate** — record ONE specific real serial_number from Mohadin Loeks (or another well-known import). The Wave 2 validation gate will search this serial via the UI and assert the timeline renders correctly.

- [ ] **Step 4: Commit + open PR**

```bash
git add docs/superpowers/probes/2026-05-21-wave2-schema-probe.md
git commit -m "$(cat <<'EOF'
docs(wave2): PR-0 schema probe for serial register UI augmentation

Captures verbatim prod schema for stock_serials, stock_serial_events, and
all referenced reference tables. Plus row counts by status, distinct
event_types, item category distribution, pseudo-trigger column existence
confirmation, and one Mohadin Loeks sample serial for the Wave 2
validation gate.

Per memory feedback_query_schema_before_migration — written before any
seed, test, or column reference is committed to code. This is PR-0 of
Wave 2 (UI augmentation per amended plan).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin docs/wave2-schema-probe
gh pr create --base master --title "docs(wave2): PR-0 schema probe" --body "Verbatim prod schema + row counts for Wave 2 reference tables. Doc-only PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Reviewer: sonnet via `/review`. Single reviewer (doc-only).

- [ ] **Step 5: After merge — cleanup**

```bash
cd /home/hein/Workspace/FF_Next.js
git worktree remove /home/hein/Workspace/FF_Next.js-wave2-pr0
```

---

## PR-7: Shared components (`<SerialSearch>` + `<SerialTimeline>`) + shared types

**Reviewer:** sonnet
**Dependencies:** PR-0 merged.
**Rollback:** `git revert <merge-sha>` — no consumer pages yet, zero blast radius.

**Files:**
- Create: `src/types/field-stock/index.ts`
- Create: `src/types/field-stock/serialFilters.ts`
- Create: `src/types/field-stock/timelineEntry.ts`
- Create: `src/components/field-stock/SerialSearch.tsx`
- Create: `src/components/field-stock/SerialSearch.props.ts`
- Create: `src/components/field-stock/SerialTimeline.tsx`
- Create: `src/components/field-stock/SerialTimeline.props.ts`
- Create: `src/components/field-stock/__tests__/SerialSearch.test.tsx`
- Create: `src/components/field-stock/__tests__/SerialTimeline.test.tsx`

**Public API surface (locked — PR-8 and PR-9a depend on these):**

```typescript
// src/types/field-stock/serialFilters.ts
export interface SerialSearchFilters {
  q?: string;                  // prefix match on serial_number OR mac_address
  status?: string[];           // multi-select from CHECK list
  category?: string;           // stock_items.category
  warehouseId?: string;        // current_location_id
  projectId?: string;          // allocated_to_project_id
  dropNumber?: string;         // installed_at_drop_number (exact)
  eventSince?: string;         // ISO date (reserved — not wired in v1)
  eventUntil?: string;         // ISO date (reserved — not wired in v1)
}

// src/types/field-stock/timelineEntry.ts
export type TimelineEntry =
  | {
      kind: 'event';
      id: string;
      eventType: string;
      fromState: string | null;
      toState: string | null;
      occurredAt: string;
      sourceTable: string | null;
      sourceId: string | null;
      actorName: string | null;
      payload: Record<string, unknown>;
    }
  | {
      kind: 'pseudo';
      id: string;
      label: string;
      occurredAt: string;
      description: string;
    };

// src/types/field-stock/index.ts (barrel)
export type { SerialSearchFilters } from './serialFilters';
export type { TimelineEntry } from './timelineEntry';

// src/components/field-stock/SerialSearch.props.ts
import type { SerialSearchFilters } from '@/types/field-stock';
export interface SerialSearchProps {
  initialFilters: SerialSearchFilters;
  onFiltersChange: (filters: SerialSearchFilters) => void;
  categories?: string[];
}

// src/components/field-stock/SerialTimeline.props.ts
import type { TimelineEntry } from '@/types/field-stock';
export interface SerialTimelineProps {
  entries: TimelineEntry[];   // reverse-chronological
  hasRealEvents: boolean;     // true iff any entry.kind === 'event'
}
```

### Task 7.1 — Worktree + collision check + shared types

- [ ] **Step 1: Worktree + collision check**

```bash
gh pr list --search 'field-stock in:title' --state open
gh pr list --search 'serial in:title' --state open
gh pr list --search 'wave2 in:title' --state open
# If anything appears on the same surface — pause + check with Hein.
git fetch origin master --quiet
git worktree add /home/hein/Workspace/FF_Next.js-wave2-pr7 -b feat/wave2-pr7-shared-components origin/master
ln -s /home/hein/Workspace/FF_Next.js/node_modules /home/hein/Workspace/FF_Next.js-wave2-pr7/node_modules
cd /home/hein/Workspace/FF_Next.js-wave2-pr7
```

- [ ] **Step 2: Create the shared types directory + files**

```typescript
// src/types/field-stock/serialFilters.ts
export interface SerialSearchFilters {
  q?: string;
  status?: string[];
  category?: string;
  warehouseId?: string;
  projectId?: string;
  dropNumber?: string;
  eventSince?: string;
  eventUntil?: string;
}
```

```typescript
// src/types/field-stock/timelineEntry.ts
export type TimelineEntry =
  | {
      kind: 'event';
      id: string;
      eventType: string;
      fromState: string | null;
      toState: string | null;
      occurredAt: string;
      sourceTable: string | null;
      sourceId: string | null;
      actorName: string | null;
      payload: Record<string, unknown>;
    }
  | {
      kind: 'pseudo';
      id: string;
      label: string;
      occurredAt: string;
      description: string;
    };
```

```typescript
// src/types/field-stock/index.ts
export type { SerialSearchFilters } from './serialFilters';
export type { TimelineEntry } from './timelineEntry';
```

- [ ] **Step 3: Component-local props**

```typescript
// src/components/field-stock/SerialSearch.props.ts
import type { SerialSearchFilters } from '@/types/field-stock';
export interface SerialSearchProps {
  initialFilters: SerialSearchFilters;
  onFiltersChange: (filters: SerialSearchFilters) => void;
  categories?: string[];
}
```

```typescript
// src/components/field-stock/SerialTimeline.props.ts
import type { TimelineEntry } from '@/types/field-stock';
export interface SerialTimelineProps {
  entries: TimelineEntry[];
  hasRealEvents: boolean;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/field-stock/ src/components/field-stock/SerialSearch.props.ts src/components/field-stock/SerialTimeline.props.ts
git commit -m "feat(wave2): shared field-stock types + component props (PR-7 scaffolding)"
```

### Task 7.2 — SerialSearch failing test (initial render)

- [ ] **Step 1: Write test**

```typescript
// src/components/field-stock/__tests__/SerialSearch.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SerialSearch } from '../SerialSearch';

describe('SerialSearch', () => {
  it('renders search input prefilled from initialFilters.q', () => {
    render(
      <SerialSearch
        initialFilters={{ q: 'SN-12345' }}
        onFiltersChange={vi.fn()}
      />
    );
    const input = screen.getByRole('searchbox', { name: /serial or mac/i }) as HTMLInputElement;
    expect(input.value).toBe('SN-12345');
  });
});
```

- [ ] **Step 2: Run, expect failure (module not found)**

```bash
npx vitest run src/components/field-stock/__tests__/SerialSearch.test.tsx
```

### Task 7.3 — Minimal SerialSearch implementation

- [ ] **Step 1: Implement**

```typescript
// src/components/field-stock/SerialSearch.tsx
import { useState, useEffect, useRef } from 'react';
import type { SerialSearchFilters } from '@/types/field-stock';
import type { SerialSearchProps } from './SerialSearch.props';

const DEBOUNCE_MS = 300;

// Mirrors stock_serials.status CHECK constraint exactly.
// Keep in sync with PR-0 probe doc (the CHECK list is the authority).
const STATUS_OPTIONS = [
  'available',
  'reserved',
  'allocated_to_project',
  'in_transit',
  'issued',
  'installed',
  'activated',
  'faulty',
  'in_repair',
  'returned',
  'scrapped',
] as const;

function toggleStatus(prev: string[] | undefined, value: string): string[] {
  const set = new Set(prev ?? []);
  if (set.has(value)) set.delete(value); else set.add(value);
  return Array.from(set);
}

export function SerialSearch({ initialFilters, onFiltersChange, categories = [] }: SerialSearchProps) {
  const [filters, setFilters] = useState<SerialSearchFilters>(initialFilters);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onFiltersChange(filters), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, onFiltersChange]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        aria-label="Serial or MAC"
        placeholder="Serial number or MAC…"
        value={filters.q ?? ''}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined }))}
        className="w-full rounded border px-3 py-2"
      />
      <fieldset className="space-y-1">
        <legend className="text-xs uppercase text-neutral-500">Status</legend>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((s) => (
            <label key={s} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                aria-label={s}
                checked={(filters.status ?? []).includes(s)}
                onChange={() => setFilters((f) => ({ ...f, status: toggleStatus(f.status, s) }))}
              />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        <span className="text-xs uppercase text-neutral-500">Category</span>
        <select
          aria-label="Category"
          value={filters.category ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}
          className="mt-1 block w-full rounded border px-2 py-1"
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Run tests, expect PASS**

```bash
npx vitest run src/components/field-stock/__tests__/SerialSearch.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/field-stock/SerialSearch.tsx src/components/field-stock/__tests__/SerialSearch.test.tsx
git commit -m "feat(wave2): SerialSearch component with debounced filters"
```

### Task 7.4 — SerialSearch debounce + status + category tests

- [ ] **Step 1: Append tests**

```typescript
// Append to src/components/field-stock/__tests__/SerialSearch.test.tsx
import { fireEvent } from '@testing-library/react';

describe('SerialSearch debounce', () => {
  it('fires onFiltersChange once after 300ms of no typing', async () => {
    vi.useFakeTimers();
    const onFiltersChange = vi.fn();
    render(<SerialSearch initialFilters={{}} onFiltersChange={onFiltersChange} />);
    const input = screen.getByRole('searchbox') as HTMLInputElement;

    await vi.advanceTimersByTimeAsync(300);
    onFiltersChange.mockClear();

    fireEvent.change(input, { target: { value: 'SN-1' } });
    fireEvent.change(input, { target: { value: 'SN-12' } });
    await vi.advanceTimersByTimeAsync(150);
    expect(onFiltersChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith({ q: 'SN-12' });
    vi.useRealTimers();
  });
});

describe('SerialSearch status multi-select', () => {
  it('toggles status filter values', async () => {
    vi.useFakeTimers();
    const onFiltersChange = vi.fn();
    render(<SerialSearch initialFilters={{}} onFiltersChange={onFiltersChange} />);
    await vi.advanceTimersByTimeAsync(300);
    onFiltersChange.mockClear();

    fireEvent.click(screen.getByRole('checkbox', { name: /available/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /installed/i }));
    await vi.advanceTimersByTimeAsync(300);

    expect(onFiltersChange).toHaveBeenLastCalledWith({ status: ['available', 'installed'] });
    vi.useRealTimers();
  });
});

describe('SerialSearch category', () => {
  it('renders categories from prop', () => {
    render(<SerialSearch initialFilters={{}} onFiltersChange={vi.fn()} categories={['ONT', 'GIZZU']} />);
    const select = screen.getByRole('combobox', { name: /category/i }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'ONT', 'GIZZU']);
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/components/field-stock/__tests__/SerialSearch.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/field-stock/__tests__/SerialSearch.test.tsx
git commit -m "test(wave2): SerialSearch debounce + status + category coverage"
```

### Task 7.5 — SerialTimeline empty-state failing test

- [ ] **Step 1: Failing test**

```typescript
// src/components/field-stock/__tests__/SerialTimeline.test.tsx
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SerialTimeline } from '../SerialTimeline';

describe('SerialTimeline', () => {
  it('renders empty state when entries is empty', () => {
    render(<SerialTimeline entries={[]} hasRealEvents={false} />);
    expect(screen.getByText(/no lifecycle data recorded/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run src/components/field-stock/__tests__/SerialTimeline.test.tsx
```

### Task 7.6 — SerialTimeline implementation

- [ ] **Step 1: Implement**

```typescript
// src/components/field-stock/SerialTimeline.tsx
import { useState } from 'react';
import type { TimelineEntry } from '@/types/field-stock';
import type { SerialTimelineProps } from './SerialTimeline.props';

export function SerialTimeline({ entries, hasRealEvents }: SerialTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded border border-neutral-700 bg-neutral-900 p-6 text-center text-sm text-neutral-400">
        No lifecycle data recorded for this serial yet.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {!hasRealEvents && (
        <div className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          No events recorded in the event log — showing inferred history from the serial record.
        </div>
      )}
      <ol className="space-y-2">
        {entries.map((entry) => <TimelineRow key={entry.id} entry={entry} />)}
      </ol>
    </div>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  if (entry.kind === 'pseudo') {
    return (
      <li className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-neutral-200">{entry.label}</span>
          <time className="text-xs text-neutral-500" dateTime={entry.occurredAt}>
            {new Date(entry.occurredAt).toISOString().slice(0, 19).replace('T', ' ')}
          </time>
        </div>
        <p className="mt-1 text-xs text-neutral-400">{entry.description}</p>
      </li>
    );
  }
  return (
    <li className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-neutral-200">{entry.eventType}</span>
        <time className="text-xs text-neutral-500" dateTime={entry.occurredAt}>
          {new Date(entry.occurredAt).toISOString().slice(0, 19).replace('T', ' ')}
        </time>
      </div>
      {(entry.fromState || entry.toState) && (
        <p className="mt-1 text-xs text-neutral-400">
          {entry.fromState ?? '∅'} → {entry.toState ?? '∅'}
        </p>
      )}
      {entry.actorName && <p className="mt-0.5 text-xs text-neutral-500">by {entry.actorName}</p>}
      {Object.keys(entry.payload).length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-blue-400 hover:underline"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide payload' : 'Show payload'}
        >
          {expanded ? '▾ Payload' : '▸ Payload'}
        </button>
      )}
      {expanded && (
        <pre className="mt-1 overflow-x-auto rounded bg-neutral-950 p-2 text-xs text-neutral-300">
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/components/field-stock/__tests__/SerialTimeline.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/field-stock/SerialTimeline.tsx src/components/field-stock/__tests__/SerialTimeline.test.tsx
git commit -m "feat(wave2): SerialTimeline component with empty + event + pseudo rendering"
```

### Task 7.7 — SerialTimeline event + pseudo + payload tests + finish PR-7

- [ ] **Step 1: Append tests**

```typescript
// Append to src/components/field-stock/__tests__/SerialTimeline.test.tsx
describe('SerialTimeline event row', () => {
  it('renders event_type, state transition, actor, timestamp', () => {
    render(
      <SerialTimeline
        hasRealEvents={true}
        entries={[
          {
            kind: 'event',
            id: 'evt-1',
            eventType: 'activated',
            fromState: 'installed',
            toState: 'activated',
            occurredAt: '2026-05-20T10:30:00Z',
            sourceTable: 'oes_pp_data',
            sourceId: 'src-1',
            actorName: 'Hein van Vuuren',
            payload: { resolution_status: 'activated' },
          },
        ]}
      />
    );
    expect(screen.getByText('activated')).toBeInTheDocument();
    expect(screen.getByText(/installed → activated/i)).toBeInTheDocument();
    expect(screen.getByText(/Hein van Vuuren/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-20 10:30/)).toBeInTheDocument();
  });

  it('toggles payload visibility on click', () => {
    render(
      <SerialTimeline
        hasRealEvents={true}
        entries={[
          {
            kind: 'event',
            id: 'evt-1',
            eventType: 'installed_at_drop',
            fromState: 'issued',
            toState: 'installed',
            occurredAt: '2026-05-20T10:30:00Z',
            sourceTable: 'drops',
            sourceId: 'drop-1',
            actorName: null,
            payload: { drop_number: 'DR0001MOH' },
          },
        ]}
      />
    );
    expect(screen.queryByText(/DR0001MOH/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show payload/i }));
    expect(screen.getByText(/DR0001MOH/)).toBeInTheDocument();
  });
});

describe('SerialTimeline pseudo row', () => {
  it('renders pseudo entries with label + description', () => {
    render(
      <SerialTimeline
        hasRealEvents={false}
        entries={[
          {
            kind: 'pseudo',
            id: 'pseudo-received',
            label: 'Received into stock',
            occurredAt: '2026-04-01T00:00:00Z',
            description: 'Inferred from stock_serials.received_date',
          },
        ]}
      />
    );
    expect(screen.getByText('Received into stock')).toBeInTheDocument();
    expect(screen.getByText(/Inferred from stock_serials/i)).toBeInTheDocument();
    expect(screen.getByText(/No events recorded in the event log/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect PASS**

```bash
npx vitest run src/components/field-stock/__tests__/SerialTimeline.test.tsx
```

- [ ] **Step 3: Lint, commit, push, PR**

```bash
git add src/components/field-stock/__tests__/SerialTimeline.test.tsx
git commit -m "test(wave2): SerialTimeline event + pseudo + payload coverage"

npm run ci:quick

git push -u origin feat/wave2-pr7-shared-components
gh pr create --base master --title "feat(wave2): PR-7 SerialSearch + SerialTimeline components + shared types" --body "## Summary
Shared components + types for the Wave 2 augmentation:
- \\\`src/types/field-stock/\\\` — \\\`SerialSearchFilters\\\` + \\\`TimelineEntry\\\` (services/components/API routes all consume from here; services must NOT import from \\\`@/components/*\\\`)
- \\\`<SerialSearch>\\\` — search input + debounced filter changes + status multi-select + category
- \\\`<SerialTimeline>\\\` — reverse-chrono event log with pseudo-entry rendering for serials with no event-log entries (99%+ of prod per PR-0)

## Scope
Library code. No consumers in this PR — PR-8 (/serials search page) and PR-9a (/serials/[serialNumber] timeline page) consume them. No pages, so no \\\`<AppLayout>\\\` to wrap.

## Test plan
- [ ] \\\`npm run ci:quick\\\` passes
- [ ] \\\`npx vitest run src/components/field-stock\\\` all green
- [ ] Browser smoke N/A — no pages in this PR. PR-8 and PR-9a smoke the components in their natural habitat.

## Rollback
\\\`git revert <merge-sha>\\\` — no consumers, zero blast radius.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Blind review via `/review` (single sonnet reviewer)**

- [ ] **Step 5: After merge — cleanup**

```bash
cd /home/hein/Workspace/FF_Next.js
git worktree remove /home/hein/Workspace/FF_Next.js-wave2-pr7
```

---

## PR-8: `/procurement/field-stock/serials` master search

**Reviewer:** sonnet
**Dependencies:** PR-7 merged.
**Rollback:** `git revert <merge-sha>` + redeploy. No DB changes.

**Files:**
- Create: `src/services/field-stock/serials/searchSerials.ts`
- Create: `src/services/field-stock/serials/__tests__/searchSerials.test.ts`
- Create: `pages/api/procurement/field-stock/serials/search.ts`
- Create: `pages/procurement/field-stock/serials/index.tsx`

**API contract:**

```typescript
// GET /api/procurement/field-stock/serials/search?q=&status=&category=&warehouseId=&projectId=&dropNumber=&page=&pageSize=
// FLAT route — no nested dynamic segments. Per CLAUDE.md and Locked decision #12.
// Response (apiResponse.success envelope):
interface SearchResponse {
  rows: Array<{
    id: string;
    serialNumber: string;
    macAddress: string | null;
    category: string | null;
    itemName: string | null;
    status: string;
    currentLocationName: string | null;
    allocatedProjectName: string | null;
    installedAtDropNumber: string | null;
    lastEventType: string | null;
    lastEventAt: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;  // clamped to max 200
}
```

### Task 8.1 — Worktree + integration test seed

- [ ] **Step 1: Worktree + collision check**

```bash
gh pr list --search 'field-stock in:title' --state open
gh pr list --search 'serial in:title' --state open
gh pr list --search 'wave2 in:title' --state open
git fetch origin master --quiet
git worktree add /home/hein/Workspace/FF_Next.js-wave2-pr8 -b feat/wave2-pr8-serials-search origin/master
ln -s /home/hein/Workspace/FF_Next.js/node_modules /home/hein/Workspace/FF_Next.js-wave2-pr8/node_modules
cd /home/hein/Workspace/FF_Next.js-wave2-pr8
```

- [ ] **Step 2: Boot the Wave-1 docker-compose test harness**

The harness is at `tests/db/setup/docker-compose.test.yml`. Global setup at `tests/db/setup/global-setup.ts` spins it up and exports env var `DATABASE_URL_TEST`. Run:

```bash
# One-time per shell session:
docker compose -f tests/db/setup/docker-compose.test.yml up -d
# Then run vitest with the global-setup wired (per existing vitest config):
npx vitest run src/services/field-stock/serials
```

If `vitest.config.ts` does not already register `tests/db/setup/global-setup.ts` for this path, EITHER (a) wire it as a `globalSetup` for the new test files OR (b) read `DATABASE_URL_TEST` from the env yourself. The Wave-1 harness convention is (a); follow it.

- [ ] **Step 3: Write failing integration test**

Create `src/services/field-stock/serials/__tests__/searchSerials.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { searchSerials } from '../searchSerials';

const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL) throw new Error('DATABASE_URL_TEST not set — boot tests/db/setup/docker-compose.test.yml first');
const pool = new Pool({ connectionString: TEST_URL });

const ITEM_ONT = '11111111-1111-1111-1111-111111111111';
const ITEM_GIZZU = '22222222-2222-2222-2222-222222222222';
const WAREHOUSE = '33333333-3333-3333-3333-333333333333';
const PROJECT = '44444444-4444-4444-4444-444444444444';

beforeAll(async () => {
  await pool.query('TRUNCATE stock_serial_events, stock_serials, stock_items, stock_locations, projects RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type) VALUES
       ($1, 'FT-ONT-01', 'Fibertime ONT', 'ONT', 'serial'),
       ($2, 'FT-GIZZU-01', 'Fibertime Gizzu', 'GIZZU', 'serial')`,
    [ITEM_ONT, ITEM_GIZZU]
  );
  await pool.query(`INSERT INTO stock_locations (id, name, location_type) VALUES ($1, 'Wadeville WH', 'warehouse')`, [WAREHOUSE]);
  await pool.query(`INSERT INTO projects (id, name) VALUES ($1, 'Mohadin Loeks')`, [PROJECT]);
  await pool.query(
    `INSERT INTO stock_serials (id, stock_item_id, serial_number, mac_address, status, current_location_id, allocated_to_project_id) VALUES
       (gen_random_uuid(), $1, 'SN-AVAIL-01', 'AA:BB:CC:00:00:01', 'available', $3, NULL),
       (gen_random_uuid(), $1, 'SN-AVAIL-02', NULL,               'available', $3, $4),
       (gen_random_uuid(), $1, 'SN-INST-01',  'AA:BB:CC:00:00:02', 'installed', NULL, $4),
       (gen_random_uuid(), $1, 'SN-ACT-01',   'AA:BB:CC:00:00:03', 'activated', NULL, $4),
       (gen_random_uuid(), $2, 'SN-GIZZU-01', NULL,               'available', $3, NULL),
       -- Negative-case rows (must be EXCLUDED by status / category / project filters):
       (gen_random_uuid(), $1, 'SN-ISSUED-01','AA:BB:CC:00:00:04', 'issued',   NULL, NULL),
       (gen_random_uuid(), $1, 'SN-FAULTY-01',NULL,               'faulty',   NULL, NULL),
       (gen_random_uuid(), $1, 'SN-RETURNED-01', NULL,            'returned', NULL, NULL),
       (gen_random_uuid(), $1, 'SN-SCRAPPED-01', NULL,            'scrapped', NULL, NULL)`,
    [ITEM_ONT, ITEM_GIZZU, WAREHOUSE, PROJECT]
  );
});

afterAll(async () => { await pool.end(); });

describe('searchSerials', () => {
  it('returns all serials with default pagination when no filters', async () => {
    const result = await searchSerials({}, { page: 1, pageSize: 50 });
    expect(result.total).toBe(9);
    expect(result.rows.length).toBe(9);
  });
  it('filters by free-text on serial_number (prefix)', async () => {
    const result = await searchSerials({ q: 'SN-AVAIL' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(2);
    expect(result.rows.map((r) => r.serialNumber).sort()).toEqual(['SN-AVAIL-01', 'SN-AVAIL-02']);
  });
  it('filters by mac_address (prefix)', async () => {
    const result = await searchSerials({ q: 'AA:BB:CC:00:00:01' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(1);
    expect(result.rows[0].serialNumber).toBe('SN-AVAIL-01');
  });
  it('filters by status (multi-select), excluding negative-case rows', async () => {
    const result = await searchSerials({ status: ['available', 'installed'] }, { page: 1, pageSize: 50 });
    const got = result.rows.map((r) => r.serialNumber).sort();
    expect(got).toEqual(['SN-AVAIL-01', 'SN-AVAIL-02', 'SN-GIZZU-01', 'SN-INST-01']);
    expect(got).not.toContain('SN-ISSUED-01');
    expect(got).not.toContain('SN-FAULTY-01');
    expect(got).not.toContain('SN-ACT-01');
    expect(got).not.toContain('SN-RETURNED-01');
    expect(got).not.toContain('SN-SCRAPPED-01');
  });
  it('filters by category', async () => {
    const result = await searchSerials({ category: 'GIZZU' }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(1);
    expect(result.rows[0].serialNumber).toBe('SN-GIZZU-01');
  });
  it('filters by projectId', async () => {
    const result = await searchSerials({ projectId: PROJECT }, { page: 1, pageSize: 50 });
    expect(result.total).toBe(3);
    expect(result.rows.every((r) => r.allocatedProjectName === 'Mohadin Loeks')).toBe(true);
  });
  it('paginates correctly', async () => {
    const p1 = await searchSerials({}, { page: 1, pageSize: 5 });
    const p2 = await searchSerials({}, { page: 2, pageSize: 5 });
    expect(p1.total).toBe(9);
    expect(p1.rows.length).toBe(5);
    expect(p2.rows.length).toBe(4);
    expect(p1.rows.map((r) => r.id)).not.toEqual(p2.rows.map((r) => r.id));
  });
  it('clamps pageSize to max 200', async () => {
    const result = await searchSerials({}, { page: 1, pageSize: 99999 });
    expect(result.pageSize).toBe(200);
  });
});
```

- [ ] **Step 4: Run, expect failure**

```bash
npx vitest run src/services/field-stock/serials/__tests__/searchSerials.test.ts
```

### Task 8.2 — Implement `searchSerials`

- [ ] **Step 1: Confirm `@/lib/db-pool` exports `pool`**

```bash
grep "^export" src/lib/db-pool.ts
```
If only `sql` is exported, add `export { pool }` (or the existing pool name) as a single-line change in this PR. Otherwise skip.

- [ ] **Step 2: Implement service**

Create `src/services/field-stock/serials/searchSerials.ts`:

```typescript
import { pool } from '@/lib/db-pool';
import type { SerialSearchFilters } from '@/types/field-stock';

export interface SearchPagination { page: number; pageSize: number; }

export interface SerialSearchRow {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
}

export interface SerialSearchResult {
  rows: SerialSearchRow[];
  total: number;
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 200;

export async function searchSerials(
  filters: SerialSearchFilters,
  pagination: SearchPagination
): Promise<SerialSearchResult> {
  const pageSize = Math.min(Math.max(1, pagination.pageSize), MAX_PAGE_SIZE);
  const page = Math.max(1, pagination.page);
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [];
  const conds: string[] = [];
  if (filters.q) {
    params.push(`${filters.q}%`);
    conds.push(`(ss.serial_number ILIKE $${params.length} OR ss.mac_address ILIKE $${params.length})`);
  }
  if (filters.status && filters.status.length > 0) {
    params.push(filters.status);
    conds.push(`ss.status = ANY($${params.length}::text[])`);
  }
  if (filters.category) {
    params.push(filters.category);
    conds.push(`si.category = $${params.length}`);
  }
  if (filters.warehouseId) {
    params.push(filters.warehouseId);
    conds.push(`ss.current_location_id = $${params.length}`);
  }
  if (filters.projectId) {
    params.push(filters.projectId);
    conds.push(`ss.allocated_to_project_id = $${params.length}`);
  }
  if (filters.dropNumber) {
    params.push(filters.dropNumber);
    conds.push(`ss.installed_at_drop_number = $${params.length}`);
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const baseFrom = `
    FROM stock_serials ss
    LEFT JOIN stock_items si ON si.id = ss.stock_item_id
    LEFT JOIN stock_locations sl ON sl.id = ss.current_location_id
    LEFT JOIN projects p ON p.id = ss.allocated_to_project_id
    LEFT JOIN LATERAL (
      SELECT event_type, occurred_at
      FROM stock_serial_events sse
      WHERE sse.serial_id = ss.id
      ORDER BY occurred_at DESC
      LIMIT 1
    ) le ON true
  `;
  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count ${baseFrom} ${where}`,
    params
  );
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

  const dataRes = await pool.query<{
    id: string; serial_number: string; mac_address: string | null;
    category: string | null; item_name: string | null; status: string;
    location_name: string | null; project_name: string | null;
    drop_number: string | null; last_event_type: string | null; last_event_at: string | null;
  }>(
    `
    SELECT
      ss.id, ss.serial_number, ss.mac_address,
      si.category, si.name AS item_name,
      ss.status, sl.name AS location_name, p.name AS project_name,
      ss.installed_at_drop_number AS drop_number,
      le.event_type AS last_event_type, le.occurred_at AS last_event_at
    ${baseFrom} ${where}
    ORDER BY ss.created_at DESC, ss.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `,
    [...params, pageSize, offset]
  );

  return {
    rows: dataRes.rows.map((r) => ({
      id: r.id,
      serialNumber: r.serial_number,
      macAddress: r.mac_address,
      category: r.category,
      itemName: r.item_name,
      status: r.status,
      currentLocationName: r.location_name,
      allocatedProjectName: r.project_name,
      installedAtDropNumber: r.drop_number,
      lastEventType: r.last_event_type,
      lastEventAt: r.last_event_at,
    })),
    total, page, pageSize,
  };
}
```

- [ ] **Step 3: Run, expect PASS, commit**

```bash
npx vitest run src/services/field-stock/serials/__tests__/searchSerials.test.ts
git add src/services/field-stock/serials/searchSerials.ts src/services/field-stock/serials/__tests__/searchSerials.test.ts
git commit -m "feat(wave2): searchSerials service with real-DB integration tests + negative-case seeds"
```

### Task 8.3 — API route

- [ ] **Step 1: Create `pages/api/procurement/field-stock/serials/search.ts`** (FLAT — already a non-dynamic route, satisfies Guardrail #12)

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { searchSerials } from '@/services/field-stock/serials/searchSerials';
import type { SerialSearchFilters } from '@/types/field-stock';

function parseFilters(query: NextApiRequest['query']): SerialSearchFilters {
  const f: SerialSearchFilters = {};
  if (typeof query.q === 'string' && query.q.trim()) f.q = query.q.trim();
  if (typeof query.status === 'string' && query.status.length > 0) {
    f.status = query.status.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof query.category === 'string' && query.category) f.category = query.category;
  if (typeof query.warehouseId === 'string' && query.warehouseId) f.warehouseId = query.warehouseId;
  if (typeof query.projectId === 'string' && query.projectId) f.projectId = query.projectId;
  if (typeof query.dropNumber === 'string' && query.dropNumber) f.dropNumber = query.dropNumber;
  return f;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  try {
    const filters = parseFilters(req.query);
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : 1;
    const pageSize = typeof req.query.pageSize === 'string' ? parseInt(req.query.pageSize, 10) : 50;
    const result = await searchSerials(filters, { page, pageSize });
    return apiResponse.success(res, result);
  } catch (err) {
    log.error('search serials failed', { err: err instanceof Error ? err.message : String(err) }, 'SerialSearchAPI');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
```

- [ ] **Step 2: Commit**

```bash
git add pages/api/procurement/field-stock/serials/search.ts
git commit -m "feat(wave2): GET /api/procurement/field-stock/serials/search route"
```

### Task 8.4 — Search page (wrapped in `<AppLayout>`)

- [ ] **Step 1: Create page**

Create `pages/procurement/field-stock/serials/index.tsx`:

```typescript
import { useEffect, useState, useCallback } from 'react';
import type { GetServerSideProps, NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AppLayout } from '@/components/layout';
import { SerialSearch } from '@/components/field-stock/SerialSearch';
import type { SerialSearchFilters } from '@/types/field-stock';

interface ServerRow {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
}

interface PageProps { initialFilters: SerialSearchFilters; }

function filtersToQuery(f: SerialSearchFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.q) q.q = f.q;
  if (f.status && f.status.length > 0) q.status = f.status.join(',');
  if (f.category) q.category = f.category;
  if (f.warehouseId) q.warehouseId = f.warehouseId;
  if (f.projectId) q.projectId = f.projectId;
  if (f.dropNumber) q.dropNumber = f.dropNumber;
  return q;
}

function queryToFilters(q: Record<string, string | string[] | undefined>): SerialSearchFilters {
  const get = (k: string): string | undefined => {
    const v = q[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    q: get('q'),
    status: get('status')?.split(',').filter(Boolean),
    category: get('category'),
    warehouseId: get('warehouseId'),
    projectId: get('projectId'),
    dropNumber: get('dropNumber'),
  };
}

const SerialsSearchPage: NextPage<PageProps> = ({ initialFilters }) => {
  const router = useRouter();
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async (filters: SerialSearchFilters) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(filtersToQuery(filters));
      const res = await fetch(`/api/procurement/field-stock/serials/search?${params}`, { credentials: 'include' });
      const env = await res.json();
      if (!env.success) { setError(env.error?.message ?? 'Search failed'); return; }
      setRows(env.data.rows);
      setTotal(env.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const filters = queryToFilters(router.query);
    void fetchResults(filters);
  }, [router.query, fetchResults]);

  const onFiltersChange = useCallback((filters: SerialSearchFilters) => {
    void router.replace(
      { pathname: '/procurement/field-stock/serials', query: filtersToQuery(filters) },
      undefined,
      { shallow: true }
    );
  }, [router]);

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold">Serial register</h1>
        <SerialSearch initialFilters={initialFilters} onFiltersChange={onFiltersChange} />
        {error && <div className="mt-4 rounded bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
        <div className="mt-4 text-sm text-neutral-400">
          {loading ? 'Loading…' : `${total} result${total === 1 ? '' : 's'}`}
        </div>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-neutral-500">
              <th className="px-2 py-1">Serial</th>
              <th className="px-2 py-1">Category</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Location</th>
              <th className="px-2 py-1">Project</th>
              <th className="px-2 py-1">Last event</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="px-2 py-1">
                  <Link
                    href={`/procurement/field-stock/serials/${encodeURIComponent(r.serialNumber)}`}
                    className="text-blue-400 hover:underline"
                  >
                    {r.serialNumber}
                  </Link>
                  {r.macAddress && <div className="text-xs text-neutral-500">{r.macAddress}</div>}
                </td>
                <td className="px-2 py-1">{r.category ?? '—'}</td>
                <td className="px-2 py-1">{r.status}</td>
                <td className="px-2 py-1">{r.currentLocationName ?? r.installedAtDropNumber ?? '—'}</td>
                <td className="px-2 py-1">{r.allocatedProjectName ?? '—'}</td>
                <td className="px-2 py-1">
                  {r.lastEventType ?? '—'}
                  {r.lastEventAt && (
                    <div className="text-xs text-neutral-500">{new Date(r.lastEventAt).toISOString().slice(0, 10)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => ({
  props: { initialFilters: queryToFilters(ctx.query) },
});

export default SerialsSearchPage;
```

- [ ] **Step 2: Lint + commit + push + PR + review + merge + cleanup (with Playwright browser smoke)**

```bash
npm run ci:quick
git add pages/procurement/field-stock/serials/index.tsx
git commit -m "feat(wave2): /procurement/field-stock/serials master search page (AppLayout-wrapped)"
git push -u origin feat/wave2-pr8-serials-search
```

**Browser smoke (mandatory before PR open — per Guardrail #15):**
1. Run dev server in worktree: `PORT=3004 npm run dev`.
2. Drive the browser via `mcp__playwriter__execute`:
   - Navigate to `http://localhost:3004/procurement/field-stock/serials`
   - Screenshot 1: empty search page, AppLayout sidebar+navbar visible.
   - Type a known serial prefix into the search input (use PR-0 probe's Mohadin sample).
   - Screenshot 2: result row appears within 600ms, AppLayout still wrapping.
   - Click the serial number link.
   - Screenshot 3: 404 page (PR-9a not shipped yet) — or detail page if PR-9a already merged.
3. Embed all three screenshots in the PR body BEFORE opening review.

```bash
gh pr create --base master --title "feat(wave2): PR-8 /serials master search + API" --body "## Summary
- New API: GET /api/procurement/field-stock/serials/search with filter + pagination (FLAT route)
- New page: /procurement/field-stock/serials — searchable serial register, URL-state filters, click-through to detail. Wraps <AppLayout>.
- Service layer with real-DB integration tests + negative-case seeds via tests/db/setup/docker-compose.test.yml

## Test plan
- [ ] \\\`npm run ci:quick\\\` passes
- [ ] Integration tests: \\\`docker compose -f tests/db/setup/docker-compose.test.yml up -d && npx vitest run src/services/field-stock/serials\\\`
- [ ] Browser smoke screenshots (3 above) embedded; Playwright MCP used per Guardrail #15

## Rollback
\\\`git revert <merge-sha>\\\` + redeploy. No DB changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

# After review APPROVED + GHA CI green:
gh pr merge <N> --merge --delete-branch
cd /home/hein/Workspace/FF_Next.js
git worktree remove /home/hein/Workspace/FF_Next.js-wave2-pr8
```

---

## PR-9a: `/procurement/field-stock/serials/[serialNumber]` lifecycle timeline (read-only)

**Reviewer:** sonnet
**Dependencies:** PR-7 merged, PR-8 merged.
**Rollback:** `git revert <merge-sha>` + redeploy. No DB changes.

**Files:**
- Create: `src/services/field-stock/serials/getSerialTimeline.ts`
- Create: `src/services/field-stock/serials/__tests__/getSerialTimeline.test.ts`
- Create: `pages/api/procurement/field-stock/serials/timeline.ts` (FLAT — no nested dynamic)
- Create: `pages/procurement/field-stock/serials/[serialNumber].tsx` (page-level dynamic is allowed; API-level is not)

**API contract:**

```typescript
// GET /api/procurement/field-stock/serials/timeline?serialNumber=<n>
// FLAT route per Locked decision #12. Page receives the serialNumber via route param
// and forwards it as a query string to this flat API.
// Response (apiResponse.success):
interface TimelineResponse {
  serial: {
    id: string;
    serialNumber: string;
    macAddress: string | null;
    category: string | null;
    itemName: string | null;
    status: string;
    currentLocationName: string | null;
    allocatedProjectName: string | null;
    installedAtDropNumber: string | null;
    installedDate: string | null;
    receivedDate: string | null;
    activatedAtOltId: string | null;
  };
  entries: TimelineEntry[];   // reverse-chrono mix of 'event' + 'pseudo'
  hasRealEvents: boolean;
}
```

**Pseudo entry derivation rules** (per Locked decision #10):

| Source on `stock_serials` | Emit pseudo when... | Label | Description |
|---|---|---|---|
| `received_date IS NOT NULL` | Always | "Received into stock" | "Inferred from stock_serials.received_date" |
| `installed_date IS NOT NULL AND status IN ('installed','activated')` | No real `installed_at_drop` event exists | "Installed at drop" | `Drop ${installed_at_drop_number ?? 'unknown'} — inferred from stock_serials.installed_date` |
| `activated_at_olt_id IS NOT NULL AND status='activated'` | No real `activated` event exists | "Activated on OLT" | `OLT ${activated_at_olt_id} — inferred from stock_serials.activated_at_olt_id` |
| `status_changed_at IS NOT NULL AND previous_status IS NOT NULL AND previous_status != status` | No real events at all | "Status changed" | `${previous_status} → ${status}` |

**UNVERIFIED columns:** `stock_serials.previous_status` and `stock_serials.status_changed_at` are referenced by the fourth pseudo rule. PR-0 probe step 2 must confirm both exist. If either is missing, the fourth pseudo rule + its test case + its code block must be removed (the other three pseudo rules use columns whose existence the Wave-1 spec already confirms).

Pseudo entries emitted ONLY when no real event covers the same fact (avoid duplication).

### Task 9a.1 — Worktree + failing integration test

- [ ] **Step 1: Worktree + collisions**

```bash
gh pr list --search 'serial in:title' --state open
gh pr list --search 'timeline in:title' --state open
gh pr list --search 'wave2 in:title' --state open
git fetch origin master --quiet
git worktree add /home/hein/Workspace/FF_Next.js-wave2-pr9a -b feat/wave2-pr9a-serial-timeline origin/master
ln -s /home/hein/Workspace/FF_Next.js/node_modules /home/hein/Workspace/FF_Next.js-wave2-pr9a/node_modules
cd /home/hein/Workspace/FF_Next.js-wave2-pr9a
```

- [ ] **Step 2: Write failing test**

Create `src/services/field-stock/serials/__tests__/getSerialTimeline.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { getSerialTimeline } from '../getSerialTimeline';

const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL) throw new Error('DATABASE_URL_TEST not set — boot tests/db/setup/docker-compose.test.yml first');
const pool = new Pool({ connectionString: TEST_URL });

const ITEM_ONT = '11111111-1111-1111-1111-111111111111';
const SN_EMPTY = 'SN-EMPTY-01';
const SN_PSEUDO_ONLY = 'SN-PSEUDO-01';
const SN_WITH_EVENTS = 'SN-EVT-01';

beforeAll(async () => {
  await pool.query('TRUNCATE stock_serial_events, stock_serials, stock_items RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'FT-ONT-01', 'Fibertime ONT', 'ONT', 'serial')`,
    [ITEM_ONT]
  );
  await pool.query(
    `INSERT INTO stock_serials (stock_item_id, serial_number, status) VALUES ($1, $2, 'available')`,
    [ITEM_ONT, SN_EMPTY]
  );
  await pool.query(
    `INSERT INTO stock_serials (stock_item_id, serial_number, status, received_date, installed_date, installed_at_drop_number)
     VALUES ($1, $2, 'installed', '2026-04-01', '2026-05-01', 'DR0001MOH')`,
    [ITEM_ONT, SN_PSEUDO_ONLY]
  );
  const sidRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_serials (stock_item_id, serial_number, status, received_date)
     VALUES ($1, $2, 'activated', '2026-04-01') RETURNING id`,
    [ITEM_ONT, SN_WITH_EVENTS]
  );
  const sid = sidRes.rows[0].id;
  await pool.query(
    `INSERT INTO stock_serial_events (serial_id, event_type, from_state, to_state, occurred_at, payload) VALUES
       ($1, 'installed_at_drop', 'issued',    'installed', '2026-05-10T08:00:00Z', '{"drop_number":"DR0002MOH"}'),
       ($1, 'activated',         'installed', 'activated', '2026-05-15T14:00:00Z', '{"resolution_status":"activated"}')`,
    [sid]
  );
});

afterAll(async () => { await pool.end(); });

describe('getSerialTimeline', () => {
  it('returns null for unknown serial', async () => {
    expect(await getSerialTimeline('SN-DOES-NOT-EXIST')).toBeNull();
  });
  it('returns empty entries when no events and no pseudo triggers', async () => {
    const r = await getSerialTimeline(SN_EMPTY);
    expect(r).not.toBeNull();
    expect(r!.entries).toEqual([]);
    expect(r!.hasRealEvents).toBe(false);
  });
  it('returns pseudo entries when no events but stock_serials columns populated', async () => {
    const r = await getSerialTimeline(SN_PSEUDO_ONLY);
    expect(r).not.toBeNull();
    expect(r!.hasRealEvents).toBe(false);
    const kinds = r!.entries.map((e) => e.kind);
    expect(kinds).toEqual(['pseudo', 'pseudo']);
    const labels = r!.entries.map((e) => (e.kind === 'pseudo' ? e.label : ''));
    expect(labels).toEqual(['Installed at drop', 'Received into stock']);
  });
  it('returns real events + non-duplicating pseudo entries', async () => {
    const r = await getSerialTimeline(SN_WITH_EVENTS);
    expect(r).not.toBeNull();
    expect(r!.hasRealEvents).toBe(true);
    expect(r!.entries.length).toBe(3);
    const eventTypes = r!.entries
      .filter((e) => e.kind === 'event')
      .map((e) => (e as { eventType: string }).eventType);
    expect(eventTypes).toEqual(['activated', 'installed_at_drop']);
    expect(r!.entries[0].kind).toBe('event');
    expect(r!.entries[r!.entries.length - 1].kind).toBe('pseudo');
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
docker compose -f tests/db/setup/docker-compose.test.yml up -d
npx vitest run src/services/field-stock/serials/__tests__/getSerialTimeline.test.ts
```

### Task 9a.2 — Implement `getSerialTimeline`

- [ ] **Step 1: Create service**

Create `src/services/field-stock/serials/getSerialTimeline.ts`:

```typescript
import { pool } from '@/lib/db-pool';
import type { TimelineEntry } from '@/types/field-stock';

export interface SerialDetail {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  installedDate: string | null;
  receivedDate: string | null;
  activatedAtOltId: string | null;
}

export interface TimelineResult {
  serial: SerialDetail;
  entries: TimelineEntry[];
  hasRealEvents: boolean;
}

export async function getSerialTimeline(serialNumber: string): Promise<TimelineResult | null> {
  const serialRes = await pool.query<{
    id: string; serial_number: string; mac_address: string | null;
    category: string | null; item_name: string | null; status: string;
    location_name: string | null; project_name: string | null;
    drop_number: string | null; installed_date: string | null;
    received_date: string | null; activated_at_olt_id: string | null;
    // UNVERIFIED — confirm in PR-0 probe before merging PR-9a.
    // If either column is missing, drop both fields here AND the
    // "Status changed" pseudo entry below.
    previous_status: string | null; status_changed_at: string | null;
  }>(
    `
    SELECT
      ss.id, ss.serial_number, ss.mac_address,
      si.category, si.name AS item_name,
      ss.status,
      sl.name AS location_name, p.name AS project_name,
      ss.installed_at_drop_number AS drop_number,
      ss.installed_date, ss.received_date, ss.activated_at_olt_id,
      ss.previous_status,        -- UNVERIFIED — confirm in PR-0 probe
      ss.status_changed_at       -- UNVERIFIED — confirm in PR-0 probe
    FROM stock_serials ss
    LEFT JOIN stock_items si ON si.id = ss.stock_item_id
    LEFT JOIN stock_locations sl ON sl.id = ss.current_location_id
    LEFT JOIN projects p ON p.id = ss.allocated_to_project_id
    WHERE ss.serial_number = $1
    LIMIT 1
    `,
    [serialNumber]
  );
  if (serialRes.rows.length === 0) return null;
  const r = serialRes.rows[0];

  const serial: SerialDetail = {
    id: r.id, serialNumber: r.serial_number, macAddress: r.mac_address,
    category: r.category, itemName: r.item_name, status: r.status,
    currentLocationName: r.location_name, allocatedProjectName: r.project_name,
    installedAtDropNumber: r.drop_number, installedDate: r.installed_date,
    receivedDate: r.received_date, activatedAtOltId: r.activated_at_olt_id,
  };

  const eventsRes = await pool.query<{
    id: string; event_type: string; from_state: string | null; to_state: string | null;
    occurred_at: string; source_table: string | null; source_id: string | null;
    payload: Record<string, unknown>; actor_name: string | null;
  }>(
    `
    SELECT
      sse.id, sse.event_type, sse.from_state, sse.to_state,
      sse.occurred_at, sse.source_table, sse.source_id, sse.payload,
      COALESCE(
        NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
        NULLIF(TRIM(COALESCE(st.first_name,'') || ' ' || COALESCE(st.last_name,'')), '')
      ) AS actor_name
    FROM stock_serial_events sse
    LEFT JOIN users u  ON u.id  = sse.actor_user_id
    LEFT JOIN staff st ON st.id = sse.actor_staff_id
    WHERE sse.serial_id = $1
    ORDER BY sse.occurred_at DESC
    `,
    [r.id]
  );

  const realEvents: TimelineEntry[] = eventsRes.rows.map((e) => ({
    kind: 'event',
    id: e.id,
    eventType: e.event_type,
    fromState: e.from_state,
    toState: e.to_state,
    occurredAt: e.occurred_at,
    sourceTable: e.source_table,
    sourceId: e.source_id,
    actorName: e.actor_name,
    payload: e.payload ?? {},
  }));
  const realEventTypes = new Set(realEvents.map((e) => (e.kind === 'event' ? e.eventType : '')));
  const pseudo: TimelineEntry[] = [];

  if (r.received_date) {
    pseudo.push({
      kind: 'pseudo',
      id: `pseudo-received-${r.id}`,
      label: 'Received into stock',
      occurredAt: new Date(r.received_date).toISOString(),
      description: 'Inferred from stock_serials.received_date',
    });
  }
  if (r.installed_date && (r.status === 'installed' || r.status === 'activated') && !realEventTypes.has('installed_at_drop')) {
    pseudo.push({
      kind: 'pseudo',
      id: `pseudo-installed-${r.id}`,
      label: 'Installed at drop',
      occurredAt: new Date(r.installed_date).toISOString(),
      description: `Drop ${r.drop_number ?? 'unknown'} — inferred from stock_serials.installed_date`,
    });
  }
  if (r.activated_at_olt_id && r.status === 'activated' && !realEventTypes.has('activated')) {
    pseudo.push({
      kind: 'pseudo',
      id: `pseudo-activated-${r.id}`,
      label: 'Activated on OLT',
      occurredAt: new Date(r.status_changed_at ?? r.installed_date ?? new Date().toISOString()).toISOString(),
      description: `OLT ${r.activated_at_olt_id} — inferred from stock_serials.activated_at_olt_id`,
    });
  }
  // UNVERIFIED branch — fires only if both previous_status and status_changed_at exist on stock_serials.
  // PR-0 probe step 2 confirms. If either column is missing, REMOVE this branch and its corresponding test case.
  if (
    r.status_changed_at && r.previous_status &&
    r.previous_status !== r.status && realEvents.length === 0
  ) {
    pseudo.push({
      kind: 'pseudo',
      id: `pseudo-status-${r.id}`,
      label: 'Status changed',
      occurredAt: new Date(r.status_changed_at).toISOString(),
      description: `${r.previous_status} → ${r.status}`,
    });
  }

  const all = [...realEvents, ...pseudo].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  return { serial, entries: all, hasRealEvents: realEvents.length > 0 };
}
```

- [ ] **Step 2: Run, expect PASS, commit**

```bash
npx vitest run src/services/field-stock/serials/__tests__/getSerialTimeline.test.ts
git add src/services/field-stock/serials/getSerialTimeline.ts src/services/field-stock/serials/__tests__/getSerialTimeline.test.ts
git commit -m "feat(wave2): getSerialTimeline service with real-DB integration tests"
```

### Task 9a.3 — API route (FLAT) + detail page (`<AppLayout>`) + finish PR-9a

- [ ] **Step 1: Create FLAT API route**

Create `pages/api/procurement/field-stock/serials/timeline.ts`:

```typescript
/**
 * GET /api/procurement/field-stock/serials/timeline?serialNumber=<n>
 *
 * FLAT route — no nested dynamic segments. Per CLAUDE.md "Flatten nested
 * dynamic routes — they fail in Vercel" and Wave 2 Locked decision #12.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getSerialTimeline } from '@/services/field-stock/serials/getSerialTimeline';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  const serialNumber = req.query.serialNumber;
  if (typeof serialNumber !== 'string' || serialNumber.length === 0) {
    return apiResponse.badRequest(res, 'serialNumber query parameter required');
  }
  try {
    const result = await getSerialTimeline(serialNumber);
    if (!result) return apiResponse.notFound(res, 'Serial', serialNumber);
    return apiResponse.success(res, result);
  } catch (err) {
    log.error('serial timeline failed', { err: err instanceof Error ? err.message : String(err) }, 'SerialTimelineAPI');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
```

- [ ] **Step 2: Create detail page (page-level dynamic is fine; only API-level nesting is forbidden)**

Create `pages/procurement/field-stock/serials/[serialNumber].tsx`:

```typescript
import { useEffect, useState } from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AppLayout } from '@/components/layout';
import { SerialTimeline } from '@/components/field-stock/SerialTimeline';
import type { TimelineEntry } from '@/types/field-stock';

interface SerialDetail {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  installedDate: string | null;
  receivedDate: string | null;
  activatedAtOltId: string | null;
}

interface PageData { serial: SerialDetail; entries: TimelineEntry[]; hasRealEvents: boolean; }

const SerialTimelinePage: NextPage = () => {
  const router = useRouter();
  const { serialNumber } = router.query;
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (typeof serialNumber !== 'string') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    const params = new URLSearchParams({ serialNumber });
    fetch(`/api/procurement/field-stock/serials/timeline?${params}`, { credentials: 'include' })
      .then((r) => r.json().then((env) => ({ status: r.status, env })))
      .then(({ status, env }) => {
        if (cancelled) return;
        if (status === 404) { setNotFound(true); return; }
        if (!env.success) { setError(env.error?.message ?? 'Failed to load timeline'); return; }
        setData(env.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Network error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serialNumber]);

  if (loading) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-4xl px-4 py-6 text-sm text-neutral-400">Loading…</div>
      </AppLayout>
    );
  }
  if (notFound) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-4xl px-4 py-6">
          <Link href="/procurement/field-stock/serials" className="text-sm text-blue-400 hover:underline">← Back to search</Link>
          <h1 className="mt-4 text-xl font-semibold">Serial not found</h1>
          <p className="mt-2 text-sm text-neutral-400">No serial matches «{String(serialNumber)}».</p>
        </div>
      </AppLayout>
    );
  }
  if (error || !data) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-4xl px-4 py-6">
          <div className="rounded bg-red-950/40 p-3 text-sm text-red-200">{error ?? 'Unknown error'}</div>
        </div>
      </AppLayout>
    );
  }
  const { serial: s, entries, hasRealEvents } = data;
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-6">
        <Link href="/procurement/field-stock/serials" className="text-sm text-blue-400 hover:underline">← Back to search</Link>
        <header className="mt-2">
          <h1 className="text-xl font-semibold">{s.serialNumber}</h1>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-neutral-300 sm:grid-cols-4">
            {s.macAddress && <div><dt className="text-xs text-neutral-500">MAC</dt><dd>{s.macAddress}</dd></div>}
            {s.category && <div><dt className="text-xs text-neutral-500">Category</dt><dd>{s.category}</dd></div>}
            <div><dt className="text-xs text-neutral-500">Status</dt><dd>{s.status}</dd></div>
            {s.currentLocationName && <div><dt className="text-xs text-neutral-500">Location</dt><dd>{s.currentLocationName}</dd></div>}
            {s.allocatedProjectName && <div><dt className="text-xs text-neutral-500">Project</dt><dd>{s.allocatedProjectName}</dd></div>}
            {s.installedAtDropNumber && <div><dt className="text-xs text-neutral-500">Drop</dt><dd>{s.installedAtDropNumber}</dd></div>}
            {s.activatedAtOltId && <div><dt className="text-xs text-neutral-500">OLT</dt><dd>{s.activatedAtOltId}</dd></div>}
          </dl>
        </header>
        <section className="mt-6">
          <h2 className="mb-2 text-sm uppercase text-neutral-500">Lifecycle</h2>
          <SerialTimeline entries={entries} hasRealEvents={hasRealEvents} />
        </section>
      </div>
    </AppLayout>
  );
};

export default SerialTimelinePage;
```

- [ ] **Step 3: Lint + commit + push + Playwright smoke + PR**

```bash
npm run ci:quick
git add pages/api/procurement/field-stock/serials/timeline.ts pages/procurement/field-stock/serials/[serialNumber].tsx
git commit -m "feat(wave2): /serials/[serialNumber] lifecycle timeline + FLAT API"
git push -u origin feat/wave2-pr9a-serial-timeline
```

**Browser smoke (mandatory before PR open — per Guardrail #15):**
1. Run dev server in worktree: `PORT=3004 npm run dev`.
2. Drive the browser via `mcp__playwriter__execute`:
   - Navigate to `http://localhost:3004/procurement/field-stock/serials`.
   - Type the PR-0 probe's Mohadin sample serial into the search input.
   - Screenshot 1: search result row visible.
   - Click the serial link → navigates to `/serials/<serialNumber>`.
   - Screenshot 2: detail page rendered with header + AppLayout sidebar visible + at least the "Received into stock" pseudo entry visible in the timeline.
   - Navigate to `/procurement/field-stock/serials/SN-DOES-NOT-EXIST-XYZ`.
   - Screenshot 3: "Serial not found" page rendered with "← Back to search" link.
3. Embed all three screenshots in the PR body BEFORE opening review.

```bash
gh pr create --base master --title "feat(wave2): PR-9a /serials/[serialNumber] lifecycle timeline (read-only)" --body "## Summary
- New FLAT API: GET /api/procurement/field-stock/serials/timeline?serialNumber=<n>
- New page: /procurement/field-stock/serials/[serialNumber] — header + <SerialTimeline> from PR-7, wraps <AppLayout>
- Pseudo entries derived from stock_serials.{received_date, installed_date, activated_at_olt_id, status_changed_at} when no real event covers them (per probe finding: 99%+ of serials have no events)

## Scope
Read-only. No force-correct (PR-9b deferred per Locked decision #4).

## Test plan
- [ ] \\\`npm run ci:quick\\\` passes
- [ ] Integration tests: \\\`docker compose -f tests/db/setup/docker-compose.test.yml up -d && npx vitest run src/services/field-stock/serials/__tests__/getSerialTimeline.test.ts\\\`
- [ ] Playwright screenshots (3 above) embedded — Mohadin sample serial, detail page render, 404 page

## UNVERIFIED columns
\\\`stock_serials.previous_status\\\` + \\\`stock_serials.status_changed_at\\\` are pseudo-trigger columns referenced by the fourth pseudo rule. PR-0 probe step 2 confirms existence; if either is missing, the rule + its test + its code branch will be removed before merge.

## Rollback
\\\`git revert <merge-sha>\\\` + redeploy. No DB changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"

# After review APPROVED + GHA CI green:
gh pr merge <N> --merge --delete-branch
cd /home/hein/Workspace/FF_Next.js
git worktree remove /home/hein/Workspace/FF_Next.js-wave2-pr9a
```

---

## Validation gate (Wave 2 complete)

After all four PRs (PR-0, PR-7, PR-8, PR-9a) merge to master and deploy to production:

Use `mcp__playwriter__execute` for every step. Embed the resulting screenshots in a follow-up gate comment on this branch's last PR.

1. Open `https://app.fibreflow.app/procurement/field-stock/serials` in a logged-in browser session. Verify AppLayout sidebar+navbar render. Screenshot.
2. From the PR-0 probe doc, take the Mohadin Loeks sample serial_number.
3. Paste it into the search input. Within ~600ms (300ms debounce + ~300ms server) the result row appears. Screenshot.
4. Click the serial number. The detail page loads at `/procurement/field-stock/serials/<that-serial>`. AppLayout sidebar+navbar still visible. Screenshot.
5. Verify the header shows: MAC (if known), category, status, project name "Mohadin Loeks", drop number (if installed).
6. Verify the timeline contains **at least** the "Received into stock" pseudo entry (the 249 Mohadin Loeks serials all have `received_date` set — see memory `project_mohadin_loeks_import`).
7. If the serial has a real event in `stock_serial_events`, verify it renders with `event_type`, state transition chip, and timestamp.

**Gate passes if:** all 7 steps succeed AND all 3 screenshots embedded in the gate comment.
**Gate fails if:** any step errors, the page 404s on a known-good serial, the timeline is empty for a serial with `received_date IS NOT NULL`, or AppLayout fails to render on either page.

After the gate passes, Wave 2 is **done**. No further PRs ship until either (a) a user surfaces a concrete pain point that one of the deferred PRs (PR-9b, PR-10–PR-15) would solve, or (b) Hein explicitly requests one.

---

## Rollback

Each PR's rollback is identical:

```bash
gh pr list --state merged --limit 10
git revert -m 1 <merge-commit-sha>
git push origin master
bash scripts/deploy-local.sh production  # after-hours + Hein approval
```

No DB changes in any of PR-0/PR-7/PR-8/PR-9a → no SQL rollback scripts. If a permission seed migration is unexpectedly added (probe should catch this), include the rollback migration in the revert commit.

---

## Self-review checklist

**Spec coverage:**
- [x] Probe step (PR-0) mandatory and documented
- [x] PR-7 covers `<SerialSearch>` + `<SerialTimeline>` per locked scope (other components dropped — listed in §"File structure")
- [x] PR-8 covers `/serials` search page + API with pagination + negative-case test seeds
- [x] PR-9a covers `/serials/[serialNumber]` lifecycle page + FLAT API (read-only)
- [x] PR-9b (force-correct) explicitly deferred with rationale (Locked decision #4)
- [x] PR-10 through PR-15 explicitly deferred with rationale (§"Out — deferred")
- [x] Validation gate is concrete (specific serial source, specific clicks, specific Playwright screenshots required)
- [x] Rollback identical across PRs (revert merge commit)

**Type consistency:**
- [x] `SerialSearchFilters` defined ONCE in `src/types/field-stock/serialFilters.ts` and consumed by component, page, service, and API parser
- [x] `TimelineEntry` defined ONCE in `src/types/field-stock/timelineEntry.ts` and consumed by component, service, and API response
- [x] Services do NOT import from `@/components/*` (per Locked decision #13)
- [x] `searchSerials` return type fields match what the page table consumes
- [x] `getSerialTimeline` return type fields match what the detail page header consumes

**Wave 1 lessons applied:**
- [x] PR-0 probe is non-negotiable and runs before any code (Wave 1 schema-drift lesson)
- [x] Integration tests against real Postgres via `tests/db/setup/docker-compose.test.yml` + `DATABASE_URL_TEST` env var (Wave 1 testing-strategy lesson)
- [x] Negative-case rows in every WHERE-filter test (Wave 1 Backfill C lesson — see memory `feedback_run_backfills_through_verification_first`)
- [x] Parallel-session collision check before each PR (Wave 1 migration collision lesson + this plan's own creation history — PR #1716 supersession). Memory note: a new `feedback_parallel_session_collision_check` should be authored to cover non-migration PRs explicitly.
- [x] Worktree workflow with cleanup after merge

**PR #1720 review fixes:**
- [x] HIGH 1: nested dynamic API route flattened — `serials/timeline.ts?serialNumber=…` (Locked decision #12, Guardrail #12)
- [x] HIGH 2: both pages wrap `<AppLayout>` (Locked decision #14, Guardrail #13)
- [x] HIGH 3: services import shared types from `@/types/field-stock`, not from components (Locked decision #13, Guardrail #14)
- [x] HIGH 4: browser smoke uses Playwright MCP with embedded screenshots (Locked decision #15, Guardrail #15)
- [x] MEDIUM 5: memory reference corrected; new `feedback_parallel_session_collision_check` memory recommended
- [x] MEDIUM 6: UNVERIFIED markers on `previous_status` and `status_changed_at` references; PR-0 probe step 2 covers
- [x] MEDIUM 7: orphaned-page discovery note added to §Scope and elevated to Locked decision #11
- [x] MEDIUM 8: docker-compose harness specifics restored — `tests/db/setup/docker-compose.test.yml`, env var `DATABASE_URL_TEST`
- [x] LOW 9: `apiResponse.internalError` added to the conventions block

**Supersession reason:**
- [x] Top-of-file supersession notice explains why this amends PR #1716
- [x] Revision-history block records the PR #1720 review-driven amendments
- [x] Locked-decisions table cites grill source for each delta from PR #1716
- [x] File structure section explicitly lists which components from PR #1716 were dropped + why
