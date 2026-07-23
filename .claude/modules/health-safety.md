# Module: health-safety

> **Last updated:** 2026-07-23 (E2E remediation — docs/plans/health-safety-e2e-goal.md; PRs #2218–#2223+)
> **Path:** `src/modules/health-safety/` + `pages/health-safety/` + `pages/projects/health-safety/` + `pages/api/health-safety/`
> **Status:** Active — all five flows work E2E (audits, incidents, risks, CAPA, contractor compliance)

## Overview

SA-compliant (OHS Act / Construction Regulations) H&S management: project audit wizard, incident reporting piggybacked on maintenance tickets, risk register with 5×5 matrix, CAPA lifecycle, contractor compliance documents + assignment gate, overdue-audit reminders via Action Items.

## The five flows (how they actually work)

### 1. Project audits
- Configure on the project page H&S tab (`/projects/[id]?tab=health-safety`): frequency + **Audit scope** select — "All categories (default)" (config.template_id NULL → seeds from every active template that has items) or one template.
- Start New Audit → `POST /api/health-safety/project/[projectId]/audits` counts seedable items FIRST (0 → 400, no audit row), creates the audit, seeds `hs_audit_responses` in one INSERT..SELECT (RETURNING-verified; rolled back if 0), logs activity.
- Wizard (`/health-safety/audits/[auditId]`) groups by item category; pass/fail/na + notes + photo per item.
- Complete → severity-weighted score (critical 4 / high 3 / medium 2 / low 1; any critical fail caps at 79), RAG (red <50, amber <80, green ≥80), status `completed` or **`requires_action`** when ≥1 fail (counts as completed everywhere), `next_audit_due` advances by frequency.
- Project audit list: `/health-safety/project/[projectId]/audits`.

### 2. Incidents
- Report at `/health-safety/incidents/new` (`?project_id=` pre-selects). POST `/api/health-safety/incidents` creates a maintenance ticket (`createTicket` with **created_by = authed user uuid** — NOT NULL) + `hs_ticket_details` row; on details-insert failure the ticket is deleted (shim = no transactions).
- List `/health-safety/incidents` (payload shape `{data:{incidents,...}}`), detail `/health-safety/incidents/[id]` via `GET /api/health-safety/incidents/[incidentId]`.
- Severity vocab in live data: `critical|major|moderate|minor` (type decls also mention `fatal` — vocabulary unification pending).

### 3. Risk register
`/projects/health-safety/risks` — 5×5 matrix, `hs_risk_register` with GENERATED risk_score/risk_level columns, reviews table.

### 4. CAPA
`/projects/health-safety/capa` (+ `[id]` detail with comments + status form). Server enforces `CAPA_STATUS_TRANSITIONS` in `capa/[capaId].ts`.

### 5. Contractor compliance + gate
- Docs/compliance/gate under `/api/health-safety/contractor/[contractorId]/…` — contractor ids are **uuid strings** end-to-end.
- Assignment gate (`pages/api/contractors-projects.ts`): failed verdict → 403 with `gate_check`; gate **error** → assignment proceeds **fail-open** with `log.error` + `gate_check.error` in the 201 (fail-closed is a pending product decision).
- Checklist admin: `/health-safety/checklists` (+ `/new`, `/[id]` editor with item CRUD).

## Database (12 live tables — live schema is authoritative)

`hs_checklist_templates`, `hs_checklist_items` (44-item seed — migration sql/450; docs that said 48 were wrong), `hs_project_config` (UNIQUE project_id; template_id NULL = all-categories scope), `hs_project_audits`, `hs_audit_responses`, `hs_contractor_compliance` (UNIQUE contractor_id + score/gate columns — sql/449), `hs_contractor_documents` (created by sql/449), `hs_ticket_details` (extends maintenance_tickets, **no FK** — 6 pre-remediation orphan rows kept as evidence), `hs_activity_log`, `hs_corrective_actions`, `hs_capa_comments`, `hs_risk_register` + `hs_risk_register_reviews`.

**Landmines**
- `hs_activity_log` live columns are `activity_type/entity_type/entity_id/user_id(int)/description/metadata` — the migration-113-era `action/actor_id/details` never existed live. Write ONLY through `logHsActivity()` (`src/modules/health-safety/services/activityLog.ts`), always AFTER the main write; it never throws.
- `maintenance_tickets.project_id` is TEXT (`p.id::text = t.project_id`), `contractor_id` uuid (`c.id = t.contractor_id`). HSE filter is `source_type IN ('hse_incident','hse_near_miss')` — NOT `ticket_type`.
- `hs_activity_log.user_id` is a legacy INTEGER; app users are uuid → user recorded in `metadata.user_id/user_email`.
- Legacy `scripts/migrations/113_health_safety_module.sql` was regenerated from live (2026-07-23) for scratch rebuilds — **never run it against live** (unguarded seed duplicates templates). Rebuild proof: `bash scripts/hs-scratch-rebuild-proof.sh`.

## Reminders cron

`POST /api/cron/hs-audit-reminders` (header `x-cron-secret: $CRON_SECRET`, fail-closed): creates/refreshes one Action Item per overdue active config (dedupe on `source_type='hs_audit_overdue'`, `source_id=config.id`, open status) and auto-completes items no longer overdue.

**Scheduled** since 2026-07-24 via `scripts/cron-hs-audit-reminders.sh` (flock, prod→dev probe, `CRON_SECRET` read from the deploy `.env.local` — never hardcoded). Live entry in the `velo` crontab:

```
40 6 * * 1-6 /home/velo/fibreflow-dev/scripts/cron-hs-audit-reminders.sh >> /home/velo/logs/hs-audit-reminders.log 2>&1
```

The script targets **production** whenever `localhost:3000/api/health` answers and only falls back to dev — the dev path is just where the file lives (dev deploys are ungated). Repoint to `/home/velo/fibreflow-production/scripts/` at the next production deploy.

Observed firing unattended before this was documented. A temporary `*/5` entry was installed alongside the real schedule purely to witness cron-driven ticks, then removed — `/home/velo/logs/hs-audit-reminders.log`:

```
[2026-07-24 01:30:01] OK: http://localhost:3000 — overdue=5 created=0 refreshed=5 resolved=0
[2026-07-24 01:35:01] OK: http://localhost:3000 — overdue=5 created=0 refreshed=5 resolved=0
```

Two ticks exactly five minutes apart at `:00:01` — the scheduler invoked it, not a human. `overdue=5` matches the plain-SQL overdue count, so the run does real work rather than merely returning 200.

## Gate check logic

Blockers: missing/expired/rejected/pending required docs (`safety_policy`, `liability_insurance`, `safety_plan`), critical/major/fatal incident in 12 months, overall score < 50, training score < 70 **only when training data exists** (NULL doesn't block). Weights: docs 25 / incidents 30 / training 15 / CAPA 15 / audits 15.

## History / deferred

- 2026-07-24 (Phase 0 close-out): 8 stranded audits cancelled (`backfill-hs-audit-scope.ts --execute`); 3 zombie `hs_project_config` rows for deleted projects deactivated — dashboard overdue now equals the plain-SQL count (5 == 5, was 5 vs 8); reminders cron scheduled and observed firing; dashboard `total_projects_configured` fixed (counted 8 unfiltered config rows while only 5 projects are configured). `hs_ticket_details` was **entirely** demo residue — all 6 rows orphaned, zero non-orphan rows.
- 2026-07-23 remediation fixed: empty-wizard root cause, activity-log schema drift (phantom-write 500s), incident created_by 23502, contractor uuid/parseInt + dead `tickets` refs, all 404 pages, checklist editor, migration reproducibility, reminders cron. Dead code deleted: ContractorHSTab, InvestigationPanel/FiveWhysForm, investigate API, calculateAuditScore.
- Deferred (Phases 4–9 of the Mar 2026 plan + more): training matrix, toolbox talks/DSTI, PPE issuance, permit-to-work, digital safety file, LTIFR/DIFR analytics, e-signatures, Annexure 3 / s16(2) letters, offline PWA capture, journey management, H&S RBAC, fail-closed gate.

## Related
- `src/modules/health-safety/.claude.md` — quick reference (auto-loaded)
- `.claude/skills/hns/SKILL.md` — /hns operational skill
- `docs/plans/health-safety-e2e-goal.md` — the remediation plan/audit findings
