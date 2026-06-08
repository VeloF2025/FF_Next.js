# Works QA — Recent Submissions Feed

**Status:** Spec / ready for build
**Author:** Hein (request) · spec drafted with Claude
**Date:** 2026-06-08
**Module:** `src/modules/works-qa` · page `/field-ops/works-qa`
**Branch:** `feat/works-qa-recent-submissions`

---

## 1. Problem

The Works QA overview shows **cumulative** per-site state (QA progress, photo slots,
counts). It does **not** show *what arrived recently*. To know what's newly ready to
QA, Johan/Hein currently have to ask the field teams — so recent work gets missed.

Source of request: Hein voice note over a screen recording of the overview (2026-06-05).

## 2. Goal

A **"Recent submissions"** view on the Works QA overview that answers, for a chosen
window (**Since I last opened** / 3 days / 7 days):

> *What field work landed recently, by Site → Zone → PON → pole count, that I should QA?*

Example target line: *"Mohadin · Zone 2 · PON 25 — 6 poles, Civil ready (latest synced yesterday)."*

**"Since I last opened" is a per-user watermark** (see §5b) — the default window — so each
QA reviewer sees only what arrived since *their* last visit, not a fixed calendar window.

## 3. Key domain constraint — QA is phased by discipline

QA is **not** one event per pole. The pole lifecycle is sequential and the photo sets
arrive **weeks apart**:

| Discipline | Slots | Approve column | When (field sequence) |
|---|---|---|---|
| **Civil** | 8 (`civil_step_01..08`) | `civil_approved` | After pole **planted** |
| **Dome** (optical splice) | 8 (`optical_dome_01..08`) | `dome_approved` | After **stringing** |
| **Main Joint** | 6 (`main_joint_11..16`) + ≥1 tray photo | `joint_approved` | Later still |

This is already modelled: `disciplineGatesPass()` and the three `*_approved` boolean
columns exist (`src/modules/works-qa/utils/approval-gates.ts`, `pages/api/works-qa/pole-approve.ts`).
`approved_at` only stamps once **all three** disciplines are approved, so it is **not**
usable as a per-discipline signal — use the boolean columns.

**Decision:** the feed is keyed on **`(pole × discipline)`**, not `(pole)`. A pole
legitimately appears in the Civil lane now, the Dome lane weeks later, the Main Joint
lane later still. The UI is **three discipline lanes**.

## 4. What the feed shows (agreed)

Per discipline lane, rolled up Site → Zone → PON:

- **Primary — "Ready to QA":** disciplines that are **complete** (all required slot
  columns present; main_joint also needs ≥1 tray photo) **and not yet approved**
  (`<discipline>_approved IS NOT TRUE`), whose latest photo landed within the window.
  This is Johan's actionable worklist.
- **Secondary — "Partial":** a per-lane **count** of disciplines with *some but not
  all* slots present, none approved, with activity in the window (e.g. *"+8 partial"*).
  Click to expand; shows e.g. *"Civil 5/8 — latest 6 days ago"* so incomplete sets
  don't slip through. Collapsed by default — keeps the worklist clean.

**Recency anchor** for a `(pole, discipline)` = the timestamp of the **last photo that
landed for that discipline** (see §5). A pole receiving optical photos must not disturb
its position in the Civil lane — hence per-discipline, not per-pole, recency.

### Non-goals (v1)
- No write-back to QField.
- No WhatsApp/email digest (natural follow-on — see §10; out of scope for v1).
- No change to the existing approval/VLM flow.
- "Complete" for the feed = **all slot photos present** (+ tray for main_joint). The
  VLM-valid / override nuance stays where it belongs — the approve gate at review time.
  Rationale: this is a triage feed ("all photos in → worth looking at"), and it keeps
  the aggregate query free of per-slot JSONB evaluation.

## 5. Data source — the one real risk (verify FIRST)

Per-discipline recency needs a **per-photo submission timestamp**, which
`pole_qa_photos` does **not** have (single `updated_at` per pole row). It must come
from upstream **`qfield_photo_validations`**, mapping each validation row to a discipline
via `resolveSlotKey(checklist_step, work_type)` → `getSlotMeta().discipline`
(both already exist in `sync-qfield.ts` / `slot-keys.ts`).

**Task 0 (blocking):** confirm against the live DB that `qfield_photo_validations` has a
populated submission timestamp column (candidate: `validated_at`; `created_at`).

```sql
\d qfield_photo_validations
SELECT count(*), count(validated_at), min(validated_at), max(validated_at)
FROM qfield_photo_validations WHERE feature_type='pole';
```

