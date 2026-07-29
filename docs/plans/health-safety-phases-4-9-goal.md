# /goal — Health & Safety Phases 4–9: build the rest of the module (run autonomously until DONE)

> ## ✅ DELIVERED — historical record, do NOT execute
>
> Written 2026-07-23; **executed to completion on 2026-07-24** and merged to master as
> PRs **#2229** (Phase 0 close-out), **#2231** (P1 training + gate), **#2232** (P2 toolbox),
> **#2233** (P3 PPE), **#2234** (P4 permits), **#2236** (P5 safety file), **#2237** (P6 LTIFR),
> **#2238** (P7 RBAC + severity + docs). Migrations `451`–`457` are live
> (`scripts/migrations/sql/451_hs_training_matrix.sql` … `457_hs_severity_check.sql`).
> All phases reached **production** on 2026-07-24; a later TZ date fix shipped as #2240/#2245.
>
> This file is kept for the design rationale in §2 and §4 — it is **not** a pending plan.
> Re-running the `/goal` command below would rebuild work that already exists.
>
> Where the module actually stands now: `.claude/modules/health-safety.md`,
> and the completion handoff `.claude/handoffs/2026-07-24-hs-phases-4-9-complete.md`
> (handoffs are untracked — local tree only).
>
> Two §4 decisions were overridden during execution, so read that section as *proposed*,
> not as *what shipped*: e-signatures are **drawn** on appointment letters (§4.5 said typed
> only), and the contractor gate ships **fail-closed** (§4.10 said fail-open-but-loud).

> **How to use:** ~~start a fresh session on Opus, in a worktree off `master`, and run:~~ (superseded — see above)
> `/goal Execute docs/plans/health-safety-phases-4-9-goal.md to completion. Work autonomously through Spec → Migrate → Build → Test → Deploy(dev) → Browser-verify → PR for each phase in §5 order; do not stop to ask; only halt for a Confirmation Gate (§8) or a genuine external blocker. Loop until every Success Criterion (§7) is verified true in a real browser against dev.fibreflow.app with DB side-effect proof, then write a handoff and stop.`

---

## 1. Mission

Phases 1–3 of the H&S module (audits, incidents, risk register, CAPA, contractor compliance)
were remediated on 2026-07-23 and are live in production. **Phases 4–9 were never built.**
Build them, to the same evidence standard: every flow proven in a real browser with DB
side-effect verification.

**The module has never been used in production.** Verified 2026-07-24 against the live DB:
`hs_audit_responses` = 5 rows total (all written in a single burst on 2026-03-31, a trial),
`hs_risk_register` = 0, `hs_corrective_actions` = 0. There is **no real user data to protect**.
That is a licence to be decisive: clean up freely, reshape schema where it is wrong, and do
not build elaborate backward-compatibility for data that does not exist. It is *not* a licence
to skip verification — the module was previously "shipped" while broken, which is exactly why
nobody used it.

**IN scope:** §5 phases 0–7 below.
**NOT in scope:** anything not listed in §5. If you find adjacent breakage, log it in the
handoff — do not fix it inline.

## 2. What already exists — do NOT redo

Read `.claude/modules/health-safety.md` first; it was rewritten truthfully in PR #2224 and is
accurate as of 2026-07-23. Key points you must build *on top of*, not around:

- **12 live `hs_*` tables.** Live schema is authoritative. `scripts/migrations/113_health_safety_module.sql` was regenerated from a live pg_dump for scratch rebuilds — **never run it against live.**
- **`logHsActivity()`** (`src/modules/health-safety/services/activityLog.ts`) is the ONLY sanctioned writer to `hs_activity_log`. Live columns are `activity_type/entity_type/entity_id/user_id(int)/description/metadata`. Always call it AFTER the main write; it never throws.
- **`maintenance_tickets.project_id` is TEXT** (`p.id::text = t.project_id`), `contractor_id` is uuid. HSE filter is `source_type IN ('hse_incident','hse_near_miss')`, NOT `ticket_type`.
- **Contractor ids are uuid strings end-to-end.** Never `parseInt` them.
- **The contractor gate already has a `training` weight (15%)** that only blocks when training data exists. Phase 1 below makes that real — wire into the existing `gateService`, do not invent a parallel scoring path.
- **`POST /api/cron/hs-audit-reminders`** exists and works. It is **not scheduled** (see §5 Phase 0).
- Rebuild proof: `bash scripts/hs-scratch-rebuild-proof.sh` must report EXACT PARITY after any migration.

## 3. Environment

