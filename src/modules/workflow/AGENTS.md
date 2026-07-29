<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: workflow
<!-- Workflow template engine (UI + service layer); DB schema NOT YET IMPLEMENTED -->

## Purpose
Provides a visual workflow template editor and portal for managing state-machine workflows across projects and installations — currently in-memory only pending DB schema.

## Key Files
| File | Purpose |
|------|---------|
| `WorkflowPortalPage.tsx` | Tabbed portal: Templates / Editor / Projects / Analytics |
| `services/WorkflowManagementService.ts` | **In-memory** CRUD for templates (no DB yet) |
| `services/WorkflowTemplateService.ts` | Template validation and clone operations |
| `components/editor/` | Visual drag-drop workflow editor |
| `components/tabs/` | TemplatesTab, EditorTab, ProjectsTab, AnalyticsTab |
| `context/WorkflowPortalContext.tsx` | Portal state: activeTab, templateStats |
| `types/workflow.types.ts` | WorkflowTemplate, Phase, Step, Task types |
| `types/portal.types.ts` | WorkflowTabId, portal state types |

## Critical Rules
- **`WorkflowManagementService` is in-memory** — `workflow_templates` table does not exist yet; all data resets on server restart
- Tab state syncs via `?tab=` URL param (router.push)
- Accessed from Settings at `/settings?tab=workflow`
- NEVER modify workflow state directly — use transition methods (when DB is wired)

## Common Issues
| Issue | Fix |
|-------|-----|
| Templates disappear on refresh | Expected — in-memory storage; DB not yet implemented |
| Tab not updating on back-nav | URL param `?tab=` drives state; ensure router.query is read |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