- **If present & populated → Strategy A (precise):** recency =
  `max(q.validated_at)` per `(fibreflow_project, pole, discipline)`, joining
  `qfield_photo_validations` → `qfield_project_links` → `sow_poles` (zone/pon).
  Completeness still computed from `pole_qa_photos` slot columns (source of truth for
  "synced into QA").
- **If absent/sparse → Strategy B (coarse fallback):** recency = `pole_qa_photos.updated_at`
  (pole-level). Completeness + approval from `pole_qa_photos`. Caveat surfaced in UI:
  a pole touched for a later discipline re-surfaces earlier lanes; acceptable for a
  triage window but label the timestamp "last activity," not "submitted."

Pick the strategy in Task 0; the rest of the build is identical.

## 5b. Per-user "since I last opened" watermark

**Storage:** new table, one row per user, keyed by email (matches `approved_by`/`created_by`):

```sql
-- As built (migration 403). Two timestamps so a refresh doesn't blank the feed:
CREATE TABLE works_qa_view_watermark (
  user_email      TEXT PRIMARY KEY,
  cutoff_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- "since I last opened" boundary
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- heartbeat for session detection
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
`cutoff_at` only rolls forward to `last_active_at` when a new session starts
(>30 min gap); a refresh within the session keeps the same cutoff.
Migration goes alongside the other works-qa migrations. **Version = MAX(live DB
`schema_migrations`/`migrations` max, `ls` max) + 1, confirmed against the live DB at
build** (the fresh worktree shows 345 in `scripts/migrations/sql/`, but live is ahead —
do not hardcode; the runner heals dual-tracker drift).

**Window semantics (`window=since_last`):**
- Cutoff = the caller's stored `last_viewed_at`. First-ever visit (no row) → fall back
  to `NOW() - 7 days` so the first open isn't empty or unbounded.
- Items newer than the cutoff render with a **"NEW"** highlight; a divider separates
  *new since last visit* from *older-but-still-in-window*.

**Watermark advance (refresh-safe — the one design subtlety):**
- **Auto-advance on open, debounced:** set `last_viewed_at = NOW()` only if the previous
  value is older than **30 min** (the tunable). This gives the automatic "since I last
  opened" feel while a page refresh within the session keeps showing the same NEW set
  (the classic forum "unread since last visit" pattern) — it doesn't blank on reload.
- **Plus an explicit "Mark caught up" button** that force-sets the watermark to NOW for
  users who want to clear it deliberately.
- Advance happens via a dedicated `POST` (below), not silently inside the read, so the
  read stays idempotent and the cutoff used for *this* render is always the pre-advance
  value.

## 6. API contract

New flat routes (module convention — no nested dynamic routes):

- `GET  /api/works-qa/recent?window=since_last|3d|7d[&project_id=<uuid>]` — the feed.
  For `since_last`, also reads the caller's watermark and returns it as `cutoffAt`.
- `POST /api/works-qa/recent-seen` — advance the caller's watermark (debounced auto on
  open, or forced via "Mark caught up"; body `{ force?: boolean }`). Upserts
  `works_qa_view_watermark` keyed by `req.user.email`.

Auth (both): mirror `poles.ts` → `withAuth(withPermission('construction-qa.works-qa', 'view'))`.

Response (`GET`):
```jsonc
{
  "success": true,
  "data": {
    "window": "since_last",
    "cutoffAt": "2026-06-06T07:55:00Z",   // watermark used for this render (since_last only)
    "asOf": "2026-06-08T11:30:00Z",
    "lanes": {
      "civil":      { "readyPoles": 42, "partialPoles": 8,  "sites": [ /* rollup */ ] },
      "dome":       { "readyPoles": 11, "partialPoles": 3,  "sites": [ ... ] },
      "main_joint": { "readyPoles": 4,  "partialPoles": 1,  "sites": [ ... ] }
    }
  }
}
```
Each `sites[]` entry:
```jsonc
{
  "projectId": "uuid", "projectName": "Mohadin",
  "zones": [
    { "zoneNo": 2, "pons": [
      { "ponNo": 25, "readyCount": 6, "partialCount": 1, "latestAt": "2026-06-07T14:02:00Z", "isNew": true }
      // isNew = latestAt > cutoffAt (drives the "NEW" highlight; since_last mode)
    ] }
  ]
}
```
Drill-through to individual poles reuses the existing `poles.ts` route + filters
(project/zone/pon) — no new pole-detail endpoint needed.

## 7. UI

- Entry point: a **"Recent"** toggle/segment on the Works QA overview header (beside
  search), and/or a **3d / 7d** switch. Default 3d.
- Three lanes (Civil / Optical-Dome / Main Joint), each a collapsible
  **Site → Zone → PON** tree showing ready pole count + relative time, with a muted
  **"+N partial"** chip that expands inline.
- Clicking a PON row deep-links into the existing pole list filtered to that
  project/zone/pon/discipline so Johan goes straight from triage → review.
- Reuse existing card/typography; dark theme consistent with the module.
- Show "as of <time>" so it's clear the feed reflects last sync, not live field state.

## 8. Files (module shape)

| File | Change |
|---|---|
| `scripts/migrations/sql/<next>_works_qa_view_watermark.sql` | **new** — watermark table (§5b) |
| `pages/api/works-qa/recent.ts` | **new** — the rollup query (Strategy A or B) + reads watermark for `since_last` |
| `pages/api/works-qa/recent-seen.ts` | **new** — `POST` upsert watermark (debounced/forced) |
| `src/modules/works-qa/hooks/useRecentSubmissions.ts` | **new** — fetch hook + window state + auto-seen call |
| `src/modules/works-qa/components/RecentSubmissionsPanel.tsx` | **new** — three-lane tree UI + NEW divider + "Mark caught up" |
| `src/modules/works-qa/components/WorksQAPage.tsx` | edit — add Recent toggle + mount panel |
| `src/modules/works-qa/types/works-qa.types.ts` | edit — response/lane/watermark types |
| `src/modules/works-qa/.claude.md` | edit — document the new routes + table |

Reuse: `slot-keys.ts` (discipline map), `zones.ts` query pattern (sow_poles + pole_qa_photos
zone/pon merge), `resolveSlotKey` (move to a shared util if imported by `recent.ts`).
Keep files <300 lines / components <200.

## 9. Task DAG

```
T0  Verify qfield_photo_validations timestamp → choose Strategy A/B   [blocking]
T0b Confirm live migration max → watermark migration + run on dev      [blocking, parallel to T0]
      │