- Worktree off `origin/master`; **never** edit `/home/hein/Workspace/FF_Next.js` (frozen) or any `/home/velo/fibreflow-*` deploy dir.
- Dev: `dev.fibreflow.app` (port 3005, `fibreflow-dev.service`). Prod: `app.fibreflow.app` (3000).
- **Single shared Postgres for dev AND prod** — `100.96.203.105:5437`, db `fibreflow`. A migration hits production the moment it runs. Connection strings: `.claude/credentials.local.md`.
- Deploy ONLY via `bash scripts/deploy-local.sh dev` from a current worktree.
- CI before every PR: `npm run ci:quick`.

## 4. Locked design decisions — correct these BEFORE launching, then don't re-litigate

These are proposals written by the planning session, not requirements handed down by the
business. **Hein: this is the section to edit.** Once the goal starts, the executor treats them
as settled.

1. **Statutory basis is the SA OHS Act 85/1993 + Construction Regulations 2014.** Where a phase implies a legal artefact (appointment letters, permits, registers), model the real statutory shape, not a generic CRUD screen.
2. **Workers are `staff`, not a new table.** Training, PPE and toolbox attendance all reference existing staff/employee records. Do NOT create a parallel person table. If field workers are not in `staff`, log it and use the existing field-worker records rather than inventing.
3. **Every new entity gets: list page, detail page, create/edit, API, `logHsActivity()` call, and a project-scoped view.** A phase is not done with an API and no UI.
4. **New tables follow the existing `hs_` prefix and live-schema conventions** (uuid pks, `created_by` uuid from `getAuthUser`, timestamptz, no FK to `maintenance_tickets`).
5. **E-signature = typed name + timestamp + captured user uuid + IP**, stored on the signed record. NOT a drawn-signature canvas, NOT a third-party service. If a drawn signature is genuinely required for the safety file, log it as a follow-up.
6. **Documents/exports reuse the existing PDF path** (see `project_reusable_report_template`), not a new library.
7. **Expiry/competency logic is computed in SQL, not in JS on the client.** Expiry drives the gate and the dashboards.
8. **RBAC: use the existing three-tier pattern** (`feedback_withauth_vs_rbac_authorization`). Do not design a new H&S-specific role system.
9. **Severity vocabulary unifies on the live data values** — `critical|major|moderate|minor`. Drop `fatal` from type declarations.
10. **The contractor gate stays fail-open-but-loud on ERROR** unless Hein says otherwise at Gate G1.

## 5. Order of work — one PR per numbered phase, merged and dev-deployed before starting the next

**Phase 0 — finish the 2026-07-23 remainder (do this first, it is ~1 hour)**
- Run `npx tsx scripts/backfill-hs-audit-scope.ts --execute` against live (cancels the 8 stranded 0-item audits). Safe: the only audit with responses is the 2026-03-31 trial.
- `UPDATE hs_project_config SET is_active=false WHERE id IN ('7fda6741-f3b8-49fe-ba62-0aadda26a9cd','0931347d-2dba-4458-9a0e-1fff95f2ccdf','412d4d54-aff7-4d4a-9183-b71d7de86b83');` (3 zombie configs, projects deleted). Dashboard overdue must then equal plain-SQL count.
- **Schedule the reminders cron** on velo, pointing at the deploy dir and prod port 3000:
  `40 6 * * 1-6 /home/velo/fibreflow-production/scripts/cron-hs-audit-reminders.sh >> /home/velo/logs/hs-audit-reminders.log 2>&1`
  Write that wrapper script the same way as `scripts/cron-backfill-onemap.sh` (flock, secret read from the deploy env — never hardcoded, `--max-time` on probes). Verify by waiting for a real tick and reading the log.
- Decide the 6 orphaned `hs_ticket_details` rows (Gate G2).

**Phase 1 — Training matrix & competency**
Training types, per-worker records, certificate upload + expiry, per-project competency gap view, expiring-soon dashboard. **Wire the real training score into the existing contractor gate** (currently inert because no data exists).

**Phase 2 — Toolbox talks / DSTI**
Daily/weekly talk per project + crew: topic, presenter, date, attendee list from staff, signature per attendee (§4.5), photo evidence. Register view per project for the safety file.

**Phase 3 — PPE issuance register**
PPE catalogue, issue-to-worker with size and quantity, acknowledgement signature, replacement-due tracking, outstanding-issue view per project.

**Phase 4 — Permit to Work**
Permit types (hot work, confined space, excavation, working at heights, electrical). Lifecycle request → approve → active → closed/expired, validity window, mandatory precondition checklist per type, approver recorded. Expired permits must visibly block, not silently lapse.

**Phase 5 — Digital safety file + appointment letters**
Per-project/per-contractor document pack assembly; generated s16(2), s8(1) and construction-supervisor appointment letters plus Annexure 3; e-signature (§4.5); single export.

**Phase 6 — LTIFR / DIFR analytics**
Man-hours capture per project per period, lost-time injury classification on incidents, LTIFR/DIFR/TRIFR computation in SQL, trend view per project and company roll-up.

