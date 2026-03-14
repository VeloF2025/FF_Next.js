# Changelog - Notifications Module

All notable changes to the Notifications module will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

---

## [5afe860] - 2026-03-11 - Hein van Vuuren - Fix

**fix(error-handling): add logging to TIER 1 silent catches (fleet, procurement, qfield, staff-docs, notifications)**

Added `console.error()` logging to 61 TIER 1 catch blocks that were silently swallowing errors across fleet, procurement, qfield, staff-docs, and notifications modules.

**Changes (Notifications Module):**
- Added error logging to 6 notification endpoints
- Core notification operations: list, mark-read, mark-all-read, unread count
- Notification preferences management
- Test notification endpoint

**Files Changed (Notifications only):** 6 files, 13 insertions
- `pages/api/notifications/index.ts`
- `pages/api/notifications/mark-all-read.ts`
- `pages/api/notifications/mark-read.ts`
- `pages/api/notifications/preferences.ts`
- `pages/api/notifications/test.ts`
- `pages/api/notifications/unread-count.ts`

**Total across all modules:** 61 files, 118 insertions, 3 deletions

---

*Last Updated: 2026-03-11*
