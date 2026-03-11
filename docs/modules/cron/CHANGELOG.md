# Cron Module Changelog

All notable changes to the Cron module will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Documentation
- Initial comprehensive module documentation created (March 10, 2026)
- Added README.md with full endpoint descriptions, architecture, and troubleshooting
- Added CHANGELOG.md tracking historical changes

---

## [1.5.0] - 2026-02-28

### Added
- **enable-auto-recording.ts**: Cron job to automatically enable recording for upcoming Teams meetings
- **poll-teams.ts**: Microsoft Graph API integration for Teams meeting polling
- **renew-graph-subscriptions.ts**: Automatic renewal of Microsoft Graph change notification subscriptions

### Changed
- Upgraded meetings integration to use Microsoft Graph API directly

### Commits
- `32d10a10` - feat(meetings): auto-recording cron for upcoming Teams meetings
- `e60e6fcc` - feat(meetings): Teams Meeting integration via Microsoft Graph API

---

## [1.4.0] - 2026-02-26

### Added
- **recurring-invoices.ts**: Automated generation of customer invoices from recurring templates (6 AM daily)
- **recurring-journals.ts**: Automated posting of journal entries from recurring templates (6 AM daily)

### Changed
- Added accounting automation support with recurring operations

### Commits
- `124b19f5` - feat(accounting): add recurring cron endpoints and depreciation/audit tables

---

## [1.3.0] - 2026-02-08 to 2026-02-25

### Changed
- **All cron endpoints**: Refactored to use singleton `Pool` from `src/lib/db` instead of creating new connections
- **API responses**: Fixed double-wrapping in 15 endpoints to standardize response format

### Security
- Removed hardcoded credentials from scripts and documentation

### Commits
- `cc99782b` - fix(api): remove apiResponse.success() double-wrapping in 15 endpoints
- `11bdcf6c` - refactor(db): consolidate 68 files to use singleton Pool from src/lib/db
- `bb13952e` - fix(security): remove hardcoded credentials from scripts and docs

---

## [1.2.0] - 2026-01-25 to 2026-01-29

### Added
- **process-vlm-queue.ts**: Parallel batch processing with configurable concurrency
- Enhanced VLM queue to process extraction-only DRs (faster throughput)
- Added prioritization: extraction-only DRs processed before full pipeline

### Fixed
- **process-vlm-queue.ts**: Fixed infinite reprocessing loop for DRs without step 6/7/9 photos
- **process-vlm-queue.ts**: Excluded already-categorized DRs from unnecessary reprocessing
- **process-vlm-queue.ts**: Improved error logging to capture actual error messages
- **process-vlm-queue.ts**: Fixed VLM categorization storing empty results
- **All cron endpoints**: Migrated from `@neondatabase/serverless` to `pg` for better stability
- **backfill-onemap-data.ts**: Capture ONT/UPS serials even when photos are empty

### Performance
- **process-vlm-queue.ts**: 4-6x throughput improvement through parallelization
- Added 500ms pause between batches to prevent VLM service overload

### Commits
- `0ec60a22` - fix(vlm-queue): stop infinite reprocessing of DRs without step 6/7/9 photos
- `58505a42` - perf(vlm-queue): also process extraction-only DRs, prioritize them
- `3a6ef4ea` - perf(vlm-queue): parallelize DR processing for 4-6x throughput
- `964981f9` - fix(activate): fix VLM categorization storing empty results
- `ce287d01` - fix(vlm-queue): exclude already-categorized DRs from processing queue
- `6213ce0c` - fix(vlm-queue): remove neonConfig reference after pg migration
- `cc6f4fc7` - fix(api): replace @neondatabase/serverless with pg in 26 API files
- `bb925315` - fix(vlm-queue): improve error logging to capture actual error message
- `73200839` - fix(activate): capture ONT/UPS serials even when photos empty
- `03d65a65` - feat(activate): warn when DR submitted but not yet in 1Map
- `c361925e` - chore: accumulated updates across modules, docs, and infrastructure

---

## [1.1.0] - 2026-01-17 to 2026-01-23

### Added
- **process-vlm-queue.ts**: Initial VLM queue processing for automated DR photo analysis (every 5 minutes)
- **backfill-onemap-data.ts**: Backfill missing ONT/UPS serials from 1Map BOSS API (every 15 minutes)
- **sage-sync.ts**: Sage accounting synchronization for invoices and payments (every 15 minutes)
- **recheck-onemap-status.ts**: Recheck 1Map activation status for pending DRs
- **sync-onemap-serials.ts**: Real-time ONT/UPS serial synchronization from 1Map (every 5 minutes)
- Enhanced VLM extraction to try multiple photos per step for better success rate
- Added barcode scanning fallback for ONT serial extraction

