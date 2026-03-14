# Changelog - QField Module

All notable changes to the QField module will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

---

## [5afe860] - 2026-03-11 - Hein van Vuuren - Fix

**fix(error-handling): add logging to TIER 1 silent catches (fleet, procurement, qfield, staff-docs, notifications)**

Added `console.error()` logging to 61 TIER 1 catch blocks that were silently swallowing errors across fleet, procurement, qfield, staff-docs, and notifications modules.

**Changes (QField Module):**
- Added error logging to 8 API endpoints in qfield module
- Sync dashboard monitoring
- GPKG import and layer extraction
- Poles synchronization
- Project management and assignments
- QA validation

**Files Changed (QField only):** 8 files, 13 insertions
- `pages/api/qfield-sync-dashboard.ts`
- `pages/api/qfield/gpkg-import.ts`
- `pages/api/qfield/gpkg-layers.ts`
- `pages/api/qfield/poles-sync.ts`
- `pages/api/qfield/projects.ts`
- `pages/api/qfield/projects/[id].ts`
- `pages/api/qfield/qa-assignments.ts`
- `pages/api/qfield/qa-validate.ts`

**Total across all modules:** 61 files, 118 insertions, 3 deletions

---

*Last Updated: 2026-03-11*
