# Changelog - Activate Module

All notable changes to the Activate module will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

---

## [47e06fe] - 2026-03-11 - Claude Sonnet 4.5 - Feature

**feat(activate): add confidence-tiered auto-approval for VLM photo categorization**

Cherry-picked from feature/vlm-auto-approval branch.

**Changes:**
- Tier thresholds: auto_approved (>=92% conf + >=85% step acc), review_recommended (70-92%), human_required (<70% or unreliable step)
- New auto-approval service with confidence-based decision logic
- Enhanced PhotoReviewPhase UI with auto-approval indicators
- Updated unified types for categorization confidence tiers

**API Endpoints:**
- Modified: `/api/activate/approve-categorization` - Updated approval logic
- Modified: `/api/activate/categorize-photos` - Added tier calculation (+42 lines)

**Files Changed:** 5 files, 456 insertions, 20 deletions
- `pages/api/activate/approve-categorization.ts` (3 lines)
- `pages/api/activate/categorize-photos.ts` (42 lines)
- `src/modules/activate/components/wizard/PhotoReviewPhase.tsx` (139 lines)
- `src/modules/activate/services/autoApprovalService.ts` (262 lines, NEW)
- `src/modules/activate/types/unified.types.ts` (30 lines)

**Co-Authored-By:** Claude Opus 4.6

---

## [a167840] - 2026-03-10 - Elon (CTO) - Feature

**feat(activate): penetration curve report with Project/Zone/PON drill-down**

**Changes:**
- New penetration curve analytics report with hierarchical drill-down
- Project-level view with Zone breakdown
- Zone-level view with PON breakdown
- Real-time penetration percentage calculation
- Interactive ReportsDashboard integration

**API Endpoints:**
- New: `/api/activate/reporting/penetration-curve` - Penetration analytics endpoint (338 lines)

**Files Changed:** 4 files, 716 insertions, 1 deletion
- `pages/api/activate/reporting/penetration-curve.ts` (338 lines, NEW)
- `src/modules/activate/components/reporting/PenetrationCurveReport.tsx` (337 lines, NEW)
- `src/modules/activate/components/reporting/ReportsDashboard.tsx` (10 lines)
- `src/modules/activate/types/reporting.types.ts` (32 lines)

---

## [19c4a88] - 2026-03-11 - Claude Sonnet 4.5 - Feature

**feat(activate): unified PP resolution pipeline with WA cross-ref and VLM**

Root cause fix + backfill pipeline for missing ONT/UPS serials in Primary Premises.

**Changes:**
- Fix root cause: dr-acknowledgment now persists ONT/UPS serials at submission time
- Add WA cross-reference: backfills missing serials via BOSS API for existing DRs
- Add WA photo VLM scan: extracts serials from activation photos and matches PPs
- Consolidate UI: single "Resolve All" button replaces 3 separate scan buttons
- Pipeline runs: local DB scan → WA cross-ref → WA photo VLM extraction

**API Endpoints:**
- Modified: `/api/activate/dr-acknowledgment` - Persist serials at submission (+31 lines)
- Modified: `/api/activate/pp-data-resolve` - Unified resolution pipeline (+344 lines)

**Files Changed:** 3 files, 379 insertions, 31 deletions
- `pages/api/activate/dr-acknowledgment.ts` (31 lines)
- `pages/api/activate/pp-data-resolve.ts` (344 lines)
- `src/modules/activate/components/PPDataTab.tsx` (35 lines)

**Co-Authored-By:** Claude Opus 4.6

---

## [f80c39c] - 2026-03-11 - Jarvis - Feature

**feat(activate): penetration curve - elapsed time axis, PO scope, continuous lines, hide-zero filter**

Post-PR-99 improvements to penetration curve report.

**Changes:**
- X-axis: elapsed days/weeks since each project's first activation (D0/D60/D120) instead of calendar dates — makes rate-of-penetration directly comparable
- Scope denominator: `client_purchase_orders.contracted_drops` (PO uptake target) instead of total drop count. Zone/PON scope pro-rated proportionally. Falls back to drop count if no PO exists.
- `connectNulls=true`: continuous lines through days with no activations
- 'Hide zero' filter toggle (default on): hides projects/zones with 0% penetration to reduce noise
- Drill-down: Project -> Zone -> PON with breadcrumb navigation
- Summary badges with progress bars, clickable for drill-down

**API Endpoints:**
- Modified: `/api/activate/reporting/penetration-curve` - Enhanced calculation logic (+295/-283 lines)

**Files Changed:** 2 files, 509 insertions, 283 deletions
- `pages/api/activate/reporting/penetration-curve.ts` (295 lines refactored)
- `src/modules/activate/components/reporting/PenetrationCurveReport.tsx` (497 lines refactored)

**Closes:** Penetration curve feature

---

*Last Updated: 2026-03-11*
