<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: dashboard
<!-- Main app landing page — role-aware KPI cards, recent activity, quick actions, dynamic tools -->

## Purpose
Post-login landing page: greeting, KPI stat cards, recent activity feed, role-based quick actions, pinned links, usage-based dynamic tool shortcuts, and stale projects widget.

## Key Files
| File | Purpose |
|------|---------|
| `Dashboard.tsx` | Root component — assembles all widgets |
| `components/ProjectOverviewCard.tsx` | Active project summary card |
| `components/RecentActivityFeed.tsx` | Recent events across modules |
| `components/QuickActions.tsx` | Role-aware action shortcuts |
| `components/DynamicTools.tsx` | Usage-based module shortcuts (most-visited) |
| `components/PinnedLinks.tsx` | User-pinned links (stored in DB) |
| `components/StaleProjectsWidget.tsx` | Projects with no recent updates |
| `components/StatsCard.tsx` | Individual KPI card |
| `config/roleDefaultTools.ts` | Default tool set per role (shown before usage history exists) |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/analytics/dashboard/stats` | KPI stats (projects, poles, drops, revenue) |
| GET | `/api/analytics/dashboard/trends` | Trend data for stat cards |
| GET | `/api/dashboard/pinned-links` | User pinned links |
| POST | `/api/dashboard/pinned-links` | Save pinned link |
| GET | `/api/dashboard/quick-links` | Quick link config |

## Critical Rules
- Uses `useMainDashboardData` hook from `src/hooks/useDashboardData.ts` — not the analytics module hook
- Stat cards built by `getMainDashboardCards()` from `src/config/dashboards/dashboardConfigs.ts`
- `DynamicTools` resolves routes via `ROUTE_MODULE_MAP` + `getModuleFromRoute()` in `roleDefaultTools.ts`
- Hydration guard: time-dependent content (greeting, date) only renders after `mounted = true`
- All data from real DB — zero mock data in Dashboard.tsx

## Role Default Tools
Roles → default module shortcuts (before usage history):
- `super_admin`: Civil QA, Procurement, NOC, Analytics, Activate, Projects
- `project_manager`: Projects, Pole Tracker, SOW, Contractors, Procurement, Reports
- `field_technician`: Civil QA, Pole Tracker, Activate, Projects, Fleet, Progress
- `site_supervisor`: Civil QA, Pole Tracker, Projects, Activate, NOC, Progress

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
