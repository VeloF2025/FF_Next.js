<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: pipeline
<!-- Pre-project wayleave/approval pipeline — tracks potential projects before they become planned -->

## Purpose
Manages potential projects through approval stages (wayleave, municipal, environmental, traditional council) before they transition to `projects`. Full document management, 2-level internal approval, expiry alerts, and Smartsheet sync.

## Key Files
| File | Purpose |
|------|---------|
| `components/PipelineDashboard.tsx` | Project list + stats + alerts widget |
| `components/PipelineProjectDetail.tsx` | Project detail with approval gates + drawer |
| `components/ApprovalDetailDrawer.tsx` | Approval workflow actions (docs first, actions collapsed) |
| `components/DocumentManager.tsx` | Document upload per approval |
| `components/ProjectDocumentManager.tsx` | Project-level legal docs (Lease, Cession) |
| `components/AlertsDashboard.tsx` | Expiring approvals + due follow-ups |
| `components/SmartsheetSyncPanel.tsx` | Smartsheet sync UI |
| `services/pipelineProjectService.ts` | Project CRUD (uses Neon shim `@/lib/neon`) |
| `services/pipelineApprovalService.ts` | Approval workflow operations |
| `services/pipelineSmartsheetService.ts` | Smartsheet sync (sheet 8735086443712388) |
| `services/pipelineDocumentSyncService.ts` | Document sync from Smartsheet attachments |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/pipeline/projects` | List / create |
| GET/PUT/DELETE | `/api/pipeline/projects/[id]` | Project CRUD (DELETE = hard cascade) |
| GET/POST | `/api/pipeline/projects/[id]/approvals` | Approval gates |
| GET/POST/DELETE | `/api/pipeline/projects/[id]/documents` | Project-level docs |
| POST | `/api/pipeline/projects/[id]/receive-po` | Receive PO → status advance |
| GET/PUT/DELETE | `/api/pipeline/approvals/[id]` | Approval CRUD |
| POST | `/api/pipeline/approvals/[id]/submit` | Submit to authority |
| POST | `/api/pipeline/approvals/[id]/approve` | Mark approved |
| POST | `/api/pipeline/approvals/[id]/internal-approve` | PM/Ops 2-level internal approval |
| GET/POST | `/api/pipeline/approvals/[id]/documents` | Approval docs |
| GET | `/api/pipeline/documents/[...path]` | Document proxy (avoids CORS on storage) |
| GET | `/api/pipeline/expiring` | Expiring approvals by urgency (90/30/7d) |
| GET/POST/PUT | `/api/pipeline/smartsheet/config` | Sync config |
| POST | `/api/pipeline/smartsheet/sync` | Manual sync trigger |

## Database Tables
- `pipeline_projects` — main project entity
- `pipeline_project_approvals` — approval instances (one per approval type per project)
- `pipeline_approval_documents` — documents per approval
- `pipeline_approval_types` — configurable approval types
- `pipeline_expiry_alerts` — auto-generated via DB trigger (90/30/7 days before expiry)
- `pipeline_activity_log` — full audit trail
- `smartsheet_sync_config` / `smartsheet_sync_history` — Smartsheet sync state

## Critical Rules
- All user ID columns are audit-only — NO FK constraints to `staff` or `users` tables (dropped Feb 2026 — they use different UUID spaces)
- DELETE is hard cascade: `projects` unlink → `project_pipeline_links` → `pipeline_approval_documents` → `pipeline_project_approvals` → `pipeline_projects`
- Document proxy at `/api/pipeline/documents/[...path]` required — direct storage URLs blocked by CORS
- Internal approval: `pending_pm → approved_pm → approved_ops` — only then can submit externally
- Never add `max-w-7xl` wrapper in dashboard — `ModulePage` handles width
- `pipelineProjectService.ts` uses Neon shim (`@/lib/neon`) — 500s → check shim first

## Status Flow
`new → qualification → approvals_in_progress → approvals_complete → po_pending → ready_to_plan → planned`
Side exits: `on_hold | cancelled | lost`

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