T1  recent.ts query + route (depends on T0); reads watermark for since_last (T0b)
T1b recent-seen.ts POST (watermark upsert, debounce logic)
      │
      ├── T2  types + useRecentSubmissions hook (window incl. since_last + auto-seen)
      │         │
      │         └── T3  RecentSubmissionsPanel (three lanes + partial expand + NEW divider + "Mark caught up")
      │                   │
      │                   └── T4  Wire toggle into WorksQAPage (default window = since_last)
T5  Tests: query unit (ready/partial/approved/window buckets, gate parity) +
           watermark (first-visit fallback, debounce, force, isNew cutoff)
T6  .claude.md doc + CI (npm run ci:quick)
T7  Deploy dev → Hein eyeball verify on live data → PR
```

## 10. Follow-on (not v1)
The same `(pole, discipline, recency)` query trivially feeds a **daily WhatsApp/email
digest** ("Yesterday: 14 Civil-ready across Mohadin Z2, Lawley Z1…") via the existing
cron + WA bridge. Park until v1 is in use.

## 11. Validation gates
- **T0 evidence:** paste the live `\d` + count query output into the PR (proves which
  strategy and that the timestamp is real — NLNH).
- **Query correctness:** unit test fixtures for: complete+unapproved (ready),
  partial (some slots), complete+approved (excluded), outside-window (excluded),
  main_joint missing tray (partial, not ready).
- **Counts cross-check:** for one PON, the feed's ready count must equal a hand-run SQL
  against the live DB (cross-check stat smell test).
- **UI:** Playwright/Claude-in-Chrome on dev — toggle Recent, expand a partial chip,
  deep-link a PON into the pole list; screenshot each.
- **CI:** `npm run ci:quick` green; `tsc --noEmit` (vitest skips TS).

## 12. Review strategy
Single-domain feature (one module). Blind `/review` (sonnet) on the raw diff + this
spec + module `.claude.md`. No self-review. Wait for self-hosted CI green, then
`gh pr merge`.

## 13. Resolved decisions
- **Windows:** Since-I-last-opened (default) / 3d / 7d. Per-user watermark is **in v1
  scope** (§5b) — confirmed by Hein 2026-06-08.
- **Only remaining tunable:** the watermark auto-advance **debounce (default 30 min)** —
  how long a refresh keeps showing the same NEW set before "last opened" rolls forward.
  Easily changed; no need to settle before building.
