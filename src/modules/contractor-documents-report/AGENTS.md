<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: contractor-documents-report
<!-- Contractor compliance document tracking with expiry alerts and CSV/PDF export -->

## Purpose
Displays compliance document status per contractor (6 company doc types + 1 ID per team member), calculates completeness %, flags expiring/expired docs, and exports CSV/PDF.

## Key Files
| File | Purpose |
|------|---------|
| `components/AllContractorsSummary.tsx` | Summary table for all contractors with overall stats |
| `components/SingleContractorReport.tsx` | Per-contractor detail: company docs + team member docs |
| `components/DocumentStatusTable.tsx` | Table of docs with `DocumentStatusBadge` |
| `components/ExpiryAlert.tsx` | Alert banner for expiring/expired docs |
| `services/documentReportApiService.ts` | Frontend fetch functions + `downloadBlob()` |
| `services/documentReportService.ts` | Backend business logic |
| `types/documentReport.types.ts` | All types: `DocumentVerificationStatus`, `DocumentUrgencyLevel`, `DocumentDisplayStatus` |
| `utils/documentStatusRules.ts` | Derives `displayStatus` from verification + expiry combo |
| `utils/completenessCalculator.ts` | Calculates `completionPercentage` |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/contractors-documents-report?contractorId=<id>` | Single contractor full report |
| GET | `/api/contractors-documents-report-summary` | All contractors summary + overall stats |
| GET | `/api/contractors-documents-export?contractorId=<id>&format=csv\|pdf` | Export blob |

## Database Tables
- `contractor_documents` — uploaded doc records (type, verification_status, expiry_date, file_url)
- `contractors` — contractor basic info
- `contractor_team_members` — team members each requiring one ID Document

## Critical Rules
- 6 company doc types: CIDB Certificate, B-BBEE Certificate, Company Registration, Tax Clearance, Bank Confirmation Letter, Proof of Address
- Team member doc type: ID Document — one required per team member
- Expiry warning: 30-day threshold; `urgencyLevel` = `expiring` (≤30 days) or `expired` (past date)
- `displayStatus` merges verification + urgency: `expiring`/`expired` override `verified`
- `completionPercentage` counts only `verified` docs — `pending` does NOT count toward completion
- Blocking status checks: 3+ unaccounted items OR >R5000 value triggers contractor block

## Common Issues
| Problem | Fix |
|---------|-----|
| Completeness stuck at 0% | Only `verified` docs count — check docs are fully approved, not just uploaded |
| Export returns empty file | API returns Blob; call `downloadBlob(blob, filename)` from `documentReportApiService` |
| Team member docs missing | Verify `contractor_team_members` table has entries for that contractor |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
