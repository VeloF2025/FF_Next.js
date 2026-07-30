<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: health-safety
<!-- SA-compliant H&S management: project audits, incidents, risks, CAPA, contractor gate -->

## Purpose
Project safety audits (multi-template wizard), incident reporting (as maintenance tickets), risk register, CAPA, and contractor compliance gate — aligned with SA OHS Act / Construction Regulations. Fully remediated 2026-07-23 (docs/plans/health-safety-e2e-goal.md).

## Key Files
| File | Purpose |
|------|---------|
| `services/activityLog.ts` | `logHsActivity()` — ONLY writer for hs_activity_log; shim-safe, never throws |
| `services/gateService.ts` | `checkContractorGate(contractorId: string)` — uuid ids; **fail-CLOSED** on error (G1); training score from live worker data |
| `services/scoringService.ts` | `calculateContractorHSScore()` (audit scoring lives in the audits API) |
| `services/hsAuth.ts` | `withHsPermission()` — wrap EVERY H&S endpoint (§4.8 RBAC): withAuth + withPermission('projects.health-safety', view/edit) |
| `services/esignature.ts` | `captureESignature()` — typed/drawn signature + server-derived IP (rightmost public XFF hop) |
| `services/trainingService.ts`, `services/permitService.ts` | contractor training score (**verified rows only**); permit lifecycle state machine + expiry |
| `services/trainingCertificate{Service,Validation,Lifecycle,RouteHandlers}.ts` | classified certificate upload: one binary, N linked competencies, verify/reject/revoke |
| `components/ProjectHSTab.tsx`, `AuditWizard.tsx`, `components/{capa,risk,incident-*,training,appointments,ppe,permits}/` | module UI |

## Critical Rules
- **Training certificates (mig 471)**: the binary lives ONCE in `staff_documents` as `document_type='certification'`; each competency is an `hs_worker_training` row linked by `staff_document_id`. Lifecycle `pending|verified|rejected|revoked` — **only `verified` counts** for competency, expiry reporting and the contractor gate. Upload `POST /api/staff-training-certificates-upload`; binary ONLY via `/api/staff-documents-download` (permission re-checked per request). NEVER return `file_path`, `file_url` or legacy `certificate_url` from an H&S response.
- **Permission** `people.staff.training-certificates` (view/create/edit/delete), seeded to `super_admin` only — NOT implied by `projects.health-safety` or `people.staff.sensitive`. Named custodians need explicit user overrides *plus* permitted `people` and `people.staff` ancestors (RBAC fails closed on a blocked ancestor).
- Verified/revoked certificates are **immutable through delete** — revoke with a reason instead, so the audit trail survives. Transitions are transactional across the document and all its linked rows; `pending->verified`, `pending->rejected`, `verified->revoked` only, same-state is idempotent, anything else 409.
- `/health-safety/training/new` is for catalogue types with `requires_certificate = false` ONLY (written as `verified`); it no longer accepts a free-text certificate URL. Everything else → `/health-safety/training/certificates/new`.
- Employee self-submission and contractor-worker certificate capture are **out of scope** in v1 (internal `staff` only).
- **hs_activity_log live columns**: `activity_type, entity_type, entity_id, user_id(int), description, metadata`. NEVER write `action/actor_id/details` (migration-113-era names — don't exist). Always use `logHsActivity()` AFTER the main write.
- **Audit seeding (D1)**: `hs_project_config.template_id` NULL = seed from ALL active templates with items; set = that template only. Zero seedable items → 400, no audit row.
- Incidents are maintenance tickets: `source_type IN ('hse_incident','hse_near_miss')` + `hs_ticket_details` row (NO FK — orphans possible). `createTicket` MUST get `created_by` (NOT NULL uuid).
- `maintenance_tickets.project_id` is TEXT → join `p.id::text = t.project_id`; `contractor_id` is uuid → `c.id = t.contractor_id` (no cast). The old `tickets` table is dead.
- Contractor ids are uuid strings end-to-end — never parseInt.
- `requires_action` = completed audit that raised actions; count it as completed.
- Neon shim: no conditional SQL fragments, no transactions — compensating deletes for multi-write flows (see incidents POST, audits POST).

## API (all `withHsPermission`; pages/api/health-safety/)
Original: `dashboard` · `checklists` · `audits/[auditId]` · `project/[projectId]/{config,audits}` · `contractor/[contractorId]/{compliance,documents,gate-check}` · `incidents` · `capa` · `risks`.
Phases 4–9: `training/{types,records,competency,pickers}` · `toolbox/[talkId]/attendance` · `ppe/{catalogue,issuance}` · `permits/[permitId]` · `appointments/[letterId]` · `project/[id]/safety-file` (PDF) · `analytics/ltifr` · `man-hours` · `injuries`.
Cron `cron/hs-audit-reminders` (x-cron-secret, NOT withHsPermission) + WA overdue notify (opt-in `WA_HS_GROUP_JID`).

## DB (25 live tables, all uuid PKs)
Original 14 (mig 449/450): `hs_checklist_templates/items` · `hs_project_config` · `hs_project_audits/audit_responses` · `hs_contractor_compliance/documents` · `hs_ticket_details` · `hs_activity_log` · `hs_corrective_actions/capa_comments` · `hs_risk_register(+_reviews)`.
Phases 4–9 (mig 451–456): `hs_training_types/worker_training` · `hs_toolbox_talks/attendance` · `hs_ppe_catalogue/issuance` · `hs_permit_types/permits` · `hs_appointment_letters` · `hs_man_hours/injuries`.
Rebuild proof: `bash scripts/hs-scratch-rebuild-proof.sh` (113→…→sql/456). NEVER psql 113 against live.

## Severity vocab
`critical|major|moderate|minor` (unified §4.9; `fatal` removed — `critical` is top). LTIFR uses a separate injury vocab (`fatality/lost_time/…`).

## Known follow-up
TZ date-display: pure `date` columns render one day early on SAST (node-postgres local-TZ parse). Cast `::text` in list/detail SELECTs. See `.claude/modules/health-safety.md`.

<!-- Rewritten 2026-07-23 (goal D9). -->