**Phase 7 — Cross-cutting close-out**
H&S RBAC on all endpoints (§4.8), severity-vocabulary unification (§4.9), WhatsApp overdue notification (reuse the existing WA sender), and `/kb` refresh so every `.claude.md` matches reality.

## 6. Discipline (mandatory — each item cost a real bug in this codebase)

1. **A cron endpoint without a scheduler is NOT done.** This module already shipped `hs-audit-reminders` with no crontab entry, and `backfill-onemap-data` sat unscheduled for months while its docstring claimed "every 15 minutes". If you add a scheduled job, install the schedule and prove it fired unattended by reading its log.
2. **A metric must count the population it claims.** On 2026-07-23 an `agedOut` alert counted 20,531 rows when the true unresolved count was 41, because it conflated "never in scope" with "unresolved" — it would have buried the signal it existed to raise. Run every new count/aggregate against live data and sanity-check the number before shipping it.
3. **Never blind-overwrite.** Read-then-write without a guard regressed photo sets. Any job that replaces stored data must refuse to write a worse value, and enforce it in the SQL predicate, not just in JS.
4. **A 200 response is not verification.** Check the value the endpoint returned and the row it wrote. "It ran without error" is not evidence.
5. **No self-review.** Every PR goes through `/review` (blind reviewer, zero session context). Fix or refute each finding with receipts, post a reconciliation comment, and re-confirm before merging.
6. **Verify in a real browser** (Playwright / Claude-in-Chrome) for every UI claim, with a DB check of the side effect. Screenshots or it did not happen.
7. **Migrations:** `\d` the live table first, sequential numbering, rollback script, and `hs-scratch-rebuild-proof.sh` EXACT PARITY afterwards. Remember dev and prod share one database.
8. **No credentials in any tracked file** — including plans and handoffs. Use a placeholder plus a reference.
9. **File size:** <300 lines per file, <200 per component. Extract services rather than growing an endpoint.
10. **Branch per phase, PR per phase.** Never commit to master.

## 7. Success criteria — DONE = all verified true (browser + DB proof each)

1. Phase 0: 8 stranded audits cancelled; 3 zombie configs inactive; dashboard overdue == plain-SQL count; reminders cron **observed firing** in its log on a real tick.
2. Each of Phases 1–6: create, read, update and list all work in the browser; each write has a verified DB row; each has a project-scoped view; each logs to `hs_activity_log` via `logHsActivity()`.
3. Contractor gate returns a **real** training score driven by Phase 1 data, and a worker with an expired certificate demonstrably changes the verdict.
4. Permits: an expired permit visibly blocks; the transition rules are enforced server-side, not just in the UI.
5. Safety file exports as one document containing the generated appointment letters with captured signatures.
6. LTIFR/DIFR match a hand-calculated figure for one project — show the arithmetic in the PR.
7. Every new endpoint enforces auth; an unauthenticated call is rejected (prove with a real request).
8. `npm run ci:quick` green on every PR; GHA green on every merged commit; H&S vitest suite green and extended with tests for each new phase.
9. `hs-scratch-rebuild-proof.sh` reports EXACT PARITY after the final migration.
10. All demo/test data created during the goal is deleted in one transaction, and the deletion is verified.
11. `.claude/modules/health-safety.md`, the module `.claude.md` and the `hns` skill describe what exists — no invented tables or endpoints. (All three were fabricated before #2224. Do not regress that.)
12. Handoff written to `.claude/handoffs/`, memory updated.

## 8. Confirmation gates — the ONLY places to stop and ask

- **G1** — fail-open vs fail-closed contractor gate on gate ERROR (§4.10). One-line change; safety gates arguably fail closed.
- **G2** — the 6 orphaned `hs_ticket_details` rows: recreate their tickets, or delete.
- **G3** — before any **production** deploy. Dev deploys need no gate. Production is blocked 08:00–17:00 SAST Mon–Fri and needs Hein's explicit approval.
- **G4** — if a phase's real requirements turn out to differ materially from §4/§5, stop and confirm rather than inventing. Batch the question with everything else you have found.

Anything else: decide it, record the decision in the PR body, keep going.

## 9. Autonomous loop behaviour

Work phase by phase in §5 order. For each: spec briefly from §4/§5 → migration (if needed) → build → unit tests → `ci:quick` → PR → `/review` → reconcile findings → CI → merge → deploy dev → browser-verify with DB proof → tick the §7 criteria → next phase.

Do not stop between phases. Do not ask for permission to continue. If blocked on one phase,
log it, move to the next, and report the blocker in the handoff. If a browser check fails,
fix it and re-verify rather than reporting it as a caveat.

## 10. Explicitly out of scope

Offline/PWA field capture, journey management, integration with any external H&S system, and
a drawn-signature canvas (§4.5). Log them; do not start them.
