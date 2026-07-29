<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: billing
<!-- Weekly FT billing reconciliation — bundle upload, zone uptake, deductions, DR payment status -->

## Purpose
Finance-only module for weekly Fibre Time (FT) billing reconciliation: ingests dropped Excel/PDF bundles, resolves project names via fuzzy match, surfaces deductions and zone uptake data.

## Key Files
| File | Purpose |
|------|---------|
| `components/BillingUploadTab.tsx` | Folder-drop UI for weekly bundle (xlsx + PDFs) |
| `components/WeeklySummaryTab.tsx` | Reconciled table per project |
| `components/DRPaymentStatusTab.tsx` | DR payment status view |
| `services/bundleProcessor.ts` | Orchestrates file classification and parsing |
| `services/parseFTPaymentSummary.ts` | Parses FT payment PDF + notes xlsx |
| `services/parseZoneUptake.ts` | Parses zone uptake PDF (per-zone and per-PON) |
| `services/reconcileBillingWeek.ts` | DB reconciliation run |
| `services/resolveProjectName.ts` | Fuzzy project name → DB project_id resolver |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/billing/upload-weekly-bundle` | Full folder drop (all files at once) |
| POST | `/api/billing/upload-weekly` | Single file upload |
| GET | `/api/billing/weekly` | Fetch weekly summary |
| POST | `/api/billing/reconcile` | Trigger reconciliation run |
| GET | `/api/billing/projects` | Eligible billing projects |
| GET | `/api/billing/dr-history` | DR payment history |
| GET | `/api/billing/status` | Overall billing status |

## Critical Rules
- Restricted to `super_admin` only — regular admins/managers cannot see Finance menu
- Bundle expects 3 file types: FT payment PDF (`<Project> WE<code>.pdf`), notes xlsx (`notes.xlsx`), zone uptake PDFs (`_installation uptake per zone_`)
- Ambiguous project name matches are flagged inline — never silently matched
- Partial imports OK; blocked projects surface inline rather than hard-failing entire bundle
- Deductions applied when zone uptake < contracted threshold
- All environments share single production DB — billing writes are immediate

## Domain Notes
- FT = Fibre Time (ISP billing system)
- GRV = Goods Received Voucher (confirms delivery before billing)
- Zone uptake = % homes activated in zone; drives deduction calculation
- Full domain logic: `memory/ft-billing-reconciliation.md`

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
