# Serial Master Register — Wave 2 Implementation Plan (UI Rebuild)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/procurement/field-stock/*` admin UI as a serial-centric surface over the Wave-1 master register, with master search, lifecycle timeline, reconciliation drift, dashboard tiles, and per-warehouse/per-project drill-downs.

**Architecture:** Three reusable React components (`<SerialSearch>`, `<SerialTimeline>`, `<ReconciliationReport>`) shipped first (PR-7) and consumed by 8 page PRs (PR-8 through PR-15). Each page PR is independently deployable, rebuilds at most one canonical path, and ships its `/legacy/` re-mount in the same commit so revert is a single `git revert`. PR-15 (accountability) merges last because counter logic is the highest-blast-radius surface and gets a `/review-team` blind review.

**Tech Stack:** Next.js Pages Router (no App Router), TypeScript strict, Postgres (Supabase pooler `100.96.203.105:5436`), `pg.Pool` via `@/lib/db-pool` for new code (Neon-shim only in pre-existing `lib/db/pool.js`), Vitest + docker-compose Postgres for real-DB tests, Tailwind for UI, lucide-react for icons, `@/lib/apiResponse` envelope for every API.

---

## Locked decisions (do not re-litigate during execution)

| # | Decision | Source |
|---|---|---|
| 1 | Persona = procurement admins/managers. Desktop. `/stock/portal` and `/my/stores/*` are out of scope. | Grill 2026-05-21 Q1 |
| 2 | Cutover = hard per-PR. Each PR ships its `/legacy/` re-mount in the same commit. Revert = `git revert <merge-sha>` + redeploy. | Grill Q2 |
| 3 | `<SerialTimeline>` ships with no pagination in PR-7. PR-9 adds `LIMIT 50 + Load more` if data volume warrants. | Self-resolved (only 66 serials have any event today, all single-event) |
| 4 | Reconciliation "resolve" emits a `note_added` event only — never mutates `stock_serials.status`. State changes go through the separate force-state-correction admin action in PR-9. | Spec line 309 + Grill |
| 5 | PR-15 merges LAST. | Grill Q6 |
| 6 | PR-8 through PR-14 are parallelizable across multiple agent tracks once PR-7 lands and has ≥1 consumer in `__tests__/`. | Grill Q6 |
| 7 | All field-stock API endpoints use `withAuth` (main app `ff_auth_token`). No changes to auth surface in Wave 2. | Spec + audit |
| 8 | Existing `pages/stock/portal.tsx` (storeman mobile counter UI) MUST keep working through the entire Wave 2. Not touched. | Grill Q1 |
| 9 | Existing `pages/procurement/field-stock/{index,reconciliation}.tsx` and `pages/procurement/field-stock/pickings/[pickingId].tsx` are the **only** existing pages — most Wave-2 PRs create *new* pages, only PR-10 / PR-11 / PR-14 trigger the `/legacy/` re-mount. | Repo inspection 2026-05-21 |
| 10 | `event_type` column on `stock_serial_events` has no CHECK constraint — adding a new event type is code-only, no migration. | Spec line 196 |

---

## Pre-Wave-2 execution gates

These MUST be true before PR-7 enters the queue. Verify in the PR description.

- [ ] **Wave 1 has been live ≥ 48h incident-free.** Wave 1 deployed 2026-05-21 ~20:14 SAST → earliest PR-7 start is **2026-05-23 ~20:00 SAST**. Check `gh issue list --label incident --search "created:>=2026-05-21"` returns no Wave-1-related incidents.
- [ ] **`reconcile-serials` exits 0** against prod (all 6 checks at drift=0).
- [ ] **`npm run ci:quick` clean** on origin/master.
- [ ] **Lint ratchet baselines unchanged** — 77 errors / ~1833 warnings / 94 catches per `.claude/memory/feedback_local_ci_pipeline.md`.
- [ ] **Direct port 5437 auth issue investigated or worked-around documented.** Plans that run psql use 5436 (pooler).

---

## Execution timeline (Gantt-ish)

```
Day 0           Day 2-3         Day 3-5         Day 5-7         Day 7-9
[Wave 1 soak]   [PR-7 ships]    [PR-8/9/10 ║]   [PR-11/12/13 ║] [PR-14, then PR-15]
48h gate                        parallel tracks  parallel tracks  PR-15 review-team

PR-7  (shared components)         ───┐
                                     │
PR-8  (master search)             ───┼──┐
PR-9  (lifecycle timeline)        ───┼──┤
PR-10 (dashboard)                 ───┼──┤
                                     │  │
PR-11 (reconciliation)               ├──┼──┐
PR-12 (warehouses)                   ├──┼──┤
PR-13 (projects)                     ├──┼──┤
                                     │  │  │
PR-14 (event-filter views)           ├──┼──┼──┐
                                     │  │  │  │
PR-15 (accountability + items + locations)  ├──┘  ← merges last, review-team
```

**Concurrency rule:** at most 3 page PRs in flight simultaneously to keep PR-review load manageable. If reviewer queue backs up, drain before opening more.

---

## Cross-PR file layout (locked in PR-7)

```
src/components/field-stock/
├── SerialSearch.tsx                 (≤200 lines)
├── SerialSearch.types.ts            (≤80 lines)
├── SerialTimeline.tsx               (≤200 lines)
├── SerialTimeline.types.ts          (≤60 lines)
├── ReconciliationReport.tsx         (≤200 lines)
├── ReconciliationReport.types.ts    (≤50 lines)
├── StatusBadge.tsx                  (≤80 lines)
├── EventIcon.tsx                    (≤80 lines)
├── statusVocabulary.ts              (≤60 lines)  ← 12-state → label/colour map
├── eventVocabulary.ts               (≤80 lines)  ← event_type → label/icon/colour map
└── __tests__/
    ├── SerialSearch.test.tsx
    ├── SerialTimeline.test.tsx
    ├── ReconciliationReport.test.tsx
    ├── StatusBadge.test.tsx
    └── EventIcon.test.tsx

pages/procurement/field-stock/
├── index.tsx                          PR-10 rebuilds (legacy → /legacy/index.tsx)
├── serials.tsx                        PR-8  new
├── serials/[serial].tsx               PR-9  new
├── reconciliation.tsx                 PR-11 rebuilds (legacy → /legacy/reconciliation.tsx)
├── warehouses/index.tsx               PR-12 new
├── warehouses/[warehouseId].tsx       PR-12 new
├── projects/index.tsx                 PR-13 new
├── projects/[projectId].tsx           PR-13 new
├── pickings.tsx                       PR-14 new (event-filter view; existing pickings/[pickingId].tsx kept)
├── movements.tsx                      PR-14 new
├── returns.tsx                        PR-14 new
├── accountability/index.tsx           PR-15 new
├── accountability/[contractorId].tsx  PR-15 new
├── items.tsx                          PR-15 new
├── locations.tsx                      PR-15 new
└── legacy/
    ├── index.tsx                      PR-10
    ├── reconciliation.tsx             PR-11
    └── pickings/[pickingId].tsx       PR-14 (only if rebuilt; otherwise stays canonical)

pages/api/procurement/field-stock/
├── serials/
│   ├── search.ts                      PR-8  new (extends existing serials.ts? — task in PR-8)
│   └── [serial]/
│       ├── timeline.ts                PR-9  new
│       └── force-correct.ts           PR-9  new
├── dashboard.ts                       PR-10 modify (exists)
├── reconciliation/
│   ├── list.ts                        PR-11 new
│   └── resolve.ts                     PR-11 new
├── warehouses/
│   ├── index.ts                       PR-12 new
│   └── [warehouseId].ts               PR-12 new
└── projects/
    ├── index.ts                       PR-13 new
    └── [projectId].ts                 PR-13 new
```

**Naming convention:** use `[warehouseId]` and `[projectId]` (not `[id]`) per CLAUDE.md API conventions.

---

## Mandatory guardrails (every PR)

