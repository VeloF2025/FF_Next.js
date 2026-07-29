<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: conduit
<!-- Financial portfolio scoping — revenue, COS, margin modelling for Prospective + Executable projects -->

## Purpose
Project financial modelling: inline-editable portfolio table with revenue, cost-of-sales breakdown, gross profit and margin calculations. Data sourced from SharePoint Shareholder Model (read-only) and local DB overrides.

## Key Files
| File | Purpose |
|------|---------|
| `components/PortfolioTable.tsx` | Main grid — Prospective + Executable sections |
| `components/ProjectDetailPanel.tsx` | Expandable project drill-down |
| `components/MonthlyForecastGrid.tsx` | 60-month forecast per project |
| `components/conduit-cells.tsx` | Inline-editable cell components |
| `components/BaselineList.tsx` | Baseline scenario management |
| `components/SelectListAdmin.tsx` | Configurable selection lists |
| `hooks/useConduitCalc.ts` | Pure formula engine (no side effects) |
| `types/index.ts` | `ConduitProject`, `ConduitCalcResult`, `ConduitCosBreakdown` |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/conduit/projects` | List all portfolio projects |
| GET | `/api/conduit/projects/[id]` | Single project data |
| PUT | `/api/conduit/projects/[id]` | Update editable fields |
| GET | `/api/conduit/projects/[id]/detail` | Financial detail + forecast |

## Database Tables
- `conduit_projects` — project portfolio data with `inputs_json` JSONB column (rate, uptake, scope, service_rates, material_rates, monthly_opex, lump_costs)

## Formula Summary (from `useConduitCalc`)
- Revenue = `po_count × uptake × rate`
- COS Services = poles + stringing + optical + activation + wayleave (all per-unit rates)
- COS Material = poles + cable + optical + activation (material rates)
- COS OPEX = `(casuals + fuel + overheads + sales + ad_hoc) × build_duration_months`
- COS Lump = `wayleave_cost`
- GP% = `(revenue − cos_total) ÷ revenue`

## Critical Rules
- NEVER modify SharePoint Shareholder Model data — Graph API is read-only
- ALWAYS use `useConduitCalc` for all derived numbers — never inline arithmetic in components
- Editable cells save per-project via PUT; debounce to avoid rapid DB writes
- Page route: `app/(main)/conduit/page.tsx` (App Router)
- Never add `max-w-7xl` wrapper inside module — `ModulePage` handles padding

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
