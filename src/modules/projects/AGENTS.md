<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# projects module

Full lifecycle management for FTTH fibre network projects: creation wizard, SOW import (poles/drops/fibre), progress tracking, budget, activation gate, and finance dashboard.

**Pages:** `pages/projects/` — list, `[id]/index`, `[id]/tracker`, `[id]/budget`, `[id]/edit`, `new`, `progress`, `reports`, `pipeline/*`
**API routes:** `pages/api/projects/index.ts` GET/POST list+create; `pages/api/projects/[projectId].ts` GET/PUT/DELETE single; `pages/api/projects/[projectId]/` — tracker, budget/*, pon-progress, pon-stages, activation-check, team, client-pos/*, customer-invoices/*, wayleaves/*, prereqs, finance/dashboard, sp-tracker, dashboard, and more; `pages/api/projects/portfolio-dashboard.ts`, `search.ts`, `stats.ts`, `stale.ts`, `expiring-documents.ts`
**DB table:** `projects` — PK `id` (uuid), `project_name` (NOT `name` — always alias: `p.project_name as name`), `project_code`, `client_id`, `project_type`, `status`, `priority`, `project_manager` (uuid FK to staff/users), `budget`, `actual_cost`, `progress` (jsonb), `location` (jsonb), `latitude`, `longitude`, `budget_status`, `budget_health`, `budget_utilization`; also `project_budgets` (`project_id`, `total_budget`, `committed_amount`, `actual_amount`, `available_budget`); `drops`, `poles`, `fibres` (SOW sub-records)
**Key files:**
- `tracker/UnifiedTrackerGrid.tsx` — unified poles/drops/fibre tracker grid with type/phase/status filters; always use this, never roll a custom grid
- `tracker/hooks/useTrackerData.ts` — fetches `/api/projects/[id]/tracker`, backbone of the tracker tab
- `hooks/useProjects.ts` — React Query hooks: useProjects, useProject, useCreateProject, useUpdateProject, useUpdateProjectStatus; staleTime 5 min
- `services/activationService.ts` — `checkActivationRequirements()` gates PLANNING→ACTIVE: client PO + wayleaves + H&S + contractor agreement must all pass
- `components/ProjectWizard/ProjectCreationWizard.tsx` — multi-step wizard: BasicInfo → ProjectDetails → SOWUpload → Review
- `sow/services/sowDropImport.ts`, `sowPoleImport.ts`, `sowFiberImport.ts` — SOW Excel import; never write SOW data directly
- `components/Dashboard/PortfolioDashboard.tsx` — portfolio-level view: budget health, network progress, expiring docs

**Gotchas:**
- `project_name` not `name` — alias in every SELECT (`p.project_name as name`); `services/projectService/core/` still uses Firebase/Firestore field `name` (legacy dead code) — real DB ops are in `pages/api/projects/`
- `pages/api/projects/index.ts` uses Neon serverless shim with explicit branched queries for each filter combo (status/clientId/search) — Neon shim breaks conditional SQL
- One project per site: disciplines (civil, fibre, installs) are project teams, NOT separate projects
- Budget comes from two sources: `projects.budget` (simple column) and `project_budgets` table (normalised) — finance dashboard joins both; never assume one is canonical
- `drops` table = SOW import records (`/api/sow/drops`); `qa_photo_reviews` is WA QA data — completely different, do not confuse
- All-projects list is cached 5 min in `queryCache` (CacheNamespaces.PROJECTS); call `cacheInvalidation.project()` after any write
