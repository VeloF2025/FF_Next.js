# /goal — Health & Safety Module: Make It Work End-to-End (run autonomously until DONE)

> **How to use:** start a fresh session on Opus, in a worktree off `master`, and run:
> `/goal Execute docs/plans/health-safety-e2e-goal.md to completion. Work autonomously through Fix → Test → Deploy(dev) → Browser-verify; do not stop to ask; only halt for a genuine external blocker that needs Hein or a Confirmation Gate (§8). Loop until every Success Criterion (§7) is verified true in the browser against dev.fibreflow.app with DB side-effect proof, then write a handoff and stop.`

---

## 1. Mission (one goal)

Take the H&S module from **one working flow to all five**: project audits (incl. weekly
recurrence), incident reporting, risk register, CAPA, and contractor compliance visibility —
each proven working end-to-end in a real browser with DB side-effect verification.

**IN scope:** the Sprint-1 + Sprint-2 fixes from the 2026-07-23 audit
(artifact: https://claude.ai/code/artifact/d7cd3b6e-8b82-419e-a09c-241b97d3f1e5): template
wiring, activity-log schema fix, incident `created_by`, contractor UUID/table fixes, missing
pages, checklist editor, overdue-audit surfacing, migration reconciliation, doc-drift fixes,
unit + browser tests for all of it.

**NOT in scope (separate goals):** Phases 4–9 of the March 2026 plan — training matrix,
toolbox talks/DSTI, PPE issuance, permit-to-work engine, digital safety file, Annexure 3 /
16.2 letter generation, LTIFR/DIFR analytics, e-signatures, offline PWA capture, journey
management. Also NOT in scope: full RBAC role design for H&S APIs (log it in the handoff).

## 2. What is already DONE — do NOT redo

Audited 2026-07-23 end-to-end in production (session bd358ce1). All findings below are
**verified with reproductions** — do not re-diagnose, go straight to fixing:

- **Audit engine WORKS.** With `hs_project_config.template_id` set, the full cycle was proven
  live: wizard items render with OHS Act refs, pass/fail/na + photo + notes, responses persist,
  severity-weighted score computed (4/3/2/1 weights, critical-fail caps at 79), fail ⇒
  `requires_action`, `next_audit_due` advances by frequency on completion
  (`pages/api/health-safety/audits/[auditId].ts:150-230` is correct — don't touch scoring).
- **Root cause of "0/0 empty wizard":** Configure H&S form
  (`src/modules/health-safety/components/ProjectHSTab.tsx` inline config) never sets
  `template_id`; `pages/api/health-safety/project/[projectId]/audits.ts:134` only seeds
  `hs_audit_responses` when `template_id` is non-null. 8 real user audits since March stalled
  this way (Mahikeng ×3, Phalaborwa ×4, Thembisa ×1).
- **Incident POST failure:** `createTicket()` call at
  `pages/api/health-safety/incidents/index.ts:566` omits `created_by`; live
  `maintenance_tickets.created_by` is NOT NULL ⇒ 23502. 6 orphaned `hs_ticket_details` rows
  exist in prod (ticket ids that don't exist) — leave those rows alone.
- **`hs_activity_log` drift:** live columns `activity_type, entity_type, entity_id, user_id,
  description, metadata, created_at`. Seven+ callers write non-existent `action / actor_id /
  details`: `dashboard.ts:138` (read), `incidents/index.ts:659`, `capa/index.ts:214`,
  `capa/[capaId].ts:154`, `risks/index.ts:148`, `checklists/index.ts:125`,
  `checklists/[id].ts:128,158`, `tickets/[ticketId]/investigate.ts:86,161`,
  `tickets/[ticketId]/details.ts:226,306`. Correct usage already exists in
  `project/[projectId]/audits.ts:152` and `project/[projectId]/config.ts:155` — copy that.
  Consequence today: dashboard 500s (UI shows fake zeros) and risk/CAPA/checklist creates 500
  **after** committing the main row (phantom writes — verified live).
- **Contractor path triple-broken:** (a)
  `pages/api/health-safety/contractor/[contractorId]/gate-check.ts:42` does
  `parseInt(contractorId)` on a UUID (truncates to `857`), and
  `src/modules/health-safety/types/compliance.types.ts` declares `contractor_id: number`
  throughout; (b) `hs_contractor_documents` does NOT exist in the live DB (mig 113 defines it —
  never applied); (c) `gateService.ts:181`, `compliance.ts:79,102`, `gate-check.ts:100`,
  `tickets/[ticketId]/details.ts:57,168,260,299` query the old `tickets` table (renamed
  `maintenance_tickets` in mig 089). Gate is fail-open at
  `pages/api/contractors-projects.ts:248-251` — has never blocked an assignment.
- **Route/page gaps (verified 404s):** `/health-safety/checklists/new`,
  `/health-safety/incidents/[id]`, `/projects/health-safety/capa/[id]`,
  `/health-safety/project/[projectId]/audits`. Duplicate API route: flat
  `pages/api/health-safety/incidents.ts` (GET-only) vs `incidents/index.ts` (GET+POST) — in the
  prod build index.ts serves the route, but the collision is a landmine.
- **Blank dropdowns:** incident + risk forms map `p.project_name` but `/api/projects` returns
  `name` (`IncidentLocationFields.tsx:60`, risk form equivalent) — 18 blank options, verified.
- **Checklist data:** live has 24 items across 5 templates; Electrical, Fire, Scaffolding
  templates have 0 items. Migration `113` seeds 44 items (docs claiming 48 are wrong). No UI
  exists to create templates or edit items (API `checklists/[id].ts` PUT exists, unconsumed).
- **Migrations not reproducible:** `scripts/migrations/236_hs_ticket_details_full.sql:59`
  indexes a `severity` column no migration creates (113 creates `hs_severity`); live table has
  `severity` — schema was created out-of-band Jan 2026. Fresh rebuild aborts at 236.
- **No scheduler:** nothing consumes `next_audit_due` except the (broken) dashboard; all 8 live
  configs are overdue. No cron under `pages/api/cron/` touches H&S.
- **Dead code (decide, don't ignore):** `ContractorHSTab.tsx` (663 ln, never rendered),
  `InvestigationPanel.tsx` + `FiveWhysForm` (never rendered), `investigate.ts` API (no caller),
  `scoringService.calculateAuditScore` (no runtime caller).
- All 17 H&S API routes are `withAuth`-wrapped (auth is fine; RBAC is the deferred gap).

## 3. Environment — get this wrong and nothing runs

- Workstation session. **Branch off `master` into a worktree** before any change (a hook blocks
  writes to the main tree). Never commit to master; all changes via PR (`gh` CLI). Pre-push
  hook runs `ci:quick` — never `--no-verify`.
- **DB:** self-hosted Supabase Postgres `100.96.203.105:5437`, db `fibreflow`, user
  `fibreflow_user`. Password: `.claude/credentials.local.md` — **never** inline it in any file,
  commit, or PR body. **Single DB shared by dev + production** — every migration hits prod
  immediately; use expand-contract (additive only, `IF NOT EXISTS` guards).
- Migrations: `scripts/migrations/`, version = MAX+1 at merge time (check for collisions), each
  with a `rollback_` file; run `\d <table>` against live BEFORE writing any migration; note the
  deploy script auto-applies migrations on deploy.
- **Neon shim rule:** these APIs use `@neondatabase/serverless` via the shim — NO conditional
  SQL fragments; use explicit query branches (that's why `incidents/index.ts` is 703 lines).
  No multi-statement transactions through the shim — see D2.
- Deploy: `bash scripts/deploy-local.sh dev` only (dev.fibreflow.app:3005). **No production
  deploy in this goal** — production promotion is Hein's call, after hours (§8).
- Browser verification: playwriter MCP against **https://dev.fibreflow.app** (same DB as prod —
  create demo data prefixed `ZZ-GOAL-HS`, delete it in one transaction when done).
- Server logs when needed: `ssh velo@100.96.203.105`, `/var/log/fibreflow-production.error.log`
  (dev equivalent per systemd unit). Never `pkill -f node`/`npm`.
- File limits: files <300 lines, components <200 (new code; don't refactor existing giants
  unless you touch them anyway). No `console.log` — `log` from `@/lib/logger`.

## 4. Locked design decisions — don't re-litigate

- **D1 Audit scope:** audit creation seeds `hs_audit_responses` from **all active templates
  that have ≥1 item** (wizard already groups by category). If `config.template_id` is set it
  restricts to that one template (backward compat). Config form gets an "Audit scope" select:
  "All categories (default)" or a specific template. Delete the silent-empty path: if seeding
  produces 0 items, the POST must fail with a clear error, never create an empty audit.
- **D2 Activity log:** one helper (e.g. `src/modules/health-safety/services/activityLog.ts`)
  writing the **live** columns `(activity_type, entity_type, entity_id, user_id, description,
  metadata)`. Because the Neon shim can't do transactions, call it AFTER the main write inside
  its own try/catch: log failures are logged via `log.warn` and **never** fail the request.
  Replace all broken call sites; fix the `dashboard.ts:138` read to the live columns.
- **D3 Incidents:** delete flat `pages/api/health-safety/incidents.ts`; `incidents/index.ts`
  owns the route. Thread the authenticated user (`withAuth` provides it) into `createTicket`
  as `created_by`. Add an incident **detail page** at `pages/health-safety/incidents/[id].tsx`
  (read view: classification, persons, witnesses, photos, DoL flag, linked ticket status).
- **D4 Contractor path:** contractor IDs become `string` (UUID) end-to-end in
  `compliance.types.ts`, `gateService.ts`, `scoringService.ts`, and the three
  `contractor/[contractorId]/*` routes; drop every `parseInt`/`Number()` on them. Replace
  `tickets` → `maintenance_tickets` (columns: `type`, `ticket_category`, `source_type`,
  `contractor_id` — verify with `\d`, don't guess). Apply `hs_contractor_documents` via new
  reconciliation migration (take DDL from mig 113). **Gate stays fail-open** but must
  `log.error` loudly and the assignment UI must show the gate result; fail-closed is Hein's
  product call — pose it in the PR description, don't decide it.
- **D5 Checklist admin:** build the template editor — list → detail with item CRUD (uses
  existing `checklists/[id].ts` PUT), plus "New Template" page (kill the 404). Seed the missing
  Electrical/Fire/Scaffolding items via an idempotent reconciliation migration upserting the
  full 44-item set from mig 113 (ON CONFLICT DO NOTHING on a natural key).
- **D6 Migration reconciliation:** one new migration (MAX+1) with `IF NOT EXISTS`/`ADD COLUMN
  IF NOT EXISTS` guards that (a) fixes 236's broken index, (b) creates
  `hs_contractor_documents`, (c) aligns any column the live DB has that migrations don't
  (diff live `\d` vs migration files for every `hs_*` table and close the gap). Acceptance:
  the full migration chain applies cleanly on a scratch Postgres (spin up throwaway docker pg,
  run all `hs_*`-relevant migrations in order).
- **D7 Weekly-audit surfacing:** new cron endpoint `pages/api/cron/hs-audit-reminders.ts`
  (follow an existing cron file's auth pattern) that, for each active `hs_project_config` past
  `next_audit_due`, creates/refreshes an Action Item (Action Centre pattern) — dedupe so it
  never spams. Wire the crontab entry on velo (document the line in the PR; actual crontab
  install is a Confirmation Gate, §8). Fix status display: `requires_action` audits must not
  render as "In Progress", and the Completed count must include them.
- **D8 Small fixes bundle:** `project_name`→`name` in incident + risk form dropdowns;
  "Report Incident" from a project H&S tab pre-selects that project (pass `project_id` query
  param through); CAPA detail page (or convert the dead link to an expanding row — smallest
  correct thing); project audit list page for ProjectHSTab's "View All"; delete or wire dead
  code from §2 last bullet — **deleting is the default** unless wiring is <1h (the
  investigation UI: wire it into the incident detail page ticket view if trivial, else delete
  and log in handoff).
- **D9 Docs:** rewrite `.claude/modules/health-safety.md` and
  `src/modules/health-safety/.claude.md` to match reality (correct tables, endpoints, 44-item
  seed count, weekly-audit mechanics); fix wrong table names in the `hns` skill. Also commit
  THIS goal file to `docs/plans/health-safety-e2e-goal.md` in the first PR.

## 5. Order of work (each step = branch-scoped commits, one PR per numbered group)

1. **PR-1 "unbreak writes":** D2 activity-log helper + all call sites + dashboard read fix;
   D3 incidents (`created_by`, delete flat route); D8 dropdown labels. Highest user value,
   smallest diff.
2. **PR-2 "audits flow":** D1 multi-template seeding + config Audit-scope field + empty-audit
   guard; D7 status labels; template_id backfill decision → §8 gate (script it, don't run it).
3. **PR-3 "contractor + schema":** D4 UUID/table fixes + D6 reconciliation migration + D5 seed
   migration. This PR carries the migrations — flag it clearly for Hein.
4. **PR-4 "pages + admin":** D5 checklist editor, D3 incident detail, D8 remaining pages/links,
   dead-code removal.
5. **PR-5 "reminders + docs":** D7 cron endpoint, D9 docs.
   Adjust grouping if a PR exceeds ~500 lines — split rather than balloon.

## 6. Discipline (mandatory)

- TDD where the fix is logic (activity-log mapping, audit seeding, created_by threading,
  UUID handling): failing vitest test first, then fix. Tests live under `src/` test dirs —
  NEVER under `pages/` (breaks next build). Remember vitest skips type-checking — run
  `npm run ci:quick` for the TS gate.
- Every PR: `npm run ci:quick` locally BEFORE push; blind `/review` (review-team if >500 lines,
  raw diff + CLAUDE.md only); GHA on the self-hosted runner via `gh run watch --exit-status`;
  merge only after review APPROVED + CI green (`gh pr merge --merge --delete-branch`).
- After each merge: `bash scripts/deploy-local.sh dev`, then browser-verify the specific flows
  that PR touched on dev.fibreflow.app before starting the next PR.
- DB changes (migrations, backfills) run by the controller session, never a subagent.
  Backfills: dry-run SELECT first, show counts, then execute.

## 7. Success Criteria — DONE = all verified true (browser + DB proof for each)

Using a throwaway `ZZ-GOAL-HS` project on dev.fibreflow.app (same flow as the audit;
clean up after):

1. Configure H&S with scope "All categories" → Start New Audit → wizard shows **>0 items
   across ≥5 categories** (never 0/0; forced-empty case returns a visible error, no orphan row).
2. Complete an audit with ≥1 fail → responses in `hs_audit_responses`, weighted score + RAG
   set, status `requires_action`, `next_audit_due` advanced; tab shows it as completed-with-
   actions (not "In Progress"), Completed count includes it.
3. Report Incident (near-miss, with the demo project **pre-selected** from the project tab,
   dropdown labels visible) → 201; `maintenance_tickets` row with `created_by` set +
   `hs_ticket_details` row, atomically consistent (no new orphans); incident appears in the
   list AND its detail page opens; H&S dashboard incident count reflects it.
4. Create Risk → single row, UI success (no phantom-write 500); matrix + summary update.
5. Create CAPA → single row, UI success; CAPA list shows it.
6. `/api/health-safety/dashboard` returns 200 with non-zero configured-project count; the
   dashboard page shows real numbers and an **Overdue Audits** count matching
   `SELECT count(*) FROM hs_project_config WHERE next_audit_due < now() AND is_active`.
7. Contractor endpoints (`compliance`, `documents`, `gate-check`) return 200 for a real UUID
   contractor; gate returns a structured verdict; assignment flow logs gate result visibly.
8. Checklists: all 8 templates have ≥4 items; creating a template and adding/editing/removing
   an item works through the UI; "New Template" no longer 404s.
9. Every previously-404 link resolves: incident detail, CAPA detail (or equivalent), project
   audit list, checklist new/edit.
10. Cron endpoint dry-run creates Action Items for the (still-overdue) real projects exactly
    once; second run is idempotent. (Crontab install itself may stay pending Hein per §8.)
11. Migration chain: full `scripts/migrations/` sequence applies cleanly on a scratch Postgres
    container; live `\d` for every `hs_*` table matches what migrations produce.
12. `npm run ci` green; all new unit tests pass; zero new `console.log`/`any` regressions in
    touched files (lint ratchet respected).
13. All 5 PRs merged after blind review; dev deployed; `.claude/modules/health-safety.md` +
    module `.claude.md` + `hns` skill corrected; handoff written (include: fail-open-vs-closed
    gate question, RBAC deferral, Phases 4–9 pointer, template_id backfill status).
14. All `ZZ-GOAL-HS` demo data deleted in one transaction; the 6 pre-existing orphaned
    `hs_ticket_details` rows are untouched (they're evidence — Hein decides their fate).

## 8. Confirmation Gates — the ONLY places to stop and ask Hein

1. **Running migrations against the shared live DB** (PR-3): post the exact SQL + rollback in
   the PR, then ask. (Merging the PR triggers auto-apply on deploy — so ask BEFORE merging PR-3.)
2. **Backfilling `template_id` / audit-scope for the 4 live real configs** (Mahikeng,
   Phalaborwa, Thembisa + one legacy) and what to do with their 8 stuck `in_progress` audits
   (propose: mark abandoned). Script ready, counts shown, await go.
3. **Installing the crontab line on velo** for hs-audit-reminders.
4. **Any production deploy** — out of scope; dev only.
Everything else: proceed autonomously.

## 9. Autonomous loop behavior

Work PR by PR (§5). After each merge+deploy, browser-verify (§7 subset) before continuing.
If a blind reviewer raises a finding, verify it before acting — including verifying their
dismissals. If blocked >30 min on a gate, ScheduleWakeup a 1200s+ heartbeat and continue any
non-dependent PR. Three consecutive no-progress ticks → PushNotification Hein and stop. On
completion: handoff doc per the handoff skill, update memory
(`project_health_safety_module_audit.md` — mark remediation status), stop.

## 10. Explicitly deferred — separate goals, do not start here

Phases 4–9 (see §1 NOT-in-scope list) — needs its own prioritised goal informed by the
benchmark section of the audit artifact. Full RBAC on H&S APIs. WhatsApp overdue-audit
notifications (Action Items only for now). Fail-closed contractor gate (Hein's call).
Resolution of the 6 orphaned incident rows. Offline/PWA field capture.