1. **Browser smoke recorded** — screenshot per smoke step embedded in the PR body, plus the `reconcile-serials` CLI output showing drift=0 before and after deploy. No PR merges without this evidence.
2. **Real-Postgres tests** via `docker-compose.test.yml` (already established in Wave 1's `tests/db/` infrastructure). No SQL mocking.
3. **API responses use `apiResponse` envelope** from `@/lib/apiResponse`. Standard shapes only.
4. **Files ≤ 300 lines / components ≤ 200 lines.** Reviewer-enforced.
5. **No new `console.log`** — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage.
6. **Auth uses `withAuth`** from `@/lib/auth` on every API endpoint. No middleware bypasses.
7. **Lint ratchet** — `npm run ci:quick` must show no regression against the 77 errors / ~1833 warnings / 94 catches baseline.
8. **Hard cutover** — each rebuilt page's PR moves the old file to `/legacy/<same-name>.tsx` in the same commit, in addition to creating the new canonical path.
9. **Production deploy** post-business-hours only (17:00 SAST), with Hein's explicit approval, via `bash scripts/deploy-local.sh production`.
10. **Migrations** (PR-9 only, for `force-state-correction`): pick version from `SELECT MAX(version) FROM migrations`, run `gh pr list --search 'migration in:title'` to detect parallel-session collisions, write SQL to `scripts/migrations/sql/<NNN>_<name>.sql`.

---

## PR-7: Shared components

**Reviewer:** sonnet
**Dependencies:** Wave 1 merged + 48h soak + reconcile=0.
**Rollback:** `git revert <merge-sha>` → no consumer pages yet, zero blast radius.

### Scope

Creates the three reusable embedded components (`<SerialSearch>`, `<SerialTimeline>`, `<ReconciliationReport>`) plus shared vocabulary (`<StatusBadge>`, `<EventIcon>`, `statusVocabulary.ts`, `eventVocabulary.ts`).

**What it does:** ships the components with their props contracts, unit tests, and one storybook-style demo page (`pages/dev/field-stock-components.tsx`, dev-only, NOT linked from anywhere) so reviewers can see the rendered output without waiting for PR-8.

**What it doesn't:** no real data wiring, no API calls. Components accept all data via props. No URL state synchronization yet (that lives in PR-8 where the search component is first mounted).

### Files

| File | Action | Budget |
|---|---|---|
| `src/components/field-stock/SerialSearch.tsx` | Create | ≤200 lines |
| `src/components/field-stock/SerialSearch.types.ts` | Create | ≤80 lines |
| `src/components/field-stock/SerialTimeline.tsx` | Create | ≤200 lines |
| `src/components/field-stock/SerialTimeline.types.ts` | Create | ≤60 lines |
| `src/components/field-stock/ReconciliationReport.tsx` | Create | ≤200 lines |
| `src/components/field-stock/ReconciliationReport.types.ts` | Create | ≤50 lines |
| `src/components/field-stock/StatusBadge.tsx` | Create | ≤80 lines |
| `src/components/field-stock/EventIcon.tsx` | Create | ≤80 lines |
| `src/components/field-stock/statusVocabulary.ts` | Create | ≤60 lines |
| `src/components/field-stock/eventVocabulary.ts` | Create | ≤80 lines |
| `src/components/field-stock/__tests__/*.test.tsx` | Create | 5 files, ≤150 lines each |
| `pages/dev/field-stock-components.tsx` | Create | ≤150 lines (dev demo) |

**Total budget: ~1900 lines across 17 files.**

### Tasks

- [ ] **Task 1 — Status + event vocabularies (no UI yet)**

Define the 12-state vocabulary and event-type vocabulary as pure data. These are imported by every Wave-2 component and page.

`src/components/field-stock/statusVocabulary.ts`:

```ts
export type SerialStatus =
  | 'available' | 'reserved' | 'allocated_to_project' | 'in_transit'
  | 'issued' | 'installed' | 'activated' | 'faulty' | 'in_repair'
  | 'returned' | 'scrapped';

export interface StatusMeta {
  label: string;
  colour: 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple';
  description: string;
}

export const STATUS_VOCABULARY: Record<SerialStatus, StatusMeta> = {
  available:            { label: 'Available',     colour: 'gray',   description: 'In DC or warehouse, ready to use' },
  reserved:             { label: 'Reserved',      colour: 'blue',   description: 'Earmarked for a planned picking' },
  allocated_to_project: { label: 'Allocated',     colour: 'blue',   description: 'Assigned to a project pool' },
  in_transit:           { label: 'In transit',    colour: 'amber',  description: 'Moving between warehouses' },
  issued:               { label: 'Issued',        colour: 'amber',  description: 'With a tech in the field' },
  installed:            { label: 'Installed',     colour: 'green',  description: 'Physically at a drop, pre-activation' },
  activated:            { label: 'Activated',     colour: 'green',  description: 'Live on Nokia OES' },
  faulty:               { label: 'Faulty',        colour: 'red',    description: 'Flagged defective' },
  in_repair:            { label: 'In repair',     colour: 'amber',  description: 'In repair queue' },
  returned:             { label: 'Returned',      colour: 'purple', description: 'Pending inspection' },
  scrapped:             { label: 'Scrapped',      colour: 'gray',   description: 'Written off (terminal)' },
};
```

`src/components/field-stock/eventVocabulary.ts`: same shape, keyed on event_type strings per spec lines 172-194.

Commit: `feat(field-stock): add status + event vocabularies for Wave 2 UI`

- [ ] **Task 2 — `<StatusBadge>` + test**

Pill component that takes `status: SerialStatus` and renders the label + colour from `STATUS_VOCABULARY`. No conditional rendering branches; one render path. Test:

```tsx
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('<StatusBadge>', () => {
  test.each([
    ['available',  'Available',  'gray'],
    ['issued',     'Issued',     'amber'],
    ['activated',  'Activated',  'green'],
    ['scrapped',   'Scrapped',   'gray'],
  ] as const)('renders %s with label %s and colour class %s', (status, label, colour) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-colour', colour);
  });

  it('throws (or renders unknown class) for an off-vocabulary value', () => {
    expect(() => render(<StatusBadge status={'fake' as SerialStatus} />)).toThrow();
  });
});
```

Run: `npm test -- src/components/field-stock/__tests__/StatusBadge.test.tsx`. Expect 5/5 pass.

Commit: `feat(field-stock): <StatusBadge> with 12-state vocabulary`

- [ ] **Task 3 — `<EventIcon>` + test**

Same pattern as `<StatusBadge>` but mapping `event_type` → lucide icon + colour. Render all spec event types (per spec lines 172-194). Add a `data-event-type` attribute for test selectors.

Commit: `feat(field-stock): <EventIcon> for event-type vocabulary`

- [ ] **Task 4 — `<SerialSearch>` props contract + skeleton + test**

Define the props in `SerialSearch.types.ts`:

```ts
export interface SerialSearchFilters {
  query?: string;                  // matches serial_number or mac_address (prefix or exact)
  deviceType?: string;
  status?: SerialStatus[];
  warehouseId?: string;
  projectId?: string;
  contractorId?: string;
  techStaffId?: string;
  dropId?: string;
  lastEventFrom?: string;          // ISO date
  lastEventTo?: string;            // ISO date
}

export interface SerialSearchResult {
  id: string;
  serial_number: string;
  mac_address: string | null;
  device_type: string;
  status: SerialStatus;
  current_location_name: string | null;
  last_event_type: string | null;
  last_event_occurred_at: string | null;
}

export interface SerialSearchProps {
  initialFilters?: SerialSearchFilters;
  hiddenFilters?: (keyof SerialSearchFilters)[];  // e.g. ['warehouseId'] when embedded in warehouse page
  onSelect?: (serial: SerialSearchResult) => void;
  onFiltersChange?: (filters: SerialSearchFilters) => void;
  fetchResults: (filters: SerialSearchFilters) => Promise<SerialSearchResult[]>;
  emptyMessage?: string;
}
```

Implementation: filter UI + debounced query + results table. **No URL state in this PR — embedding pages own URL serialization.** The component is dumb about its environment.

Test signatures (write them, watch them fail, implement):

```tsx
describe('<SerialSearch>', () => {
  it('debounces query input and calls fetchResults once after 300ms', async () => { /* ... */ });
  it('renders results in a table with status badge + event icon', async () => { /* ... */ });
  it('hides filters listed in hiddenFilters prop', () => { /* ... */ });
  it('calls onFiltersChange with normalized filters when a filter changes', async () => { /* ... */ });
  it('calls onSelect with the result row when a row is clicked', async () => { /* ... */ });
  it('renders emptyMessage when fetchResults returns []', async () => { /* ... */ });
});
```

Run: `npm test -- src/components/field-stock/__tests__/SerialSearch.test.tsx`. Expect 6/6 pass.

Commit: `feat(field-stock): <SerialSearch> component (props-driven, no URL state)`

- [ ] **Task 5 — `<SerialTimeline>` + test**

Props contract:

```ts
export interface SerialTimelineEvent {
  id: string;
  event_type: string;
  from_state: SerialStatus | null;
  to_state: SerialStatus | null;
  actor_name: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
  source_table: string | null;
  source_id: string | null;
}

export interface SerialTimelineProps {
  header: {
    serial_number: string;
    mac_address: string | null;
    device_type: string;
    current_status: SerialStatus;
    current_location_name: string | null;
  };
  events: SerialTimelineEvent[];   // ordered newest-first by caller
  onSourceClick?: (sourceTable: string, sourceId: string) => void;
  renderAdminActions?: () => React.ReactNode;  // injected by PR-9 (force-correct + add-note)
}
```

Pagination: **none**. Renders all events given. PR-9 owns the LIMIT 50 + Load more if needed.

Tests cover: header rendering, event row rendering (icon + from→to chip + relative age + click-through), expandable payload toggle, empty-events state, admin-actions render-prop integration.

Commit: `feat(field-stock): <SerialTimeline> component`

- [ ] **Task 6 — `<ReconciliationReport>` + test**

Props contract:

```ts
export interface DriftRow {
  check_name: string;              // e.g. 'accountability_issued_counter_drift'
  drift_count: number;
  tolerance: number;
  sample_rows?: Record<string, unknown>[];  // up to 10 sample drift records, supplied by /api/.../reconciliation/list
}

export interface ReconciliationReportProps {
  rows: DriftRow[];
  onResolve?: (row: DriftRow, reason: string) => Promise<void>;
  isAdmin: boolean;
}
```

Three sections per spec lines 301-309: cross-source disagreements, orphans, accountability counter drift. Section assignment is data-driven (`check_name` prefix routes to a section). "Mark as resolved" modal: free-text reason, posts via `onResolve`. Non-admin users see the data but not the resolve button.

Tests: section grouping, resolve modal opens/closes, onResolve is called with reason, non-admin hides resolve buttons.

Commit: `feat(field-stock): <ReconciliationReport> component`

- [ ] **Task 7 — Dev demo page**

`pages/dev/field-stock-components.tsx`: renders each component with hardcoded fixtures so reviewers see the visual output. Hidden from the nav. `getStaticProps` not needed.

Add a one-line comment at the top: `// REMOVE before Phase 5+. Wave-2-only demo surface.`

Commit: `chore(field-stock): dev demo page for Wave 2 components`

- [ ] **Task 8 — Browser smoke + PR**

Open `dev.fibreflow.app/dev/field-stock-components` in a browser, screenshot each of the three components rendering against fixtures.

Run `reconcile-serials` against prod, paste output.

Open PR. Body must include: file-by-file diff summary, both screenshots, reconcile output, `npm run ci:quick` exit code.

```bash
npx tsx scripts/reconcile-serials.ts  # before push
git push -u origin plan/wave2-ui-pr-7
gh pr create --title "feat(field-stock): Wave 2 PR-7 shared components" --body "$(cat <<'EOF'
## Summary
- Adds reusable <SerialSearch>, <SerialTimeline>, <ReconciliationReport>, <StatusBadge>, <EventIcon>
- Pure props-driven — no API calls, no URL state, no data fetching
- Dev demo at /dev/field-stock-components (not nav-linked)

## Test plan
- [x] npm test -- src/components/field-stock — 28/28 pass
- [x] npm run ci:quick clean
- [x] Browser smoke: screenshots attached
- [x] reconcile-serials drift=0 (output attached)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Tests

| File | Layer | Notes |
|---|---|---|
| `src/components/field-stock/__tests__/StatusBadge.test.tsx` | Unit (Vitest + Testing Library) | 5 test cases per status vocabulary |
| `src/components/field-stock/__tests__/EventIcon.test.tsx` | Unit | One case per event-type |
| `src/components/field-stock/__tests__/SerialSearch.test.tsx` | Unit | 6 cases (debounce, render, filters, callbacks, empty) |
| `src/components/field-stock/__tests__/SerialTimeline.test.tsx` | Unit | 5 cases (header, rows, payload toggle, empty, render-prop) |
| `src/components/field-stock/__tests__/ReconciliationReport.test.tsx` | Unit | 4 cases (grouping, resolve modal, callback, admin-gating) |

### Browser smoke

1. Open `dev.fibreflow.app/dev/field-stock-components`
2. Screenshot: `<SerialSearch>` rendering with all filter chips visible + 3 result rows
3. Screenshot: `<SerialTimeline>` with header + 4 events (one of each colour)
4. Screenshot: `<ReconciliationReport>` with 3 sections populated
5. Verify console clean (no warnings/errors)

### Acceptance criteria

- Five components exist at the file paths above.
- All 28 unit tests pass.
- `npm run ci:quick` clean.
- `reconcile-serials` exits 0 (no regression from data-layer state).
- Dev demo page renders all three composite components with no errors in console.
- Bundle size impact ≤ +30 KB gzipped (measured via `npm run analyze` if available; otherwise spot-check `.next/analyze`).

---

## PR-8: Master search page

**Reviewer:** sonnet
**Dependencies:** PR-7 merged + has ≥1 consumer (the dev demo counts).
**Rollback:** `git revert <merge-sha>` → page disappears; no other surface affected.

### Scope

Creates `/procurement/field-stock/serials` — the primary master search view. URL state synchronization (filters serialized to query params, shareable). Backed by a new `/api/procurement/field-stock/serials/search.ts` endpoint (the existing `serials.ts` is kept for its own callers — see Task 2).

**What it does:** filterable searchable list of every serial in `stock_serials`, with current status + last event + click-through to detail.

**What it doesn't:** no bulk actions in this PR (admin re-allocate / force-state-correction lives in PR-9 via the detail page). No CSV export in this PR — deferred to a follow-up since the existing `export-serials.ts` already covers it.

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/serials.tsx` | Create | ≤180 lines |
| `pages/api/procurement/field-stock/serials/search.ts` | Create | ≤200 lines |
| `pages/api/procurement/field-stock/serials/__tests__/search.test.ts` | Create | ≤250 lines |
| `tests/pages/procurement/field-stock/serials.test.tsx` | Create | ≤150 lines (component-level integration) |

### Tasks

- [ ] **Task 1 — Decide endpoint structure: extend `serials.ts` or new `search.ts`?**

Read `pages/api/procurement/field-stock/serials.ts` to see what shape it returns and who calls it. If it's already shaped for search-with-filters AND no other caller depends on a different shape, extend it. Otherwise create `search.ts`.

```bash
grep -rn "from.*field-stock/serials'" src pages | grep -v __tests__
grep -rn "api/procurement/field-stock/serials" src pages | grep -v __tests__
```

Decision criterion: if the existing endpoint has ≤2 callers AND none of them paginate/filter the way `<SerialSearch>` needs, fold the search into it and update callers. Otherwise create the new endpoint and leave the old one alone.

Document the decision in a top comment in whichever file you write.

- [ ] **Task 2 — Failing API test (real Postgres)**

`pages/api/procurement/field-stock/serials/__tests__/search.test.ts`:

```ts
import { setupTestDb, teardownTestDb, withTestPool } from '@/tests/db/setup';
import handler from '../search';
import { createMocks } from 'node-mocks-http';

describe('GET /api/procurement/field-stock/serials/search', () => {
  beforeAll(setupTestDb);
  afterAll(teardownTestDb);

  it('returns paginated results with current status + last event', async () => {
    await withTestPool(async (pool) => {
      // seed 5 stock_serials + 3 events
      // ...
    });
    const { req, res } = createMocks({ method: 'GET', query: { query: 'GU18' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.data.results).toHaveLength(2);
    expect(body.data.results[0]).toMatchObject({
      serial_number: expect.stringContaining('GU18'),
      status: expect.any(String),
      last_event_type: expect.any(String),
    });
  });

  it('filters by status[] (multi-select)', async () => { /* ... */ });
  it('matches MAC prefix case-insensitively', async () => { /* ... */ });
  it('limit + offset paginate correctly', async () => { /* ... */ });
  it('respects hiddenFilters via query schema', async () => { /* ... */ });
  it('returns 401 without auth cookie', async () => { /* ... */ });
});
```

Run: `npm test -- pages/api/procurement/field-stock/serials/__tests__/search.test.ts`. Expect ALL fail (handler not yet implemented).

- [ ] **Task 3 — Implement `search.ts` (real SQL, no mocks)**

The SQL joins `stock_serials` to the latest `stock_serial_events` row per serial (via `DISTINCT ON (serial_id) ORDER BY serial_id, occurred_at DESC`) plus to `stock_locations` for the current-location name. Use `pg.Pool` via `@/lib/db-pool`. Wrap with `withAuth`.

Show the SQL skeleton (not the full route):

```sql
SELECT
  ss.id, ss.serial_number, ss.mac_address, ss.device_type, ss.status,
  loc.name AS current_location_name,
  sse.event_type AS last_event_type,
  sse.occurred_at AS last_event_occurred_at
FROM stock_serials ss
LEFT JOIN stock_locations loc ON loc.id = ss.current_location_id
LEFT JOIN LATERAL (
  SELECT event_type, occurred_at
  FROM stock_serial_events
  WHERE serial_id = ss.id
  ORDER BY occurred_at DESC
  LIMIT 1
) sse ON true
WHERE ($1::text IS NULL OR ss.serial_number ILIKE $1 || '%' OR ss.mac_address ILIKE $1 || '%')
  AND ($2::text[] IS NULL OR ss.status = ANY($2::text[]))
  -- ... other filters
ORDER BY sse.occurred_at DESC NULLS LAST
LIMIT $N OFFSET $M;
```

**Critical:** before writing the SQL, run `psql -c "\d stock_serials"` against prod (port 5436) to verify the column names. Wave-1 lessons codified in `feedback_query_schema_before_migration` apply.

Run tests until 6/6 pass.

- [ ] **Task 4 — Page component**

`pages/procurement/field-stock/serials.tsx` mounts `<SerialSearch>` with URL state sync via `next/router`:

```tsx
// Pseudocode contract — actual JSX is the engineer's choice
function SerialsPage() {
  const router = useRouter();
  const filters = useMemo(() => parseFiltersFromQuery(router.query), [router.query]);
  return (
    <AppLayout>
      <SerialSearch
        initialFilters={filters}
        onFiltersChange={(f) => router.replace({ query: serializeFiltersToQuery(f) })}
        onSelect={(s) => router.push(`/procurement/field-stock/serials/${s.serial_number}`)}
        fetchResults={async (f) => {
          const r = await fetch(`/api/procurement/field-stock/serials/search?${qs(f)}`);
          const body = await r.json();
          return body.data.results;
        }}
      />
    </AppLayout>
  );
}
```

`parseFiltersFromQuery` / `serializeFiltersToQuery` live in the same file. Date strings stay ISO, arrays become comma-separated.

- [ ] **Task 5 — Page integration test**

`tests/pages/procurement/field-stock/serials.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SerialsPage from '@/pages/procurement/field-stock/serials';
// mock fetch
// mock useRouter

it('hydrates filters from URL query on mount', async () => { /* ... */ });
it('updates URL when filters change (debounced)', async () => { /* ... */ });
it('navigates to /serials/[serial] when a result is clicked', async () => { /* ... */ });
```

Run until 3/3 pass.

- [ ] **Task 6 — Add navigation entry**

Add a "Serials" link to the procurement field-stock side-nav (find via `grep -rn "field-stock" src/components/layout/`). Position it below "Dashboard". This is the only nav touch; PR-9's detail page doesn't need a nav entry.

- [ ] **Task 7 — Lint + browser smoke**

```bash
npm run ci:quick
npx tsx scripts/reconcile-serials.ts
```

Browser smoke per "Browser smoke" section below. Screenshot each step.

- [ ] **Task 8 — Open PR**

Body template (re-use PR-7's structure). Include filter screenshots + URL-state-shareable evidence (paste a URL with filters applied; show it renders the same state when pasted into a fresh tab).

### Tests

| File | Layer | Cases |
|---|---|---|
| `pages/api/procurement/field-stock/serials/__tests__/search.test.ts` | API integration (real Postgres) | 6 |
| `tests/pages/procurement/field-stock/serials.test.tsx` | Component integration | 3 |

### Browser smoke

1. Open `dev.fibreflow.app/procurement/field-stock/serials`
2. Search for a known serial number prefix (`GU18W12V`) → see results within 1s
3. Apply `status=issued` filter → URL updates → only `issued` serials shown
4. Copy URL, open in fresh tab → same filtered state on load
5. Search by MAC prefix → results match
6. Click a result row → navigates to `/procurement/field-stock/serials/<serial>` (PR-9 will populate; in PR-8 this is a 404 stub, document it in the PR body)

### Acceptance criteria

- `dev.fibreflow.app/procurement/field-stock/serials` loads in <1.5s
- All 9 tests pass (6 API + 3 page).
- `npm run ci:quick` clean.
- `reconcile-serials` drift=0 (data layer untouched).
- URL state survives copy-paste.
- Mobile viewport renders gracefully (no overflow; filter chips wrap, table becomes a horizontally scrollable region).

---

## PR-9: Serial lifecycle timeline page

**Reviewer:** sonnet
**Dependencies:** PR-7 merged. (Independent of PR-8 for testing, but PR-8 ships the click-through navigation — coordinate merge order if both ready simultaneously.)
**Rollback:** `git revert <merge-sha>` → detail route 404s; clicking through from PR-8 shows the 404 stub.

### Scope

Creates `/procurement/field-stock/serials/[serial]` (detail/timeline) + the admin force-state-correction action.

**Migration:** if the spec's `force_state_correction` event_type needs a non-trivial transition path, this PR adds a single migration. Most likely no migration is needed (event_type is `VARCHAR(50)` permissive per Decision #10) — verify in Task 1.

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/serials/[serial].tsx` | Create | ≤200 lines |
| `pages/api/procurement/field-stock/serials/[serial]/timeline.ts` | Create | ≤180 lines |
| `pages/api/procurement/field-stock/serials/[serial]/force-correct.ts` | Create | ≤200 lines |
| `pages/api/procurement/field-stock/serials/[serial]/__tests__/timeline.test.ts` | Create | ≤200 lines |
| `pages/api/procurement/field-stock/serials/[serial]/__tests__/force-correct.test.ts` | Create | ≤250 lines |
| `tests/pages/procurement/field-stock/serials/[serial].test.tsx` | Create | ≤180 lines |
| `scripts/migrations/sql/<NNN>_force_state_correction_event.sql` | Create only if needed | ≤30 lines |
| `scripts/migrations/sql/rollback_<NNN>_force_state_correction_event.sql` | Same | ≤10 lines |

### Tasks

- [ ] **Task 1 — Probe: is a migration needed for `force_state_correction`?**

```bash
PGPASSWORD=$PG_PASS psql -h 100.96.203.105 -p 5436 -U postgres.ironman-platform -d fibreflow -c "\d stock_serial_events"
```

If `event_type` has no CHECK and no enum, no migration needed; the event-type vocabulary in `eventVocabulary.ts` (PR-7) just gets a new entry.

If there IS a CHECK, add the migration: pick version via `SELECT MAX(version) FROM migrations`, write SQL, write rollback. Open a migration-collision check with `gh pr list --search 'migration in:title'` first.

Document the probe result in the PR body.

- [ ] **Task 2 — `timeline.ts` failing test**

`pages/api/procurement/field-stock/serials/[serial]/__tests__/timeline.test.ts`:

```ts
describe('GET /api/procurement/field-stock/serials/[serial]/timeline', () => {
  it('returns header + ordered events (newest first) for a known serial', async () => { /* ... */ });
  it('returns 404 for an unknown serial', async () => { /* ... */ });
  it('returns LIMIT 50 + nextOffset when serial has >50 events', async () => { /* ... */ });
  it('supports offset pagination via ?offset=50', async () => { /* ... */ });
  it('returns 401 without auth', async () => { /* ... */ });
});
```

Run, expect 5/5 fail.

- [ ] **Task 3 — Implement `timeline.ts`**

SQL: lookup serial by `serial_number` → return header (`stock_serials.* JOIN stock_locations`) + events (`stock_serial_events WHERE serial_id = $1 ORDER BY occurred_at DESC LIMIT 50 OFFSET $2`). Include `actor_name` via JOIN to `staff` or `users` based on which actor column is populated.

Run tests, watch them pass.

- [ ] **Task 4 — `force-correct.ts` failing test**

`pages/api/procurement/field-stock/serials/[serial]/__tests__/force-correct.test.ts`:

```ts
describe('POST /api/procurement/field-stock/serials/[serial]/force-correct', () => {
  it('updates stock_serials.status + emits a force_state_correction event', async () => {
    // POST { from: 'issued', to: 'available', reason: 'physical recount' }
    // expect 200, stock_serials.status === 'available', new event row exists
  });
  it('400 if reason is empty or <10 chars', async () => { /* ... */ });
  it('409 if from-state does not match current stock_serials.status (optimistic-lock)', async () => { /* ... */ });
  it('403 if user role is not admin', async () => { /* ... */ });
  it('atomic: status update + event insert succeed together or neither', async () => {
    // simulate event insert failure (e.g. invalid actor) → status must NOT have changed
  });
});
```

Run, expect 5/5 fail.

- [ ] **Task 5 — Implement `force-correct.ts`**

Within a single transaction:
1. `SELECT FOR UPDATE` on `stock_serials WHERE serial_number = $1`
2. Verify `current.status === body.from` (optimistic lock)
3. `INSERT INTO stock_serial_events` with `event_type='force_state_correction'`, `from_state=body.from`, `to_state=body.to`, `actor_user_id=user.id`, `payload={reason: body.reason}`
4. `UPDATE stock_serials SET status = $to_state, updated_at = NOW()`
5. COMMIT

Auth: `withAuth` + role check (`user.role === 'super_admin' || user.role === 'admin'`). Reason MUST be non-empty and ≥10 chars (rule: enforce server-side; client validates too).

Critical: the trigger `emit_serial_event_on_picking_done` doesn't fire here — we're manually emitting the event because there's no source-table change. That's correct behaviour.

Run tests, watch them pass.

- [ ] **Task 6 — Detail page component + add-note hook**

`pages/procurement/field-stock/serials/[serial].tsx` mounts `<SerialTimeline>` with admin actions injected via `renderAdminActions`:

```tsx
// Pseudocode contract
function SerialDetailPage() {
  const { data, isLoading } = useSWR(`/api/.../timeline`, fetcher);
  const user = useAuth();
  return (
    <AppLayout>
      <SerialTimeline
        header={data.header}
        events={data.events}
        onSourceClick={navigateToSource}
        renderAdminActions={user.isAdmin ? () => <ForceCorrectModal serial={data.header} /> : undefined}
      />
      {data.hasMore && <button onClick={loadMore}>Load more</button>}
    </AppLayout>
  );
}
```

`navigateToSource` routes:
- `stock_pickings` → `/procurement/field-stock/pickings/<id>`
- `qa_photo_reviews` → `/construction-qa/reviews/<id>` (existing page)
- `oes_pp_data` → `/oes/pp/<id>` (existing page)
- `stock_returns` → `/procurement/field-stock/returns/<id>` (created PR-14)
- Others → no link (just show the source id as plain text)

- [ ] **Task 7 — Page integration test**

`tests/pages/procurement/field-stock/serials/[serial].test.tsx`:

```tsx
it('renders timeline header + events for a known serial', async () => { /* ... */ });
it('shows force-correct button only for admin users', async () => { /* ... */ });
it('force-correct round-trip: opens modal, posts, re-fetches, shows new event', async () => { /* ... */ });
it('clicking a source link navigates to the correct route', async () => { /* ... */ });
```

- [ ] **Task 8 — Browser smoke + PR**

Smoke per "Browser smoke" below. PR body must include before/after screenshots of a force-correct round-trip on a TEST serial (NOT a real production serial — pick one from the imported-but-unused pool). Include `reconcile-serials` output BEFORE and AFTER the force-correct: drift MUST remain 0 (the manually-emitted event keeps `latest_event_matches_status` consistent).

### Tests

| File | Layer | Cases |
|---|---|---|
| `pages/api/.../timeline.test.ts` | API integration | 5 |
| `pages/api/.../force-correct.test.ts` | API integration | 5 |
| `tests/pages/.../[serial].test.tsx` | Component integration | 4 |

### Browser smoke

1. Open `/procurement/field-stock/serials/<known-serial>` → header + timeline render
2. Click an event's source link → navigates to the right place
3. As admin, open the force-correct modal → submit with reason → modal closes → new event appears at top → status badge updates
4. As non-admin, force-correct button is absent
5. `reconcile-serials` drift=0 after the force-correct

### Acceptance criteria

- Detail page renders for any serial that exists.
- 14 tests pass (5 + 5 + 4).
- Force-correct creates a `stock_serial_events` row AND updates `stock_serials.status` atomically.
- `reconcile-serials` drift=0 after a force-correct.
- Migration (if any) applied via `psql -f` per Wave-1 workaround, with rollback SQL also present in the same commit.

---

## PR-10: Dashboard rebuild

**Reviewer:** sonnet
**Dependencies:** PR-7 merged.
**Rollback:** `git revert <merge-sha>` → `/legacy/index.tsx` becomes canonical again (the re-mount path is the inverse of the cutover).

### Scope

Rebuilds `/procurement/field-stock` (the dashboard) using the new tile vocabulary from spec lines 311-318. Moves the existing `pages/procurement/field-stock/index.tsx` to `pages/procurement/field-stock/legacy/index.tsx` AND updates `pages/api/procurement/field-stock/dashboard.ts` response shape to feed the new tiles.

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/index.tsx` | Replace (new content) | ≤200 lines |
| `pages/procurement/field-stock/legacy/index.tsx` | Create (moved from above) | (unchanged) |
| `pages/api/procurement/field-stock/dashboard.ts` | Modify (extend response shape) | ≤250 lines |
| `pages/api/procurement/field-stock/__tests__/dashboard.test.ts` | Create | ≤250 lines |
| `tests/pages/procurement/field-stock/index.test.tsx` | Create | ≤150 lines |

### Tasks

- [ ] **Task 1 — Capture current `dashboard.ts` shape + callers**

```bash
git mv pages/procurement/field-stock/index.tsx pages/procurement/field-stock/legacy/index.tsx
grep -rn "/api/procurement/field-stock/dashboard" src pages | grep -v __tests__
```

If the legacy index has callers we don't control (e.g. other pages embed the dashboard), document and decide whether the new shape is backwards-compatible (preferred) or breaking (fallback). Default: extend the response with new keys, keep old keys for one PR cycle, drop them in PR-14 cleanup.

- [ ] **Task 2 — Failing API test**

`pages/api/procurement/field-stock/__tests__/dashboard.test.ts`:

```ts
describe('GET /api/procurement/field-stock/dashboard', () => {
  it('returns stock_on_hand by status (donut data) for all warehouses combined', async () => { /* ... */ });
  it('returns today_activity counts (issued / returned / installed / activated)', async () => { /* ... */ });
  it('returns drift_count from the 6 reconcile checks', async () => { /* ... */ });
  it('returns blocked_contractors count', async () => { /* ... */ });
  it('returns low_stock_alerts (empty array if stock_quants empty per audit)', async () => { /* ... */ });
  it('responds in <500ms against a seeded 50k-serial corpus', async () => { /* ... */ });
});
```

- [ ] **Task 3 — Implement extended `dashboard.ts`**

Five queries, ideally a single round-trip via CTEs:

```sql
WITH stock_on_hand AS (
  SELECT status, COUNT(*) AS n FROM stock_serials WHERE status NOT IN ('scrapped') GROUP BY status
),
today_activity AS (
  SELECT event_type, COUNT(*) AS n FROM stock_serial_events
  WHERE occurred_at >= CURRENT_DATE
    AND event_type IN ('issued','returned','installed_at_drop','activated')
  GROUP BY event_type
),
drift AS (
  -- inline the 6 reconcile queries' COUNTs (or just COUNT them total) — design choice for this task
  SELECT 0::int AS total_drift  -- placeholder; real query inlined here
),
blocked AS (
  SELECT COUNT(*) AS n FROM contractor_stock_accountability WHERE is_blocked = true
)
SELECT row_to_json((SELECT x FROM (SELECT
  (SELECT json_agg(stock_on_hand.*) FROM stock_on_hand) AS stock_on_hand,
  (SELECT json_agg(today_activity.*) FROM today_activity) AS today_activity,
  (SELECT total_drift FROM drift) AS drift_count,
  (SELECT n FROM blocked) AS blocked_contractors
) x));
```

Real query: write it against prod columns. Don't trust this skeleton — verify each table name + column exists.

Performance budget: <500ms p50 on the production corpus. If it exceeds budget, split into separate queries OR add a materialized view (defer the view to PR-14 cleanup if needed).

- [ ] **Task 4 — Dashboard page component**

`pages/procurement/field-stock/index.tsx`: 5 tiles + 1 donut chart. Donut via `recharts` (existing dep). Each tile is a `<Card>` with click-through to filtered view.

- [ ] **Task 5 — Add ModuleNav per project rule**

Per `feedback_module_nav.md`, multi-page modules use ModuleNav horizontal tab bar. This dashboard IS the module landing — surface the tab bar pointing at: Dashboard (active) | Serials | Pickings | Movements | Returns | Reconciliation | Accountability | Warehouses | Projects.

Some tabs route to pages that don't exist yet (PR-12, PR-13, PR-14). Leave them as `disabled` or `coming soon` until those PRs land. Track this debt in the PR body so PR-12/13/14 know to flip the flag.

- [ ] **Task 6 — Page integration test**

`tests/pages/procurement/field-stock/index.test.tsx`:

```tsx
it('renders all 5 tiles + donut with API data', async () => { /* ... */ });
it('clicking the drift tile navigates to /reconciliation', async () => { /* ... */ });
it('renders ModuleNav with the right tabs (some disabled)', async () => { /* ... */ });
```

- [ ] **Task 7 — Browser smoke**

1. `dev.fibreflow.app/procurement/field-stock` → new dashboard renders within 1.5s
2. Old `/procurement/field-stock/legacy` route still serves the old page (verify revert path works)
3. Each tile click navigates to the right child route (or "coming soon" for disabled tabs)
4. Donut shows the 11 active states with proportional slices
5. `reconcile-serials` drift=0

- [ ] **Task 8 — PR**

Body: before/after screenshots, mention `/legacy/` re-mount for revert, paste `dashboard.ts` p50 latency from the integration test.

### Acceptance criteria

- New dashboard lives at canonical `/procurement/field-stock`.
- `/procurement/field-stock/legacy` serves the old dashboard (revert escape hatch).
- All 9 tests pass (6 API + 3 page).
- p50 latency <500ms on the dashboard endpoint.
- ModuleNav present.

---

## PR-11: Reconciliation page

**Reviewer:** sonnet
**Dependencies:** PR-7 merged.
**Rollback:** `git revert <merge-sha>` → `/legacy/reconciliation` becomes canonical.

### Scope

Rebuilds `/procurement/field-stock/reconciliation` using `<ReconciliationReport>`. Adds `/api/.../reconciliation/list.ts` and `/api/.../reconciliation/resolve.ts`. Resolve emits a `note_added` event only — no status mutation (Decision #4).

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/reconciliation.tsx` | Replace | ≤180 lines |
| `pages/procurement/field-stock/legacy/reconciliation.tsx` | Create (moved) | (unchanged) |
| `pages/api/procurement/field-stock/reconciliation/list.ts` | Create | ≤250 lines |
| `pages/api/procurement/field-stock/reconciliation/resolve.ts` | Create | ≤180 lines |
| `pages/api/procurement/field-stock/reconciliation/__tests__/list.test.ts` | Create | ≤200 lines |
| `pages/api/procurement/field-stock/reconciliation/__tests__/resolve.test.ts` | Create | ≤200 lines |
| `tests/pages/procurement/field-stock/reconciliation.test.tsx` | Create | ≤150 lines |

### Tasks

- [ ] **Task 1 — Move legacy + scaffold new file**

```bash
git mv pages/procurement/field-stock/reconciliation.tsx pages/procurement/field-stock/legacy/reconciliation.tsx
touch pages/procurement/field-stock/reconciliation.tsx
```

- [ ] **Task 2 — `list.ts` failing test**

```ts
describe('GET /api/procurement/field-stock/reconciliation/list', () => {
  it('returns one DriftRow per check from reconcile-queries.sql', async () => {
    // expect 6 rows: assets_without_serial, ..., latest_event_matches_status
  });
  it('each row includes drift_count, tolerance, and up to 10 sample_rows', async () => { /* ... */ });
  it('returns 401 without auth', async () => { /* ... */ });
});
```

- [ ] **Task 3 — Implement `list.ts`**

Strategy: re-use `scripts/migrations/sql/reconcile-queries.sql` (the file the CLI reads). Parse the named checks via the same regex the CLI uses (`scripts/reconcile-serials.ts:parseChecks`). For each check, run the COUNT query AND additionally a sample-row query (top 10).

Sample-row queries: write a second `reconcile-sample-queries.sql` file alongside the main one, with matching `@name` markers but selecting concrete rows instead of counts. This keeps the CLI single-purpose and lets the UI surface deeper detail.

```ts
// Skeleton
async function listDrift(): Promise<DriftRow[]> {
  const checks = parseChecksFromSqlFile('scripts/migrations/sql/reconcile-queries.sql');
  const samples = parseChecksFromSqlFile('scripts/migrations/sql/reconcile-sample-queries.sql');
  return Promise.all(checks.map(async (c) => ({
    check_name: c.name,
    drift_count: parseInt((await pool.query(c.sql)).rows[0].drift_count),
    tolerance: c.tolerance,
    sample_rows: (await pool.query(samples.find((s) => s.name === c.name)?.sql ?? 'SELECT 1 WHERE false')).rows.slice(0, 10),
  })));
}
```

- [ ] **Task 4 — `resolve.ts` failing test**

```ts
describe('POST /api/procurement/field-stock/reconciliation/resolve', () => {
  it('emits a note_added event with the supplied reason', async () => { /* ... */ });
  it('does NOT mutate stock_serials.status', async () => {
    // POST resolve, then SELECT status FROM stock_serials WHERE id = $1
    // assert status === pre_resolve_status
  });
  it('400 if reason is empty or <10 chars', async () => { /* ... */ });
  it('403 if user is not admin', async () => { /* ... */ });
  it('idempotent: resolving the same drift twice does NOT create a second event', async () => { /* ... */ });
});
```

The idempotency rule: a drift row is identified by `check_name + sample_row_pkey`. Calling resolve twice with the same identifier inserts only one event. Encode this as: `ON CONFLICT (serial_id, source_table, source_id, event_type) DO NOTHING` where `source_table = 'reconciliation_resolve'` and `source_id = <stable hash of check_name + sample_pkey>`.

- [ ] **Task 5 — Implement `resolve.ts`**

Per the test signatures. Wrap in `withAuth` + admin role check. Insert a `note_added` event with `payload = {reason, check_name, sample_pkey}`. Do NOT update `stock_serials.status`.

- [ ] **Task 6 — Page**

`pages/procurement/field-stock/reconciliation.tsx`: fetches `/list` on mount, passes rows to `<ReconciliationReport>`, wires `onResolve` to POST `/resolve`. After resolve, re-fetch.

- [ ] **Task 7 — Page integration test**

```tsx
it('renders 6 drift sections with counts from API', async () => { /* ... */ });
it('resolve modal posts to /resolve and re-fetches', async () => { /* ... */ });
it('non-admin user sees data but not resolve buttons', async () => { /* ... */ });
```

- [ ] **Task 8 — Browser smoke + PR**

Browser smoke:
1. `/procurement/field-stock/reconciliation` → 6 sections render
2. Today all 6 should show drift=0 — verify the UI handles "all clear" gracefully (empty state message, no empty tables)
3. Manually introduce drift on a test serial (e.g. UPDATE stock_serials SET status='issued' WHERE id = '<test>' — bypassing the event log) → `/list` returns drift_count=1 in the relevant check
4. As admin, resolve with a reason → event appears in the timeline of that serial
5. Repeat resolve → idempotent, no duplicate event
6. Undo the manual drift, reconcile-serials drift=0

### Acceptance criteria

- 13 tests pass.
- Resolve is idempotent.
- Resolve emits `note_added`, never changes `status`.
- Sample rows render within `<ReconciliationReport>` (max 10 per check).

---

## PR-12: Warehouses drill-down

**Reviewer:** sonnet
**Dependencies:** PR-7 merged. Note that PR-10's ModuleNav had this tab as disabled — this PR flips it on (single-line edit, document in PR body).
**Rollback:** `git revert <merge-sha>` → tab goes back to disabled.

### Scope

Creates `/procurement/field-stock/warehouses` (list) and `/procurement/field-stock/warehouses/[warehouseId]` (detail). Detail page embeds `<SerialSearch>` with `warehouseId` hidden in filters (always set to the URL param). New APIs: `/api/.../warehouses/index.ts` (list) and `/api/.../warehouses/[warehouseId].ts` (warehouse metadata + on-hand stats).

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/warehouses/index.tsx` | Create | ≤150 lines |
| `pages/procurement/field-stock/warehouses/[warehouseId].tsx` | Create | ≤180 lines |
| `pages/api/procurement/field-stock/warehouses/index.ts` | Create | ≤150 lines |
| `pages/api/procurement/field-stock/warehouses/[warehouseId].ts` | Create | ≤180 lines |
| `pages/api/procurement/field-stock/warehouses/__tests__/index.test.ts` | Create | ≤150 lines |
| `pages/api/procurement/field-stock/warehouses/__tests__/[warehouseId].test.ts` | Create | ≤180 lines |
| `tests/pages/procurement/field-stock/warehouses/[warehouseId].test.tsx` | Create | ≤150 lines |

### Tasks

- [ ] **Task 1 — Probe**: identify the warehouse table. Likely `stock_locations` (already used by `/api/procurement/field-stock/locations.ts`). Run `\d stock_locations` to confirm columns.

- [ ] **Task 2 — `index.ts` API + test**: returns the list of warehouses with on-hand counts per status. Tests cover: list shape, includes on-hand counts, 401 without auth.

- [ ] **Task 3 — Implement `index.ts`**.

- [ ] **Task 4 — `[warehouseId].ts` API + test**: returns warehouse metadata + status breakdown + recent events. Tests cover: 200 with valid id, 404 with unknown id, includes status breakdown.

- [ ] **Task 5 — Implement `[warehouseId].ts`**.

- [ ] **Task 6 — Page components**: `index.tsx` = list with click-through; `[warehouseId].tsx` = header + on-hand donut + embedded `<SerialSearch>` with `hiddenFilters={['warehouseId']}` and `initialFilters={{warehouseId: router.query.warehouseId}}`.

- [ ] **Task 7 — Tests + lint + smoke**

Browser smoke:
1. `/procurement/field-stock/warehouses` → list renders, click-through works
2. `/procurement/field-stock/warehouses/<id>` → detail renders with donut + embedded search filtered to that warehouse
3. `reconcile-serials` drift=0
4. Flip the ModuleNav tab from disabled to enabled in `pages/procurement/field-stock/index.tsx` — verify navigation works from dashboard

- [ ] **Task 8 — PR**

### Acceptance criteria

- Both routes render.
- Embedded `<SerialSearch>` is locked to the warehouse via `hiddenFilters`.
- Reverse-navigation: clicking a serial row from inside the warehouse page → goes to `/serials/<serial>` (PR-9) — not back to warehouses.

---

## PR-13: Projects drill-down

**Reviewer:** sonnet
**Dependencies:** PR-7 merged.
**Rollback:** identical pattern.

### Scope

Mirror of PR-12 for projects. `/procurement/field-stock/projects` (list) + `/procurement/field-stock/projects/[projectId]` (detail with embedded `<SerialSearch>` locked to project).

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/projects/index.tsx` | Create | ≤150 lines |
| `pages/procurement/field-stock/projects/[projectId].tsx` | Create | ≤180 lines |
| `pages/api/procurement/field-stock/projects/index.ts` | Create | ≤150 lines |
| `pages/api/procurement/field-stock/projects/[projectId].ts` | Create | ≤180 lines |
| `__tests__` files | Create | 3 files, ≤180 lines each |

### Tasks

Tasks 1-8: mirror PR-12 step-by-step. Substitute "warehouse" → "project". The project table is `projects` (existing). On-hand counts join `stock_serials.allocated_to_project_id` (added in Wave 1).

Smoke step extra: verify a project with 0 allocated serials still renders gracefully (`<SerialSearch>` shows empty state, not an error).

### Acceptance criteria

- Both routes render.
- Embedded search locked to project.
- Empty-project case renders cleanly.

---

## PR-14: Event-filter views (pickings, movements, returns)

**Reviewer:** sonnet
**Dependencies:** PR-7 merged. PR-10 ModuleNav tabs for these three become live.
**Rollback:** `git revert <merge-sha>` → three tabs return to disabled.

### Scope

Creates `/procurement/field-stock/pickings`, `/procurement/field-stock/movements`, `/procurement/field-stock/returns`. Each is an event-filtered view over `stock_serial_events`, NOT a re-skin of the existing picking/return entities. The existing `pages/procurement/field-stock/pickings/[pickingId].tsx` (picking detail) stays canonical — these new index pages link INTO it, they don't replace it.

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/pickings.tsx` | Create (note: separate from `pickings/[pickingId].tsx`) | ≤180 lines |
| `pages/procurement/field-stock/movements.tsx` | Create | ≤180 lines |
| `pages/procurement/field-stock/returns.tsx` | Create | ≤180 lines |
| `pages/api/procurement/field-stock/events.ts` | Create — single endpoint with `type` filter | ≤220 lines |
| `pages/api/procurement/field-stock/__tests__/events.test.ts` | Create | ≤250 lines |
| `tests/pages/procurement/field-stock/{pickings,movements,returns}.test.tsx` | Create — 3 files | ≤120 lines each |

### Tasks

- [ ] **Task 1 — Naming check**

The new `pages/procurement/field-stock/pickings.tsx` is a SIBLING to the existing `pickings/[pickingId].tsx`. In Pages Router, `pickings.tsx` matches `/procurement/field-stock/pickings` exactly while `pickings/[pickingId].tsx` matches `/procurement/field-stock/pickings/<id>`. Verify no Next.js routing conflict — write a quick test that hits both URLs and confirms each routes to the right file.

If conflict: rename to `pickings/index.tsx` (still matches `/procurement/field-stock/pickings`) and move the existing dynamic route under that directory.

- [ ] **Task 2 — Unified events API + test**

`pages/api/procurement/field-stock/events.ts` with query params: `type` (one of `picking`/`movement`/`return`), `from`, `to`, `contractor_id`, `serial_id`, `limit`, `offset`. The `type` param maps to event_type sets:

```ts
const TYPE_TO_EVENT_TYPES: Record<string, string[]> = {
  picking:   ['issued'],
  movement:  ['transferred'],
  return:    ['returned', 'inspected', 'restocked', 'sent_to_repair', 'scrapped'],
};
```

Tests cover: filtering, pagination, joins to source rows for actor/contractor labels.

- [ ] **Task 3 — Implement `events.ts`**.

- [ ] **Task 4 — Three pages**

Each page is thin: mounts a shared `<EventList>` (a sub-component lifted from these pages — define it in `src/components/field-stock/EventList.tsx`, ≤150 lines, with its own tests) configured with the relevant `type`. URL state for filters.

Actually, defer `<EventList>` to a follow-up if it overflows file-count budget. Initial implementation: copy the table structure across the three pages (DRY violation accepted — three nearly-identical 60-line tables — to keep PR scope tight). Note the duplication in the PR body for follow-up cleanup.

- [ ] **Task 5 — Tests for each page**

3 integration tests, one per page. Each verifies: list renders, click-through to serial detail (PR-9), filter persistence in URL.

- [ ] **Task 6 — Flip ModuleNav tabs**

In `pages/procurement/field-stock/index.tsx`: remove the `disabled` state on the Pickings / Movements / Returns tabs.

- [ ] **Task 7 — Lint + smoke**

Browser smoke covers all three new pages + verifies PR-10's ModuleNav now has 3 more live tabs.

- [ ] **Task 8 — PR**

### Acceptance criteria

- All three routes render with event-filtered data.
- Click-through to `/serials/<serial>` works from each.
- PR-10's ModuleNav has these three tabs live.
- p50 latency <800ms on the unified `events.ts` endpoint (likely needs an index on `stock_serial_events.event_type, occurred_at DESC`; add it as a migration in Task 2 if missing).

---

## PR-15: Accountability + items + locations

**Reviewer:** `/review-team` (blind multi-reviewer per Decision #5).
**Dependencies:** PR-7 merged. **All other PR-8 through PR-14 should be merged first** — PR-15 ships against a stable Wave-2 surface.
**Rollback:** `git revert <merge-sha>` → existing accountability/items/locations behaviour restored (these existing pages don't get a `/legacy/` since they're new pages, NOT rebuilds; verify in Task 1).

### Scope

Creates four new pages: `accountability/index.tsx`, `accountability/[contractorId].tsx`, `items.tsx`, `locations.tsx`. The accountability pages are the highest-blast-radius surface in Wave 2 because they read the (Wave-1-fixed) contractor counter logic.

### Files

| File | Action | Budget |
|---|---|---|
| `pages/procurement/field-stock/accountability/index.tsx` | Create | ≤180 lines |
| `pages/procurement/field-stock/accountability/[contractorId].tsx` | Create | ≤200 lines |
| `pages/procurement/field-stock/items.tsx` | Create | ≤180 lines |
| `pages/procurement/field-stock/locations.tsx` | Create | ≤180 lines |
| `tests/pages/procurement/field-stock/accountability/index.test.tsx` | Create | ≤120 lines |
| `tests/pages/procurement/field-stock/accountability/[contractorId].test.tsx` | Create | ≤180 lines |
| `tests/pages/procurement/field-stock/items.test.tsx` | Create | ≤120 lines |
| `tests/pages/procurement/field-stock/locations.test.tsx` | Create | ≤120 lines |

**No new API endpoints in PR-15** — accountability/items/locations APIs already exist (`pages/api/procurement/field-stock/{accountability,items,locations}*`). This PR consumes them.

### Tasks

- [ ] **Task 1 — Audit existing accountability behaviour**

Read `pages/api/procurement/field-stock/accountability/index.ts`, `[contractorId]/index.ts`, `block.ts`, `unblock.ts`, `reconcile.ts`. Compile a one-page note for the review-team on:
- What the counters mean (`total_issued_count`, `total_returned_count`, derived `outstanding_count`).
- The block / unblock thresholds (per `feedback_contractor_accountability` if present).
- The reconcile endpoint — what it does, what triggers it.

This note ships INSIDE the PR body so the reviewers don't have to reverse-engineer it.

- [ ] **Task 2 — Accountability index page**

`accountability/index.tsx`: list of contractors with their counters + block/unblock status + outstanding count + link-through.

- [ ] **Task 3 — Accountability contractor detail**

`accountability/[contractorId].tsx`: contractor header + counter widgets + embedded `<SerialSearch>` with `contractorId` hidden + admin block/unblock action. Wire the block/unblock action to the existing endpoint with confirmation modal.

- [ ] **Task 4 — Items page**

`items.tsx`: stock-item catalog. Embed `<SerialSearch>` with no hidden filters (acts like a "by-item" alternative entry to /serials).

- [ ] **Task 5 — Locations page**

`locations.tsx`: warehouses table. Sister page to `warehouses/index.tsx` from PR-12 — items page is for *what*, locations page is for *where*. Decision: keep them separate (existing `pages/api/procurement/field-stock/locations.ts` covers Odoo-style location metadata; warehouses are the storage subset).

Distinguish their personas in the page intro: "Locations" = full Odoo location tree (read-only); "Warehouses" = stock-holding locations only.

- [ ] **Task 6 — Tests**

Per-file unit/integration tests. Critical test on accountability: counters as displayed on the page MUST match counters as returned by the existing API endpoint (no UI-side double-counting bug).

- [ ] **Task 7 — Flip ModuleNav tabs**

Accountability + Items + Locations tabs go live.

- [ ] **Task 8 — Open PR + dispatch `/review-team`**

Invoke `/review-team` in the PR description (the review team itself runs against the diff). Include the Task-1 audit note. Reviewer team must include at least one reviewer focused on the accountability counter logic — flag it explicitly in the PR description.

### Acceptance criteria

- 4 routes render.
- Counter values on accountability/[contractorId] match the API response 1:1 (no display-side arithmetic).
- Block/unblock round-trip works in the browser.
- `/review-team` blind review APPROVED before merge.
- All 4 ModuleNav tabs live.
- `reconcile-serials` drift=0 after every browser smoke step (counters survive UI interaction).

### Browser smoke

1. `/procurement/field-stock/accountability` → contractor list renders with counters
2. Click a contractor → detail page with counters + embedded serial search filtered to that contractor
3. As admin, block contractor → confirmation modal → contractor row updates to "Blocked" state
4. Unblock → state reverts
5. `/procurement/field-stock/items` → stock items renders + embedded search
6. `/procurement/field-stock/locations` → locations renders
7. `reconcile-serials` drift=0

---

## Wave 2 success criteria (per spec lines 363-369)

- [ ] `<SerialSearch>` resolves any serial by serial_number OR mac_address.
- [ ] `<SerialTimeline>` renders every event with click-through to source records.
- [ ] Accountability counters move correctly through real picking/return roundtrips.
- [ ] `<ReconciliationReport>` drift < 100 rows.
- [ ] `/stock/portal` (storeman counter UI) untouched and operational through entire Wave 2.
- [ ] `npm run ci:quick` clean throughout.
- [ ] All production deploys post-business-hours with Hein's approval.

---

## Self-review

**Spec coverage check** (skimming spec lines 277-378 against the plan):

| Spec section | Covered by |
|---|---|
| `<SerialSearch>` master component | PR-7 Task 4 |
| `<SerialTimeline>` component | PR-7 Task 5 |
| `<ReconciliationReport>` component | PR-7 Task 6 |
| Dashboard tiles (5 tiles) | PR-10 |
| `/serials` master search page | PR-8 |
| `/serials/[serial]` lifecycle page | PR-9 |
| `/warehouses[/id]` drill-down | PR-12 |
| `/projects[/id]` drill-down | PR-13 |
| `/reconciliation` UI | PR-11 |
| `/pickings`, `/movements`, `/returns` event filters | PR-14 |
| `/accountability` + `/items` + `/locations` | PR-15 |
| Admin force-state-correction | PR-9 Task 5 |
| "Mark as resolved" with reason | PR-11 Task 5 |
| 12-state status vocabulary | PR-7 Task 1 |
| Event-type vocabulary | PR-7 Task 1 |
| Testing strategy (real DB, no mocks) | All PRs |
| Browser smoke (spec lines 371-376) | Each PR's "Browser smoke" section |

**No gaps identified.**

**Placeholder scan:** searched plan for TBD / TODO / "implement later" / "fill in details" / "similar to". Every code/SQL block contains either real code, a real contract (typed interface), or a real test signature. JSX bodies intentionally omitted per the "code shape is the battleground" instruction — replaced by props contracts and behavioural test signatures.

**Type consistency:** `SerialStatus`, `SerialSearchFilters`, `SerialSearchResult`, `SerialTimelineEvent`, `DriftRow` types defined once in PR-7's `.types.ts` files, referenced consistently across PR-8 through PR-15. ModuleNav tab states (`disabled` → `enabled`) tracked PR-by-PR with the PR-10 introduction and PR-12/13/14/15 flips called out.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-serial-master-register-wave2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task with two-stage review. Best for this plan because PR-7 through PR-15 are mostly independent after PR-7 lands, so parallelism is real.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`. Batch execution with checkpoints for review. Best for PR-7 if you want close oversight on the shared-components decisions before the parallel tracks open.

Recommended path: **PR-7 inline (close oversight on the shared-component contracts) → PR-8 through PR-14 subagent-driven in parallel batches of 3 → PR-15 subagent-driven last with `/review-team`.**

Note: do not begin PR-7 until the **2026-05-23 ~20:00 SAST gate** opens (Wave 1 ≥48h soak).
