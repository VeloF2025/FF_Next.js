# Changelog - Construction QA Module

All notable changes to the Construction QA (Field Ops) module will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

---

## [d66ce08] - 2026-03-10 - Claude Sonnet 4.5 - Refactor

**refactor(field-ops): consolidate disciplines from 3 to 2 (civil + optical)**

Merge splicing discipline into optical per Velocity Fibre Optical Checklist v1.0.

**Changes:**
- Phase A: Distribution Dome (8 steps) — was splicing steps 1-8
- Phase B: Main Joint (6 steps) — was splicing steps 11-16
- Remove old optical cable stringing discipline (6 steps, 0 reviews existed)
- Update all types, APIs, UI components, reason codes, ingestion mappings

**Database Migration:**
- Migration 240: `240_optical_discipline_consolidation.sql` (87 lines)
  - Rename `splicing_step_*` columns → `optical_step_*`
  - Drop old optical cable stringing columns
  - Update discipline values (64 rows affected)
  - 18 schema changes total

**API Endpoints:**
- Modified: `/api/construction-qa/ingest-qfield` - Updated ingestion mapping
- Modified: `/api/construction-qa/project-dashboard` - Updated discipline filtering
- Modified: `/api/construction-qa/review` - Consolidated discipline logic (21 lines)
- Modified: `/api/construction-qa/vlm-validate` - Updated step validation
- Modified: `/api/construction-qa/zone-hierarchy` - Updated discipline aggregation

**Files Changed:** 22 files, 242 insertions, 350 deletions
- `pages/api/construction-qa/ingest-qfield.ts`
- `pages/api/construction-qa/project-dashboard.ts`
- `pages/api/construction-qa/review.ts`
- `pages/api/construction-qa/vlm-validate.ts`
- `pages/api/construction-qa/zone-hierarchy.ts`
- `prisma/migrations/sql/240_optical_discipline_consolidation.sql` (NEW)
- `src/modules/construction-qa/components/ConstructionQaCentrePage.tsx`
- `src/modules/construction-qa/components/dashboard/FieldOpsDashboardPage.tsx`
- `src/modules/construction-qa/components/dashboard/ProjectQaCard.tsx`
- `src/modules/construction-qa/components/dashboard/ProjectQaTable.tsx`
- `src/modules/construction-qa/components/project/PonFeaturesPanel.tsx`
- `src/modules/construction-qa/components/project/PonRow.tsx`
- `src/modules/construction-qa/components/project/ProjectDetailPage.tsx`
- `src/modules/construction-qa/components/wizard/PhaseDataValidation.tsx`
- `src/modules/construction-qa/components/wizard/PhaseFinalDecision.tsx`
- `src/modules/construction-qa/components/wizard/PhasePhotoReview.tsx`
- `src/modules/construction-qa/components/wizard/ReviewWizard.tsx`
- `src/modules/construction-qa/services/qfieldIngestionService.ts`
- `src/modules/construction-qa/types/construction.types.ts` (major refactor: -333 lines)
- `src/modules/construction-qa/types/dashboard.types.ts`
- `src/modules/help-center/data/manual-content.ts`
- `src/shared/config/modules/construction-qa.config.ts`

**Co-Authored-By:** Claude Opus 4.6

---

*Last Updated: 2026-03-11*
