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

## Database (25 live tables — live schema is authoritative)

Phases 4–9 added 11: `hs_training_types`, `hs_worker_training`, `hs_toolbox_talks`, `hs_toolbox_attendance`, `hs_ppe_catalogue`, `hs_ppe_issuance`, `hs_permit_types`, `hs_permits`, `hs_appointment_letters`, `hs_man_hours`, `hs_injuries` (sql/451–456). The original 14:

`hs_checklist_templates`, `hs_checklist_items` (44-item seed — migration sql/450; docs that said 48 were wrong), `hs_project_config` (UNIQUE project_id; template_id NULL = all-categories scope), `hs_project_audits`, `hs_audit_responses`, `hs_contractor_compliance` (UNIQUE contractor_id + score/gate columns — sql/449), `hs_contractor_documents` (created by sql/449), `hs_ticket_details` (extends maintenance_tickets, **no FK** — emptied 2026-07-24 at gate G2: all 6 rows were orphans with blank incident fields from the 2026-01-22 demo seed, zero non-orphan rows ever existed), `hs_activity_log`, `hs_corrective_actions`, `hs_capa_comments`, `hs_risk_register` + `hs_risk_register_reviews`, `hs_training_types` + `hs_worker_training` (sql/451 — Phase 1 training matrix).

## Training matrix & competency gate (Phase 1, sql/451)

- **Worker model** — a worker is EITHER internal `staff` (`staff_id`) or a contractor field worker (`team_member_id`), enforced by a one-worker CHECK on `hs_worker_training`; `contractor_id` is carried on the row for gate aggregation. Decided against §4.2's "workers are staff": the gate is per-contractor and contractor workers live in `team_members`, whose own `contractor_id` is unpopulated (all 65 rows NULL) — so training rows carry the link directly. No new person table.
- **Competency status** (`current`/`expiring_soon`/`expired`/`missing`) is derived in SQL from `expiry_date` at read time, never stored. `hs_training_types.validity_months` sets the refresher cadence; expiry auto-derives from `completed_date + validity_months` when not given explicitly.
- **Gate** (`gateService.checkContractorGate`) recomputes the contractor training score live via `trainingService` on every check: `current_certs / total_certs`, NULL when there is no data (does NOT block). Blocks below 70% AND on any **expired statutory** certificate. `computeAndPersistContractorTrainingScore` writes the score onto `hs_contractor_compliance.training_score` for the dashboard.
- **G1 fail-closed** (2026-07-24): `pages/api/contractors-projects.ts` returns 503 + blocked when the gate itself errors (was fail-open).
- Endpoints under `/api/health-safety/training/*` (types, records, competency, pickers). UI at `/health-safety/training` (matrix, record CRUD, types admin) + `/health-safety/project/[projectId]/competency` (gap matrix); nav sub-tab under Projects → H&S.

**Landmines**
- `hs_activity_log` live columns are `activity_type/entity_type/entity_id/user_id(int)/description/metadata` — the migration-113-era `action/actor_id/details` never existed live. Write ONLY through `logHsActivity()` (`src/modules/health-safety/services/activityLog.ts`), always AFTER the main write; it never throws.
- `maintenance_tickets.project_id` is TEXT (`p.id::text = t.project_id`), `contractor_id` uuid (`c.id = t.contractor_id`). HSE filter is `source_type IN ('hse_incident','hse_near_miss')` — NOT `ticket_type`.
- `hs_activity_log.user_id` is a legacy INTEGER; app users are uuid → user recorded in `metadata.user_id/user_email`.
- Legacy `scripts/migrations/113_health_safety_module.sql` was regenerated from live (2026-07-23) for scratch rebuilds — **never run it against live** (unguarded seed duplicates templates). Rebuild proof: `bash scripts/hs-scratch-rebuild-proof.sh`.

## Phases 4–9 build (2026-07-24) — 6 new capabilities, PRs #2231–#2237

The Mar-2026 "deferred" list is now built. Each is a full flow (list/detail/create/edit, API, `logHsActivity`, project-scoped view) verified in a real browser with DB proof:

- **Training matrix** (sql/451, `hs_training_types` + `hs_worker_training`): per-worker competency, cert expiry, per-project gap matrix. Worker = `staff` XOR `team_members` (contractor workers), `contractor_id` carried for gate aggregation (team_members' own link is unpopulated). The contractor gate now derives a **real** training score (current/total × 100; NULL = no data → does not block) and blocks on any **expired statutory** cert. **G1 fail-closed**: a gate ERROR now blocks assignment (503).
- **Toolbox talks / DSTI** (sql/452, `hs_toolbox_talks` + `hs_toolbox_attendance`): per-project register, attendee list, **typed** e-signature (§4.5).
- **PPE register** (sql/453, `hs_ppe_catalogue` + `hs_ppe_issuance`): catalogue with lifespan-driven replacement-due, size/qty, typed acknowledgement, outstanding view.
- **Permit to Work** (sql/454, `hs_permit_types` + `hs_permits`): server-enforced lifecycle (`permitService`) — an expired permit's transition set is empty (visibly blocks); approval needs all mandatory preconditions; terminal permits are edit-locked.
- **Digital safety file** (sql/455, `hs_appointment_letters`): statutory s16(2)/s8(1)/construction-supervisor/Annexure-3 letters with a **DRAWN** signature (§4.5 — PNG data URL, ≤500KB, server-derived audit IP), single **PDF export** via Puppeteer (`/project/[id]/safety-file`).
- **LTIFR/DIFR/TRIFR** (sql/456, `hs_man_hours` + `hs_injuries`): rates computed in SQL on the 200,000-hour base; trend + per-project roll-up.

**e-signature** (`services/esignature.ts`): typed name + timestamp + capturing-user uuid + **server-derived IP** (rightmost public x-forwarded-for hop — this deployment has two proxies, so first-hop is spoofable and pure last-hop is 127.0.0.1). Reused by toolbox/PPE (typed) and appointment letters (drawn).

**RBAC (§4.8)**: every H&S endpoint is wrapped with `withHsPermission` (`services/hsAuth.ts`) — `withAuth` (401) + `withPermission('projects.health-safety', view|edit)` (view for GET, edit for writes; super_admin bypasses). Ratchet test `__tests__/rbacGates.test.ts` fails if a new endpoint ships bare `withAuth`. The `hs-audit-reminders` cron is exempt (x-cron-secret).

**Severity vocab (§4.9)**: unified on `critical|major|moderate|minor` — `fatal` dropped from type declarations (`critical` is the top tier).

**Known follow-up — TZ date display**: pure `date` columns (talk_date, issued_date, replacement_due, completed_date, expiry_date, appointment_date, injury_date) serialize via node-postgres's local-TZ Date parser, so a SAST server renders them **one day early** (DB `2026-05-01` → UI `2026-04-30`). SQL rate/overdue/expiry *classification* is unaffected (computed against `CURRENT_DATE`). Fix: cast these columns `::text` in the list/detail SELECTs (append `col::text AS col` after `SELECT *` — last-column-wins), or a scoped `pg.types.setTypeParser(1082, …)`. Not yet applied.

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


## Classified training certificates (migration 471)

**Design:** `docs/superpowers/specs/2026-07-30-training-certificate-upload-design.md`

### Where the file and the competencies live

The binary is stored **once**, in the employee's HR record:
`staff_documents` with `document_type = 'certification'`. Each competency it
proves is a separate `hs_worker_training` row pointing back at it through
`staff_document_id` (`ON DELETE RESTRICT`). One rope-access certificate can
therefore prove Working at Heights *and* Fall Arrest without duplicating the
file, while each competency stays independently queryable and independently
expiring — each derives its own `expiry_date` from its catalogue
`validity_months` when the certificate carries no printed expiry.

### Lifecycle — only `verified` counts

`hs_worker_training.verification_status` is one of
`pending | verified | rejected | revoked`:

| state | meaning | counts? |
|---|---|---|
| `pending` | uploaded, nobody has checked it | no |
| `verified` | a verifier confirmed it | **yes** |
| `rejected` | refused, with a reason | no |
| `revoked` | was verified, withdrawn with a reason | no |

The exclusion is a `WHERE verification_status = 'verified'` in the contractor
rollup (`trainingService.computeContractorTrainingScore`) and in the project
competency matrix (`/api/health-safety/training/competency`), **not** a
subtraction afterwards. That distinction matters: a contractor whose uploads are
all pending reads as *no data* (score `NULL`, does not block) rather than as a 0%
failure — and, more importantly, ten unverified uploads cannot present as full
compliance.

Migration 471 backfilled every pre-existing row to `verified`, because those were
typed in by hand and were already being treated as accepted evidence. The
backfill is guarded on the lifecycle CHECK constraint so a re-run cannot approve
genuinely-pending submissions.

### Transitions

`pending -> verified`, `pending -> rejected` (reason required),
`verified -> revoked` (reason required). Re-requesting the current state is an
idempotent no-op; anything else is `409`. Every transition runs in ONE
transaction covering the document and **all** its linked rows — a partial update
would leave a worker verified for some competencies and pending for others,
which no reader can distinguish from a genuine mixed state.

A verified or revoked submission is **immutable through delete**. Correcting one
means revoking it (the document and audit history survive) and uploading a new
certificate. Only `pending`/`rejected` submissions can be deleted, and that
removes the linked rows first because of the RESTRICT foreign key.

Actor columns differ by table and are easy to get wrong:
`hs_worker_training.verified_by / revoked_by` reference **`users(id)`**, while
`staff_documents.verified_by` references **`staff(id)`**. A user with no linked
staff row leaves the latter NULL while the training rows still record who acted.

### Permission

`people.staff.training-certificates` with `view / create / edit / delete`,
parented to `people.staff`. Seeded to **`super_admin` only** — deliberately not
to `admin`, and not implied by `projects.health-safety` or
`people.staff.sensitive`. An H&S reader may see worker, competency, dates and
verification state; the certificate itself needs the dedicated `view`.

Named custodians are added as explicit **user overrides**, and each also needs
view access to the `people` and `people.staff` ancestors — the RBAC service fails
closed on a blocked ancestor.

Action mapping: `create` = upload, `edit` = verify/reject/revoke *and* metadata
edit, `delete` = remove an unverified submission, `view` = metadata + binary.
Note a create-only custodian **cannot** approve their own submission.

### Routes

| Route | Purpose |
|---|---|
| `POST /api/staff-training-certificates-upload` | multipart upload (flattened route name) |
| `POST /api/staff-documents/[documentId]/verify` | verify / reject / revoke (certification branch) |
| `DELETE /api/staff-documents/[documentId]` | delete an unverified submission |
| `GET /api/staff-documents-download?documentId=` | **the only** way to the binary |
| `/health-safety/training/certificates/new` | H&S entry point (employee selection) |
| Employee profile → Documents → Upload training certificate | staff entry point |

**No H&S or staff-document response ever carries `file_path`, `file_url` or the
legacy `certificate_url`.** Callers get `downloadUrl` (the protected route) when
they have binary access, and `hasCertificate: boolean` otherwise. Storage paths
and URLs are also kept out of application logs.

The upload orders its work so failure is cheap: authorize → validate everything
(MIME + extension + magic bytes, 10 MB cap) → upload to VF Storage → one
`pg.Pool` transaction for the document and all pending rows. If the transaction
fails, the stored object is deleted; if that delete also fails, the filename is
logged for an operator and withheld from the response.

### Manual entry is now narrow

`/health-safety/training/new` records **only** catalogue types with
`requires_certificate = false` (a site induction register, say). Those are their
own evidence, so they are written `verified` — leaving them pending would mean
they counted for nothing and nobody would ever be asked to approve them. Types
that need a certificate are signposted to the upload flow, and the free-text
certificate URL field is gone: a link anyone could type is not evidence.

### Out of scope in v1

Employee self-submission, contractor-worker certificate capture (the live
contractor roster is not authoritative), bulk import, and OCR of certificates.
Internal `staff` only.

## History / deferred

- 2026-07-24 (Phase 0 close-out): 8 stranded audits cancelled (`backfill-hs-audit-scope.ts --execute`); 3 zombie `hs_project_config` rows for deleted projects deactivated — dashboard overdue now equals the plain-SQL count (5 == 5, was 5 vs 8); reminders cron scheduled and observed firing; dashboard `total_projects_configured` fixed (counted 8 unfiltered config rows while only 5 projects are configured); 6 orphaned `hs_ticket_details` rows deleted at gate G2 (all demo residue). Gate decisions recorded: **G1 = fail-CLOSED** (block contractor assignment when the gate itself errors — reverses the previous fail-open default, wired in Phase 1); **§4.5 e-signature = typed** for toolbox/PPE registers, **drawn** for the statutory appointment letters only (Phase 5); **G3 = dev-only**, batch to production later.
- 2026-07-23 remediation fixed: empty-wizard root cause, activity-log schema drift (phantom-write 500s), incident created_by 23502, contractor uuid/parseInt + dead `tickets` refs, all 404 pages, checklist editor, migration reproducibility, reminders cron. Dead code deleted: ContractorHSTab, InvestigationPanel/FiveWhysForm, investigate API, calculateAuditScore.
- 2026-07-30: classified training certificate upload built (migration 471) — see the section above. Also closed a set of pre-existing staff-document authorization holes found on the way: `/api/staff-documents-download`, `/api/staff-documents/[documentId]` (GET/PUT/DELETE), `/api/staff-documents/expiring` and `/api/staff-documents-upload` authenticated but did not authorize at all.
- 2026-07-24: Phases 4–9 **built** (training matrix, toolbox/DSTI, PPE, permit-to-work, digital safety file + appointment letters, LTIFR/DIFR, e-signatures, H&S RBAC, fail-closed gate, severity unification) — see the "Phases 4–9 build" section above. Still deferred: offline/PWA field capture, journey management.

## Related
- `src/modules/health-safety/.claude.md` — quick reference (auto-loaded)
- `.claude/skills/hns/SKILL.md` — /hns operational skill
- `docs/plans/health-safety-e2e-goal.md` — the remediation plan/audit findings