### Changed
- **process-vlm-queue.ts**: Try multiple Step 9 photos if first extraction fails
- **process-vlm-queue.ts**: Try multiple photos for all extraction steps (Step 6, 7, 9)

### Database
- Merged `foto_ai_reviews` into unified `dr_photo_unified_reviews` table

### Commits
- `ffb90a5a` - feat(activate): add VLM queue cron for automatic extraction
- `a9dcaf91` - feat(activate): add backfill cron to sync missing OneMap photos/serials
- `f8ff36e2` - feat(sage): add supplier, invoice, payment sync services and cron job
- `16031101` - feat(activate): add installer name from 1Map via BOSS API
- `4f42d5ba` - feat(activate): add barcode scanning for ONT serial extraction
- `e9c71ac0` - fix(activate): try multiple photos for all extraction steps
- `d0b8a871` - fix(activate): try multiple Step 9 photos for extraction
- `270190ee` - feat(activate): merge foto_ai_reviews into dr_photo_unified_reviews

---

## [1.0.0] - 2026-01-13 to 2026-01-14

### Added
- **fleet-check-reminders.ts**: Daily and weekly vehicle check-in reminders (7 AM Mon-Sat)
  - WhatsApp primary delivery via WAHA API
  - Email fallback via Resend API
  - Separate daily (odometer/fuel) and weekly (full inspection) checks
  - Monday = weekly check day
- **sync-onemap-serials.ts**: Automatic serial sync when DR submitted to WA Monitor

### Commits
- `f9b23e53` - feat(fleet): add daily/weekly check-in modes with VLM integration
- `33aba264` - feat(onemap): implement automatic serial sync when DR submitted to WA Monitor

---

## [0.2.0] - 2025-10-29

### Added
- **sync-action-items.ts**: Automatic action item extraction from Fireflies meeting transcripts (every 6 hours)
  - Step 1: Sync meetings from Fireflies API
  - Step 2: Extract action items from transcripts

### Fixed
- **sync-action-items.ts**: Fixed execution order - now syncs meetings BEFORE extracting action items
- Removed cron schedule from code comment to avoid syntax errors in Vercel deployment

### Commits
- `52e10bd7` - feat: add automatic action items sync with Vercel Cron
- `0de103d8` - fix: cron job now syncs meetings BEFORE extracting action items
- `c751fccf` - fix: remove cron schedule from comment to avoid syntax error

---

## [0.1.0] - Initial Implementation (Pre-2025-10-29)

### Added
- Initial cron job infrastructure
- Basic authentication with CRON_SECRET
- Standardized API response formatting
- Structured logging for all cron operations
- Vercel Cron integration via `vercel.json`

### Architecture Established
- Next.js Pages Router API routes pattern (`pages/api/cron/`)
- CRON_SECRET header verification for security
- Idempotent job design for safe retries
- Graceful error handling and logging
- Database connection pooling
- OAuth token auto-refresh for external APIs

---

## Summary Statistics

### Current Module State (as of March 10, 2026)
- **Total Cron Jobs**: 12
- **Total Lines of Code**: 2,089
- **Active Schedules**: 5 (via vercel.json)
- **Manual Triggers**: 7 (external schedulers)
- **External APIs Integrated**: 6 (Sage, Graph, 1Map, WAHA, Resend, Fireflies)

### Major Milestones
1. **Oct 2025**: Action items automation
2. **Jan 2026**: VLM queue processing, Sage sync, Fleet reminders, 1Map integration
3. **Feb 2026**: Database refactoring, accounting automation, Teams meeting integration
4. **Mar 2026**: Comprehensive documentation

---

## Maintenance Notes

### Breaking Changes
- **2026-01-25**: Migration from `@neondatabase/serverless` to `pg` - ensure environment uses correct client
- **2026-01-25**: Database schema change - `foto_ai_reviews` merged into `dr_photo_unified_reviews`

### Deprecations
- None currently

### Security Updates
- **2026-02-07**: Hardcoded credentials removed - all secrets now in environment variables
- **Ongoing**: CRON_SECRET verification enforced in production

---

## Future Roadmap

### Planned for Q2 2026
- [ ] Webhook migration for poll-based jobs (poll-teams, sync-onemap-serials)
- [ ] Exponential backoff retry logic
- [ ] Dead letter queue for failed jobs
- [ ] Real-time metrics dashboard

### Under Consideration
- [ ] Database-driven cron schedules (no redeployment needed)
- [ ] Distributed locking for multi-instance deployments
- [ ] Job cancellation/graceful shutdown
- [ ] Adaptive concurrency for VLM queue

---

**Changelog Maintainer**: Dev Team  
**Last Updated**: March 10, 2026  
**Format Version**: 1.0.0 (Keep a Changelog)
