# Changelog

All notable changes to FibreFlow will be documented in this file.
## [2026-02-20]

### ✨ Features
- feat: disable QField QA, redirect to Construction QA (f3de15f4)
- feat: add Thembisa POP 1 & POP 3 to SharePoint QA ingestion (0cf7193d)
- feat: migration 189 — bulk ingest QField photos into Civil QA (790aa4e8)
- feat: add 'unidentified' workflow status for non-standard feature IDs in Civil QA (60673a89)
- feat: add 9 new FibreFlow skills — DR, Odoo, H&S, contractor, DB, KPI, VLM, SOW, fibre (b712b7c3)
- feat: add photo lightbox with zoom/pan and feature ID rename in Civil QA (470522c4)
- feat: add shared PhotoLightbox with zoom/pan to Activate QA Centre (2cbfba95)
- feat: field stock management — mobile portal, API routes, desktop wiring (PRD-027) (caee4de1)

### 🐛 Fixes
- fix: security hardening — auth, CORS, RBAC, and API safety improvements (397caa84)
- fix: security hardening phase 2 — empty catches, HMAC portal tokens, CSP, OneMap secrets (d811f17f)
- fix: remove field-stock redirect so standalone page with 8 sub-tabs is reachable (14e01e94)
- fix: usePickings auto-fetch deadlock — loading initialized true but never triggered fetch (c21c1530)
- fix: revert inventory page redirect that broke Stock/Items/Bundles/Takes tabs (8c079870)

### 📦 Other Changes
- rename: Construction QA → Civil QA (f93efbdf)
- Merge pull request #47 from VelocityFibre/fix/security-hardening (19a8361d)

---

## [2026-02-19]

### ✨ Features
- feat: add Odoo GRN and stock level sync scripts (aa7773e0)
- feat: complete Odoo data sync — vendor bills, serials, reorder rules, fleet, warehouses (ccec209f)
- feat: browser QA infrastructure — Playwright CLI + user stories + /ui-review skill (ad8d246e)
- feat: P0 procurement features — audit wiring, fault UI, audit UI, HoP override (ffa65f58)
- feat: auto-generate 60 smoke stories + /kb staleness tracking (99596dda)
- feat: DR not-found notification, procurement docs, devops scripts, module contexts (7aab62d9)
- feat: procurement document upload — DB, API, component, wired into PO/GRN/RFQ (8eb2edd3)
- feat: extend RBAC, help center and AI chatbot for all new features (850aff28)
- feat: Sage BU/Site integration with P&L reporting (b9ca2bf5)

### 🐛 Fixes
- fix: replace mock supplier data with real DB data in procurement reports (46b01db9)
- fix: cast item_count to integer — prevents string concatenation in stat cards (aa9731a9)
- fix: replace mock spend-by-category and cycle-time with real DB queries (a3804f25)
- fix: remove fake fallback values from aggregate-metrics API (99999d1d)
- fix: eliminate all mock/hardcoded data across codebase (ed00406c)
- fix: complete Odoo data reconciliation — GRN-PO linkage, stock qty, movements (df0890d4)
- fix: WCAG AA accessibility compliance for sign-in page (a7493323)
- fix: SharePoint photo proxy + checklist step categorization for Construction QA (bebc69de)
- fix: expose actual error message in procurement document upload (d837796c)
- fix: flatten VF Storage upload path for procurement documents (6156505d)
- fix: dark theme dropdowns + wizard chatbot overlap on Construction QA (fdcc88f3)
- fix: replace native selects with Radix UI dark dropdowns on Construction QA (c51ecc34)
- fix: QField→Construction QA ingestion with project mapping (0b086d00)
- fix: add missing SageMappingTab component (9d9f639d)

### 📝 Documentation
- docs: add GitHub contributor details to Zander SSH setup guide (ce8c3507)
- docs: update Velocity server storage info after LVM expansion (1f7c3e3d)
- docs: add comprehensive CHANGELOG, field-tech quick ref, and changelog generator (97f457cf)

### 🔧 Chores
- chore: make ingest-qdrant.py executable (f793ce38)
- chore: update /kb skill to use venv python with DATABASE_URL for DB schema ingestion (10bbf8a9)

### 📦 Other Changes
- test: add E2E test for /api/procurement/reports-data endpoint (d73707b4)

---

## [2026-02-18]

### ✨ Features
- feat: add Qdrant vector DB ingestion to /kb skill (862b707f)
- feat: procurement audit trail, fault handling, serial state machine, BOQ forms & export (09a002e4)
- feat: add Construction QA module — Phase 1 MVP (ccfd5648)

### 🐛 Fixes
- fix: NOC dashboard bugs — workload total, recent tickets, kanban sub-tabs (32b463b0)
- fix: qdrant ingestion uses model objects instead of raw dicts (a9f20ecf)
- fix: remove dead WA Sender from health checks, add dashboard page title (b678a410)
- fix: dashboard KPI trends show real percentages, align Kanban with actual ticket statuses (f84ec94e)
- fix: dashboard KPI trends actually read unwrapped API response (09a7c9d9)
- fix: procurement audit — critical security, SQL, and link fixes (cf219ca5)
- fix: strip /storage prefix from internal VF Storage URL for VLM OCR (b5929784)
- fix: correct VF Storage URL patterns across codebase (47ec22c6)
- fix: aggregate-metrics resilient to partial query failures + E2E procurement audit suite (ddcb83c0)
- fix: Construction QA audit bugs — reports page, duplicate header, search debounce (760d6cb5)

### 📝 Documentation
- docs: update wa-monitor for direct-send bridge (sender service removed) (54fbdf41)
- docs: update Zander bootstrap and infra docs for current state (ed10cd4e)

---

## [2026-02-17]

### ✨ Features
- feat: add 'Hide inactive' checkbox to PON Stage Tracker (c5df3688)
- feat: add clickable navigation to activation requirements and prereqs (18c276af)
- feat: add auto-detection for project pre-requisites (b2bcf6c5)
- feat: refine prereq templates — add MSA, BSS, MSS, SOW items (acaa0a10)
- feat: auto-detect BSS and MSS from project_documents table (32fb4e35)
- feat: make Pre-Reqs the default and first tab under Planning (3479ae12)
- feat: supersede previous BOQ versions on re-import (8db77cc3)

### 🐛 Fixes
- fix: remove cron syntax from JSDoc that broke ESM parsing (3cacd4e1)
- fix: remove SITES reference from dynamic sync script (4a211962)
- fix: use QField + OES data for poles planted and CWC stages (2c5f9ff7)
- fix: use correct denominators per stage — poles for build stages, joints for optical, drops for activation (143a1743)
- fix: fall back to poles count for optical when joints lack pon_no (55c8d947)
- fix: add missing requirement_type mappings for prereq clickable links (4ba240bf)
- fix: correct prereq link mappings for BSS, MSS, PO, HLD, LLD (fab9b097)
- fix: use opaque background for wayleave detail drawer (b4e0ca91)
- fix: add toast error feedback when prereq checkbox save fails (b83e15da)
- fix: wayleaves show expired status and overview reflects expired docs (1777bf4f)
- fix: rewrite expiring-documents API to use pool instead of neon driver (265ed0e0)
- fix: correct column names in expiring-documents API queries (461e464c)
- fix: expiring docs links scroll to list and expand in-place (13d50578)
- fix: filter out ancient expired documents from expiring docs sidebar (9ddfe6ac)
- fix: budget KPI falls back to projects.budget when no formal budget record (dd324c08)
- fix: handle Cloudflare tunnel response delivery for BOQ imports (71f6fa1a)
- fix: BOQ import sets item_count on boqs record + polling retry with count (540a1725)

### 📦 Other Changes
- fix(build): use drops table as universal denominator for PON stage totals (cf27451e)
- fix(projects): map camelCase form fields to snake_case API fields (c089689d)
- feat(build): dynamic 1Map stage sync with DB-driven project discovery (ac4f7023)
- fix(build): deduplicate 1Map records by DR number in stage counting (7e591ecf)
- fix(activate): fix QA Centre search 500 error - missing upr JOIN in oesOnlyQuery (2751d338)
- debug: add queryErrors tracking to expiring-documents API (44eeb5a6)

---

## [2026-02-16]

### 🐛 Fixes
- fix: pipeline approval auto-transition + bulk internal approve + Smartsheet import fix (6cb556f1)

---

## [2026-02-15]

### 📦 Other Changes
- feat(build): add PON stage tracker, 1Map stage sync, and project pre-reqs (e23debc3)

---

## [2026-02-14]

### ✨ Features
- feat: Add deployment safety scripts and documentation (d85b341f)

### 🐛 Fixes
- Fix: Update password placeholders to Title Case (434a1e22)
- Fix: Update email placeholder to Title Case across all login forms (bbecd814)
- Fix: Add dark mode variants to all color classes (Theme Compliance #82) (2ebcc303)
- fix: ClientPOCreateModal WCAG 2.1 AA compliance - Task #239 (a92e5a8b)
- fix: Add missing screenshot #35 (Field App Portal) to production (7c13dea5)

### 📝 Documentation
- docs: Update deployment documentation for systemd transition (10e8e38a)
- docs: add Field App Portal section (5.4) to user manual (efde0e66)
- docs: update INFRASTRUCTURE.md paths from /home/louis to /home/velo (4ab05a89)
- docs: Fix 4 broken screenshot references in user manual (2a9590b2)
- docs: FibreFlow User Manual v1.4 - Field App Portal and Mission Control (38a38409)
- docs: Fix screenshot references in user manual (Task #169) (954dbee3)
- docs: Add screenshots 15, 35, 37 to complete manual (ca2b5020)
- docs: Fix screenshot numbering (35→36, 36→37, 37→38) (c2ead430)
- docs: Add 38 user manual screenshots for FibreFlow guide (a79d1e43)

### 🔧 Chores
- chore: Commit production changes (field stock fix + accessibility + docs) (bf7bc09b)
- chore: Commit agent-applied fixes (accessibility, theme compliance, screenshots, docs) (5666829e)
- chore: Remove temp/backup files (49412b9f)
- chore: Commit remaining agent changes (procurement services + screenshot 35) (75bbfa3e)
- chore: Remove 16 .backup files left by agents (5a328b5b)
- chore: Remove 21 test scripts from project root (1a50fbb3)

### 📦 Other Changes
- fix(qfield-import): improve layer detection heuristics + defensive UI guards (6c80279c)
- fix(qfield-import): fix field mappings for MAM-style GPKG columns (aed8e544)
- fix(qfield-import): guard against NaN integer cast from comma-separated pon_no/zone_no (c7164f23)
- fix(qfield-import): filter null keys and deduplicate before UNNEST upsert (72b439ce)
- fix(gpkg-import): handle Mohadin field variations — varchar truncation, zone_no fallbacks, null filtering (22019f12)
- fix(gpkg-import): increase maxBuffer to 200MB and timeout to 5min for large projects (b9760aef)
- fix(gpkg-import): add pole_type to merge ON CONFLICT update (8805e81b)
- fix(gpkg-reader): exclude HomeConnections from joints classification (bdedcbe2)
- feat(documents): add Client PO upload to Documents tab (0c1852ca)
- refactor(monitoring): restructure health endpoints to /api/health (3be13982)
- fix(projects): convert Documents and Income tabs from dynamic to static imports (dfe50e8f)
- fix(projects): convert all next/dynamic imports to static imports (935be8d1)
- fix(projects): use useEffect dynamic import instead of next/dynamic (1f5cf7bb)
- fix(projects): use mounted state guard instead of dynamic import (7de47947)
- fix(projects): break neon import chain in client components (1b7f559d)
- fix(dashboard): Update greeting to Title Case (4feebede)
- Fix Client PO Upload theme compliance - Replace hardcoded colors with design tokens (7e77f781)
- fix(auth): Update email placeholder to Title Case (25bef72f)
- feat(monitoring): Add /api/monitoring/health endpoint (ea87e357)
- Update SSH commands to use sshpass for automation (12f0825d)
- fix(dashboard): Apply Title Case to main Dashboard greeting (577f3124)
- fix(auth): Apply Title Case to "Forgot Password?" link (8b3916d8)
- Add screenshot 36: Mission Control Dashboard (55c0f26c)
- Add input sanitization to prevent stored XSS (Task #225) (3420e120)
- test: Add rate limiting verification script for Arcjet (c8722676)
- feat(finance): add spare drop tracking to Client PO system (88d12097)

---

## [2026-02-13]

### 📦 Other Changes
- docs(infra): add nginx upstream failover and backup auto-sync docs (b90b8e3d)
- fix(projects): show 'Not specified' for empty location JSON instead of raw string (f3da4ebe)
- fix(projects): fix GPS DMS parsing — handle negative signs and symbol stripping (4b49bd01)
- fix(projects): unify BOQ import and redirect dead SOW import page (5cbfa80d)
- feat(activate): enable search on dashboard (9dd791cc)
- fix(rbac): add maintenance + system.vlm-learning permissions (batch 2) (d4a11298)
- fix(activate): pass search term to dashboard stats and project table (b32c4c67)
- feat(mission-control): add Mission Control dashboard with agent status, live feed, task board (93d473be)
- fix(mission-control): move API route to root pages/ dir (5562db59)
- feat(qfield): add GeoPackage import pipeline for infrastructure data (eb558334)
- fix(pipeline): improve approval drawer UX — docs first, actions collapsed (b360723a)
- fix(qfield): fix GPKG import — correct MinIO bucket + remove SSH (9f4ca02c)

---

## [2026-02-12]

### ✨ Features
- feat: chatbot overhaul - pgvector RAG, dynamic SQL queries, response fix (8a7440fe)

### 📝 Documentation
- docs: update KB, module docs, session state, and project documentation (d7317dbd)

### 🔧 Chores
- chore: update session state and metrics (8f065c0c)

### 📦 Other Changes
- feat(qfield-qa): redesign QA dashboard with Activate-style hierarchy navigation (9c3cb4a6)
- feat(pipeline): add hard delete for pipeline projects with cascade (d893cc7e)
- fix(qfield-qa): use drops table for zone/PON hierarchy data (813541b7)
- feat(qfield-qa): add feature-level drill-down in hierarchy tree (d877de7e)
- fix(fleet): add retry logic for portal plate scan network failures (791144fb)
- fix(help-center): use absolute paths for manual screenshots (d1629c8b)
- feat(contractors): add agreement generation modal with date config (ecf961dd)
- fix(storage): add DOC/DOCX to allowed upload types for Pipeline (c14845d6)
- feat(activate): add ONT swap tracking via WhatsApp pre-provision groups (19aff621)
- feat(activate): add ONT swap marker in DR Review summary (eb55a7d3)
- fix(wa): remove withAuth from bridge inbound endpoint, use bridge secret (36fbbdd5)
- fix(rbac): add 5 missing permission entries found by audit (54c2be57)
- fix(activate): require 95% VLM confidence before showing serial mismatch in ACK (4f86412d)
- fix(activate): prompt tech to double-check serial when VLM photo is unclear (ff20f11a)
- fix(activate): always prompt double-check when VLM can't confirm serial (9ac5abe6)
- perf(boq): optimize import to avoid Cloudflare timeout (b149146b)
- feat(boq): add prefix code matching for stock items with variant suffixes (6d262328)
- feat(boq): add stock rematch API endpoint (a845991a)
- fix(boq): align fiber domain matcher prefixes with actual stock item codes (cf046cee)
- fix(boq): improve domain matcher for manholes, diameter tolerance, tangent parsing (b8eb1bf0)
- fix(boq): fix splitter model parsing and diameter tiebreaker (b788b296)

---

## [2026-02-11]

### 🔧 Chores
- chore: add module context docs and remove junk files (62d79011)

### 📦 Other Changes
- fix(sync): preserve QContact timestamps for SLA tracking (0cabeb1f)
- feat(sync): enable bidirectional QContact sync with status precedence (35da23cb)
- fix(sync): add RESOLVED status to enum and fix outbound QContact mapping (07ef775f)
- fix(sync): wrap PATCH body in {fields:{}} and use correct QC status values (e477de8c)
- fix(sync): skip terminal status tickets in outbound sync (2066bda0)
- feat(sync): real-time outbound QContact sync on every ticket change (3422b2f0)
- refactor(nav): rename Maintenance menu to NOC (8258a2cb)
- fix(chat): harden chatbot API with rate limiting and input validation (3faf6a6d)
- fix(logger): resolve apiLogger import warning in builds (1a7040b5)
- fix(build): hide nodemailer require from webpack static analysis (616e6118)
- fix(pipeline): align stat cards with EnhancedStatCard and fix dark mode contrast (63ed3bfa)
- fix(pipeline): remove max-w-7xl constraint to match other pages (14812a15)
- fix(sync): fallback to c__update field when QContact note creation returns 403 (ebae153f)
- fix(sync): use description field for QContact note fallback (f6e8f603)
- feat(pipeline): add file upload for legal documents (Lease/Cession) (c0f833d2)
- fix(pipeline): fix search-for-linking NOT IN query for Neon driver (464c611e)
- feat(pipeline): add file upload to document managers (b60a7a27)

---

## [2026-02-10]

### ✨ Features
- feat: Help Center & AI Chat Assistant (Phase 1 & 2) (becbd939)
- feat: Chat Assistant data lookups (Phase 3) with RBAC integration (00d09c43)

### 📝 Documentation
- docs: update contractors onboarding and staff module documentation (40e65c48)

### 🔧 Chores
- chore: add database pool migration scripts and update session metrics (2a5c4233)

### 📦 Other Changes
- refactor(pp-data): rename statuses to found/not-found/activated (3b71fb2a)
- feat(pp-data): switch 1Map lookup from bulk fetch to per-serial search (8a6a216c)
- feat(pp-data): add live progress tracking for 1Map serial search (635ea14e)
- fix(pp-data): auto-start polling when running lookup detected on mount (aa877c60)
- fix(pp-data): detect stale running lookups after server restart (cfc4babf)
- fix(pp-data): fix stale detection killing active lookups prematurely (1cfd56bf)
- feat(onemap): auto re-auth on session expiry + proactive refresh (b0158fca)
- fix(onemap): add 30s fetch timeouts to prevent hanging requests (55c9ceac)
- fix(onemap): reduce re-auth interval to 100 requests, add 45s per-serial timeout (47ca108b)
- fix(pp-data): use consistent key names in final tracker write (8fecf2a5)
- feat(pp-data): add 9 additional local DB sources to serial resolution (41a47574)
- feat(pp-data): add maintenance ticket creation from PP Data records (96f4f78c)
- fix(pp-data): pass created_by to ticket creation (NOT NULL constraint) (0526f1e6)
- fix(pp-data): add pp_data to tickets_source_check constraint (f383179a)
- docs(qfield): add infrastructure troubleshooting and incident learnings (bd2653f2)
- docs(qfield): add CSRF trusted origins fix to KB and module docs (cb40277e)
- feat(meetings): enhance attendee display and auto-sync from Fireflies (8adca11c)
- fix(meetings): use speakers data from Fireflies and fix Communications portal attendees (7cb79b87)
- fix(meetings): dark theme alignment for meeting detail modal (9e69e14f)
- feat(activate): add duplicate serial detection and improve mismatch warnings in DR ack (cb8d64c3)
- fix(meetings): add divider borders between meeting cards (5fc93758)
- fix(meetings): match participants by name for non-admin users (45466373)

---

## [2026-02-09]

### 🐛 Fixes
- fix: rename Master Service Agreement to Master Build Agreement (58492a93)

### 📝 Documentation
- docs: update module docs, knowledge base, and deployment info (0a7515fc)
- docs: update deployment KB and fleet camera permission docs (fc01d342)

### 📦 Other Changes
- fix(mobile): add responsive breakpoints across 28 files for mobile readiness (d2aa1566)
- fix(mobile): make module tabs scrollable and stack header on mobile (31f7d39b)
- fix(fleet): handle object error responses in portal session hook (30dfa1fa)
- fix(mobile): make data-sync tabs and nav scrollable on mobile (fb5ca56f)
- fix(fleet): correct rbacKey mismatch blocking Check-Ins tab access (b6e4477c)
- fix(reporting): switch all reporting endpoints from Pool to neon() HTTP (acefd3fc)
- fix(reporting): use singleton @/lib/db instead of @neondatabase/serverless Pool (6c8dd06c)
- fix(qfield-qa): fix AI validation logging and badge visibility (4b9114ba)
- fix(reporting): use direct res.json() for serial-swaps and serial-mismatches APIs (3d160d25)
- fix(reporting): fix SerialSwapReports icon props and optional chaining (0a747e4b)
- feat(qfield): add real-time photo validation API for QField plugin (9bbc50df)
- fix(reporting): add missing optional chaining across reporting components (8777d762)
- feat(qfield): add photo validation plugin for real-time AI feedback (4b190015)
- feat(contractors): add company verification system for onboarding (b4e89f17)
- fix(verification): resolve module initialization error on onboarding page (6efd35b9)
- fix(verification): move loadData before useEffect to fix TDZ error (07336aa2)
- fix(verification): improve VerificationPanel UI/UX alignment (2767b880)
- fix(verification): use FF design system CSS variables for dark theme (7eb640de)
- fix(fleet): improve camera permission error handling in vehicle portal (cb68f1ec)
- docs(kb): consolidate reporting audit learnings into module knowledge base (d0d1cf5d)
- feat(staff): simplify creation to name/email/phone with auto-generated employee ID (7cb81471)
- fix(onboarding): convert stage cards to dark theme design system (2c17de42)
- fix(onboarding): convert page wrapper and progress components to dark theme (32a0add4)
- fix(staff): use full page width for staff detail to match app layout (38046ba7)
- fix(contractors): use full page width and dark theme for detail/edit pages (b7c3b9ab)
- fix(ui): standardize back buttons across all modules with larger click target (a5a1ed81)
- feat(activate): add PP Data import and resolution for pre-provisioned ONTs (b1d5f703)
- fix(ui): convert modals and upload forms to FF dark theme (9c39f367)
- refactor(pp-data): auto-import PP DATA from OES import instead of separate upload (bae60e08)
- fix(onboarding): align stage documents with actual contractor workflow (6005cc44)
- feat(pp-data): add Excel export with project/status filters (203c6e53)
- fix(fleet): allow managers to view all check-in records (ccaa5e04)
- fix(onemap): add fallback credentials to createOneMapClient (37ed1985)
- fix(onemap): add CSRF token flow to OneMapClient.authenticate() (7e3b0940)
- fix(pp-data): increase 1Map page size to 500 and run lookup in background (0e306853)

---

## [2026-02-08]

### 📦 Other Changes
- fix(olt): increase 1Map timeout from 5s to 30s, reduce concurrency (b342dd9a)
- feat(qfield-qa): show pole numbers on photo cards (a4897538)
- fix(olt): detect duplicate UPS in cross-DR lookup for de-duplication (c2a13830)
- feat(qfield-qa): add photo-to-pole mapping script (b9272322)
- fix(olt): build photo entries from 1Map data instead of matching FF DB (485146ac)
- fix(olt): only flag status mismatch when NO prop_id has Installed status (101807aa)
- fix(olt): use source DR path in cross-DR photo URLs for proxy resolution (51ec0583)
- fix(qfield-qa): correct project filtering to use qfield_project_id lookup (3cf14237)
- feat(olt): add date filters for stats cards and fix history (308ca624)
- feat(olt): add clickable status filter on stats cards for history (d63c544a)
- feat(olt): add sub-status filter on Investigate tab (02d45669)
- fix(security): SQL injection, rate limiting, magic byte validation, and export bug (11b651bd)
- fix(olt): server-side investigate sub-filter with separate useEffect (118508ce)
- feat(olt): displaced ONT tracking and fixable tab warnings (7432d499)
- feat(olt): smart displaced badges + reporting section (4ed2178a)
- refactor(olt): reporting tab sub-tabs for Records/Imports/Displaced (62f3fec4)
- feat(olt): CSV export for all reporting sub-tabs (14b5bf03)
- feat(nav): enable FIELD OPERATIONS section with QField QA link (aa7de6d1)
- feat(nav): show only QField QA in FIELD OPERATIONS section (10d467fe)
- fix(olt): use pool.query instead of pool.connect for reporting APIs (035e0d91)
- refactor(db): consolidate 68 files to use singleton Pool from src/lib/db (11bdcf6c)
- fix(db): add missing singleton pool file and fix path alias ordering (adce791e)
- fix(olt): reporting tables column widths to prevent horizontal scroll (2666e678)
- feat(qfield-qa): implement VLM validation for Run AI button (1f32b779)
- fix(fleet): prevent VLM re-processing from overwriting user fuel corrections (622516a3)
- feat(qfield-qa): integrate HITL corrections with VLM learning system (bbdc454a)
- feat(qfield-qa): enhance bulk actions with loading states and confirmation (9fd82d71)
- fix(build): correct neon sql imports and remove unused lint directive (cd6bf25e)
- feat(qfield-qa): add bulk assignment UI with due dates and priorities (7c6d57a4)
- feat(qfield-qa): add WhatsApp notifications for rejections and escalations (ec0366fb)
- perf: optimize slow pages and fix broken endpoints (1ca6dd07)
- fix(qfield-qa): dark theme + improved revalidate flow for photo modal (84f0620e)
- debug: add verbose error to discrepancy endpoint (d21e6c47)
- debug: serialize non-Error object in discrepancy endpoint (3705f297)
- debug: extract non-enumerable error props in discrepancy (19d21cc2)
- fix(discrepancy): switch from Pool to neon() to fix socket hang up (ca1448bd)
- fix(qfield-qa): improve UI/UX for photo detail modal (4d1b20c8)
- fix(qfield-qa): use staff list for assignment dropdown (2d8a7dc6)
- fix(qfield-qa): add background batch processing for bulk AI validation (f635b59c)
- fix(qfield-qa): add detailed logging for validation debugging (be1452ad)

---

## [2026-02-07]

### 🐛 Fixes
- fix: handle unknown photo_source values in PhotoGalleryUnified (a1b8dcb7)
- fix: restore deploy commands with credentials in CLAUDE.md (70bdd013)

### 📝 Documentation
- docs: add QField photo resizer knowledge base (57f8fbc8)
- docs: update KB with technician stats documentation (e82d62c7)

### 🔧 Chores
- chore: update session tracking (ccfd2f38)

### 📦 Other Changes
- fix(fleet): use refs for mobile camera input reliability (75845afa)
- fix(fleet): improve receipt scan error logging for debugging (1fe55a7f)
- fix(fleet): increase body size limit for receipt photo scanning (cd7f0150)
- fix(fleet): always calculate price/L from amount/litres (5ac7fce2)
- feat(fleet): add admin delete for fuel transactions, fix L/100km calc (d4559f8b)
- feat(fleet): add delete button for fuel transactions (admin only) (add794b8)
- feat(fleet): recalculate L/100km after fuel transaction delete (ca3e4cac)
- feat(technicians): add WhatsApp push name import script (045860e1)
- feat(olt): automate mismatch detection from OES import data (7e63ccef)
- feat(technicians): differentiate installer vs activator stats (829a1631)
- fix(fleet): use odometer history as single source of truth for stats (cf39adac)
- fix(technicians): use oes_confirmed instead of is_activated (8945edb7)
- fix(olt): call auto-detect service directly instead of via HTTP (0160248f)
- fix(technicians): use correct step column names from schema (72ab3c8f)
- fix(technicians): correct step column names for installer performance (4b3d3c96)
- fix(navigation): correct active tab detection for nested routes (2ed488fd)
- feat(technicians): add dB signal quality metrics for installers (3a498461)
- feat(fleet): add fuel level sync when adding fuel transactions (50708e39)
- fix(olt): deduplicate onemap_properties JOIN and fix run tracking (e67ee2b4)
- feat(technicians): add flexible date range filters (4b9990ce)
- fix(olt): treat empty ONT barcode as cache miss, queue for API lookup (96068538)
- fix(olt): replace HTTP queue trigger with direct service call (8106fc05)
- feat(fleet): add tank level field to portal fuel fill-up form (d2986151)
- fix(olt): check ALL 1Map records per DR, handle ONT/UPS swaps (6fa6d501)
- feat(fleet): add fuel gauge photo scanning to portal (7172ee8a)
- fix(olt): correct multi-record classification logic (1d6ce053)
- fix(fleet): show 'Fuel' source badge for fuel_transaction entries (3c732141)
- feat(olt): add toast notification, progress counter, and skip-already-verified optimization (8dea3b4e)
- feat(olt): add visible progress banner and fix duplicate queue prevention (8dba90f2)
- fix(olt): status endpoint prioritizes active processing run over latest (37e0938a)
- fix(olt): improve status endpoint prioritization (9d6578ef)
- fix(olt): show live match/mismatch counts in progress banner (b2eb1e59)
- fix(olt): don't count cache misses as confirmed not-found (62e91e12)
- feat(olt): detect cross-DR conflicts and show investigation context (ec3b62b2)
- feat(olt): make investigation context cards collapsible (3f23040d)
- perf(olt): parallelize queue processor with 5 concurrent 1Map API calls (97cf7069)
- feat(olt): add internal API key bypass for queue processor trigger (5f46c1aa)
- fix(olt): reduce concurrency to 3, add error retry in queue processor (7f37e079)
- fix(security): comprehensive security hardening from code review (ef99259a)
- feat(olt): add cross-DR conflict swap feature (e89f04b2)
- feat(qfield): add AI photo validation with VLM integration (4de415ab)
- feat(olt): add DR Review links to cross-DR swap comparison card (25714585)
- feat(olt): add 1Map + DR Review links per DR in swap card (3bf338b0)
- feat(qfield): add QField QA photo validation dashboard (cab75814)
- fix(security): second round of security hardening from audit (fe39c0de)
- feat(olt): add UPS transfer UI + auto photo re-sync after swap fix (fe6445b0)
- fix(qfield): use sql.query for dynamic queries in qa-validations (dd121bd7)
- fix(olt): find correct record for UPS serial in cross-DR lookup (cd71049f)
- fix(security): tier 2 security hardening (b39ac433)
- fix(olt): update swap UI to reflect UPS transfer + sync DR B photos (62418626)
- refactor(qfield-qa): align UI with FibreFlow patterns (01088863)
- fix(olt): search ALL prop records for UPS serial, not just wrong-serial record (53e812a4)
- fix(olt): clear UPS from DR A after transferring to DR B (357039b6)
- fix(olt): restructure UPS transfer to always clear DR A even if DR B already has it (1d1c947b)
- fix(security): medium findings - sql-helpers allowlists, health info leak, upload validation (8c40f4f9)
- fix(security): remove hardcoded credentials from scripts and docs (bb13952e)
- fix(qfield): add MinIO authentication to photo-proxy API (d1b4eaff)
- fix(security): remove wildcard CORS, hardcoded DB cred, and SSRF risk (f926cec9)
- fix(security): critical SQL injection, wildcard CORS, credential cleanup (216c09bf)
- feat(olt): cross-DR swap, photo copy, status mismatch detection (333a238f)
- fix(olt): swap Recent Fixes above Import History on History tab (ab3234c7)
- feat(qfield): add photo import script for QField QA (a927e7e5)
- fix(security): add CSP header, magic byte validation, replace console.log with logger (2d6c206c)

---

## [2026-02-06]

### 📝 Documentation
- docs: update fleet module KB with check-in improvements (3b341fc3)

### 📦 Other Changes
- feat(fleet): add admin delete for check-in records (1b77698e)
- fix(fleet): admin role check and access control (7ee06dec)
- fix(fleet): persist fuel level from check-in to database (214b38af)
- feat(fleet): display fuel level in check-in history (7f9172ea)
- fix(fleet): add credentials to portal fuel fill-up fetch calls (5da3a8ff)
- fix(fleet): use flat category for fuel receipt uploads (b186410a)
- feat(fleet): add odometer photo capture with VLM extraction to Fuel Fill-up (8af31926)
- feat(fleet): add offline support Phase 1 - Service Worker & IndexedDB (971e8ab9)
- feat(fleet): add offline data capture Phase 2 - GPS & offline submission (bfd37684)
- feat(fleet): add offline sync engine Phase 3 - automatic data synchronization (d092101d)

---

## [2026-02-05]

### 🐛 Fixes
- fix: correct FiberTimeQContactClient import casing (de0f7ed6)
- fix: remove dynamic import for ProjectDetail to fix loading issue (dceb44ef)
- fix: use dynamic imports for Neon to prevent client bundling (125c9a84)
- fix: make projectCrud client-only to prevent Neon bundling (237b8b8d)
- fix: use direct import for FinanceDashboardTab to avoid Neon bundling (1fc9c72a)
- fix: align zone/PON counts with project totals in activate stats (5caeaa7d)
- fix: show all contractors and default new ones to active (06391c18)

### 📝 Documentation
- docs: add WA monitor troubleshooting and Docker health check patterns (3f4740aa)
- docs: add zone/PON stats alignment learning to memory and activate module (d54c6a1f)
- docs: add contractors module knowledge base and session learnings (4bdfdcf1)

### 📦 Other Changes
- fix(contractors): add cache revalidation, suspend/delete separation (cdd6b164)
- fix(contractors): add credentials to fetch calls for auth (142216e0)
- fix(contractors): force no-cache on contractors page (a0d0ef6e)
- fix(contractors): use flat update endpoint for edit form (455ba6cc)
- fix(contractors): add force-dynamic to detail and edit pages (ec4811f0)
- feat(activate): add wa_contacts table for technician name mapping (bd68db35)
- feat(activate): add installer sync from 1Map and installer leaderboard (dbd1f940)
- fix(fleet): resolve mobile photo capture issues (c5017444)
- fix(fleet): add debug toasts and simplify photo capture flow (95c49463)
- fix(fleet): remove debug toasts, keep GPS-free photo capture (f25adf1b)
- fix(fleet): mark check-ins with low VLM confidence as needing review (fe2c95f8)
- fix(technicians): use user_name for stats join and handle API response wrapper (3582219d)
- fix(technicians): update performance API to use wa_contacts table (1fba096d)
- refactor(technicians): match DrSummaryPage UI style (a4ad5638)
- feat(technicians): add edit modal to technician directory (95a76fb3)
- refactor(fleet): merge check-in audit into history page (f5407cd4)

---

## [2026-02-04]

### 🐛 Fixes
- fix: improve error logging in quote-evaluations (903dce50)
- fix: normalize storage URLs to include /storage/ proxy path (252d40f6)

### 📝 Documentation
- docs: update fleet module and infrastructure documentation (c37351e1)
- docs: add learning about demo data fallback anti-pattern (1ef55219)

### 📦 Other Changes
- feat(fleet): add withFleetAuth for portal session support (8690160d)
- fix(fleet): update vehicles API to use withFleetAuth (b5158359)
- fix(projects): URL tab aliases and date format in edit form (cd8c41f5)
- fix(fleet): complete portal auth for all check-in APIs (27c268e8)
- fix(wayleaves): correct pipeline navigation URLs (2d9d7333)
- feat(fleet): add GPS coordinate capture when taking check-in photos (b377e1fb)
- docs(kb): update learnings from E2E audit (19db4c81)
- fix(fleet): ensure odometer history persistence and HITL correction tracking (954bb3a7)
- feat(fleet): add check-in history to nav and photos to audit page (0278899e)
- fix(fleet): add error logging for photo upload failures (a3ca90e0)
- fix(fleet): add dataUrl to File fallback for photo uploads (0a740868)
- feat(vlm): enterprise-wide VLM learning system with HITL corrections (51a0d17d)
- feat(vlm): add VLM Learning to system navigation (1a509b23)
- chore(nav): hide xyOps, Grafana, Downloads, Imports from system menu (fde18d12)
- feat(fleet): add Photos tab and enhance vehicle photo display (1db82906)
- fix(fleet): fix photo upload to VF Storage with proper form-data handling (11a86e60)
- fix(fleet): use axios for photo upload to fix form-data compatibility (8d90d70c)
- fix(fleet): correct photo URLs to use /storage/ prefix for nginx proxy (eadf08f7)
- feat(ux): add skeleton loaders for project detail page (102cd7a5)
- fix(fleet): add license disc data to all vehicle list query branches (f74b5c1d)
- fix(portfolio): handle missing hs_incidents/hs_audits tables gracefully (53b4e7eb)
- fix(procurement): replace react-router-dom with next/router in QuoteEvaluationPage (44f81a4f)
- fix(portfolio): use correct H&S table names (hs_ticket_details, hs_project_audits) (3d522037)
- fix(procurement): replace conditional SQL fragments in quote-evaluations API (268b4193)
- fix(procurement): fix UUID comparison in quote-evaluations API (1d9b9a25)
- fix(staff): remove silent fallback to demo data on API failure (c19f968d)
- fix(procurement): use correct column name total_amount in quote-evaluations (f001bb28)
- docs(fleet): update KB with vehicles API query branches and license disc fix (6cbe2993)
- temp: add test-db API for debugging (cfed1d74)
- temp: test quote-evaluations query (0a0a3d5a)
- temp: check quotes table columns (4e76dbf0)
- fix(procurement): use total_value column (production schema) (650b6ff9)
- temp: check rfqs columns (216d54e7)
- fix(procurement): use correct column response_deadline in quote-evaluations (03a72052)
- fix(procurement): prevent division by zero in QuoteEvaluationPage (573043a0)
- temp: simplify QuoteEvaluationPage for debugging (1e8c52f2)
- feat(procurement): integrate VLM learning with PO extraction (1d2a7670)

---

## [2026-02-03]

### 📝 Documentation
- docs: add modal structure and Neon array patterns to KB (bb36a124)
- docs: update KB with dark theme semi-transparent color patterns (c4f408c0)

### 📦 Other Changes
- fix(tabs): use CSS grid for guaranteed full-width equal tabs (0c383143)
- fix(project-detail): remove max-width constraint for full-width layout (2fe27fac)
- fix(module-page): remove padding from tabs container for edge-to-edge tabs (6751ca89)
- feat(wayleaves): add multi-pipeline project linking (6e292a6a)
- fix(tabs): use Tailwind grid-cols classes instead of inline style for consistency (bdb4cc2b)
- feat(pipeline): add link to existing project from pipeline (4f3eb2ab)
- fix(tabs): add px-6 padding for consistent alignment with header and content (0a3c376d)
- fix(rbac): correct permission key format in navigation configs (e6e13c7f)
- fix(api): use company_name instead of name in clients join (245c1395)
- test: remove tabs padding for edge-to-edge testing (8d142f35)
- fix(tabs): add consistent px-6 padding to ModulePage tabs and ProjectTabs (0da3f17a)
- fix(api): use staff ID for linked_by in pipeline-links (b0ed23e0)
- fix(project-detail): add px-6 padding to outer wrapper for consistent alignment (910194de)
- fix(tabs): revert to flex layout for single-row tab display (0c753b63)
- fix(layout): hide AppLayout header on project detail pages (9d82a01e)
- fix(pipeline): fix Link Pipeline modal errors (6e559e06)
- fix(ui): darken modal backdrops to prevent bleed-through (0c898223)
- fix(modals): increase backdrop opacity to 85% for better visual separation (6bc31739)
- fix(pipeline): remove double padding from PipelineDashboard (6d2d4835)
- fix(modals): use fully opaque backdrop to hide background content (6640bc10)
- fix(modals): use standard bg-black/50 backdrop like other app modals (6b0a0906)
- fix(security): add participant check to action-items extract endpoint (338de30d)
- fix(modals): use standard modal structure matching DocumentVerificationModal (dd07b8cf)
- fix(api): use ANY() instead of sql() for array handling in Neon (ddf4930b)
- fix(contractors): apply dark theme styling to detail page (8e3957e8)
- docs(kb): add deployment directory gotcha and meetings access control patterns (fa60417f)
- feat(sow): add download template button to SOW upload cards (7122213a)
- feat(sow): add PlanNet/Fibertime column alias support for drops import (33035866)
- fix(sow): handle trailing whitespace in Excel column names (d6221ae3)
- fix(portal): prevent client-side neon() bundling in fleet portal (b6be8d43)
- docs(kb): add barrel export server code bundling gotcha (2bb70b04)
- fix(sow): use individual inserts for drops batch upload (9007a02a)
- fix(sow): use ALTER TABLE to add missing columns for drops import (e25dd516)
- fix(portal): exclude fleet portal from RBAC auth redirects (09b21066)
- perf(sow): use UNNEST for bulk drops insert (1000x faster) (7f30aedd)
- fix(portal): remove upload from gallery option for plate capture (15315a02)
- fix(sow): only clear existing drops on first chunk (b2f0ae04)
- fix(sow): optimize poles API with UNNEST bulk insert and chunked uploads (f9c34452)
- fix(sow): add missing column migrations for poles table (f5685853)
- fix(sow): parse height/diameter as numeric for poles table (3e881e6b)
- fix(sow): deduplicate poles before insert to handle multi-DR files (8c4c67de)

---

## [2026-02-02]

### 📝 Documentation
- docs: add lint cleanup learnings and React hooks patterns (a9732647)
- docs: update knowledge base with conditional SQL anti-pattern and /access skill (8fa27004)
- docs: update fleet module, learnings, and storage architecture (d6e4b9b1)

### 📦 Other Changes
- fix(data-sync): auto-complete stale QField sync operations (0ff43de4)
- fix(clients): add missing AppLayout to detail and edit pages (559170e7)
- fix(clients): dark mode styling for client form (719e1a76)
- fix(clients): fix projects API query column names (491c07ce)
- fix(clients): use correct progress column name (65f9a5fa)
- fix(clients): cast project_manager to text to avoid UUID coalesce error (9d3fb7b2)
- fix(clients): remove non-existent outstanding_balance column query (943a2cd7)
- fix(clients): fix formatCurrency import path (9c7d7609)
- fix(clients): multiple UI and API fixes for client module (837f6eae)
- fix(clients): remove non-existent priority column from summary query (99e04102)
- fix(clients): use API endpoint for client summary instead of local calculation (92f6ca4e)
- feat(meetings): add participant-based access control (a7952583)
- feat(meetings): add super_admin override for access control (7600448d)
- feat(communications): merge meetings module into communications portal (0d6e897c)
- feat(projects): add Client PO activation requirements and finance module (e57a6c4d)
- feat(access-control): improve search and filter UX (d9c366ae)
- fix(finance): correctly access API response data in dashboard (b1d207a9)
- fix(projects): case-insensitive status check for activation blockers (e4525346)
- fix(access-control): increase search debounce to 500ms (807ceded)
- fix(activation): case-insensitive status check in ActivationBlockersCard (45acccaf)
- fix(income): correctly access API response data wrapper (6ad7a1e8)
- feat(activation): add seed requirements button and API (4e262163)
- fix(access-control): use client-side filtering for instant search (9802e1b0)
- feat(client-po): add PDF import via VLM and project documents (e4e9ad08)
- feat(project): add Documents tab for centralized file uploads (27a41cea)
- fix(documents): improve error message handling in upload (33fe80ab)
- fix(documents): use procurement storage path for project documents (86d74129)
- fix(documents): use flat folder structure for VF Storage (33d2224f)
- fix(documents): rewrite GET query to avoid conditional SQL fragments (c03953e8)
- fix(client-pos): avoid empty sql fragments in conditional query (c8008420)
- fix(client-po): add solid background to PDF drop zone (f4de091f)
- fix(client-po): use correct CSS variable --ff-bg-card (d73e430e)
- fix(client-po): correctly unwrap API response for PDF extraction (b30c8b2c)
- feat(system): add granular access control for System Data Sync module (794e8c23)
- feat(client-po): show VAT breakdown in create modal (3b66dd08)
- feat(staff): add granular per-tab access control (7a58dc0f)
- fix(documents-tab): correct CSS variable name for card background (18414071)
- fix(api): use company_name instead of name for clients table (754ea249)
- docs(kb): add access-control module documentation (590f1613)
- fix(data-sync): use RBAC permission check instead of legacy (5358f1e4)
- fix(api): use project_name instead of name for projects table (a2b92116)
- fix(data-sync): show loading spinner instead of all groups while checking permissions (4d073074)
- feat(finance): show actual OES activations in income dashboard (33227e9f)
- feat(data-sync): add tab-level permission filtering to OLT Report (62922331)
- fix(sow): query main tables instead of sow_* tables (6723e9fc)
- fix(sow): rewrite /api/sow endpoint to return actual SOW data (2baaa4a1)
- feat(data-sync): add tab-level permission filtering to all groups (43149bb1)
- fix(client-pos): use live activation count from oes_activations (7ce7fbec)
- debug: add logging to client-pos API (4e21a624)
- debug: add _debug to response (1201f5c7)
- fix(sow): use correct column names in SOW API queries (07b68cc9)
- fix(documents): show summary counts instead of array lengths for SOW data (35203b33)
- feat(fleet): enhance license disc modal with full OCR verification (d53ee9b6)
- fix(fleet): use flat category path for license disc uploads (d8bbc0de)
- feat(overview): enhance project overview tab with KPI cards and workflow checklist (PRD-058) (5f3f5f6e)
- fix(fleet): show expiry date instead of issue date in license disc card (74188db6)
- fix(projects): fix requirements API and budget endpoint (592d15fd)
- refactor(fleet): reorder tabs - vehicles first, then drivers (03723d95)
- fix(sow): correct data source display and counts in SOW tab (ac325c09)
- fix(api): use correct photo column name in drivers-documents (d7acddd0)
- fix(storage): return HTTPS URLs for browser access (f616662a)
- fix(storage): ensure all storage services return HTTPS URLs (e6be7c6e)
- fix(fleet): default to active vehicles and show filtered count (dec9878c)
- fix(sow): dark mode UI + correct statistics calculations (5e203d05)
- fix(overview): show actual progress from activations data (e2ed274f)
- fix(sow): dark mode UI fixes for summary cards, statistics, and tabs (ab0f6d2b)
- feat(project-detail): add wayleaves tab and enhanced H&S integration (060bb950)
- fix(projects): improve portfolio dashboard calculations and UI (2b1554a8)
- fix(projects): improve progress display with '<1%' for low progress (078cdb79)
- fix(nav): make module tabs use full width with even distribution (47d4a4d8)
- fix(tabs): make project detail tabs use full width (10bfdd5e)
- docs(manual): update user manual v1.1 with new screenshots (33a55f81)
- fix(tabs): use CSS grid for guaranteed equal-width tab distribution (8498a857)
- fix(tabs): use flex-1 basis-0 for consistent equal-width tabs (255dc30a)

---

## [2026-02-01]

### ✨ Features
- feat: show project names instead of count in staff directory (20cab3d3)

### 🐛 Fixes
- fix: Format project location JSON as readable string on dashboard (2b9de638)
- fix: sync current_project_count when staff assignments change (f4fc1fb3)

### 📝 Documentation
- docs: add user manual generation learnings and KB (e29e1ca6)

### 📦 Other Changes
- feat(staff): add access control for sensitive data and sortable columns (f2df5cbe)
- fix(staff): add employeeId and currentProjectCount aliases to list queries (104039bc)
- feat(kpi-dashboard): Add enhanced KPI dashboard with real charts (ec5a4bdb)
- feat(staff): Add Performance tab with field technician metrics (e8c6ed5d)
- feat(activate): Add Technician Directory for field techs (00ecfa03)
- fix(kpi-dashboard): Remove placeholder stat cards (986eb5fe)
- fix(ui): Global UI/UX audit - Title Case headers, opacity badges, client detail fixes (7515fb28)

---

## [2026-01-31]

### 🐛 Fixes
- fix: remove auth-mock from all production code, fix procurement auth (9a25d462)

### 📝 Documentation
- docs: add performance optimization learnings and KB article (a9353048)
- docs: document WA group type business terminology (2f33be90)
- docs: update KB, learnings, and skills for bridge + maintenance fixes (be85a353)
- docs: add OLT mismatch report for week ending 30 Jan 2026 (e44d6a35)

### 📦 Other Changes
- feat(boq): enhance detail page with edit, Excel export, hide zeros, versions (45fc251a)
- feat(boq): add edit history tracking with user attribution (aa084ea7)
- fix(boq): resolve 7 dark mode contrast/visibility issues (34e08d6b)
- fix(boq): dark mode contrast for upload Config and Progress components (2f25f098)
- fix(projects): improve detail page layout and UX (b7a217d9)
- fix(boq): show progress spinner during enhanced import (ba983695)
- perf: parallelize API queries and fix next.config.js loading (7a775992)
- perf(h&s): parallelize 12 sequential DB queries into 2 batches (f2de1714)
- feat(procurement): 3-level stock item matching for BOQ imports (dc3b4c5a)
- fix(olt-report): unwrap apiResponse envelope for import result (b26a28fd)
- perf(system): parallelize 9 sequential DB queries in stats API (fca9bdaf)
- fix(build): add custom 500 page to fix server build failure (060ef551)
- fix(data-sync): correct column names in overview stats queries (a24653ac)
- fix(olt-report): redesign import tab UI with drag-and-drop (92aaff50)
- fix(olt-report): fix loop bug, add per-record errors, fix history (bdda51a4)
- feat(olt-report): log serial changes to serial_change_history (a5149866)
- fix(olt-report): update ALL 1Map prop_ids for a DR, not just best match (13748be6)
- feat(procurement): fiber domain matcher for BOQ auto-matching (74%) (5b3a76a5)
- fix(olt-report): update DR Review summary serial when fixing 1Map (5e5eddbe)
- fix(activate): prevent false resubmission detection in dr-acknowledgment (841531b5)
- docs(kb): update race condition KB with commit reference 841531b5 (70f8ece4)
- docs(learnings): add false resubmission detection fix entry (a0b757f6)
- feat(activate): pre-compute serial verification badges (6a153226)
- fix(olt-report): prevent React error #31 on API error responses (b5589166)
- fix(activate): convert process-new-dr INSERTs to UPSERTs (147 bridge 500s) (05aac8a8)
- fix(olt-report): batch bulk fix to avoid Cloudflare 524 timeout (8a675e96)
- fix(maintenance): replace withAuth with bridge secret for WA message endpoint (b58ee477)
- fix(activate): show full serial numbers in Serial History tab (7f643169)
- fix(vlm): prevent serial hallucination from prompt examples (98be2884)
- docs(manual): add comprehensive FibreFlow user manual (f0fbadc2)

---

## [2026-01-30]

### 📝 Documentation
- docs: add serial audit KB and update learnings/activate module (0ae42b15)
- docs: update learnings and procurement KB with RBAC and API details (2c1f3dbf)
- docs: add VLM bulk processing learnings and KB playbook (f597d44c)
- docs: add DR acknowledgment race condition learnings and KB (7e5d3fd7)
- docs: add deployment window straggler lesson (DR1735961) (39e71a60)
- docs: add typo DR filtering, self-healing, and reconciliation learnings (ff8df585)

### 📦 Other Changes
- fix(oes-import): prevent 524 timeout by making QField sync fire-and-forget (d7c10fe7)
- docs(learnings): add QFieldCloud Docker image self-healing fix (2d006fd9)
- feat(procurement): eliminate all mock data, wire real APIs and RBAC (2db4f38d)
- docs(learnings): add serial audit findings - 61 unresolved DRs (58bad987)
- fix(activate): resolve [object Object] error and null project on send-feedback (f0d00668)
- fix(activate): replace "Unknown" with dash for DRs without sender phone (80c84f6b)
- feat(procurement): add BOQ column detection and mapping for imports (85b57a8c)
- fix(activate): resolve sender_phone from wa_monitor_drops in pipeline (2ee62790)
- fix(activate): prevent false resubmission classification (d68b12d4)
- fix(navigation): remove Pipeline and H&S from sidebar — now tabs (6a97f8b0)
- fix(activate): fix date display and missing submitted_date in QA Centre (bb74ba64)
- fix(activate): add project and sender_phone to all process-new-dr paths (37e97952)
- fix(activate): prevent row duplication from LEFT JOINs in drops query (b3e9cdf3)
- fix(activate): prevent false resubmission when dr-acknowledgment creates record first (cf8beb04)
- fix(activate): exclude phantom dr-acknowledgment records from installed count (d11c27d8)
- Revert "fix(activate): exclude phantom dr-acknowledgment records from installed count" (531217b4)
- fix(activate): self-healing backfill for orphaned dr-acknowledgment records (7f1383d2)
- fix(boq): use explicit projectId prop instead of requiring context (70584913)
- revert(activate): remove backfillOrphanedRecords - caused incomplete data display (6ef2eb12)
- fix(boq): use log.info/error/warn instead of log() function calls (9d927321)
- fix(activate): self-healing fetch photos from BOSS for orphaned DRs (13c11713)
- fix(boq): pass projectId prop to BOQUpload in create page (17a8fdcf)
- fix(activate): exclude typo/invalid DRs from QA Centre list (d95ea2b7)
- fix(boq): use correct column names in boqImportEnhanced createBoq (8cc0440b)
- fix(boq): include required version column in createBoq INSERT (5116cb2d)
- fix(boq): align createBoqItem with actual boq_items schema (6103f419)
- fix(boq): auto-increment version to avoid unique constraint violation (de977e6a)
- fix(boq): resolve 6 UI/UX issues from E2E audit (6a57712d)

---

## [2026-01-29]

### 📝 Documentation
- docs: update learnings and staff module KB (aa9aa3ff)

### 🔧 Chores
- chore: accumulated updates across modules, docs, and infrastructure (c361925e)
- chore: disable all Vercel crons (no longer using Vercel) (3445dc5e)

### 📦 Other Changes
- fix(quote-scanner): simplify supplier matching - use substring match (21705770)
- fix(quote-scanner): correct column name stock_item_code → item_code (8504a535)
- fix(procurement): reorder tabs - Requisitions before Quotes, restore Approvals (d779cbdd)
- perf(vlm-queue): parallelize DR processing for 4-6x throughput (3a6ef4ea)
- feat(settings): add Procurement Settings tab with approval workflow management (9affb0d2)
- perf(vlm-queue): also process extraction-only DRs, prioritize them (58505a42)
- feat(rbac): batch permission editing and role template creation (054f6e7d)
- fix(middleware): handle Edge Runtime missing process.stdout/stderr (5046ef5b)
- fix(data-sync): use neon() directly for dynamic UNION query (1685b50f)
- debug: add detailed error logging to history API (f90c92ee)
- fix(data-sync): use neon sql.query() for dynamic SQL string (2cacc47c)
- fix(data-sync): clean up debug output from history API (cf2eefcc)
- fix(vlm-queue): stop infinite reprocessing of DRs without step 6/7/9 photos (0ec60a22)
- fix(staff): replace snake_case display with Title Case across all components (4841d115)
- fix(staff): apply formatLabel to staff directory page (pages/staff/index.tsx) (89578506)
- fix(staff): hide Next of Kin section and sync SA ID number fields (264dc4b4)
- Revert "chore: disable all Vercel crons (no longer using Vercel)" (57f61bcf)
- fix(staff): align department-position dropdowns and fix persistence (617562af)
- fix(staff): add DB department name aliases for position mapping (ec96c7e0)
- fix(staff): use is_active instead of deleted_at for department lookup (67385961)
- feat(activate): warn when DR submitted but not yet in 1Map (03d65a65)
- docs(kb): fix bridge API field name - recipient_jid not mention_jid (e4683277)
- fix(activate): capture ONT/UPS serials even when photos empty (73200839)
- feat(activate): serial swap detection in OES import + serial capture fixes (ffeaa199)

---

## [2026-01-28]

### 📝 Documentation
- docs: add API wrong export gotcha to learnings and KB (e47558c2)
- docs: update learnings and KB for OES sync changes (6d9288ce)
- docs: add compliance bug learning and staff-compliance KB (99bb57cb)
- docs: add WA bridge health check learning and KB update (b2d0fd6e)
- docs: add asset purchase price validation learning (99c8d6a6)
- docs: add auth UX learnings and toast notification patterns (bb4305cd)
- docs: add contract type persistence and dynamic labels to KB (a05b6727)
- docs: add QField OES coordinate source learning (bc09aeda)
- docs: add enhanced barcode service to learnings and KB (42ca743b)
- docs: add E2E project lifecycle user manual (6ee7b6ff)
- docs: add reporting patterns learnings and knowledge base (ca121664)
- docs: add VS Code OOM fix and Access Control UX learnings (0e9b329c)

### 📦 Other Changes
- fix(ocr): export handler instead of detectImageOrientation (4af1d20b)
- fix(qfield): change OES filename format to DD-MM-YYYY (042d01be)
- fix(compliance): add Employment Contract/IC Agreement to required documents check (ada54839)
- fix(qfield): use OES import report_date for filename (16b3ba95)
- docs(kb): add PO approval workflow documentation (ba1e381b)
- fix(auth): improve session timeout UX and login page footer (fe171f52)
- fix(staff): map legacy contract types for persistence (d8d0ded5)
- fix(staff): dynamic compliance labels based on Employee vs IC (b51e34d7)
- feat(oes-sync): add dual coordinates and point_type for QField filtering (ff74a338)
- fix(qfield): use drops table as source of truth for OES coordinates (64ac7c12)
- fix(assets): allow zero purchase price for donated assets (72a1a6ba)
- feat(assets): add VLM label scanning for asset extraction and verification (61f9697b)
- feat(qfield): add remaining drops layer to OES sync (cae1a75d)
- fix(ui): simplify main app footer to match login page style (fccf8e0f)
- feat(assets): add GRN → Asset registration workflow (Sprint 2) (c9eedbc0)
- feat(barcode): add enhanced barcode service with 2D support (ce34c8a6)
- feat(barcode): add Phase 2 advanced preprocessing strategies (694c6076)
- feat(assets): add Odoo asset sync with fleet ownership filter (46ca2523)
- fix(ui): make footer single line layout (5f3e657f)
- docs(learnings): document QField dual-layer OES sync system (e6a070a1)
- fix(assets): remove non-existent columns from GRN registration query (dfc352a1)
- fix(assets): remove supplier_id from GRN registration INSERT (9781e7b5)
- fix(assets): generate asset_number during GRN registration (98eca15f)
- feat(activate): add Activation Progress report (a6d9a4d6)
- feat(staff): add departments management feature (5fa49b1f)
- fix(migration): use sql.query() for dynamic SQL in migration 137 (18e71232)
- fix(activate): filter activation progress report to active projects only (089c3569)
- fix(activate): exclude zone/pon = 0 from activation progress report (dbad9d35)
- fix(departments): convert count strings to numbers for stats calculation (3ffb2991)
- fix(departments): use correct table name staff_projects (2ad24be0)
- feat(activate): add Hide Zero toggle for activation progress report (7562c3c6)
- fix(departments): handle null report state gracefully (478931bf)
- fix(activate): Hide Zero toggle now also hides zones/PONs with 0 activations (cd424479)
- fix(staff): load departments from database instead of hardcoded enum (46d1a4bb)
- fix(staff): set department_id FK when department name is updated (a9cf9d36)
- feat(settings): improve Access Control UX with better search and toggles (4cad3d16)
- fix(activate): support project name filtering in activation progress API (aa696ca3)
- fix(assets): add revalidatePath to update dashboard counts after mutations (b97d52ad)
- fix(activate): use full summary stats, not filtered totals (18103716)
- fix(activate): count ALL OES activations for progress, not just date range (fc8e57b0)
- fix(activate): update progress bar color thresholds (bdf7c9ec)
- fix(reports): fix timezone bugs in quick date filters (c424bb3e)
- feat(projects): complete Projects module restructure (522ffd63)
- feat(activate): add Maturity Tracking report (a4cbffc3)
- feat(activate): add avg days to 25%, 50%, 75% milestones in maturity report (c04ff20b)
- fix(reporting): exclude invalid DRs from daily counts and trend analysis (a8cae39f)
- fix(reporting): remove non-existent d.project_name column references (9e0ce79e)
- feat(procurement): add OCR Quote Scanner for RFQ workflow (ccf96920)
- fix(quote-scanner): prevent modal reset during extraction (c2095698)
- feat(quote-scanner): add Create Quote button to save extraction to RFQ (9d332564)
- fix(quote-scanner): auto-create quote after successful extraction (f8cad141)
- fix(rfq): fetch RFQs from API instead of hardcoded empty array (c309fe9c)
- fix(quotes): fix quote creation and display in RFQ (49c9cc5d)
- fix(quotes): add created_by field when creating supplier from quote scan (b6323a8a)
- feat(procurement): add clickable quote details in RFQ page (3859c774)
- feat(quote-scanner): add review step before creating quote (3740003d)
- fix(quote-scanner): add supplier selection and review step (68aec0b9)
- fix(quote-scanner): add null safety for result.extraction (7bcce294)
- fix(quote-scanner): access nested data from API response wrapper (5d857471)
- fix(quote-scanner): fix supplier matching from API response (686f4c31)

---

## [2026-01-27]

### 📝 Documentation
- docs: add Next.js route resolution gotcha to KB and learnings (ab234ac5)
- docs: update KB for OES format change and nginx timeout (c48ac58a)
- docs: add UI audit learnings and KB patterns (7237dcd1)
- docs: add router-agnostic pattern and stat card standards to KB (3d7638cd)
- docs: add QFieldCloud infrastructure to learnings and KB (7d5824b6)
- docs: add Velocity Fibre brand guide to learnings and KB (ea6b2ca4)
- docs: add WhatsApp mentions architecture to learnings and KB (666540bd)
- docs: add learning for WhatsApp bridge case-sensitivity bug (155de8e2)
- docs: add WhatsApp bridge direct API documentation (d137d2f5)
- docs: add GeoJSON coordinate type learning and update QField KB (9202c0ad)
- docs: add dynamic route catching lesson to learnings, skill, and KB (ffe4770a)

### 🔧 Chores
- chore: add version marker for deployment debugging (b101ccde)

### 📦 Other Changes
- fix(qa-history): use actual step columns instead of non-existent photos_categorized (6885d6fb)
- fix(oes-import): update column mapping for Jan 2027 format (701969e2)
- fix(oes-import): add 120s timeout for large imports (bdd7124b)
- fix(qa-history): remove duplicate directory causing old code to be used (ca90e61e)
- fix(projects): fix SQL query errors in projects API (7833fee4)
- debug: add explicit error logging to projects API (2047fac1)
- fix(projects): remove non-existent columns city/province/completed_drops (115d4ea3)
- fix(projects): remove total_drops column, use location not city/province (d9470471)
- fix(projects): display manager name instead of UUID in project detail (ece34457)
- fix(projects): add projectManagerName to service transform (ed664ae9)
- fix(projects): add manager name JOIN to single project query (bdb37bf7)
- fix(maintenance): correct QContact status mapping for bidirectional sync (7cd2e3fc)
- fix(projects): fix GRN query in procurement-summary API (f103886a)
- fix(projects): support tab query param and fix timeline dark mode (38638590)
- fix(health-safety): break circular redirect loop for incidents (3b6c687a)
- fix(health-safety): safer array check for incidents data (a15b76c3)
- fix(boq): prevent 404 on Edit button click (088d7846)
- fix(maintenance): fix query result access in sync job (b113bbe2)
- fix(projects): align dashboard with other modules + fix API bugs (127e1fc8)
- fix(maintenance): remove unsupported not_equals filter from QContact API (63532755)
- fix(projects): resolve manager name query - use correct column names (dd12052c)
- fix(projects): remove redundant list header + fix status case matching (12ed7fc8)
- fix(projects): parse JSON location + case-insensitive status badges (1176c8b3)
- fix(clients): add icon badge to header matching other modules (d0425ea9)
- feat(projects): redesign dashboard stat cards to match main dashboard (3bda4517)
- fix(activate): pass all filters to export and use unique filenames (ded19335)
- refactor(dashboards): unify all module stat cards to EnhancedStatCard (01640e9b)
- fix(maintenance): revert EnhancedStatCard - incompatible with App Router (99481c2d)
- fix(stat-cards): make EnhancedStatCard router-agnostic for App Router (98f82be1)
- feat(activate): add record count to export filename and headers (46ed752d)
- fix(maintenance): align QContact categories with FibreFlow ticket types (b7817111)
- fix(maintenance): remove WIP limits from kanban board (c62a4c20)
- fix(activate): align export filters with display API (drops.ts) (5f3da63c)
- fix(activate): make QA Centre export button dynamic like Dashboard (88d6d437)
- fix(maintenance): map QContact 'Pending Company Response' to in_progress (0404af14)
- feat(qfield): dynamic QField project management via DB (4a2ee1e2)
- docs(manual): add maintenance user manual with screenshots and PDF (3ab0c0d4)
- fix(manual): embed images in PDF using --basedir flag (fb349d07)
- feat(qfield): support multi-project OES sync (de4f4703)
- fix(qfield): connect to correct QFieldCloud DB on Velocity server (d22fee08)
- feat(manual): enhance maintenance manual with Velocity Fibre branding (4f71eb9a)
- fix(whatsapp): display user name instead of raw JID in @mentions (546f3c77)
- fix(manual): use @import for Google Fonts instead of stylesheet frontmatter (97432d67)
- feat(activate): add photo count verification to sync flow (918a6baa)
- feat(contracts): add branded Cession of Wayleave Agreement template (29025651)
- fix(qfield): update API token for QFieldCloud authentication (81174ba7)
- docs(kb): add QFieldCloud API authentication and file upload info (c9aa0082)
- feat(contracts): add fillable PDF version with embedded Velocity logo (3a32426d)
- feat(contracts): pre-fill Velocity Fibre company details in cession template (72d3fe12)
- fix(qfield): add trailing slash to file upload URLs (6ba093d0)
- feat(contracts): pre-fill VF details in cession agreement, remove template labels (b0364f11)
- feat(contracts): add fillable PDF with 35 form fields (5898372e)
- feat(qfield): rename OES upload to "OES FF YYMMDD.geojson" (5b35d2ef)
- fix(contracts): replace pdf form fields with clean fill-in underlines (029d2455)
- fix(qfield): regenerate API token (previous expired) (0559507d)
- fix(qfield): convert GeoJSON coordinates to numbers (965e918a)
- chore(qfield): update to long-lived API token (1 year) (f917cb16)
- fix(procurement): use inline tab content instead of navigation (40667b59)
- refactor(procurement): implement two-level tab navigation (d0b8053f)
- fix(procurement): navigate directly to dedicated pages from sub-tabs (a3418f06)
- fix(procurement): correct Sourcing sub-tab navigation paths (7cd6c3e4)
- feat(procurement): add main category tabs to Sourcing page (24230ec6)
- fix(procurement): add categoriesOnly prop to hide duplicate sub-tabs (e1358937)
- fix(procurement): add path to Dashboard tab for navigation from sub-pages (79832a60)
- feat(procurement): add top-level category tabs to all sub-pages (54e8e10b)
- feat(procurement): add top-level category tabs to purchasing page (ce2e43e9)
- feat(procurement): add comprehensive reports page (2bf19ed8)
- fix(procurement): standardize tab positioning across all sub-pages (64c66bf1)
- feat(assets): add Financial, Warranty & Documents sections to detail page (883602d7)
- feat(ui): make table rows clickable across all list pages (a0ea46fe)
- fix(assets): use correct VF Storage path for document uploads (0b6addfa)
- fix(assets): rename File import to avoid shadowing browser File constructor (f61484bf)
- feat(assets): enable document viewing via proxy URL (0fccb6de)
- feat(assets): add document deletion (162e2348)
- fix(staff): handle FK constraints on staff deletion (41c8100a)
- feat(assets): add separate view and download buttons for documents (ca70e5c9)
- feat(assets): add delete asset button with double confirmation (b03488d9)
- fix(routing): add missing project pages and human-resources redirect (fb51b13c)
- feat(procurement): implement PO approval workflow with versioning (63439fe0)

---

## [2026-01-26]

### 🐛 Fixes
- fix: replace heroicons with lucide-react in Dashboard components (2ed609aa)
- fix: use correct safe-query pattern in portfolio-dashboard API (92e1db7e)
- fix: remove deleted_at filter and fix project_manager column (eadd0755)
- fix: use company_name instead of name for clients (dd514774)

### ♻️ Refactoring
- refactor: remove App Router projects page in favor of Pages Router (27488410)

### 📝 Documentation
- docs: update learnings and KB with Sprint 1 patterns (ac90eb4b)
- docs: update learnings and KB for OES format change (f0f27c26)
- docs: add unified architecture learning to knowledge base (928b2aee)
- docs: add knowledge-base with filter-aware exports pattern (abca62e9)
- docs: add Unified WhatsApp Bridge architecture to learnings and KB (21304bc6)
- docs: add WA Portal unification and DR Activity Timeline to KB (76df79fe)

### 📦 Other Changes
- feat(projects): implement Sprint 1 - Project Hub Foundation (b7217c26)
- fix(team-api): return structured response with members, stats, primaryManager (62f49b85)
- feat(navigation): implement tab-based navigation system (9eaa66b1)
- feat(maintenance): migrate to horizontal tab navigation (96ea3f84)
- docs(skills): add navigation skill for tab-based migration (d2f2c75d)
- feat(system): add unified Data Sync page (1a9000e2)
- feat(fleet): migrate Fleet module to horizontal tab navigation (19e7c863)
- fix(activate): fix VLM categorization storing empty results (964981f9)
- feat(navigation): migrate Assets, Procurement, Activate to tab-based nav (b8474793)
- feat(fleet): implement plate-based authentication for vehicle portal (51a0c6d0)
- feat(staff): migrate Staff module to horizontal tab navigation (caa31d6c)
- fix(qcontact): update existing ticket status instead of skipping during sync (8bd2d004)
- fix(staff): save all form fields to database, not just 15 (8549bb3a)
- feat(sidebar): make Human Resources a direct link to /staff (6653c3ca)
- feat(sidebar): convert 5 more sections to direct links (90bf774b)
- fix(oes-import): update parser for new Nokia OES format with Stack Ref column (79e97a07)
- fix(qcontact): add pagination to fetch ALL tickets, not just first 50 (c1c9401a)
- refactor(sidebar): simplify PROJECT MANAGEMENT section (e68527a6)
- feat(qa-centre): add subscriber contact info from 1Map and QContact (9d1d4dcd)
- feat(oes-import): add format validation to detect column misalignment (23bfb344)
- feat(imports): add format validation to ARCH and OLT Report imports (020eaf84)
- feat(activate): add sidebar navigation to activate pages (3c60d1f1)
- docs(learnings): add Excel import validation pattern (4c6ca3d5)
- fix(summary): use correct column name dr_number for maintenance_tickets (335d4be1)
- feat(olt-report): add missing stats, records, and imports API endpoints (4be4c8f0)
- feat(activate): convert to ModulePage tab-based navigation (f915923a)
- fix(olt-report): include not_found records in Pending/Fixable tab (ccba5e6c)
- feat(olt-report): add bulk select and fix functionality (68529a6b)
- feat(activate): unified architecture for contact info storage (3c39caf4)
- fix(activate): update DrListPage styling to match UI theme spec (2645549f)
- feat(activate): add explicit refresh endpoint, standardize BOSS API naming (22077f5e)
- fix(olt-report): move not_found records to Investigate tab (ee3e3a16)
- refactor(routes): move Health & Safety and Pipeline under /projects (4268067f)
- feat(olt-report): add Resolve and Escalate actions to Investigate tab (88827db5)
- docs(activate): document UNIFIED ARCHITECTURE pattern (b195e51f)
- docs(learnings): add CSS variables, ModulePage, and route restructuring patterns (e0968b12)
- fix(activate): remove duplicate header from QaCentrePage (c94f0e44)
- feat(olt-report): add records table and CSV export to Reporting tab (9969f3d2)
- fix(staff-api): handle empty strings for UUID and date fields (6d120c2a)
- fix(staff-api): fix RETURNING clause for emergency_contact JSONB (c00c01e9)
- docs(activate): add refresh endpoint to API tables (360e3725)
- fix(staff): fix emergency contact field mapping from API (d4c2b355)
- fix(staff): show only Emergency Contact on Overview page, not Next of Kin (97c34784)
- feat(olt-report): filter CSV export by selected status (30caa1f3)
- feat(activate): auto-sync photos from 1Map when QA opens (742e5e85)
- feat(exports): add filter-aware CSV exports across all modules (51dbdd1e)
- fix(settings): improve Access Control tab UI/UX with full-width layout (fb5a2766)
- fix(search): make list page search filters instant and consistent (dc1b185e)
- fix(nav): add Pipeline and Health & Safety back to sidebar (8a5e8401)
- fix(projects): add missing /api/projects endpoint (1c09653b)
- feat(projects): add Project Management Hub (PRD-058) (afabaf0f)
- feat(projects): add Agreements tab to project detail (PRD-058) (062bc486)
- feat(wa-portal): unify with wa_monitored_groups table (e0592f52)
- feat(agreements): implement SOW and MBA PDF generation (PRD-058) (ac85676c)
- feat(pipeline): add Kanban board view with drag-and-drop (PRD-058) (f3059c49)
- feat(expiry): implement unified document expiry tracking system (PRD-058) (4e2d02ea)
- fix(activate): show reviewer name in Activity Timeline and populate QA History (84c21c72)
- fix(activate): show reviewer name and QA details in Activity timeline (54fbdece)
- fix(activate): use first_name/last_name columns for user name lookup (51329d61)
- fix(activate): get user ID from req.user instead of x-user-id header (7c8c00e7)

---

## [2026-01-25]

### 🐛 Fixes
- fix: minor bug fixes for cost centers and VelocityInput (56b423bd)

### 📝 Documentation
- docs: add users table schema learning (first_name/last_name, not name) (4b7aba99)

### 📦 Other Changes
- fix(olt-report): proper duplicate handling during import (095981a8)
- fix(olt-report): resolve PostgreSQL type inference error in duplicate handling (76151be5)
- fix(olt-report): preserve original import_id for audit trail (25505e98)
- fix(olt-report): use first_name + last_name instead of non-existent name column (0a63380c)
- fix(olt-report): show actual error message in import detail modal (e42b2a6d)
- fix(olt-report): use correct column name 'actor' instead of 'created_by' (95fe05c9)
- feat(olt-report): add Reporting tab with time filters and CSV export (ba883fc0)
- fix(olt-report): improve CSV export error handling (316cda95)
- fix(auth): fix Chrome autofill putting email in password field (58340a1c)
- feat(activate): merge foto_ai_reviews into dr_photo_unified_reviews (270190ee)
- fix(auth): allow passwords containing @ symbol (c278c7a4)
- style(ui): redesign version notification to subtle toast (ef7286ac)
- feat(pipeline): add Service Authorities database and UI enhancements (60ce62ca)
- debug: add error tracing to authorities API (3466c370)
- fix(authorities): use sql template literals instead of query function (efc8c426)
- fix(pipeline): remove created_by/updated_by from authority API calls (983e52a9)
- fix(procurement): resolve supplier display and stock tab issues (e6979b12)
- fix(vlm-queue): improve error logging to capture actual error message (bb925315)
- fix(olt-report): use HTTP database connections instead of WebSocket (b6be87fe)
- fix(procurement): move Quick Actions to top of dashboard pages (b62421d0)
- fix(olt-report): use inline pg Pool instead of lib/db import (235e07bc)
- docs(kb): add VLM cron job troubleshooting to activate module (b658ef9f)
- feat(pipeline): add missing pages and fix Add button (40c1b21a)
- fix(pipeline): improve Project Details sidebar spacing (efaf9f83)
- docs(kb): add database connection pattern learning (6623b2ac)
- docs(procurement): add UI patterns and common issues to KB (b0be851c)
- fix(activate): use pg Pool for drops API (aed4e968)
- fix(api): replace @neondatabase/serverless with pg in 26 API files (cc6f4fc7)
- fix(fleet): handle unknown vehicle status in vehicles list (59175fdb)
- docs(kb): add config lookup fallback pattern learning (642a3f55)
- fix(procurement): add missing Requisitions and Goods Receipt tab content (3ae35903)
- fix(procurement): navigate directly to tab pages instead of showing intermediate cards (62c21d79)
- fix(vlm-queue): remove neonConfig reference after pg migration (6213ce0c)
- fix(procurement): navigate before updating tab state to prevent URL race (e6e7930e)
- fix(procurement): prevent localStorage from overriding URL tab param (17a7c2f1)
- fix(procurement): use direct tab URLs to fix client-side navigation (9d270354)
- feat(procurement): implement fully functional Stock Management dashboard (efc04551)
- fix(stock): query stock_items table instead of empty stock_positions (c40ef00e)
- fix(vlm-queue): exclude already-categorized DRs from processing queue (ce287d01)
- feat(odoo): add stock movements sync from Odoo (7c440759)
- feat(grn): add GRN confirm workflow with stock movements integration (780a4fa5)
- feat(olt-report): add investigation workflow with escalation and resolution (df40c2ed)
- fix(olt-report): use first_name/last_name instead of non-existent name column (732360ff)
- docs(kb): add stock movements architecture and GRN workflow (d12e76c6)
- fix(olt-report): make activity logging non-blocking for resolve/escalate (62933e39)
- fix(olt-report): use correct 1Map URL path /apps/app (a009543c)
- fix(olt-report): add workspace param to 1Map links (8a76762e)

---

## [2026-01-24]

### 📝 Documentation
- docs: add manual DR acknowledgment procedure to KB (12b86e16)
- docs: update CLAUDE.md and QField sync documentation (91bd31ad)
- docs: add ONT serial mismatch analysis and correction log (3058f62f)
- docs: update corrections log with correct layer name (20c29658)

### 🔧 Chores
- chore: update session state for reports completion (0a4773ca)

### 📦 Other Changes
- feat(pipeline): add standalone Smartsheet document sync script (eee9f1e4)
- feat(pipeline): enhance document sync toast with detailed stats (7f663cb2)
- feat(rbac): add auth middleware to all 65 procurement API routes (a1376fac)
- feat(odoo): add inventory sync services for suppliers, products, receipts, transfers, and stock levels (7ab0b684)
- feat(rbac): add auth middleware to all 56 fleet API routes (c8687bd6)
- feat(rbac): add auth middleware to all 22 pipeline API routes (828d2559)
- feat(rbac): add withAuth middleware to 131 API routes (c22ebaec)
- feat(rbac): add withAuth middleware to remaining 157 API routes (1490d697)
- feat(rbac): add role-based access control to sensitive routes (1cd7571a)
- feat(activate): add Installation Gaps report for tracking installed-but-not-activated DRs (181261d9)
- feat(auth): add password reset flow (5636efd6)
- fix(activate): remove duplicate age filters from Installation Gaps report (53712a64)
- fix(health-check): adjust WhatsApp Bridge thresholds for overnight gaps (86283553)
- feat(odoo): add invoice sync and procurement reporting (36979ea7)
- feat(auth): add password reset pages with premium UI (d7090806)
- feat(activate): add 'All' date filter and update Installation Gaps UI (09fb160a)
- feat(auth): add automatic redirect to sign-in on 401 errors (df913ec7)
- feat(odoo): add comprehensive Odoo sync scripts (6519abef)
- fix(auth): make WA Bridge endpoints public (f7af2d34)
- fix(auth): install fetch interceptor at module load time (792102cb)
- feat(fleet): add fleet documents sync from Odoo (22f94ed7)
- fix(auth): disable TLS cert validation for expired SMTP cert (186bb060)
- fix(auth): use correct column name 'password' instead of 'password_hash' (37f2e9a1)
- refactor(reports): use shared ReportCard in SerialMismatchReports (686991a0)
- fix(auth): use AuthContext for login to fix sidebar race condition (65b1af1e)
- fix(auth): add name/id attributes for proper browser autofill (c1e21e33)
- fix(reports): use same date for WA and OES in discrepancy report (f8a9d907)
- feat(rbac): add custom roles system with create/delete/clone (82ec64dd)
- feat(rbac): add role management UI with create/clone/delete modals (920a6ff4)
- feat(system): add self-healing infrastructure module (2648a798)
- feat(system): add self-healing API endpoints and UI (8a76af46)
- feat(system): add self-healing infrastructure module (9f46b9a1)
- feat(activate): add WA photos display in QA Centre (fbfd9209)
- fix(activate): match WA photos API response to WAPhotosGallery interface (9811fe8b)
- fix(system): use dynamic db imports for production bundling (c7a59f6a)
- fix(activate): proxy WA photos from VPS instead of Velocity (75c9eca8)
- fix(activate): use regular img for WA photo thumbnails (e725e693)
- fix(system): normalize db query results for self-healing services (abb5c492)
- feat(nav): add System Health Hub to sidebar menu (917a968a)
- feat(system): integrate QFieldDashboard into System Health Hub (1c2fb448)
- fix(api): correct export in qfield API endpoint (a4afe79a)
- refactor(system): consolidate QField into System Health Hub (4fcf11a6)
- feat(activate): add serial change audit trail (3a9e0d40)
- feat(activate): add Serial History tab to Activity section (e89bc137)
- feat(activate): add 4-way serial comparison with WA photo VLM (6ef1ee97)
- feat(activate): add serial verification badge on DR Summary page (3e2feca0)
- feat(system): integrate dashboard with Python AI Recovery Agent (84c65d70)
- fix(activate): update WA photo VLM processing to use correct photo URL (6aee1f3a)
- fix(activate): correct WA photo proxy to use VPS photo viewer (5b6c712e)
- fix(activate): update wa-photo proxy to use VPS photo viewer (b9866d7e)
- fix(system): add services array to self-healing API and null safety (3e9e289f)
- fix(photo-proxy): route 1Map photos to Velocity, WA photos to VPS (bfaf2fe3)
- fix(serial-verification): remove non-existent ups_serial from oes_activations query (a9f8f1a7)
- feat(activate): add serial status audit script (dab4faeb)
- feat(system): add OLT Report import and 1Map fix system (ab7eb29d)
- fix(olt-report): store wrong 1Map serial from Excel for comparison (35ad2825)
- fix(migration-124): use pg client and drop/recreate view (3ac4e053)
- fix(olt-report): use dr_activity_log instead of dr_timeline_events (e0593fc0)
- feat(olt-report): add olt_mismatch_records table for complete tracking (c8082d43)
- fix(olt-report): show full serial numbers in UI (b04959dd)
- fix(olt-report): correct terminology - ONT serial not OLT serial (2055b9a9)
- fix(olt-report): consistent ONT terminology throughout UI (b45bebbf)
- feat(olt-report): add import detail modal with full audit trail (5c09d869)
- feat(olt-report): add investigate tab for records missing 1Map serial (917f4bce)
- fix(1map): add 8-second timeout to prevent gateway timeout (b896b569)
- fix(olt-report): show Fix button for pending mismatch records (a3e6cd74)
- fix(olt-report): correct fixable logic - only ONT serial (column B) required (7fb5bfab)
- fix(olt-report): don't update 1Map if already correct, log verification (25917a5d)
- fix(olt-report): reduce timeout and extend API duration for 1Map calls (8ede76f3)
- feat(olt-report): add bulk progress UI for sequential processing (3cc37ca4)
- fix(olt-report): move "not found in 1Map" records to investigate tab (81027384)
- fix(olt-report): use 'not_found' status to match DB constraint (847defed)
- fix(1map): pick highest prop_id when multiple records found (b8d1d442)
- feat(olt-report): fetch active projects dynamically for dropdown (48ab3ac9)

---

## [2026-01-23]

### 🐛 Fixes
- fix: resolve 3 UI display bugs from production audit (8f712d00)
- fix: use sender_name instead of sender in wa-dr-photos (2adb270d)

### ♻️ Refactoring
- refactor: rename WA Tracking to Offline Tracking (cc371ee3)

### 📝 Documentation
- docs: add VPS backup infrastructure and fix duplicate BOQ header (7d1989ea)
- docs: update ONEMAP_HOST references to Tailscale IP (07434dbe)
- docs: add OES import project mapping fix to changelog and module docs (a6b3a1f6)
- docs: update QField sync documentation and KB (d88e5c9b)
- docs: update qfield-sync module with OES sync details (96a5ba09)

### 📦 Other Changes
- fix(projects): display created date using correct field name (66dedff2)
- feat(maintenance): enhance KanbanBoard with drag-and-drop (729fea27)
- fix(maintenance): resolve AnimatePresence/Draggable ref conflict (fd8be82c)
- feat(staff): add bank document validation with account holder check (f313d53a)
- feat(auth): implement internal JWT authentication system (8c9dea00)
- feat(staff): add OCR verification data to staff notes (1d7bdb72)
- fix(auth): update session with final token hash after signing (da6804b3)
- fix(staff): save OCR notes to staff_notes table for UI display (bd55ef4c)
- fix(staff): handle API response structure in NotesTab (64637607)
- feat(staff): improve OCR notes with expand/collapse UI (f33fcf95)
- feat(staff): add audit trail system for staff actions (c9964a39)
- fix(staff): prevent duplicate audit log entries (ea2edcd4)
- feat(auth): add login page and update AuthContext for real JWT auth (42b20797)
- feat(qfield): pass reportDate to QField sync webhook (2c099eec)
- feat(activate): add installer name from 1Map via BOSS API (16031101)
- fix(auth): enable Sign Out button in header (fe4993c0)
- fix(activate): consistent styling for timeline dates (f3034720)
- feat(fleet): add driver's license upload from Fleet module (f189e117)
- refactor(sidebar): reorganize navbar and add all shortcuts (6b9a5206)
- feat(auth): add premium login page with fiber background (73a56783)
- fix(settings): add missing shortcut items to sidebar customization (8442fc5c)
- fix(auth): improve login form labels to avoid autofill overlap (32178bb4)
- feat(settings): increase sidebar shortcut limit to 5 (bc28eadf)
- fix(wishlist): enable drag for all users on dev queue board (cd3e03b8)
- fix(fleet): skip document type selection for driver's license upload (f715d247)
- fix(fleet): improve assign driver modal with searchable list (abf50d6b)
- feat(auth): First-time user onboarding flow (#45) (ca760486)
- feat(auth): add super_admin role for Hein van Vuuren (b26cd1a4)
- feat(wishlist): Add 2-stage pipeline (POC + Harness) (54d06f75)
- feat(assets): add category creation page (664475ba)
- fix(activate): lookup project from drops table during OES import (19e3d621)
- fix(assets): add missing category type labels and icons (94266a13)
- fix(activate): respect NEON_USE_HTTP env for database transport (8dd2409a)
- fix(wishlist): Correct harness trigger endpoint path (28fd0599)
- fix(wishlist): Transform payload to match mvp_pipeline.py format (c402ee35)
- fix(dev-queue): Use Authorization Bearer header for mvp_pipeline (5e408385)
- fix(dev-queue): Correct import paths to use dev-queue directory (f29dcafe)
- feat(sidebar): add System Health link to SYSTEM section (6d373d7d)
- fix(sidebar): make System Health available to all users (d3dbfedc)
- fix(dev-queue): Keep DB table names as wishlist_*, update nav menu (a9289d43)
- feat(rbac): implement database-driven role-based access control (ab348108)
- feat(system): add comprehensive infrastructure health monitoring (9cbf08bc)
- feat(rbac): add theme styling and staff provisioning to Access Control (68987aa1)
- feat(system): add health trend chart to infrastructure dashboard (cfae3563)
- feat(maintenance): add WhatsApp maintenance tracking for Mohadin QA (17f34079)
- fix(maintenance): use JS timestamp instead of INTERVAL in SQL query (d7fb65b5)
- fix(maintenance): use createLogger instead of log.child (25cf012f)
- feat(rbac): integrate RBAC permission keys into sidebar navigation (326bdbb6)
- feat(maintenance): add WhatsApp maintenance tracking for Mohadin QA (41262540)
- fix(activate): auto-sync missing DRs from qa_photo_reviews (b2558d94)
- fix(activate): auto-sync missing DRs from qa_photo_reviews with OES check (65ff72f6)
- fix(auth): fix user name and role display in sidebar (7261e8af)
- fix(ocr): improve SA ID extraction accuracy for large PDFs (d460e9c8)
- feat(maintenance): add WA Tracking tab to Data Sync page (2d2cf0a8)
- fix(maintenance): handle space in DR numbers (DR 1234567) (dbfddee1)
- fix(rbac): add missing user_audit_log table (1cd0d87a)
- feat(maintenance): add photo viewing to WA Tracking dashboard (3818542d)
- fix(maintenance): use correct column names for wa-photos API (39a1e031)
- fix(rbac): add key and label to getRolePermissions response (77a6d15d)
- feat(pipeline): add wayleave and cession date column mappings (0f65d4b1)
- fix(activate): sync ALL WhatsApp submissions, remove OES requirement (fed5ff95)
- feat(pipeline): add wayleave/cession date columns to Smartsheet sync (56eed971)
- feat(pipeline): add FibreFlow-style toast notifications for Smartsheet sync (9f42179d)

---

## [2026-01-22]

### ✨ Features
- feat: staff documents, notes, H&S tab, and QA improvements (84ef983a)

### 📝 Documentation
- docs: update KB with dark mode FOUC fix and theme system (dd45d4d7)
- docs: add FOUC prevention section to UI/UX spec (e1bb93e6)
- docs: unify theme specification and archive legacy docs (22ffa66f)
- docs: update QField to use OES_Project_Progress (production) (ade53050)
- docs: add cloudflared QUIC buffer fix to troubleshooting (1356312a)
- docs: update cloudflared fix - use HTTP/2 and run as root (4c4d3e07)
- docs: add missing DATABASE_URL troubleshooting to kb (302be7d0)
- docs: add dev environment (dev.fibreflow.app on port 3005) (1874cbaa)
- docs: update deployment workflow (Local → Dev → Staging → Prod) (3425e1ff)
- docs: recommend dev mode for local development (c3fc0708)
- docs: update WhatsApp architecture for VPS migration (d2c43cfd)

### 🔧 Chores
- chore: archive all legacy dark mode documentation (eea42b1e)
- chore: add debug endpoint for QContact case inspection (9d4281aa)

### 📦 Other Changes
- fix(projects): add skeleton loading to prevent layout flash (bf88e845)
- feat(pipeline): add document proxy for secure file viewing (e79c4f59)
- docs(kb): update pipeline module with doc proxy and flash fix learnings (4813b4cd)
- docs(kb): update procurement module with navigation structure (e6069118)
- refactor(sidebar): hide unused Project Management menu items (373059cc)
- fix(projects): add loading.tsx and improve loading state detection (75809291)
- feat(procurement): link requisitions to RFQs and POs (4b7a2fae)
- fix(procurement): match dashboard layout spacing with other pages (23361da6)
- fix(theme): prevent dark mode FOUC on App Router pages (6a40dec8)
- fix(layout): add missing AppLayout to clients/new and projects/new (5ea61125)
- fix(activate): require confirmation before showing success toast (20ecd466)
- fix(maintenance): add verification API endpoints (38b382bd)
- fix(procurement): prevent route abort errors on main portal page (cf16aa26)
- fix(procurement): show all tabs in All Projects view (c963aa48)
- docs(audit): add comprehensive UI/UX improvement plan (ed8afa8b)
- fix(analytics): remove duplicate stat cards grid (9e3e3cd4)
- fix(activate): correct QField status field names in polling (d2d2c50b)
- fix(maintenance): allow multiple weekly imports per week (04b0a5cf)
- fix(maintenance): allow multiple weekly imports per week (6fe21df5)
- fix(analytics): refactor to match Maintenance Dashboard pattern (514f55aa)
- fix(maintenance): update trigger to use maintenance_history table (d32c1ee4)
- fix(maintenance): return 'id' field in weekly import response (13de9ab9)
- fix(activate): correct field names in pending-aging report (357e9c57)
- fix(communications): refactor to match Maintenance Dashboard pattern (0d5dafc4)
- fix(maintenance): add progress endpoint for weekly import polling (7589063c)
- fix(maintenance): streamline weekly import with FormData and auto-parse (d88f9e7c)
- feat(maintenance): add progress overlay and toasts to weekly import (10751f64)
- feat(whatsapp): add message logging to send-feedback API (691bbbd3)
- fix(whatsapp): use Tailscale IP for sender URL in test endpoint (e4b67809)
- fix(maintenance): align weekly report SQL with database schema (cfb94432)
- fix(maintenance): use system user for weekly import created_by (168c8b1b)
- fix(whatsapp): add recipient_jid to test message request (70a8f40e)
- fix(maintenance): use correct TicketType enum for weekly imports (18fe1362)
- feat(whatsapp): add Send Message tab to WhatsApp Portal (329f895f)
- fix(maintenance): disable caching on weekly import status endpoint (b01bcbba)
- feat(whatsapp): add Chat tab for real-time messaging (661daf8f)
- feat(commands): add /infra skill for infrastructure management (530a8cd1)
- fix(whatsapp): use valid status value for inbound messages (ae75fb98)
- fix(maintenance): fix weekly import polling stuck on completion (c5b6d1b8)
- feat(maintenance): improve weekly import success messages (97c1190b)
- feat(maintenance): add refresh button and duplicates column to import history (fbe774f6)
- feat(wishlist): Add MVP automation with GitHub sync (b9b2ec5b)
- feat(procurement): add CRUD modals for inventory tabs (0a892f34)
- feat(maintenance): add QContact status discovery endpoint (2f6efe85)
- fix(maintenance): fetch case details for accurate status discovery (d2e8e6f0)
- feat(maintenance): add QContact ticket alignment comparison (b2170f12)
- fix(maintenance): use correct db import for alignment service (9fc4c4e6)
- feat(maintenance): add QContact alignment UI tab (389cdb8c)
- fix(maintenance): map QContact status during inbound sync (326a3446)
- feat(wishlist): Add harness integration for automated builds (b8d55cfe)
- fix(procurement): show project name instead of ID in requisition dropdown (efbcac34)
- fix(procurement): show only project name in requisition dropdown (5108d2ed)
- fix(db): auto-reconnect on Neon WebSocket socket hang up (cafa1381)
- feat(maintenance): add three-way alignment and VF renumbering (af85205d)
- feat(dates): standardize dates to YYYY-MM-DD format (Phase 1) (665c95ab)
- fix(staff): await refetch calls to prevent data disappearing (c940177b)
- refactor(nav): rename People section to Human Resources (f76dcabb)
- feat(dates): standardize dates to YYYY-MM-DD format (Phase 2) (3a9b7d8a)
- feat(dates): standardize dates to YYYY-MM-DD format (Phase 3) (e69307a6)
- fix(procurement): fix bundles creation - field mismatch and error handling (f47a926f)
- feat(procurement): add bundle items modal and reports (5e85d0c0)
- fix(bundles): wrap numeric values with Number() for .toFixed() (e31e87b0)
- fix(inventory): fix bundle price decimal display (2168e4af)
- fix(wishlist): Change columns endpoint from PUT to POST (92228d2c)
- refactor(procurement): migrate toast to notificationService (81999b4b)
- fix(procurement): fix dark theme colors in StockManagement (886ba599)
- Merge branch 'master' of https://github.com/VelocityFibre/FF_Next.js (d9c31877)
- fix(boq): use actual items array for stats instead of stale boq.itemCount (5a1a488c)
- feat(audit): add comprehensive production readiness audit system (44d2401d)
- feat(nav): add Health & Safety to sidebar navigation (679afe3b)
- feat(health-safety): add Health & Safety module (8dc080c4)
- chore(deps): add swr for data fetching (1f8d5f0b)
- feat(health-safety): add API endpoints (d6a3bb85)
- fix(health-safety): handle missing tickets table gracefully (d0bbc9e2)
- fix(health-safety): handle missing tickets table in incidents API (8372db72)
- feat(health-safety): add incidents and checklists pages (b064341a)
- fix(health-safety): wrap pages with AppLayout directly (0ce419bf)
- feat(activate): add DR-level expansion to dashboard hierarchy (3c77c9c0)
- fix(health-safety): fix dashboard API queries and add seed script (1272cc10)
- feat(staff): add alerts system with birthday reminders, document expiry, and compliance tracking (c91eafe2)
- fix(activate): show numeric values in DR row columns (2c7673ec)
- fix(health-safety): use maintenance_tickets table in incidents API (3bf02fbd)
- fix(whatsapp): update service URLs to VPS (72.61.197.178) (1abc0e98)

---

## [2026-01-21]

### ✨ Features
- feat: add xyOps and Grafana to System menu (ba87cd2e)

### 🐛 Fixes
- fix: standardize all service URLs to use Tailscale IP (62f1b7b5)

### 📝 Documentation
- docs: add comprehensive infrastructure documentation (1fbfe716)
- docs: add Progressive Knowledge Base system documentation (36745ac1)
- docs: add QFieldCloud infrastructure details (e64acfd8)
- docs: update module documentation and learnings (c5c9928e)
- docs: add pipeline module documentation and update KB (873bc601)
- docs: update WhatsApp integration for bridge-2 (063 841 2276) (05acbdc2)

### 🔧 Chores
- chore: add .env.production to gitignore to prevent credential loss (cedd4097)
- chore: remove .env.production from git tracking (226e1dfd)
- chore: update session state with WA architecture fixes (a6baffdf)

### 📦 Other Changes
- feat(procurement): add stock categories, bundles/kits, and stock takes (f041c37e)
- feat(procurement): add cost centers for hierarchical cost allocation (47ab08f3)
- feat(procurement): add budget templates and dashboard (3341481c)
- feat(procurement): add field stock technician locations and views (e2d6696e)
- feat(system): add QField Monitor dashboard (6bd1f471)
- fix(system): move QField Monitor to root level route (a0b99c49)
- fix(system): move QField Monitor to App Router (5aef168e)
- fix(wishlist): Fix storage upload endpoint path (829ff80d)
- fix(procurement): fix cost-centers ORDER BY column (5354b86b)
- fix(procurement): use numbers for LIMIT/OFFSET params (a793ed24)
- debug: add detailed error for cost-centers (b460a2f9)
- debug: add logging to cost-centers (ae4bb05c)
- fix(procurement): clean up debug logging from cost-centers (03ddf019)
- fix(procurement): add null safety to utilization_percent (829eafa7)
- fix(procurement): convert string utilization_percent to Number (59dedd9a)
- fix(procurement): cast varchar project_id to uuid in joins (8e847673)
- feat(qfield): Add Server Controls admin panel (bed3d666)
- fix(procurement): fix boq_items column name and filter invalid UUIDs (cc38fdfe)
- fix(activate): exclude OES-only records from QA Centre list (bd648d41)
- feat(qfield): Move Server Controls to QField Sync dashboard (b34b0501)
- feat(qfield): Add Server Controls tab to QField Monitor page (a62e6c62)
- fix(nav): Rename 'QField Monitor' to 'QField' in sidebar menu (2fdcaf7d)
- feat(nav): Add QField Sync to sidebar menu under System (116a283f)
- feat(qfield): Add Sync tab to QField page (6887273f)
- feat(procurement): Improve UX with collapsible sidebar groups and dashboard (1ed2f527)
- feat(activate): add SharePoint to health check endpoint (bd3df8ac)
- fix(procurement): transform RFQ date fields for correct display (3263eb49)
- fix(procurement): address audit findings from diagnostic report (5e0f8209)
- fix(procurement): address audit findings from diagnostic report (85d480aa)
- fix(procurement): resolve all API TypeScript errors (baa3379f)
- fix(activate): use Pool pattern for serial swaps API (0de012b9)
- fix(whatsapp): standardize WA URLs to use sender-2 via wa-feedback (ee4bb534)
- feat(pipeline): add document sync from Smartsheet (48390d10)
- fix(activate): set is_oes_only=FALSE on manual DR entry (f7f968d0)
- feat(db): add NEON_USE_HTTP toggle for transport mode (368c1977)
- fix(pipeline): fix blank alerts page and dark theme skeleton (95a36802)
- feat(pipeline): add project-level document management (6adc2395)
- feat(sidebar): add Pipeline to Project Management section (095c15c5)

---

## [2026-01-20]

### 📝 Documentation
- docs: add ticket source tracking to module KB (837934aa)
- docs: add WhatsApp Communications Admin module KB and update wa-agent (32a77d09)
- docs: update knowledge base - bridge now uses unified 082 number (4de7b7da)
- docs: add PDFCraft deployment to knowledge base (d9bd1d25)
- docs: add SharePoint DR sync setup guide (b9de6a26)

### 🔧 Chores
- chore: remove unused BMad commands (532457f2)
- chore: update knowledge base with recent features (0d4e81da)
- chore: update knowledge base session state (47334f99)
- chore: add PDFCraft as submodule (1e8665f4)
- chore: add debug logging to activity timeline (15f1b6f9)
- chore: add debug timeline endpoint (606a233f)
- chore: move debug endpoint to /api/debug/timeline (4ef1ba62)
- chore: move debug endpoint to /api/test-timeline (00b962fc)
- chore: add version marker to activity-log API (69b9e9bc)
- chore: remove debug endpoint (ecb20224)

### 📦 Other Changes
- feat(activate): add confirmation mode for serial validation (8dc62f96)
- feat(activate): add fuzzy matching for serial validation (1bc81d88)
- feat(activate): add blur detection for VLM extraction pipeline (597dc5a1)
- feat(oes-import): add confirmation toast for database sync (4ea5fe37)
- fix(fleet): improve VLM odometer extraction accuracy with multi-pass verification (09061e62)
- feat(fleet): add audit trail page and validation UI indicators (7c7aa702)
- fix(fleet): fix SQL syntax in audit API discrepancy query (3d7d52fa)
- fix(fleet): use sql.query() for parameterized dynamic queries (c6e7eccb)
- feat(activate): add standalone NAFNet deblur service (ad04b653)
- feat(fleet): add Check-In Audit page to sidebar navigation (d079306e)
- feat(activate): Add automated OES to QFieldCloud sync with labeled drop numbers (dea9a830)
- fix(activate): Remove non-existent column reference in OES sync query (ca9cb1d7)
- feat(activate): add Offline Devices report to Reports dashboard (5bf43943)
- feat(activate): add sync progress spinner to OES and ARCH imports (151b2872)
- feat(activate): Add diagnostic endpoint to check OES coordinates (1f6799e1)
- feat(activate): add progress overlays to QA Wizard (47ccb6af)
- fix(activate): Fix OES to QFieldCloud sync webhook integration (213b69a8)
- docs(activate): add progress overlay documentation (f1feffdf)
- feat(fleet): add verified override flow for rejected VLM readings (a29ba63c)
- feat(activate): Add diagnostic endpoint to check OES view for sync (497a945d)
- feat(activate): add Create Ticket action to Offline Devices report (86524be6)
- feat(maintenance): add OFFLINE_REPORT and QA_REVIEW ticket sources (1032ff84)
- fix(qfield): Update sync to use correct OES_Project_Progress project (15f8ad1b)
- feat(fleet): add vehicle calibration API for first-time check-in (551f5e47)
- feat(activate): add draft state for QA Wizard Phase 4 (336e2b8f)
- fix(wishlist): Add form validation feedback for required title field (c408324d)
- docs(activate): add Phase 4 draft state to module KB (d84f9292)
- feat(wishlist): Add vote and move API endpoints (c1a5335f)
- feat(communications): add WhatsApp Admin Portal with accessibility improvements (b7aa6d55)
- feat(fleet): add vehicle calibration modal for first-time check-in (1b9e2ce2)
- feat(wishlist): Add attachments feature for wishlist items (6c8f6335)
- feat(activate): add photo rejection with Fibertime-spec reasons (d5ade502)
- fix(wishlist): Add modal close handlers (Escape, backdrop click, X button) (de01cc26)
- docs(activate): update KB with photo rejection reasons (cd53f6c7)
- fix(wa-admin): dark theme styling for WhatsApp Portal (97d7de4c)
- fix(wa-admin): align header and tabs with FibreFlow design system (267a613f)
- fix(activate): show warning when feedback already sent (c517676f)
- fix(wa-admin): complete dark theme compliance for WhatsApp Portal (ccdaa0ba)
- feat(wa-admin): add phones API and service pairing endpoints (87135381)
- feat(activate): complete DR resubmission workflow (589da03d)
- fix(activate): remove non-existent step_completion column from resubmission snapshot (45d7640e)
- feat(communications): add PDF Tools module (e451b63a)
- feat(wa-admin): add multi-phone support and service improvements (9d838b1c)
- feat(sidebar): add external link support and PDFCraft integration (7f90b907)
- fix(wishlist): Resolve hydration error and fetch race conditions (e5bd369f)
- feat(claude): add self-maintaining knowledge base system (2dc1f085)
- fix(claude): add /kb command to commands directory (ccd4aa36)
- fix(sidebar): use nginx proxy path for PDF Tools (68be122b)
- docs(wa-monitor): update knowledge base with WhatsApp Portal info (398cd443)
- feat(wishlist): Add card click-to-edit functionality (daa715f2)
- feat(wishlist): Add Settings tab with WIP limits and column management (3b4aa016)
- feat(wishlist): Add admin-only drag-and-drop permissions (7d134c70)
- docs(claude): add fleet and activate module profiles (1a142061)
- feat(wishlist): Add Agent OS spec fields for automated development (51d09af3)
- fix(activate): reduce visual disruption from auto-refresh (f7195b61)
- feat(activate): show WA submission time below Installed date (5daaec72)
- fix(activate): use waReceivedAt for WA submission time display (c8398928)
- feat(activate): show OES import timestamp below Activated date (7211ecba)
- feat(activate): add serial swap detection and tracking (ff66946d)
- feat(activate): add serial mismatch tracking with team accountability (830f99eb)
- feat(activate): add quick sync with serial tracking on DR view (7805fda4)
- docs(kb): update activate and wishlist module context (bfba5b56)
- feat(activate): add SWAP_DETECTED activity logging (90116359)
- fix(activate): fix activity log service to match table schema (767a678f)
- feat(activate): add SharePoint DR photo sync system (f9dfac67)
- fix(procurement): resolve critical blockers - real DB operations (5d834887)
- feat(activate): show detailed serial changes in Activity timeline (b3f5eab9)
- fix(activate): clarify timestamp labels in Activity timeline (129a320f)
- feat(activate): comprehensive DR lifecycle timeline (fe31fd41)
- fix(activate): use sender_phone instead of submitter_id in timeline query (5d6759ee)
- fix(sharepoint): use correct column name project_name (279be325)
- fix(config): move OCR service to port 8093 (c779e932)
- refactor(ui): migrate stat cards to unified StatCard component (0adc7a42)
- fix(ui): apply dark theme to native select elements (40f81a85)
- feat(sharepoint): trigger SharePoint sync on QA completion (b35fda71)
- chore(session): update KB scan results and session state (cf1f2e12)
- feat(sharepoint): add comprehensive full sync script (b6d9944b)
- fix(sharepoint): correct activity log column names (1eba3a9a)

---

## [2026-01-19]

### ✨ Features
- feat: Add wishlist feature under Communications menu (94328b47)
- feat: Migrate wishlist from Clerk to PostgreSQL auth (0b226701)

### 🐛 Fixes
- fix: stop version checker from constantly showing "new version" banner (2dc9d7ce)
- fix: Remove PageContainer import and use standard div wrapper for wishlist page (a8ca7876)
- fix: Export API route functions directly for Next.js 14 App Router compatibility (11b2ea4b)
- fix: Remove AppLayout wrapper from WishlistDashboard and fix API responses (431cab46)
- fix: Calculate stats from columns data to prevent undefined error (a2e31c00)
- fix: Use next/navigation router for App Router compatibility (4b8749cf)

### 📝 Documentation
- docs: update skills with VLM extraction troubleshooting (28b55301)
- docs: add Activity Tab documentation to CLAUDE.md (b9a4595a)

### 📦 Other Changes
- feat(procurement): complete RFQ workflow with supplier/stock integration and PO conversion (38c8bde8)
- feat(activate): add expandable Zone/PON breakdown to Dashboard (f42e47e7)
- docs(activate): update KB with Dashboard expandable breakdown and Reports tab changes (c01bd601)
- feat(activate): improve QA Wizard feedback with specific missing photos (20f31979)
- fix(activate): link OES-only activations to projects via drops table (c895cacb)
- docs(activate): add project attribution logic for OES-only activations (aed0184b)
- fix(procurement): render StockItemSelector modal via portal (b220d12d)
- feat(activate): add WhatsApp message threading for QA feedback replies (02ef8bc2)
- feat(activate): improve QA data fetching with ensure-data endpoint (c368b8ea)
- refactor(activate): reorder QA tabs and remove AI Evaluation (1921b1b1)
- feat(activate): add comprehensive reporting dashboard (0ebb45c8)
- feat(activate): add DR Summary page as landing tab (b8573df8)
- fix(activate): correct column names in reporting SQL queries (8deffb40)
- fix(activate): fix summary API column names (76ca28d0)
- fix(procurement): RFQ save and dark mode fixes from E2E testing (04369657)
- fix(activate): add dark mode support to PhotoGalleryUnified (bbcc5eaf)
- fix(procurement): update RFQ list to match Suppliers styling (facde44c)
- docs(e2e): add cross-page styling consistency check (02a8e884)
- fix(activate): pass photos to evaluateAutoFail in Final Decision (7866a79d)
- docs(activate): update knowledge base with QA Wizard and reporting (d4d8dc74)
- fix(rfq): remove gray background wrapper for dark mode consistency (596fd1b5)
- docs(rfq): update E2E test log with background color fix (91e64eb5)
- fix(activate): use VLM categorization results for step data in fetch-photos (80e22f2b)
- docs(ui): add page background anti-pattern to KB (2d8d51fd)
- feat(activate): add backfill cron to sync missing OneMap photos/serials (a9dcaf91)
- feat(activate): improve DR Summary with accurate state and step coverage (bce1f471)
- fix(activate): trust Step 6 serial over Step 9 for ONT validation (b819a4b3)
- feat(activate): store feedback message ID for future threading (c1154e27)
- feat(skills): add comprehensive Final Audit skill for production testing (71f11823)
- docs(activate): add WhatsApp threading and serial validation documentation (76a60da3)
- feat(activate): add inline photo categorization editing (49ef1aa5)
- feat(activate): add VLM queue cron for automatic extraction (ffb90a5a)
- fix(activate): use OneMap URLs for VLM extraction (af058492)
- fix(activate): try multiple Step 9 photos for extraction (d0b8a871)
- fix(activate): try multiple photos for all extraction steps (e9c71ac0)
- fix(procurement): prevent NaN% display in BOQ card mapped percentage (24d033ee)
- feat(activate): align status filters with dashboard states (6187220d)
- feat(activate): add barcode scanning for ONT serial extraction (4f42d5ba)
- fix(sidebar): remove dead links for Drop Dashboard and Home Installations (ef828631)
- fix(activate): use activeProjects from API for project filter dropdown (b3fe05c4)
- fix(activate): implement server-side search for QA Centre (38dfb288)
- fix(activate): add loading indicator to Re-categorize button (a6af4b7c)
- docs(skills): update KB with E2E audit results and troubleshooting (db164535)
- fix(activate): add migration to assign project to OES imports (12bf0f20)
- docs(activate): update KB with OES project mapping and search info (656172fd)
- fix(activate): improve QA wizard UX and add project tracking (f9593bae)
- fix(activate): use approvals map for step counts after override (e68e5fb6)
- feat(activate): compact step indicator with labels under circles (f6636c68)
- style(activate): increase step label font size from 10px to 12px (ddfcfc26)
- feat(activate): add Edit mode for approved categorizations (89a5cccd)
- feat(activate): UX improvements for QA Wizard (70773f41)
- feat(activate): show discarded photos in edit mode for reassignment (5f21b84e)
- feat(activate): separate technician feedback from internal QA data (60343226)
- fix(activate): use correct API format for swap ticket creation (9a6654a2)
- docs(activate): update CLAUDE.md with serial swap detection features (1fce7ba2)
- docs(activate): update module README with serial swap detection (a8af2aca)
- fix(activate): return actual message with @mention in send-feedback response (cb260ae8)
- docs(skill): update activate skill with serial swap detection (51d255c6)
- feat(activate): improve serial feedback with partial serial display (4db4bbd2)
- docs(skill): add serial feedback functions to activate skill (0f81540e)
- feat(activate): improve QA Centre card display with rich status model (b16cd38a)
- feat(activate): add staff tagging and task creation in QA feedback (483af8d8)
- fix(activate): improve QA Centre card UI/UX (37fc0199)
- fix(db): robust migration script with DO blocks for missing constraints (842ac06f)
- feat(activate): add status timeline to QA Centre cards (ec79e16c)
- fix(activate): split status timeline - dates left, QA status right (2913e546)
- feat(maintenance): rename remaining ticket tables to maintenance (f8c57646)
- feat(staff): add WhatsApp JID field to staff edit form (22b0307c)
- feat(activate): compact inline status badges for QA Centre cards (994b364c)
- feat(staff): add script to populate WhatsApp IDs from phone numbers (719c8185)
- docs(skill): add QA Centre compact card layout documentation (bc9c89ca)
- docs(memory): add static assets 404 staging fix (6fa77304)
- fix(maintenance): use correct table name in sync status API (542886fd)
- fix(activate): auto-fetch photos for OES-only DRs (417d1494)
- feat(whatsapp): route QA feedback through dedicated sender (082 418 9511) (a0e108eb)
- feat(activate): add batch sync script for OneMap photos/serials (79080cf7)
- feat(activate): enhance QA Centre card with status badges and maintenance ticket (fe9e7f44)
- refactor(activate): improve QA Centre card layout with clearer structure (66d0fe24)
- refactor(activate): table-based QA Centre layout with column headers (edb197ce)
- style(activate): move QA Status and Outcome to middle of table (43447cd2)
- style(activate): center QA status/outcome, move serials to row 2 (978331fc)
- fix(activate): combine OES/ARCH import into single Data Import tab (8be54058)
- style(activate): show full ONT/UPS serials in QA Centre cards (46671464)
- feat(activate): add QA Status and Install Status filters to QA Centre (f08db85b)
- chore(activate): hide more test projects from filter dropdown (f0601727)
- feat(qfield): add OES data sync from Neon to QFieldCloud (4258503c)
- feat(activate): add Serial Status filter to QA Centre (6a346fa9)
- feat(activate): add daily target benchmark to trend reports (b80afbc0)
- feat(activate): add series and project visibility toggles to trend reports (20130ff8)
- fix(reports): show projects separately in bar chart, hide test projects (5c7ed685)
- fix(reports): exclude Marketing Activations from project toggles (a90d3a4a)
- style(reports): improve color contrast for trend chart series (bac78557)
- docs(activate): add Trend Reports documentation with toggles and colors (bc1797af)
- fix(api): use sql.query() for parameterized queries in qa-review-history (62c06ba5)
- fix(activate): remove Submitted date from DR Summary Timeline (f3a38be0)
- fix(activate): use WA Monitor review_date as fallback for Installed date (e4d55ead)

---

## [2026-01-18]

### 📝 Documentation
- docs: update skills and KB for Excel export feature (b77a7df0)

### 📦 Other Changes
- fix(procurement): fix API response parsing for projects (baf00ac9)
- fix(procurement): fix suppliers API response parsing in RFQ new page (7c83ba98)
- fix(theme): update BOQ list and card components to use dark theme variables (3ad9935d)
- fix(theme): apply dark theme to BOQ pages using correct CSS variables (6a9b01cd)
- fix(activate): use correct photo type to step mappings from stepMapper (6b205c75)
- fix(activate): remove ph_sign1 from step 10 mapping (374ebcde)
- fix(activate): add ph_sign1 to step 10 mapping (abd87376)
- fix(boq): align filters and status badges with dark mode spec (24ffb5cc)
- fix(boq): remove incorrect bg-tertiary wrapper, use AppLayout background (00fd5601)
- fix(layout): use primary background for outer wrapper (fcf2f933)
- fix(activate): resolve VLM image URL for server-side fetching (a0339bab)
- fix(boq): add p-6 padding to match Suppliers layout (ada5a393)
- feat(qa-learning): add HITL few-shot learning for VLM categorization (f4b05baf)
- feat(activate): add robust photo fetch service with retry logic (814eec28)
- feat(activate): add 'Discard - Rubbish' option for photo categorization (7ef24de2)
- fix(activate): add step 0 to stepMapper for correct_category in corrections (692d5ae4)
- fix(procurement): handle multiple status filters and supplier name display (7dfea466)
- fix(fleet): improve VLM accuracy with image resizing and result persistence (851a2492)
- fix(fleet): add VLM persistence logging and knowledge capture hook (f31ef75c)
- feat(fleet): add last reading display and anomaly detection for check-in (1c198a80)
- feat(fleet): add driver details and last readings to vehicle portal (050bdd63)
- fix(fleet): add emergency contact text to Fleet Manager notice (074f4fbe)
- feat(fleet): add last check-in info and history card to vehicle portal (ae5a0274)
- fix(fleet): correct check-in query column names (driver_name, check_date) (8812c4f5)
- feat(fleet): add vehicle-specific check-in history page (c21847eb)
- fix(fleet): fix dynamic route naming conflict for check-in history (a57cbf45)
- fix(fleet): fallback to check-in records for last ODO reading (b70929a7)
- docs(skill): update VLM skill with Fleet Portal and anomaly detection (485a2b43)
- fix(fleet): improve fuel gauge VLM prompt for better accuracy (f66579fe)
- fix(suppliers): add GRN dependency check to prevent FK violations on delete (41d97b53)
- fix(activate): use OES activation_date for Activated count (86b7b65f)
- feat(activate): add Status/Project/Date filters to Dashboard (52692e45)
- feat(activate): add CSV export with filter support (d7fdcc42)
- fix(activate): add missing searchTerm to handleClearFilters (5414c590)
- feat(activate): change export format from CSV to Excel (2971cce7)
- fix(activate): correct export SQL query for missing columns (98d613b2)
- feat(activate): add ONT/UPS serials to Excel export (efa5de23)
- refactor(activate): move Export Excel button next to filters in QA Centre (61cb95a0)
- fix(activate): correct WA Sender port from 8081 to 8090 (accb3ad2)
- fix(activate): support wa-feedback health response format (ef218aea)
- fix(activate): correct reporting calculations for INSTALLED/ACTIVATED (a69a2c64)
- fix(activate): align Dashboard stats with reporting (Total includes OES-only) (62b19094)
- refactor(activate): change Complete/Incomplete to Reviewed/Not Reviewed (a49fdafa)
- feat(activate): implement 5-phase QA Wizard with VLM integration (ba68e359)

---

## [2026-01-17]

### 🐛 Fixes
- fix: rename to 1M (not 1Map) (279d827a)
- fix: close health dropdown when clicking outside (a4df93e2)
- fix: resolve Clients RNaN bug and SOW dark theme issue (7a755828)
- fix: resolve procurement page hydration errors (196657fd)
- fix: prevent white flash on dark theme page refresh (7db4588f)

### 📝 Documentation
- docs: update session memory with health check fixes (6f51cf2b)

### 🔧 Chores
- chore: rename OneMap to 1Map in health dashboard (f6aa02e1)

### 📦 Other Changes
- fix(health-check): query correct table for WhatsApp Bridge status (3985077a)
- fix(health-check): get last submission from all records, not just last hour (ef09fce2)
- feat(health-dashboard): add expandable service status dropdown (c19a5aac)
- fix(procurement): resolve hydration errors with loading state (762d9a7d)
- fix(procurement): ensure all hooks called before early return (643cc51e)
- fix(procurement): add navigation to ProcurementTabs (e08981b8)
- feat(budget): add Budget Items tab and BOQ import modal to project budget page (eb46fc80)
- feat(sage): add public pages and database migration for Sage integration (fbeab58b)
- feat(sage): add Sage API client and endpoints (37a70669)
- fix(sage): redirect OAuth callback to /home instead of non-existent /settings/integrations (bd9013a9)
- feat(sage): add Integrations tab to Settings page with Sage configuration UI (340e5bf3)
- feat(sage): add supplier, invoice, payment sync services and cron job (f8ff36e2)
- fix(sage): use snake_case for API request/response fields (760ac6b3)
- feat(sage): implement Basic Auth for South African Sage API (118e22b5)
- feat(activate): add Reports tab with comprehensive reporting system (5a2212b2)
- fix(sage): improve error messages for API authentication failures (d5733e4b)
- fix(activate): use photo_count for completion status in reports (b2874b45)
- feat(sage): implement OAuth 2.0 for SA Sage Business Cloud API (0caf6572)
- feat(sage): update UI for OAuth 2.0 authentication (f4abe04f)
- feat(sage): switch to Basic Auth for SA Sage API v2.0.0 (162dc854)
- feat(reporting): update terminology to Installed/Complete/Incomplete/Activated (d0347f27)
- docs(sage): add SA Sage API knowledge and fix auth method (260b217c)
- feat(activate): add missing photo detection to WhatsApp feedback (fa05a989)
- feat(nav): add Activate menu item to Field Operations section (934a8b2a)
- fix(activate): correct WhatsApp bridge port and endpoint (d9eca442)
- docs(skill): update activate-module skill with Reports tab and terminology (c3b405f9)
- fix(activate): add null safety for incorrect_steps in send-feedback (f17081a3)
- fix(activate): add detailed logging to send-feedback for debugging (6b085f08)
- fix(activate): use hardcoded WhatsApp group mappings (7c2987ca)
- refactor(activate): clean up verbose debugging logs (d26a3a09)
- feat(activate): fix missing photos detection with correct 1Map mappings (b5a39cbe)
- feat(activate): simplify feedback to receipt acknowledgment with serials (49597a21)
- feat(activate): use friendly step descriptions in feedback (f2dbc561)
- fix(activate): add 'with labels' to green lights description (c11d8d21)
- fix(activate): prevent acknowledgment for DRs not found in 1Map (43cf1e08)
- feat(activate): add auto-refresh system with shared context (ab383ae3)
- feat(stock-items): add Stock Items CRUD module with Odoo sync (3f8c90a9)
- feat(activate): add comprehensive stats and reporting system (5ceb4ef3)
- fix(activate): prevent duplicate counts in Installed/Activated stats (bf42b28b)
- fix(activate): fix ambiguous column reference in activated query (3cf83419)
- checkpoint: before procurement navigation reorganization (c1a785a1)
- refactor(navigation): reorganize procurement and rename inventory to assets (c821e3d9)
- fix(procurement): add AppLayout wrapper to BOQ, RFQ, and Stock pages (c6a007ab)
- fix(procurement): convert StockManagement from react-router to Next.js (42d73630)
- feat(activate): implement 3-phase QA workflow with VLM validation (192a1c6d)
- feat(procurement): add missing pages and fix mock data issues (1994c48c)
- fix(build): resolve all build warnings and errors (28eadea0)
- feat(fleet): add debug photo saving for plate verification (f2ce61a9)
- fix(fleet): resize iPhone photos before VLM processing (bdaadfdd)
- fix(ocr): resize large images before VLM processing (daf9aa2d)
- fix(ocr): add sa_id document type alias for VLM extraction (cef350d7)

---

## [2026-01-16]

### 🐛 Fixes
- fix: use vf.fibreflow.app URL for staging in OES docs (979c52b7)

### ♻️ Refactoring
- refactor: rename dr-photo-unified to activate module (d645b7c5)

### 📝 Documentation
- docs: add DR Photo Unified module documentation to CLAUDE.md (38956244)
- docs: add dr-photo-unified module profile (831ecf88)
- docs: update server credentials and deployment commands (814f299e)
- docs: add OES import skill and command (b0c9e994)
- docs: update knowledge base with DR acknowledgment system (45fae7d6)

### 🔧 Chores
- chore: cleanup import paths and fix ticketing column names (7e577d73)
- chore: add Go bridge patch scripts for DR acknowledgment (0aa19683)

### 📦 Other Changes
- fix(dr-photo-unified): add photo proxy to fix image loading from external (0e1d396f)
- fix(dr-photo-unified): use PhotoGalleryUnified component in Photos tab (eb433dc5)
- fix(ticketing): align weeklyReportService with database schema (c45062ac)
- fix(dr-photo-unified): create unified review on-demand from qa_photo_reviews (63085255)
- feat(dr-photo-unified): add Fetch Photos button to load photos from OneMap (d9bdad66)
- feat(dr-photo-unified): auto-fetch photos and sync serial numbers from OneMap (474e2e5d)
- fix(dr-photo-unified): trigger download when OneMap record exists but photos empty (c62399de)
- fix(dr-photo-unified): pass force=true when manually fetching photos (01a3ba97)
- fix(procurement): fix VAT calculation in PO create (b3dbf699)
- refactor(dr-photo-unified): convert from 12-step to 10-step photo checklist (f6566d72)
- refactor(dr-photo-unified): update Qwen3 VLLM prompts for 10-step structure (dd0af6ca)
- fix(ticketing): add sheet auto-detection to weekly import API (4bcdadfa)
- fix(ticketing): use correct column name 'type' instead of 'ticket_type' (25e640e3)
- fix(procurement): fix PR to PO conversion API and UI (7318485c)
- fix(procurement): add tab content rendering to procurement portal (2b30cd3e)
- feat(procurement): add GRN and Approvals pages (a8aab227)
- fix(procurement): correct project column name in requisitions API (6319e133)
- feat(dr-photo-unified): add VLM categorization, health monitoring, and UI improvements (cc431f8b)
- fix(ticketing): persist QContact activities locally and fix weekly import (c3c51b36)
- feat(dr-photo-unified): default to today's filter with filters panel visible (cd60de3b)
- fix(dr-photo-unified): keep filters panel collapsed, only apply today filter by default (969a6eda)
- fix(dr-photo-unified): initialize date filters synchronously to fix project stats race condition (2489deb7)
- fix(dr-photo-unified): don't overwrite filtered projectStats from fetchDrops (4395dd48)
- feat(budget): add project budget tracking system (PRD-057) (c4e661a4)
- feat(projects): add Budget tab to project detail view (d716befc)
- feat(dr-photo-unified): use unified reviews table for DR list (14a5fc71)
- fix(dr-photo-unified): use correct column names after migration 054 (5b1a478a)
- fix(dr-photo-unified): fix date filter SQL with explicit DATE casting (6957d8b3)
- fix(budget): resolve SQL syntax errors in alerts and transactions APIs (65b4bfd8)
- fix(budget): correct data extraction for transactions and alerts (ec0bc104)
- feat(dr-photo-unified): add duplicate detection with submission history (2a4b742b)
- feat(dr-photo-unified): add submitted_date field for retroactive DR entry (6de7685e)
- feat(dr-photo-unified): add toast notifications for Manual Entry results (8a962a2c)
- debug: add logging to ManualDREntry for resubmission detection (ae594814)
- feat(dr-photo-unified): add agent phone number tracking from WA Monitor (893281be)
- fix(dr-photo-unified): filter by submitted_date instead of created_at (cffb5b0a)
- fix(dr-photo-unified): fix timezone handling for submitted_date filtering (c8a58ff6)
- feat(dr-photo-unified): add site submission tracking and OES import (e51806e6)
- feat(oes-import): add upsert support for repeated imports (b2a9c4e5)
- fix(dr-photo-unified): preserve original timestamp from qa_photo_reviews when syncing (5fb17a06)
- perf(oes-import): batch processing for 10x faster imports (e0926836)
- fix(oes-import): show results before refreshing page (a4175d2c)
- fix(oes-import): properly track inserts vs updates in batch mode (ae8dd80f)
- fix(oes-import): use count-based approach for insert/update tracking (30418b33)
- Merge pull request #43 from VelocityFibre/feature/rename-to-activate (fd8ede6c)
- refactor(activate): rename DR List tab to Dashboard (d1207362)
- fix(activate): apply project filter to dashboard stats and project table (36d377a1)
- fix(activate): server-side filtering for dashboard stats (32a7f8b0)
- fix(activate): trigger fetch on filter changes (8e946da0)
- fix(activate): call getTodaySAST() for initial date state (a86d0f91)
- fix(activate): only fetch when date filters are initialized (b4747106)
- fix(activate): use COALESCE for date filter when submitted_date is null (84f2b153)
- perf(activate): improve UX with skeleton loading and parallel queries (08af0574)
- feat(activate): add DR acknowledgment API for instant WhatsApp feedback (b5ef3a25)
- fix(activate): extract ONT serial from barcode scan data (87f72708)
- fix(activate): correct OneMap health check endpoint (d5b8cdb6)
- feat(activate): add WhatsApp Sender to health check (96f7636b)

---

## [2026-01-15]

### 📝 Documentation
- docs: add project import skill and enhance import script (669f62e7)
- docs: add theme-audit skill for light/dark theme visual audits (4c94aee4)

### 📦 Other Changes
- feat(fleet): add Vehicle Portal with plate verification and enhanced tracking (3b856b29)
- feat(sidebar): add customizable main menu items and improve navigation UX (dd53b492)
- fix(sidebar): prioritize dedicated sections over MAIN shortcuts (93c78cdd)
- feat(fleet): add comprehensive Fleet Analytics system (PRD-046) (562f3eb6)
- fix(fleet): replace alert() with toast notifications on Driver Leaderboard (2ecc721c)
- fix(fleet): add toast notifications to Maintenance page (3be24b2a)
- fix(fleet): add toast notification to Analytics page (14112526)
- fix(ui): replace remaining alert() calls with toast notifications (736fc91c)
- refactor(ui): replace all alert() calls with toast notifications (6baa459e)
- fix(dr-photo-unified): add server-side pagination to resolve 4MB API limit (#41) (05f689e6)
- fix(dr-photo-unified): fix quick filter button highlighting timezone mismatch (cb98a03e)
- feat(import): add unified project import system (PRD-047) (e2e7c1f5)
- fix(import): handle comma numbers and trailing space headers (4693f197)
- feat(fleet): add unified Fleet Drivers page with 4-tab structure (ff133347)
- fix(dr-photo-unified): calculate per-project stats from all records (32aab66d)
- fix(api): correct column names in projects API to match table schema (f81aa20b)
- fix(api): add project_code generation for new projects (f64e383f)
- fix(env): update production env with correct credentials (4d31cdc4)
- fix(api): accept project_name from frontend and handle nested location object (ea88064e)
- fix(ui): navigate to /projects/new instead of inline form (412b5f5e)
- fix(ui): update Project Detail cards to use dark theme CSS variables (26f135d4)
- fix(ui): improve dark theme contrast for project detail tabs and header (fca22bd2)
- fix(ticketing): remove view=all param from QContact API call (7d4f8792)
- fix(procurement): resolve React hydration errors #418/#423 (0506f1e1)
- fix(layout): resolve React hydration errors in AppLayout and AppRouterLayout (c46bd183)
- fix(hydration): use static dates in AuthContext mockUser (151c9615)
- docs(skills): add comprehensive QContact integration documentation (0df11615)
- refactor(themes): limit UI to Light and Dark themes only (8cc52dae)
- fix(theme): prevent hydration mismatch when theme preference is invalid (64336d62)
- fix(hydration): add protection for Date() calls in Footer and DashboardHeader (36ab3dbe)
- fix(ticketing): add weekly import parse endpoint and fix import flow (ae849458)
- fix(ticketing): weekly maintenance import with correct schema mapping (6939f677)
- feat(ticketing): add upsert logic for weekly import (3736eddb)
- refactor(ticketing): combine QContact Sync and Weekly Import into Data Sync page (721bc763)
- feat(ticketing): wire Risk Acceptance and Handover Center UIs to APIs (8e8583ed)
- fix(ticketing): cast text to uuid in risk acceptance join query (4b6f588d)
- fix(ticketing): use project_name column instead of name (8bfc3bdf)
- fix(ticketing): fix handover service project_name column and UUID cast (48710544)
- fix(ticketing): correct column names in handover service (zone, pole_id, pon, contractor_id) (20f576a6)
- fix(ticketing): handle nested error structure in weekly import (1db17dcf)

---

## [2026-01-14]

### ✨ Features
- feat: DR Photo Unified System - Complete Phase 6 Rollout (#40) (7582b10e)

### ♻️ Refactoring
- refactor: rename foto-review to photo-review (76073a38)

### 📦 Other Changes
- Merge branch 'feature/onemap-auto-sync' (c6d0d24a)
- feat(dr-photo): move ONT and UPS serials to dedicated row side-by-side (4e97bef1)
- checkpoint: before foto-review to photo-review rename (0e0ec2e2)
- Migrate BOSS VPS API references from 72.61.197.178 to Velocity Server (100.96.203.105) (16ab1e94)
- feat(fleet): add vehicle ownership management with tabbed detail page (#39) (7c7de5d0)
- feat(fleet): add investigation detail page for GPS analysis results (4719fa1c)
- feat(fleet): add daily vehicle check-in system for pre-trip inspections (318f2189)
- feat(fleet): add daily/weekly check-in modes with VLM integration (f9b23e53)
- fix(wa-monitor): revert UnifiedReviewCard integration from WA Monitor (cb7cc2cf)
- feat(fleet): improve vehicle retire/delete UX with toast notifications (3ff42d19)
- feat(fleet): add unified driver-vehicle assignment system (fef0db08)

---

## [2026-01-13]

### 📦 Other Changes
- fix(staff): fetch hasValidLicense from API instead of using complianceComplete (c9e90a70)
- feat(staff): complete HR system with tabbed edit form and enhanced vehicles (78d4377b)
- feat(staff): sync document data to employee details on upload (cdc0c4cf)
- feat(staff): add comprehensive document compliance tracking (8dcc0044)
- fix(staff): display SA ID and Passport in Overview tab (2a207552)
- fix(staff): enable clearing identity document fields in edit form (2e43bf66)
- fix(staff-docs): correct field name for document number sync (fb6b573c)
- feat(staff): add face photo extraction from ID documents using VLM (fb2aa0ea)
- refactor(staff): reorganize Overview tab layout for better UX (e47835f2)
- fix(staff): prevent ID photo replacement unless explicitly forced (e2762e8d)
- feat(ocr): add passport document type with proper field extraction (0a899f2d)
- feat(stock-tracking): implement 4-stage site stock tracking system (#37) (8281712b)
- feat(ocr): add driver's license OCR extraction with expiry detection (7b59b378)
- feat(ocr): replace tesseract with Qwen3-VL for all document OCR (e520823e)
- feat(staff): verification-based OCR sync for compulsory documents (0110c2ec)
- feat(onemap): implement automatic serial sync when DR submitted to WA Monitor (33aba264)
- feat(dr-photo-api): add ONT and UPS serial number cards to UI (998416ff)
- feat(dr-photo-api): improve serial card layout with click-to-copy functionality (b560b848)

---

## [2026-01-12]

### 📦 Other Changes
- fix(ocr): resolve double-click upload bug and add field extraction improvements (38612a91)
- Merge pull request #34 from VelocityFibre/feature/ocr-document-extraction (488e10ec)
- feat(sidebar): add collapsible sections and separate Clients from Staff (#35) (710232b1)
- feat(ocr): implement OcrResultsModal component for document extraction review (9df2f7d5)
- fix(ticketing): correct ticket count and set Kanban as default view (5ee692ad)
- fix(ocr): improve SA ID detection for both Smart ID cards and old ID books (3ae30dfa)
- fix(ocr): update server-side classification for Smart ID cards (26540b4a)
- feat(ocr): add Smart ID card and passport support to document classification (b69ee50a)
- feat(ocr): add international passport support for document classification (0a3566c0)
- fix(ocr): improve field extraction for bilingual passport format (9e85419e)
- feat(ticketing): add search functionality and QContact note sync (e31df44c)
- fix(ocr): improve classification scoring for large keyword sets (ae79b4bf)
- fix(ticketing): use correct QContact env vars for note sync (24040cde)
- fix(ocr): extract values from OCR field objects before upload (116568db)
- fix(ocr): always extract SA Smart ID card issued date (a7baef4a)
- fix(ocr): boost confidence for strong keyword+pattern evidence (e101319f)
- feat(staff): add document verification panel modal (4bc20f51)
- feat(ticketing): add QContact note sync with proper error handling (68431863)
- feat(staff-docs): implement type-first document upload flow (ffac3428)
- feat(ticketing): add clickable status and priority badges with flexible status system (ff33e73f)
- fix(ocr): simplify driver's license to single-file upload (front only) (b4bf4e29)
- feat(staff): comprehensive HR system expansion with 7-tab staff detail (#36) (05e48a8c)

---

## [2026-01-11]

### 📦 Other Changes
- feat(staff): implement document management with VF Storage (09e19dcb)
- feat(staff): implement OCR-first document upload wizard (PRD-033) (8f25a773)
- fix(ocr): correct OCR service health endpoint path (5eefb920)
- fix(ocr): add drag-and-drop handlers to document upload wizard (d66b3722)
- fix(ocr): make file input accessible for click-to-upload (cb660d49)
- feat(ocr): verify OCR wizard end-to-end with successful test (8b70b3ca)
- fix(ocr): add explicit onClick handler for file input trigger (19ef19d0)

---

## [2026-01-10]

### ✨ Features
- feat: Field Stock Control (PRD-027) + Complete Dark Mode (f1250292)

### 🐛 Fixes
- fix: resolve dashboard hydration errors and loading issues (d2e3c271)
- fix: remove App Router page routes that conflict with Pages Router (04a8523f)

### ♻️ Refactoring
- refactor: remove Clerk authentication references (f3aad28d)

### 📝 Documentation
- docs: update memories and skills with session progress (4c0e8bd9)
- docs: update memories with suppliers fix (039465c2)

### 🔧 Chores
- chore: trigger Vercel redeploy to fix intermittent 404s (07cd767a)
- chore: trigger fresh Vercel deployment (fb402687)

### 📦 Other Changes
- Merge pull request #32 from VelocityFibre/develop (59c73b9d)
- Revert "fix: remove App Router page routes that conflict with Pages Router" (23f84814)
- fix(sidebar): fix navigation by using Pages Router API (28d90f6d)
- feat(nav): add Field Stock Control to sidebar menu (c926f8fa)
- fix(suppliers): replace react-router useNavigate with Next.js useRouter (e9436967)
- fix(ui): standardize page spacing across Staff, Clients, Contractors, Projects (70ef4d94)
- fix(router): use next/navigation for hybrid App/Pages Router support (8b397616)
- fix(drops): fix spacing to match standard page layout (5d163565)
- feat(staff): improve staff import with flexible header mapping (e2421d75)

---

## [2026-01-09]

### ✨ Features
- feat: add PAI integration, GitHub workflow, and TDD enforcement (4ffd0757)

### 🐛 Fixes
- fix: Remove development bypass sign-in page (2a8f7436)
- fix: Remove all Clerk authentication completely (1400838b)
- fix: Remove indirect Clerk dependency via convex package (b93e10d6)
- fix: Replace react-router-dom with next/router in Nokia Equipment (ba3abdc7)

### 📝 Documentation
- docs: Document clean foundation reset (2084c1ed)
- docs: add comprehensive module documentation system for all 34 FF modules (c68df533)
- docs: add comprehensive development workflow guide (74ca8e9e)
- docs: add comprehensive database audit report (150175e0)

### 🔧 Chores
- chore: add OneMap sync script and misc updates (0bbcb18f)

### 📦 Other Changes
- Remove Firebase dependencies - complete migration to local storage (8bf02327)
- Migrate pole tracker photos to local storage (dfe50c09)
- Fix CI: rename check-db-connections.js to .mjs for ES modules (a10ba8b8)
- Merge: Remove Firebase dependencies - complete migration to local storage (9752f1ce)
- Add unified storage adapter with VF Server support (6ae622db)
- Merge branch 'develop' (e3c3cc3a)
- Add new components from fork: TicketForm, OneMap, StaffDocumentChecklist (c9dd967d)
- Integrate TicketForm component into create ticket page (098af4c3)
- ci: add Claude PR assistant GitHub Action (1f8c9ee5)
- Merge pull request #30 from VelocityFibre/develop (a67f53ca)
- Merge pull request #31 from VelocityFibre/develop (720981a6)

---


## [2026-02-19]

### ✨ Features
- feat: add Odoo GRN and stock level sync scripts (aa7773e0)
- feat: complete Odoo data sync — vendor bills, serials, reorder rules, fleet, warehouses (ccec209f)
- feat: browser QA infrastructure — Playwright CLI + user stories + /ui-review skill (ad8d246e)
- feat: P0 procurement features — audit wiring, fault UI, audit UI, HoP override (ffa65f58)
- feat: auto-generate 60 smoke stories + /kb staleness tracking (99596dda)
- feat: DR not-found notification, procurement docs, devops scripts, module contexts (7aab62d9)
- feat: procurement document upload — DB, API, component, wired into PO/GRN/RFQ (8eb2edd3)

### 🐛 Fixes
- fix: replace mock supplier data with real DB data in procurement reports (46b01db9)
- fix: cast item_count to integer — prevents string concatenation in stat cards (aa9731a9)
- fix: replace mock spend-by-category and cycle-time with real DB queries (a3804f25)
- fix: remove fake fallback values from aggregate-metrics API (99999d1d)
- fix: eliminate all mock/hardcoded data across codebase (ed00406c)
- fix: complete Odoo data reconciliation — GRN-PO linkage, stock qty, movements (df0890d4)

### 📝 Documentation
- docs: add GitHub contributor details to Zander SSH setup guide (ce8c3507)
- docs: update Velocity server storage info after LVM expansion (1f7c3e3d)

### 🔧 Chores
- chore: make ingest-qdrant.py executable (f793ce38)
- chore: update /kb skill to use venv python with DATABASE_URL for DB schema ingestion (10bbf8a9)

### 📦 Other Changes
- test: add E2E test for /api/procurement/reports-data endpoint (d73707b4)

---

## [2026-02-18]

### ✨ Features
- feat: add Qdrant vector DB ingestion to /kb skill (862b707f)
- feat: procurement audit trail, fault handling, serial state machine, BOQ forms & export (09a002e4)
- feat: add Construction QA module — Phase 1 MVP (ccfd5648)

### 🐛 Fixes
- fix: NOC dashboard bugs — workload total, recent tickets, kanban sub-tabs (32b463b0)
- fix: qdrant ingestion uses model objects instead of raw dicts (a9f20ecf)
- fix: remove dead WA Sender from health checks, add dashboard page title (b678a410)
- fix: dashboard KPI trends show real percentages, align Kanban with actual ticket statuses (f84ec94e)
- fix: dashboard KPI trends actually read unwrapped API response (09a7c9d9)
- fix: procurement audit — critical security, SQL, and link fixes (cf219ca5)
- fix: strip /storage prefix from internal VF Storage URL for VLM OCR (b5929784)
- fix: correct VF Storage URL patterns across codebase (47ec22c6)
- fix: aggregate-metrics resilient to partial query failures + E2E procurement audit suite (ddcb83c0)
- fix: Construction QA audit bugs — reports page, duplicate header, search debounce (760d6cb5)

### 📝 Documentation
- docs: update wa-monitor for direct-send bridge (sender service removed) (54fbdf41)
- docs: update Zander bootstrap and infra docs for current state (ed10cd4e)

---

## [2026-02-17]

### ✨ Features
- feat: add 'Hide inactive' checkbox to PON Stage Tracker (c5df3688)
- feat: add clickable navigation to activation requirements and prereqs (18c276af)
- feat: add auto-detection for project pre-requisites (b2bcf6c5)
- feat: refine prereq templates — add MSA, BSS, MSS, SOW items (acaa0a10)
- feat: auto-detect BSS and MSS from project_documents table (32fb4e35)
- feat: make Pre-Reqs the default and first tab under Planning (3479ae12)
- feat: supersede previous BOQ versions on re-import (8db77cc3)

### 🐛 Fixes
- fix: remove cron syntax from JSDoc that broke ESM parsing (3cacd4e1)
- fix: remove SITES reference from dynamic sync script (4a211962)
- fix: use QField + OES data for poles planted and CWC stages (2c5f9ff7)
- fix: use correct denominators per stage — poles for build stages, joints for optical, drops for activation (143a1743)
- fix: fall back to poles count for optical when joints lack pon_no (55c8d947)
- fix: add missing requirement_type mappings for prereq clickable links (4ba240bf)
- fix: correct prereq link mappings for BSS, MSS, PO, HLD, LLD (fab9b097)
- fix: use opaque background for wayleave detail drawer (b4e0ca91)
- fix: add toast error feedback when prereq checkbox save fails (b83e15da)
- fix: wayleaves show expired status and overview reflects expired docs (1777bf4f)
- fix: rewrite expiring-documents API to use pool instead of neon driver (265ed0e0)
- fix: correct column names in expiring-documents API queries (461e464c)
- fix: expiring docs links scroll to list and expand in-place (13d50578)
- fix: filter out ancient expired documents from expiring docs sidebar (9ddfe6ac)
- fix: budget KPI falls back to projects.budget when no formal budget record (dd324c08)
- fix: handle Cloudflare tunnel response delivery for BOQ imports (71f6fa1a)
- fix: BOQ import sets item_count on boqs record + polling retry with count (540a1725)

### 📦 Other Changes
- fix(build): use drops table as universal denominator for PON stage totals (cf27451e)
- fix(projects): map camelCase form fields to snake_case API fields (c089689d)
- feat(build): dynamic 1Map stage sync with DB-driven project discovery (ac4f7023)
- fix(build): deduplicate 1Map records by DR number in stage counting (7e591ecf)
- fix(activate): fix QA Centre search 500 error - missing upr JOIN in oesOnlyQuery (2751d338)
- debug: add queryErrors tracking to expiring-documents API (44eeb5a6)

---

## [2026-02-16]

### 🐛 Fixes
- fix: pipeline approval auto-transition + bulk internal approve + Smartsheet import fix (6cb556f1)

---

## [2026-02-15]

### 📦 Other Changes
- feat(build): add PON stage tracker, 1Map stage sync, and project pre-reqs (e23debc3)

---

## [2026-02-14]

### ✨ Features
- feat: Add deployment safety scripts and documentation (d85b341f)

### 🐛 Fixes
- Fix: Update password placeholders to Title Case (434a1e22)
- Fix: Update email placeholder to Title Case across all login forms (bbecd814)
- Fix: Add dark mode variants to all color classes (Theme Compliance #82) (2ebcc303)
- fix: ClientPOCreateModal WCAG 2.1 AA compliance - Task #239 (a92e5a8b)
- fix: Add missing screenshot #35 (Field App Portal) to production (7c13dea5)

### 📝 Documentation
- docs: Update deployment documentation for systemd transition (10e8e38a)
- docs: add Field App Portal section (5.4) to user manual (efde0e66)
- docs: update INFRASTRUCTURE.md paths from /home/louis to /home/velo (4ab05a89)
- docs: Fix 4 broken screenshot references in user manual (2a9590b2)
- docs: FibreFlow User Manual v1.4 - Field App Portal and Mission Control (38a38409)
- docs: Fix screenshot references in user manual (Task #169) (954dbee3)
- docs: Add screenshots 15, 35, 37 to complete manual (ca2b5020)
- docs: Fix screenshot numbering (35→36, 36→37, 37→38) (c2ead430)
- docs: Add 38 user manual screenshots for FibreFlow guide (a79d1e43)

### 🔧 Chores
- chore: Commit production changes (field stock fix + accessibility + docs) (bf7bc09b)
- chore: Commit agent-applied fixes (accessibility, theme compliance, screenshots, docs) (5666829e)
- chore: Remove temp/backup files (49412b9f)
- chore: Commit remaining agent changes (procurement services + screenshot 35) (75bbfa3e)
- chore: Remove 16 .backup files left by agents (5a328b5b)
- chore: Remove 21 test scripts from project root (1a50fbb3)

### 📦 Other Changes
- fix(qfield-import): improve layer detection heuristics + defensive UI guards (6c80279c)
- fix(qfield-import): fix field mappings for MAM-style GPKG columns (aed8e544)
- fix(qfield-import): guard against NaN integer cast from comma-separated pon_no/zone_no (c7164f23)
- fix(qfield-import): filter null keys and deduplicate before UNNEST upsert (72b439ce)
- fix(gpkg-import): handle Mohadin field variations — varchar truncation, zone_no fallbacks, null filtering (22019f12)
- fix(gpkg-import): increase maxBuffer to 200MB and timeout to 5min for large projects (b9760aef)
- fix(gpkg-import): add pole_type to merge ON CONFLICT update (8805e81b)
- fix(gpkg-reader): exclude HomeConnections from joints classification (bdedcbe2)
- feat(documents): add Client PO upload to Documents tab (0c1852ca)
- refactor(monitoring): restructure health endpoints to /api/health (3be13982)
- fix(projects): convert Documents and Income tabs from dynamic to static imports (dfe50e8f)
- fix(projects): convert all next/dynamic imports to static imports (935be8d1)
- fix(projects): use useEffect dynamic import instead of next/dynamic (1f5cf7bb)
- fix(projects): use mounted state guard instead of dynamic import (7de47947)
- fix(projects): break neon import chain in client components (1b7f559d)
- fix(dashboard): Update greeting to Title Case (4feebede)
- Fix Client PO Upload theme compliance - Replace hardcoded colors with design tokens (7e77f781)
- fix(auth): Update email placeholder to Title Case (25bef72f)
- feat(monitoring): Add /api/monitoring/health endpoint (ea87e357)
- Update SSH commands to use sshpass for automation (12f0825d)
- fix(dashboard): Apply Title Case to main Dashboard greeting (577f3124)
- fix(auth): Apply Title Case to "Forgot Password?" link (8b3916d8)
- Add screenshot 36: Mission Control Dashboard (55c0f26c)
- Add input sanitization to prevent stored XSS (Task #225) (3420e120)
- test: Add rate limiting verification script for Arcjet (c8722676)
- feat(finance): add spare drop tracking to Client PO system (88d12097)

---

## [2026-02-13]

### 📦 Other Changes
- docs(infra): add nginx upstream failover and backup auto-sync docs (b90b8e3d)
- fix(projects): show 'Not specified' for empty location JSON instead of raw string (f3da4ebe)
- fix(projects): fix GPS DMS parsing — handle negative signs and symbol stripping (4b49bd01)
- fix(projects): unify BOQ import and redirect dead SOW import page (5cbfa80d)
- feat(activate): enable search on dashboard (9dd791cc)
- fix(rbac): add maintenance + system.vlm-learning permissions (batch 2) (d4a11298)
- fix(activate): pass search term to dashboard stats and project table (b32c4c67)
- feat(mission-control): add Mission Control dashboard with agent status, live feed, task board (93d473be)
- fix(mission-control): move API route to root pages/ dir (5562db59)
- feat(qfield): add GeoPackage import pipeline for infrastructure data (eb558334)
- fix(pipeline): improve approval drawer UX — docs first, actions collapsed (b360723a)
- fix(qfield): fix GPKG import — correct MinIO bucket + remove SSH (9f4ca02c)

---

## [2026-02-12]

### ✨ Features
- feat: chatbot overhaul - pgvector RAG, dynamic SQL queries, response fix (8a7440fe)

### 📝 Documentation
- docs: update KB, module docs, session state, and project documentation (d7317dbd)

### 🔧 Chores
- chore: update session state and metrics (8f065c0c)

### 📦 Other Changes
- feat(qfield-qa): redesign QA dashboard with Activate-style hierarchy navigation (9c3cb4a6)
- feat(pipeline): add hard delete for pipeline projects with cascade (d893cc7e)
- fix(qfield-qa): use drops table for zone/PON hierarchy data (813541b7)
- feat(qfield-qa): add feature-level drill-down in hierarchy tree (d877de7e)
- fix(fleet): add retry logic for portal plate scan network failures (791144fb)
- fix(help-center): use absolute paths for manual screenshots (d1629c8b)
- feat(contractors): add agreement generation modal with date config (ecf961dd)
- fix(storage): add DOC/DOCX to allowed upload types for Pipeline (c14845d6)
- feat(activate): add ONT swap tracking via WhatsApp pre-provision groups (19aff621)
- feat(activate): add ONT swap marker in DR Review summary (eb55a7d3)
- fix(wa): remove withAuth from bridge inbound endpoint, use bridge secret (36fbbdd5)
- fix(rbac): add 5 missing permission entries found by audit (54c2be57)
- fix(activate): require 95% VLM confidence before showing serial mismatch in ACK (4f86412d)
- fix(activate): prompt tech to double-check serial when VLM photo is unclear (ff20f11a)
- fix(activate): always prompt double-check when VLM can't confirm serial (9ac5abe6)
- perf(boq): optimize import to avoid Cloudflare timeout (b149146b)
- feat(boq): add prefix code matching for stock items with variant suffixes (6d262328)
- feat(boq): add stock rematch API endpoint (a845991a)
- fix(boq): align fiber domain matcher prefixes with actual stock item codes (cf046cee)
- fix(boq): improve domain matcher for manholes, diameter tolerance, tangent parsing (b8eb1bf0)
- fix(boq): fix splitter model parsing and diameter tiebreaker (b788b296)

---

## [2026-02-11]

### 🔧 Chores
- chore: add module context docs and remove junk files (62d79011)

### 📦 Other Changes
- fix(sync): preserve QContact timestamps for SLA tracking (0cabeb1f)
- feat(sync): enable bidirectional QContact sync with status precedence (35da23cb)
- fix(sync): add RESOLVED status to enum and fix outbound QContact mapping (07ef775f)
- fix(sync): wrap PATCH body in {fields:{}} and use correct QC status values (e477de8c)
- fix(sync): skip terminal status tickets in outbound sync (2066bda0)
- feat(sync): real-time outbound QContact sync on every ticket change (3422b2f0)
- refactor(nav): rename Maintenance menu to NOC (8258a2cb)
- fix(chat): harden chatbot API with rate limiting and input validation (3faf6a6d)
- fix(logger): resolve apiLogger import warning in builds (1a7040b5)
- fix(build): hide nodemailer require from webpack static analysis (616e6118)
- fix(pipeline): align stat cards with EnhancedStatCard and fix dark mode contrast (63ed3bfa)
- fix(pipeline): remove max-w-7xl constraint to match other pages (14812a15)
- fix(sync): fallback to c__update field when QContact note creation returns 403 (ebae153f)
- fix(sync): use description field for QContact note fallback (f6e8f603)
- feat(pipeline): add file upload for legal documents (Lease/Cession) (c0f833d2)
- fix(pipeline): fix search-for-linking NOT IN query for Neon driver (464c611e)
- feat(pipeline): add file upload to document managers (b60a7a27)

---

## [2026-02-10]

### ✨ Features
- feat: Help Center & AI Chat Assistant (Phase 1 & 2) (becbd939)
- feat: Chat Assistant data lookups (Phase 3) with RBAC integration (00d09c43)

### 📝 Documentation
- docs: update contractors onboarding and staff module documentation (40e65c48)

### 🔧 Chores
- chore: add database pool migration scripts and update session metrics (2a5c4233)

### 📦 Other Changes
- refactor(pp-data): rename statuses to found/not-found/activated (3b71fb2a)
- feat(pp-data): switch 1Map lookup from bulk fetch to per-serial search (8a6a216c)
- feat(pp-data): add live progress tracking for 1Map serial search (635ea14e)
- fix(pp-data): auto-start polling when running lookup detected on mount (aa877c60)
- fix(pp-data): detect stale running lookups after server restart (cfc4babf)
- fix(pp-data): fix stale detection killing active lookups prematurely (1cfd56bf)
- feat(onemap): auto re-auth on session expiry + proactive refresh (b0158fca)
- fix(onemap): add 30s fetch timeouts to prevent hanging requests (55c9ceac)
- fix(onemap): reduce re-auth interval to 100 requests, add 45s per-serial timeout (47ca108b)
- fix(pp-data): use consistent key names in final tracker write (8fecf2a5)
- feat(pp-data): add 9 additional local DB sources to serial resolution (41a47574)
- feat(pp-data): add maintenance ticket creation from PP Data records (96f4f78c)
- fix(pp-data): pass created_by to ticket creation (NOT NULL constraint) (0526f1e6)
- fix(pp-data): add pp_data to tickets_source_check constraint (f383179a)
- docs(qfield): add infrastructure troubleshooting and incident learnings (bd2653f2)
- docs(qfield): add CSRF trusted origins fix to KB and module docs (cb40277e)
- feat(meetings): enhance attendee display and auto-sync from Fireflies (8adca11c)
- fix(meetings): use speakers data from Fireflies and fix Communications portal attendees (7cb79b87)
- fix(meetings): dark theme alignment for meeting detail modal (9e69e14f)
- feat(activate): add duplicate serial detection and improve mismatch warnings in DR ack (cb8d64c3)
- fix(meetings): add divider borders between meeting cards (5fc93758)
- fix(meetings): match participants by name for non-admin users (45466373)

---

## [2026-02-09]

### 🐛 Fixes
- fix: rename Master Service Agreement to Master Build Agreement (58492a93)

### 📝 Documentation
- docs: update module docs, knowledge base, and deployment info (0a7515fc)
- docs: update deployment KB and fleet camera permission docs (fc01d342)

### 📦 Other Changes
- fix(mobile): add responsive breakpoints across 28 files for mobile readiness (d2aa1566)
- fix(mobile): make module tabs scrollable and stack header on mobile (31f7d39b)
- fix(fleet): handle object error responses in portal session hook (30dfa1fa)
- fix(mobile): make data-sync tabs and nav scrollable on mobile (fb5ca56f)
- fix(fleet): correct rbacKey mismatch blocking Check-Ins tab access (b6e4477c)
- fix(reporting): switch all reporting endpoints from Pool to neon() HTTP (acefd3fc)
- fix(reporting): use singleton @/lib/db instead of @neondatabase/serverless Pool (6c8dd06c)
- fix(qfield-qa): fix AI validation logging and badge visibility (4b9114ba)
- fix(reporting): use direct res.json() for serial-swaps and serial-mismatches APIs (3d160d25)
- fix(reporting): fix SerialSwapReports icon props and optional chaining (0a747e4b)
- feat(qfield): add real-time photo validation API for QField plugin (9bbc50df)
- fix(reporting): add missing optional chaining across reporting components (8777d762)
- feat(qfield): add photo validation plugin for real-time AI feedback (4b190015)
- feat(contractors): add company verification system for onboarding (b4e89f17)
- fix(verification): resolve module initialization error on onboarding page (6efd35b9)
- fix(verification): move loadData before useEffect to fix TDZ error (07336aa2)
- fix(verification): improve VerificationPanel UI/UX alignment (2767b880)
- fix(verification): use FF design system CSS variables for dark theme (7eb640de)
- fix(fleet): improve camera permission error handling in vehicle portal (cb68f1ec)
- docs(kb): consolidate reporting audit learnings into module knowledge base (d0d1cf5d)
- feat(staff): simplify creation to name/email/phone with auto-generated employee ID (7cb81471)
- fix(onboarding): convert stage cards to dark theme design system (2c17de42)
- fix(onboarding): convert page wrapper and progress components to dark theme (32a0add4)
- fix(staff): use full page width for staff detail to match app layout (38046ba7)
- fix(contractors): use full page width and dark theme for detail/edit pages (b7c3b9ab)
- fix(ui): standardize back buttons across all modules with larger click target (a5a1ed81)
- feat(activate): add PP Data import and resolution for pre-provisioned ONTs (b1d5f703)
- fix(ui): convert modals and upload forms to FF dark theme (9c39f367)
- refactor(pp-data): auto-import PP DATA from OES import instead of separate upload (bae60e08)
- fix(onboarding): align stage documents with actual contractor workflow (6005cc44)
- feat(pp-data): add Excel export with project/status filters (203c6e53)
- fix(fleet): allow managers to view all check-in records (ccaa5e04)
- fix(onemap): add fallback credentials to createOneMapClient (37ed1985)
- fix(onemap): add CSRF token flow to OneMapClient.authenticate() (7e3b0940)
- fix(pp-data): increase 1Map page size to 500 and run lookup in background (0e306853)

---

## [2026-02-08]

### 📦 Other Changes
- fix(olt): increase 1Map timeout from 5s to 30s, reduce concurrency (b342dd9a)
- feat(qfield-qa): show pole numbers on photo cards (a4897538)
- fix(olt): detect duplicate UPS in cross-DR lookup for de-duplication (c2a13830)
- feat(qfield-qa): add photo-to-pole mapping script (b9272322)
- fix(olt): build photo entries from 1Map data instead of matching FF DB (485146ac)
- fix(olt): only flag status mismatch when NO prop_id has Installed status (101807aa)
- fix(olt): use source DR path in cross-DR photo URLs for proxy resolution (51ec0583)
- fix(qfield-qa): correct project filtering to use qfield_project_id lookup (3cf14237)
- feat(olt): add date filters for stats cards and fix history (308ca624)
- feat(olt): add clickable status filter on stats cards for history (d63c544a)
- feat(olt): add sub-status filter on Investigate tab (02d45669)
- fix(security): SQL injection, rate limiting, magic byte validation, and export bug (11b651bd)
- fix(olt): server-side investigate sub-filter with separate useEffect (118508ce)
- feat(olt): displaced ONT tracking and fixable tab warnings (7432d499)
- feat(olt): smart displaced badges + reporting section (4ed2178a)
- refactor(olt): reporting tab sub-tabs for Records/Imports/Displaced (62f3fec4)
- feat(olt): CSV export for all reporting sub-tabs (14b5bf03)
- feat(nav): enable FIELD OPERATIONS section with QField QA link (aa7de6d1)
- feat(nav): show only QField QA in FIELD OPERATIONS section (10d467fe)
- fix(olt): use pool.query instead of pool.connect for reporting APIs (035e0d91)
- refactor(db): consolidate 68 files to use singleton Pool from src/lib/db (11bdcf6c)
- fix(db): add missing singleton pool file and fix path alias ordering (adce791e)
- fix(olt): reporting tables column widths to prevent horizontal scroll (2666e678)
- feat(qfield-qa): implement VLM validation for Run AI button (1f32b779)
- fix(fleet): prevent VLM re-processing from overwriting user fuel corrections (622516a3)
- feat(qfield-qa): integrate HITL corrections with VLM learning system (bbdc454a)
- feat(qfield-qa): enhance bulk actions with loading states and confirmation (9fd82d71)
- fix(build): correct neon sql imports and remove unused lint directive (cd6bf25e)
- feat(qfield-qa): add bulk assignment UI with due dates and priorities (7c6d57a4)
- feat(qfield-qa): add WhatsApp notifications for rejections and escalations (ec0366fb)
- perf: optimize slow pages and fix broken endpoints (1ca6dd07)
- fix(qfield-qa): dark theme + improved revalidate flow for photo modal (84f0620e)
- debug: add verbose error to discrepancy endpoint (d21e6c47)
- debug: serialize non-Error object in discrepancy endpoint (3705f297)
- debug: extract non-enumerable error props in discrepancy (19d21cc2)
- fix(discrepancy): switch from Pool to neon() to fix socket hang up (ca1448bd)
- fix(qfield-qa): improve UI/UX for photo detail modal (4d1b20c8)
- fix(qfield-qa): use staff list for assignment dropdown (2d8a7dc6)
- fix(qfield-qa): add background batch processing for bulk AI validation (f635b59c)
- fix(qfield-qa): add detailed logging for validation debugging (be1452ad)

---

## [2026-02-07]

### 🐛 Fixes
- fix: handle unknown photo_source values in PhotoGalleryUnified (a1b8dcb7)
- fix: restore deploy commands with credentials in CLAUDE.md (70bdd013)

### 📝 Documentation
- docs: add QField photo resizer knowledge base (57f8fbc8)
- docs: update KB with technician stats documentation (e82d62c7)

### 🔧 Chores
- chore: update session tracking (ccfd2f38)

### 📦 Other Changes
- fix(fleet): use refs for mobile camera input reliability (75845afa)
- fix(fleet): improve receipt scan error logging for debugging (1fe55a7f)
- fix(fleet): increase body size limit for receipt photo scanning (cd7f0150)
- fix(fleet): always calculate price/L from amount/litres (5ac7fce2)
- feat(fleet): add admin delete for fuel transactions, fix L/100km calc (d4559f8b)
- feat(fleet): add delete button for fuel transactions (admin only) (add794b8)
- feat(fleet): recalculate L/100km after fuel transaction delete (ca3e4cac)
- feat(technicians): add WhatsApp push name import script (045860e1)
- feat(olt): automate mismatch detection from OES import data (7e63ccef)
- feat(technicians): differentiate installer vs activator stats (829a1631)
- fix(fleet): use odometer history as single source of truth for stats (cf39adac)
- fix(technicians): use oes_confirmed instead of is_activated (8945edb7)
- fix(olt): call auto-detect service directly instead of via HTTP (0160248f)
- fix(technicians): use correct step column names from schema (72ab3c8f)
- fix(technicians): correct step column names for installer performance (4b3d3c96)
- fix(navigation): correct active tab detection for nested routes (2ed488fd)
- feat(technicians): add dB signal quality metrics for installers (3a498461)
- feat(fleet): add fuel level sync when adding fuel transactions (50708e39)
- fix(olt): deduplicate onemap_properties JOIN and fix run tracking (e67ee2b4)
- feat(technicians): add flexible date range filters (4b9990ce)
- fix(olt): treat empty ONT barcode as cache miss, queue for API lookup (96068538)
- fix(olt): replace HTTP queue trigger with direct service call (8106fc05)
- feat(fleet): add tank level field to portal fuel fill-up form (d2986151)
- fix(olt): check ALL 1Map records per DR, handle ONT/UPS swaps (6fa6d501)
- feat(fleet): add fuel gauge photo scanning to portal (7172ee8a)
- fix(olt): correct multi-record classification logic (1d6ce053)
- fix(fleet): show 'Fuel' source badge for fuel_transaction entries (3c732141)
- feat(olt): add toast notification, progress counter, and skip-already-verified optimization (8dea3b4e)
- feat(olt): add visible progress banner and fix duplicate queue prevention (8dba90f2)
- fix(olt): status endpoint prioritizes active processing run over latest (37e0938a)
- fix(olt): improve status endpoint prioritization (9d6578ef)
- fix(olt): show live match/mismatch counts in progress banner (b2eb1e59)
- fix(olt): don't count cache misses as confirmed not-found (62e91e12)
- feat(olt): detect cross-DR conflicts and show investigation context (ec3b62b2)
- feat(olt): make investigation context cards collapsible (3f23040d)
- perf(olt): parallelize queue processor with 5 concurrent 1Map API calls (97cf7069)
- feat(olt): add internal API key bypass for queue processor trigger (5f46c1aa)
- fix(olt): reduce concurrency to 3, add error retry in queue processor (7f37e079)
- fix(security): comprehensive security hardening from code review (ef99259a)
- feat(olt): add cross-DR conflict swap feature (e89f04b2)
- feat(qfield): add AI photo validation with VLM integration (4de415ab)
- feat(olt): add DR Review links to cross-DR swap comparison card (25714585)
- feat(olt): add 1Map + DR Review links per DR in swap card (3bf338b0)
- feat(qfield): add QField QA photo validation dashboard (cab75814)
- fix(security): second round of security hardening from audit (fe39c0de)
- feat(olt): add UPS transfer UI + auto photo re-sync after swap fix (fe6445b0)
- fix(qfield): use sql.query for dynamic queries in qa-validations (dd121bd7)
- fix(olt): find correct record for UPS serial in cross-DR lookup (cd71049f)
- fix(security): tier 2 security hardening (b39ac433)
- fix(olt): update swap UI to reflect UPS transfer + sync DR B photos (62418626)
- refactor(qfield-qa): align UI with FibreFlow patterns (01088863)
- fix(olt): search ALL prop records for UPS serial, not just wrong-serial record (53e812a4)
- fix(olt): clear UPS from DR A after transferring to DR B (357039b6)
- fix(olt): restructure UPS transfer to always clear DR A even if DR B already has it (1d1c947b)
- fix(security): medium findings - sql-helpers allowlists, health info leak, upload validation (8c40f4f9)
- fix(security): remove hardcoded credentials from scripts and docs (bb13952e)
- fix(qfield): add MinIO authentication to photo-proxy API (d1b4eaff)
- fix(security): remove wildcard CORS, hardcoded DB cred, and SSRF risk (f926cec9)
- fix(security): critical SQL injection, wildcard CORS, credential cleanup (216c09bf)
- feat(olt): cross-DR swap, photo copy, status mismatch detection (333a238f)
- fix(olt): swap Recent Fixes above Import History on History tab (ab3234c7)
- feat(qfield): add photo import script for QField QA (a927e7e5)
- fix(security): add CSP header, magic byte validation, replace console.log with logger (2d6c206c)

---

## [2026-02-06]

### 📝 Documentation
- docs: update fleet module KB with check-in improvements (3b341fc3)

### 📦 Other Changes
- feat(fleet): add admin delete for check-in records (1b77698e)
- fix(fleet): admin role check and access control (7ee06dec)
- fix(fleet): persist fuel level from check-in to database (214b38af)
- feat(fleet): display fuel level in check-in history (7f9172ea)
- fix(fleet): add credentials to portal fuel fill-up fetch calls (5da3a8ff)
- fix(fleet): use flat category for fuel receipt uploads (b186410a)
- feat(fleet): add odometer photo capture with VLM extraction to Fuel Fill-up (8af31926)
- feat(fleet): add offline support Phase 1 - Service Worker & IndexedDB (971e8ab9)
- feat(fleet): add offline data capture Phase 2 - GPS & offline submission (bfd37684)
- feat(fleet): add offline sync engine Phase 3 - automatic data synchronization (d092101d)

---

## [2026-02-05]

### 🐛 Fixes
- fix: correct FiberTimeQContactClient import casing (de0f7ed6)
- fix: remove dynamic import for ProjectDetail to fix loading issue (dceb44ef)
- fix: use dynamic imports for Neon to prevent client bundling (125c9a84)
- fix: make projectCrud client-only to prevent Neon bundling (237b8b8d)
- fix: use direct import for FinanceDashboardTab to avoid Neon bundling (1fc9c72a)
- fix: align zone/PON counts with project totals in activate stats (5caeaa7d)
- fix: show all contractors and default new ones to active (06391c18)

### 📝 Documentation
- docs: add WA monitor troubleshooting and Docker health check patterns (3f4740aa)
- docs: add zone/PON stats alignment learning to memory and activate module (d54c6a1f)
- docs: add contractors module knowledge base and session learnings (4bdfdcf1)

### 📦 Other Changes
- fix(contractors): add cache revalidation, suspend/delete separation (cdd6b164)
- fix(contractors): add credentials to fetch calls for auth (142216e0)
- fix(contractors): force no-cache on contractors page (a0d0ef6e)
- fix(contractors): use flat update endpoint for edit form (455ba6cc)
- fix(contractors): add force-dynamic to detail and edit pages (ec4811f0)
- feat(activate): add wa_contacts table for technician name mapping (bd68db35)
- feat(activate): add installer sync from 1Map and installer leaderboard (dbd1f940)
- fix(fleet): resolve mobile photo capture issues (c5017444)
- fix(fleet): add debug toasts and simplify photo capture flow (95c49463)
- fix(fleet): remove debug toasts, keep GPS-free photo capture (f25adf1b)
- fix(fleet): mark check-ins with low VLM confidence as needing review (fe2c95f8)
- fix(technicians): use user_name for stats join and handle API response wrapper (3582219d)
- fix(technicians): update performance API to use wa_contacts table (1fba096d)
- refactor(technicians): match DrSummaryPage UI style (a4ad5638)
- feat(technicians): add edit modal to technician directory (95a76fb3)
- refactor(fleet): merge check-in audit into history page (f5407cd4)

---

## [2026-02-04]

### 🐛 Fixes
- fix: improve error logging in quote-evaluations (903dce50)
- fix: normalize storage URLs to include /storage/ proxy path (252d40f6)

### 📝 Documentation
- docs: update fleet module and infrastructure documentation (c37351e1)
- docs: add learning about demo data fallback anti-pattern (1ef55219)

### 📦 Other Changes
- feat(fleet): add withFleetAuth for portal session support (8690160d)
- fix(fleet): update vehicles API to use withFleetAuth (b5158359)
- fix(projects): URL tab aliases and date format in edit form (cd8c41f5)
- fix(fleet): complete portal auth for all check-in APIs (27c268e8)
- fix(wayleaves): correct pipeline navigation URLs (2d9d7333)
- feat(fleet): add GPS coordinate capture when taking check-in photos (b377e1fb)
- docs(kb): update learnings from E2E audit (19db4c81)
- fix(fleet): ensure odometer history persistence and HITL correction tracking (954bb3a7)
- feat(fleet): add check-in history to nav and photos to audit page (0278899e)
- fix(fleet): add error logging for photo upload failures (a3ca90e0)
- fix(fleet): add dataUrl to File fallback for photo uploads (0a740868)
- feat(vlm): enterprise-wide VLM learning system with HITL corrections (51a0d17d)
- feat(vlm): add VLM Learning to system navigation (1a509b23)
- chore(nav): hide xyOps, Grafana, Downloads, Imports from system menu (fde18d12)
- feat(fleet): add Photos tab and enhance vehicle photo display (1db82906)
- fix(fleet): fix photo upload to VF Storage with proper form-data handling (11a86e60)
- fix(fleet): use axios for photo upload to fix form-data compatibility (8d90d70c)
- fix(fleet): correct photo URLs to use /storage/ prefix for nginx proxy (eadf08f7)
- feat(ux): add skeleton loaders for project detail page (102cd7a5)
- fix(fleet): add license disc data to all vehicle list query branches (f74b5c1d)
- fix(portfolio): handle missing hs_incidents/hs_audits tables gracefully (53b4e7eb)
- fix(procurement): replace react-router-dom with next/router in QuoteEvaluationPage (44f81a4f)
- fix(portfolio): use correct H&S table names (hs_ticket_details, hs_project_audits) (3d522037)
- fix(procurement): replace conditional SQL fragments in quote-evaluations API (268b4193)
- fix(procurement): fix UUID comparison in quote-evaluations API (1d9b9a25)
- fix(staff): remove silent fallback to demo data on API failure (c19f968d)
- fix(procurement): use correct column name total_amount in quote-evaluations (f001bb28)
- docs(fleet): update KB with vehicles API query branches and license disc fix (6cbe2993)
- temp: add test-db API for debugging (cfed1d74)
- temp: test quote-evaluations query (0a0a3d5a)
- temp: check quotes table columns (4e76dbf0)
- fix(procurement): use total_value column (production schema) (650b6ff9)
- temp: check rfqs columns (216d54e7)
- fix(procurement): use correct column response_deadline in quote-evaluations (03a72052)
- fix(procurement): prevent division by zero in QuoteEvaluationPage (573043a0)
- temp: simplify QuoteEvaluationPage for debugging (1e8c52f2)
- feat(procurement): integrate VLM learning with PO extraction (1d2a7670)

---

## [2026-02-03]

### 📝 Documentation
- docs: add modal structure and Neon array patterns to KB (bb36a124)
- docs: update KB with dark theme semi-transparent color patterns (c4f408c0)

### 📦 Other Changes
- fix(tabs): use CSS grid for guaranteed full-width equal tabs (0c383143)
- fix(project-detail): remove max-width constraint for full-width layout (2fe27fac)
- fix(module-page): remove padding from tabs container for edge-to-edge tabs (6751ca89)
- feat(wayleaves): add multi-pipeline project linking (6e292a6a)
- fix(tabs): use Tailwind grid-cols classes instead of inline style for consistency (bdb4cc2b)
- feat(pipeline): add link to existing project from pipeline (4f3eb2ab)
- fix(tabs): add px-6 padding for consistent alignment with header and content (0a3c376d)
- fix(rbac): correct permission key format in navigation configs (e6e13c7f)
- fix(api): use company_name instead of name in clients join (245c1395)
- test: remove tabs padding for edge-to-edge testing (8d142f35)
- fix(tabs): add consistent px-6 padding to ModulePage tabs and ProjectTabs (0da3f17a)
- fix(api): use staff ID for linked_by in pipeline-links (b0ed23e0)
- fix(project-detail): add px-6 padding to outer wrapper for consistent alignment (910194de)
- fix(tabs): revert to flex layout for single-row tab display (0c753b63)
- fix(layout): hide AppLayout header on project detail pages (9d82a01e)
- fix(pipeline): fix Link Pipeline modal errors (6e559e06)
- fix(ui): darken modal backdrops to prevent bleed-through (0c898223)
- fix(modals): increase backdrop opacity to 85% for better visual separation (6bc31739)
- fix(pipeline): remove double padding from PipelineDashboard (6d2d4835)
- fix(modals): use fully opaque backdrop to hide background content (6640bc10)
- fix(modals): use standard bg-black/50 backdrop like other app modals (6b0a0906)
- fix(security): add participant check to action-items extract endpoint (338de30d)
- fix(modals): use standard modal structure matching DocumentVerificationModal (dd07b8cf)
- fix(api): use ANY() instead of sql() for array handling in Neon (ddf4930b)
- fix(contractors): apply dark theme styling to detail page (8e3957e8)
- docs(kb): add deployment directory gotcha and meetings access control patterns (fa60417f)
- feat(sow): add download template button to SOW upload cards (7122213a)
- feat(sow): add PlanNet/Fibertime column alias support for drops import (33035866)
- fix(sow): handle trailing whitespace in Excel column names (d6221ae3)
- fix(portal): prevent client-side neon() bundling in fleet portal (b6be8d43)
- docs(kb): add barrel export server code bundling gotcha (2bb70b04)
- fix(sow): use individual inserts for drops batch upload (9007a02a)
- fix(sow): use ALTER TABLE to add missing columns for drops import (e25dd516)
- fix(portal): exclude fleet portal from RBAC auth redirects (09b21066)
- perf(sow): use UNNEST for bulk drops insert (1000x faster) (7f30aedd)
- fix(portal): remove upload from gallery option for plate capture (15315a02)
- fix(sow): only clear existing drops on first chunk (b2f0ae04)
- fix(sow): optimize poles API with UNNEST bulk insert and chunked uploads (f9c34452)
- fix(sow): add missing column migrations for poles table (f5685853)
- fix(sow): parse height/diameter as numeric for poles table (3e881e6b)
- fix(sow): deduplicate poles before insert to handle multi-DR files (8c4c67de)

---

## [2026-02-02]

### 📝 Documentation
- docs: add lint cleanup learnings and React hooks patterns (a9732647)
- docs: update knowledge base with conditional SQL anti-pattern and /access skill (8fa27004)
- docs: update fleet module, learnings, and storage architecture (d6e4b9b1)

### 📦 Other Changes
- fix(data-sync): auto-complete stale QField sync operations (0ff43de4)
- fix(clients): add missing AppLayout to detail and edit pages (559170e7)
- fix(clients): dark mode styling for client form (719e1a76)
- fix(clients): fix projects API query column names (491c07ce)
- fix(clients): use correct progress column name (65f9a5fa)
- fix(clients): cast project_manager to text to avoid UUID coalesce error (9d3fb7b2)
- fix(clients): remove non-existent outstanding_balance column query (943a2cd7)
- fix(clients): fix formatCurrency import path (9c7d7609)
- fix(clients): multiple UI and API fixes for client module (837f6eae)
- fix(clients): remove non-existent priority column from summary query (99e04102)
- fix(clients): use API endpoint for client summary instead of local calculation (92f6ca4e)
- feat(meetings): add participant-based access control (a7952583)
- feat(meetings): add super_admin override for access control (7600448d)
- feat(communications): merge meetings module into communications portal (0d6e897c)
- feat(projects): add Client PO activation requirements and finance module (e57a6c4d)
- feat(access-control): improve search and filter UX (d9c366ae)
- fix(finance): correctly access API response data in dashboard (b1d207a9)
- fix(projects): case-insensitive status check for activation blockers (e4525346)
- fix(access-control): increase search debounce to 500ms (807ceded)
- fix(activation): case-insensitive status check in ActivationBlockersCard (45acccaf)
- fix(income): correctly access API response data wrapper (6ad7a1e8)
- feat(activation): add seed requirements button and API (4e262163)
- fix(access-control): use client-side filtering for instant search (9802e1b0)
- feat(client-po): add PDF import via VLM and project documents (e4e9ad08)
- feat(project): add Documents tab for centralized file uploads (27a41cea)
- fix(documents): improve error message handling in upload (33fe80ab)
- fix(documents): use procurement storage path for project documents (86d74129)
- fix(documents): use flat folder structure for VF Storage (33d2224f)
- fix(documents): rewrite GET query to avoid conditional SQL fragments (c03953e8)
- fix(client-pos): avoid empty sql fragments in conditional query (c8008420)
- fix(client-po): add solid background to PDF drop zone (f4de091f)
- fix(client-po): use correct CSS variable --ff-bg-card (d73e430e)
- fix(client-po): correctly unwrap API response for PDF extraction (b30c8b2c)
- feat(system): add granular access control for System Data Sync module (794e8c23)
- feat(client-po): show VAT breakdown in create modal (3b66dd08)
- feat(staff): add granular per-tab access control (7a58dc0f)
- fix(documents-tab): correct CSS variable name for card background (18414071)
- fix(api): use company_name instead of name for clients table (754ea249)
- docs(kb): add access-control module documentation (590f1613)
- fix(data-sync): use RBAC permission check instead of legacy (5358f1e4)
- fix(api): use project_name instead of name for projects table (a2b92116)
- fix(data-sync): show loading spinner instead of all groups while checking permissions (4d073074)
- feat(finance): show actual OES activations in income dashboard (33227e9f)
- feat(data-sync): add tab-level permission filtering to OLT Report (62922331)
- fix(sow): query main tables instead of sow_* tables (6723e9fc)
- fix(sow): rewrite /api/sow endpoint to return actual SOW data (2baaa4a1)
- feat(data-sync): add tab-level permission filtering to all groups (43149bb1)
- fix(client-pos): use live activation count from oes_activations (7ce7fbec)
- debug: add logging to client-pos API (4e21a624)
- debug: add _debug to response (1201f5c7)
- fix(sow): use correct column names in SOW API queries (07b68cc9)
- fix(documents): show summary counts instead of array lengths for SOW data (35203b33)
- feat(fleet): enhance license disc modal with full OCR verification (d53ee9b6)
- fix(fleet): use flat category path for license disc uploads (d8bbc0de)
- feat(overview): enhance project overview tab with KPI cards and workflow checklist (PRD-058) (5f3f5f6e)
- fix(fleet): show expiry date instead of issue date in license disc card (74188db6)
- fix(projects): fix requirements API and budget endpoint (592d15fd)
- refactor(fleet): reorder tabs - vehicles first, then drivers (03723d95)
- fix(sow): correct data source display and counts in SOW tab (ac325c09)
- fix(api): use correct photo column name in drivers-documents (d7acddd0)
- fix(storage): return HTTPS URLs for browser access (f616662a)
- fix(storage): ensure all storage services return HTTPS URLs (e6be7c6e)
- fix(fleet): default to active vehicles and show filtered count (dec9878c)
- fix(sow): dark mode UI + correct statistics calculations (5e203d05)
- fix(overview): show actual progress from activations data (e2ed274f)
- fix(sow): dark mode UI fixes for summary cards, statistics, and tabs (ab0f6d2b)
- feat(project-detail): add wayleaves tab and enhanced H&S integration (060bb950)
- fix(projects): improve portfolio dashboard calculations and UI (2b1554a8)
- fix(projects): improve progress display with '<1%' for low progress (078cdb79)
- fix(nav): make module tabs use full width with even distribution (47d4a4d8)
- fix(tabs): make project detail tabs use full width (10bfdd5e)
- docs(manual): update user manual v1.1 with new screenshots (33a55f81)
- fix(tabs): use CSS grid for guaranteed equal-width tab distribution (8498a857)
- fix(tabs): use flex-1 basis-0 for consistent equal-width tabs (255dc30a)

---

## [2026-02-01]

### ✨ Features
- feat: show project names instead of count in staff directory (20cab3d3)

### 🐛 Fixes
- fix: Format project location JSON as readable string on dashboard (2b9de638)
- fix: sync current_project_count when staff assignments change (f4fc1fb3)

### 📝 Documentation
- docs: add user manual generation learnings and KB (e29e1ca6)

### 📦 Other Changes
- feat(staff): add access control for sensitive data and sortable columns (f2df5cbe)
- fix(staff): add employeeId and currentProjectCount aliases to list queries (104039bc)
- feat(kpi-dashboard): Add enhanced KPI dashboard with real charts (ec5a4bdb)
- feat(staff): Add Performance tab with field technician metrics (e8c6ed5d)
- feat(activate): Add Technician Directory for field techs (00ecfa03)
- fix(kpi-dashboard): Remove placeholder stat cards (986eb5fe)
- fix(ui): Global UI/UX audit - Title Case headers, opacity badges, client detail fixes (7515fb28)

---

## [2026-01-31]

### 🐛 Fixes
- fix: remove auth-mock from all production code, fix procurement auth (9a25d462)

### 📝 Documentation
- docs: add performance optimization learnings and KB article (a9353048)
- docs: document WA group type business terminology (2f33be90)
- docs: update KB, learnings, and skills for bridge + maintenance fixes (be85a353)
- docs: add OLT mismatch report for week ending 30 Jan 2026 (e44d6a35)

### 📦 Other Changes
- feat(boq): enhance detail page with edit, Excel export, hide zeros, versions (45fc251a)
- feat(boq): add edit history tracking with user attribution (aa084ea7)
- fix(boq): resolve 7 dark mode contrast/visibility issues (34e08d6b)
- fix(boq): dark mode contrast for upload Config and Progress components (2f25f098)
- fix(projects): improve detail page layout and UX (b7a217d9)
- fix(boq): show progress spinner during enhanced import (ba983695)
- perf: parallelize API queries and fix next.config.js loading (7a775992)
- perf(h&s): parallelize 12 sequential DB queries into 2 batches (f2de1714)
- feat(procurement): 3-level stock item matching for BOQ imports (dc3b4c5a)
- fix(olt-report): unwrap apiResponse envelope for import result (b26a28fd)
- perf(system): parallelize 9 sequential DB queries in stats API (fca9bdaf)
- fix(build): add custom 500 page to fix server build failure (060ef551)
- fix(data-sync): correct column names in overview stats queries (a24653ac)
- fix(olt-report): redesign import tab UI with drag-and-drop (92aaff50)
- fix(olt-report): fix loop bug, add per-record errors, fix history (bdda51a4)
- feat(olt-report): log serial changes to serial_change_history (a5149866)
- fix(olt-report): update ALL 1Map prop_ids for a DR, not just best match (13748be6)
- feat(procurement): fiber domain matcher for BOQ auto-matching (74%) (5b3a76a5)
- fix(olt-report): update DR Review summary serial when fixing 1Map (5e5eddbe)
- fix(activate): prevent false resubmission detection in dr-acknowledgment (841531b5)
- docs(kb): update race condition KB with commit reference 841531b5 (70f8ece4)
- docs(learnings): add false resubmission detection fix entry (a0b757f6)
- feat(activate): pre-compute serial verification badges (6a153226)
- fix(olt-report): prevent React error #31 on API error responses (b5589166)
- fix(activate): convert process-new-dr INSERTs to UPSERTs (147 bridge 500s) (05aac8a8)
- fix(olt-report): batch bulk fix to avoid Cloudflare 524 timeout (8a675e96)
- fix(maintenance): replace withAuth with bridge secret for WA message endpoint (b58ee477)
- fix(activate): show full serial numbers in Serial History tab (7f643169)
- fix(vlm): prevent serial hallucination from prompt examples (98be2884)
- docs(manual): add comprehensive FibreFlow user manual (f0fbadc2)

---

## [2026-01-30]

### 📝 Documentation
- docs: add serial audit KB and update learnings/activate module (0ae42b15)
- docs: update learnings and procurement KB with RBAC and API details (2c1f3dbf)
- docs: add VLM bulk processing learnings and KB playbook (f597d44c)
- docs: add DR acknowledgment race condition learnings and KB (7e5d3fd7)
- docs: add deployment window straggler lesson (DR1735961) (39e71a60)
- docs: add typo DR filtering, self-healing, and reconciliation learnings (ff8df585)

### 📦 Other Changes
- fix(oes-import): prevent 524 timeout by making QField sync fire-and-forget (d7c10fe7)
- docs(learnings): add QFieldCloud Docker image self-healing fix (2d006fd9)
- feat(procurement): eliminate all mock data, wire real APIs and RBAC (2db4f38d)
- docs(learnings): add serial audit findings - 61 unresolved DRs (58bad987)
- fix(activate): resolve [object Object] error and null project on send-feedback (f0d00668)
- fix(activate): replace "Unknown" with dash for DRs without sender phone (80c84f6b)
- feat(procurement): add BOQ column detection and mapping for imports (85b57a8c)
- fix(activate): resolve sender_phone from wa_monitor_drops in pipeline (2ee62790)
- fix(activate): prevent false resubmission classification (d68b12d4)
- fix(navigation): remove Pipeline and H&S from sidebar — now tabs (6a97f8b0)
- fix(activate): fix date display and missing submitted_date in QA Centre (bb74ba64)
- fix(activate): add project and sender_phone to all process-new-dr paths (37e97952)
- fix(activate): prevent row duplication from LEFT JOINs in drops query (b3e9cdf3)
- fix(activate): prevent false resubmission when dr-acknowledgment creates record first (cf8beb04)
- fix(activate): exclude phantom dr-acknowledgment records from installed count (d11c27d8)
- Revert "fix(activate): exclude phantom dr-acknowledgment records from installed count" (531217b4)
- fix(activate): self-healing backfill for orphaned dr-acknowledgment records (7f1383d2)
- fix(boq): use explicit projectId prop instead of requiring context (70584913)
- revert(activate): remove backfillOrphanedRecords - caused incomplete data display (6ef2eb12)
- fix(boq): use log.info/error/warn instead of log() function calls (9d927321)
- fix(activate): self-healing fetch photos from BOSS for orphaned DRs (13c11713)
- fix(boq): pass projectId prop to BOQUpload in create page (17a8fdcf)
- fix(activate): exclude typo/invalid DRs from QA Centre list (d95ea2b7)
- fix(boq): use correct column names in boqImportEnhanced createBoq (8cc0440b)
- fix(boq): include required version column in createBoq INSERT (5116cb2d)
- fix(boq): align createBoqItem with actual boq_items schema (6103f419)
- fix(boq): auto-increment version to avoid unique constraint violation (de977e6a)
- fix(boq): resolve 6 UI/UX issues from E2E audit (6a57712d)

---

## [2026-01-29]

### 📝 Documentation
- docs: update learnings and staff module KB (aa9aa3ff)

### 🔧 Chores
- chore: accumulated updates across modules, docs, and infrastructure (c361925e)
- chore: disable all Vercel crons (no longer using Vercel) (3445dc5e)

### 📦 Other Changes
- fix(quote-scanner): simplify supplier matching - use substring match (21705770)
- fix(quote-scanner): correct column name stock_item_code → item_code (8504a535)
- fix(procurement): reorder tabs - Requisitions before Quotes, restore Approvals (d779cbdd)
- perf(vlm-queue): parallelize DR processing for 4-6x throughput (3a6ef4ea)
- feat(settings): add Procurement Settings tab with approval workflow management (9affb0d2)
- perf(vlm-queue): also process extraction-only DRs, prioritize them (58505a42)
- feat(rbac): batch permission editing and role template creation (054f6e7d)
- fix(middleware): handle Edge Runtime missing process.stdout/stderr (5046ef5b)
- fix(data-sync): use neon() directly for dynamic UNION query (1685b50f)
- debug: add detailed error logging to history API (f90c92ee)
- fix(data-sync): use neon sql.query() for dynamic SQL string (2cacc47c)
- fix(data-sync): clean up debug output from history API (cf2eefcc)
- fix(vlm-queue): stop infinite reprocessing of DRs without step 6/7/9 photos (0ec60a22)
- fix(staff): replace snake_case display with Title Case across all components (4841d115)
- fix(staff): apply formatLabel to staff directory page (pages/staff/index.tsx) (89578506)
- fix(staff): hide Next of Kin section and sync SA ID number fields (264dc4b4)
- Revert "chore: disable all Vercel crons (no longer using Vercel)" (57f61bcf)
- fix(staff): align department-position dropdowns and fix persistence (617562af)
- fix(staff): add DB department name aliases for position mapping (ec96c7e0)
- fix(staff): use is_active instead of deleted_at for department lookup (67385961)
- feat(activate): warn when DR submitted but not yet in 1Map (03d65a65)
- docs(kb): fix bridge API field name - recipient_jid not mention_jid (e4683277)
- fix(activate): capture ONT/UPS serials even when photos empty (73200839)
- feat(activate): serial swap detection in OES import + serial capture fixes (ffeaa199)

---

## [2026-01-28]

### 📝 Documentation
- docs: add API wrong export gotcha to learnings and KB (e47558c2)
- docs: update learnings and KB for OES sync changes (6d9288ce)
- docs: add compliance bug learning and staff-compliance KB (99bb57cb)
- docs: add WA bridge health check learning and KB update (b2d0fd6e)
- docs: add asset purchase price validation learning (99c8d6a6)
- docs: add auth UX learnings and toast notification patterns (bb4305cd)
- docs: add contract type persistence and dynamic labels to KB (a05b6727)
- docs: add QField OES coordinate source learning (bc09aeda)
- docs: add enhanced barcode service to learnings and KB (42ca743b)
- docs: add E2E project lifecycle user manual (6ee7b6ff)
- docs: add reporting patterns learnings and knowledge base (ca121664)
- docs: add VS Code OOM fix and Access Control UX learnings (0e9b329c)

### 📦 Other Changes
- fix(ocr): export handler instead of detectImageOrientation (4af1d20b)
- fix(qfield): change OES filename format to DD-MM-YYYY (042d01be)
- fix(compliance): add Employment Contract/IC Agreement to required documents check (ada54839)
- fix(qfield): use OES import report_date for filename (16b3ba95)
- docs(kb): add PO approval workflow documentation (ba1e381b)
- fix(auth): improve session timeout UX and login page footer (fe171f52)
- fix(staff): map legacy contract types for persistence (d8d0ded5)
- fix(staff): dynamic compliance labels based on Employee vs IC (b51e34d7)
- feat(oes-sync): add dual coordinates and point_type for QField filtering (ff74a338)
- fix(qfield): use drops table as source of truth for OES coordinates (64ac7c12)
- fix(assets): allow zero purchase price for donated assets (72a1a6ba)
- feat(assets): add VLM label scanning for asset extraction and verification (61f9697b)
- feat(qfield): add remaining drops layer to OES sync (cae1a75d)
- fix(ui): simplify main app footer to match login page style (fccf8e0f)
- feat(assets): add GRN → Asset registration workflow (Sprint 2) (c9eedbc0)
- feat(barcode): add enhanced barcode service with 2D support (ce34c8a6)
- feat(barcode): add Phase 2 advanced preprocessing strategies (694c6076)
- feat(assets): add Odoo asset sync with fleet ownership filter (46ca2523)
- fix(ui): make footer single line layout (5f3e657f)
- docs(learnings): document QField dual-layer OES sync system (e6a070a1)
- fix(assets): remove non-existent columns from GRN registration query (dfc352a1)
- fix(assets): remove supplier_id from GRN registration INSERT (9781e7b5)
- fix(assets): generate asset_number during GRN registration (98eca15f)
- feat(activate): add Activation Progress report (a6d9a4d6)
- feat(staff): add departments management feature (5fa49b1f)
- fix(migration): use sql.query() for dynamic SQL in migration 137 (18e71232)
- fix(activate): filter activation progress report to active projects only (089c3569)
- fix(activate): exclude zone/pon = 0 from activation progress report (dbad9d35)
- fix(departments): convert count strings to numbers for stats calculation (3ffb2991)
- fix(departments): use correct table name staff_projects (2ad24be0)
- feat(activate): add Hide Zero toggle for activation progress report (7562c3c6)
- fix(departments): handle null report state gracefully (478931bf)
- fix(activate): Hide Zero toggle now also hides zones/PONs with 0 activations (cd424479)
- fix(staff): load departments from database instead of hardcoded enum (46d1a4bb)
- fix(staff): set department_id FK when department name is updated (a9cf9d36)
- feat(settings): improve Access Control UX with better search and toggles (4cad3d16)
- fix(activate): support project name filtering in activation progress API (aa696ca3)
- fix(assets): add revalidatePath to update dashboard counts after mutations (b97d52ad)
- fix(activate): use full summary stats, not filtered totals (18103716)
- fix(activate): count ALL OES activations for progress, not just date range (fc8e57b0)
- fix(activate): update progress bar color thresholds (bdf7c9ec)
- fix(reports): fix timezone bugs in quick date filters (c424bb3e)
- feat(projects): complete Projects module restructure (522ffd63)
- feat(activate): add Maturity Tracking report (a4cbffc3)
- feat(activate): add avg days to 25%, 50%, 75% milestones in maturity report (c04ff20b)
- fix(reporting): exclude invalid DRs from daily counts and trend analysis (a8cae39f)
- fix(reporting): remove non-existent d.project_name column references (9e0ce79e)
- feat(procurement): add OCR Quote Scanner for RFQ workflow (ccf96920)
- fix(quote-scanner): prevent modal reset during extraction (c2095698)
- feat(quote-scanner): add Create Quote button to save extraction to RFQ (9d332564)
- fix(quote-scanner): auto-create quote after successful extraction (f8cad141)
- fix(rfq): fetch RFQs from API instead of hardcoded empty array (c309fe9c)
- fix(quotes): fix quote creation and display in RFQ (49c9cc5d)
- fix(quotes): add created_by field when creating supplier from quote scan (b6323a8a)
- feat(procurement): add clickable quote details in RFQ page (3859c774)
- feat(quote-scanner): add review step before creating quote (3740003d)
- fix(quote-scanner): add supplier selection and review step (68aec0b9)
- fix(quote-scanner): add null safety for result.extraction (7bcce294)
- fix(quote-scanner): access nested data from API response wrapper (5d857471)
- fix(quote-scanner): fix supplier matching from API response (686f4c31)

---

## [2026-01-27]

### 📝 Documentation
- docs: add Next.js route resolution gotcha to KB and learnings (ab234ac5)
- docs: update KB for OES format change and nginx timeout (c48ac58a)
- docs: add UI audit learnings and KB patterns (7237dcd1)
- docs: add router-agnostic pattern and stat card standards to KB (3d7638cd)
- docs: add QFieldCloud infrastructure to learnings and KB (7d5824b6)
- docs: add Velocity Fibre brand guide to learnings and KB (ea6b2ca4)
- docs: add WhatsApp mentions architecture to learnings and KB (666540bd)
- docs: add learning for WhatsApp bridge case-sensitivity bug (155de8e2)
- docs: add WhatsApp bridge direct API documentation (d137d2f5)
- docs: add GeoJSON coordinate type learning and update QField KB (9202c0ad)
- docs: add dynamic route catching lesson to learnings, skill, and KB (ffe4770a)

### 🔧 Chores
- chore: add version marker for deployment debugging (b101ccde)

### 📦 Other Changes
- fix(qa-history): use actual step columns instead of non-existent photos_categorized (6885d6fb)
- fix(oes-import): update column mapping for Jan 2027 format (701969e2)
- fix(oes-import): add 120s timeout for large imports (bdd7124b)
- fix(qa-history): remove duplicate directory causing old code to be used (ca90e61e)
- fix(projects): fix SQL query errors in projects API (7833fee4)
- debug: add explicit error logging to projects API (2047fac1)
- fix(projects): remove non-existent columns city/province/completed_drops (115d4ea3)
- fix(projects): remove total_drops column, use location not city/province (d9470471)
- fix(projects): display manager name instead of UUID in project detail (ece34457)
- fix(projects): add projectManagerName to service transform (ed664ae9)
- fix(projects): add manager name JOIN to single project query (bdb37bf7)
- fix(maintenance): correct QContact status mapping for bidirectional sync (7cd2e3fc)
- fix(projects): fix GRN query in procurement-summary API (f103886a)
- fix(projects): support tab query param and fix timeline dark mode (38638590)
- fix(health-safety): break circular redirect loop for incidents (3b6c687a)
- fix(health-safety): safer array check for incidents data (a15b76c3)
- fix(boq): prevent 404 on Edit button click (088d7846)
- fix(maintenance): fix query result access in sync job (b113bbe2)
- fix(projects): align dashboard with other modules + fix API bugs (127e1fc8)
- fix(maintenance): remove unsupported not_equals filter from QContact API (63532755)
- fix(projects): resolve manager name query - use correct column names (dd12052c)
- fix(projects): remove redundant list header + fix status case matching (12ed7fc8)
- fix(projects): parse JSON location + case-insensitive status badges (1176c8b3)
- fix(clients): add icon badge to header matching other modules (d0425ea9)
- feat(projects): redesign dashboard stat cards to match main dashboard (3bda4517)
- fix(activate): pass all filters to export and use unique filenames (ded19335)
- refactor(dashboards): unify all module stat cards to EnhancedStatCard (01640e9b)
- fix(maintenance): revert EnhancedStatCard - incompatible with App Router (99481c2d)
- fix(stat-cards): make EnhancedStatCard router-agnostic for App Router (98f82be1)
- feat(activate): add record count to export filename and headers (46ed752d)
- fix(maintenance): align QContact categories with FibreFlow ticket types (b7817111)
- fix(maintenance): remove WIP limits from kanban board (c62a4c20)
- fix(activate): align export filters with display API (drops.ts) (5f3da63c)
- fix(activate): make QA Centre export button dynamic like Dashboard (88d6d437)
- fix(maintenance): map QContact 'Pending Company Response' to in_progress (0404af14)
- feat(qfield): dynamic QField project management via DB (4a2ee1e2)
- docs(manual): add maintenance user manual with screenshots and PDF (3ab0c0d4)
- fix(manual): embed images in PDF using --basedir flag (fb349d07)
- feat(qfield): support multi-project OES sync (de4f4703)
- fix(qfield): connect to correct QFieldCloud DB on Velocity server (d22fee08)
- feat(manual): enhance maintenance manual with Velocity Fibre branding (4f71eb9a)
- fix(whatsapp): display user name instead of raw JID in @mentions (546f3c77)
- fix(manual): use @import for Google Fonts instead of stylesheet frontmatter (97432d67)
- feat(activate): add photo count verification to sync flow (918a6baa)
- feat(contracts): add branded Cession of Wayleave Agreement template (29025651)
- fix(qfield): update API token for QFieldCloud authentication (81174ba7)
- docs(kb): add QFieldCloud API authentication and file upload info (c9aa0082)
- feat(contracts): add fillable PDF version with embedded Velocity logo (3a32426d)
- feat(contracts): pre-fill Velocity Fibre company details in cession template (72d3fe12)
- fix(qfield): add trailing slash to file upload URLs (6ba093d0)
- feat(contracts): pre-fill VF details in cession agreement, remove template labels (b0364f11)
- feat(contracts): add fillable PDF with 35 form fields (5898372e)
- feat(qfield): rename OES upload to "OES FF YYMMDD.geojson" (5b35d2ef)
- fix(contracts): replace pdf form fields with clean fill-in underlines (029d2455)
- fix(qfield): regenerate API token (previous expired) (0559507d)
- fix(qfield): convert GeoJSON coordinates to numbers (965e918a)
- chore(qfield): update to long-lived API token (1 year) (f917cb16)
- fix(procurement): use inline tab content instead of navigation (40667b59)
- refactor(procurement): implement two-level tab navigation (d0b8053f)
- fix(procurement): navigate directly to dedicated pages from sub-tabs (a3418f06)
- fix(procurement): correct Sourcing sub-tab navigation paths (7cd6c3e4)
- feat(procurement): add main category tabs to Sourcing page (24230ec6)
- fix(procurement): add categoriesOnly prop to hide duplicate sub-tabs (e1358937)
- fix(procurement): add path to Dashboard tab for navigation from sub-pages (79832a60)
- feat(procurement): add top-level category tabs to all sub-pages (54e8e10b)
- feat(procurement): add top-level category tabs to purchasing page (ce2e43e9)
- feat(procurement): add comprehensive reports page (2bf19ed8)
- fix(procurement): standardize tab positioning across all sub-pages (64c66bf1)
- feat(assets): add Financial, Warranty & Documents sections to detail page (883602d7)
- feat(ui): make table rows clickable across all list pages (a0ea46fe)
- fix(assets): use correct VF Storage path for document uploads (0b6addfa)
- fix(assets): rename File import to avoid shadowing browser File constructor (f61484bf)
- feat(assets): enable document viewing via proxy URL (0fccb6de)
- feat(assets): add document deletion (162e2348)
- fix(staff): handle FK constraints on staff deletion (41c8100a)
- feat(assets): add separate view and download buttons for documents (ca70e5c9)
- feat(assets): add delete asset button with double confirmation (b03488d9)
- fix(routing): add missing project pages and human-resources redirect (fb51b13c)
- feat(procurement): implement PO approval workflow with versioning (63439fe0)

---

## [2026-01-26]

### 🐛 Fixes
- fix: replace heroicons with lucide-react in Dashboard components (2ed609aa)
- fix: use correct safe-query pattern in portfolio-dashboard API (92e1db7e)
- fix: remove deleted_at filter and fix project_manager column (eadd0755)
- fix: use company_name instead of name for clients (dd514774)

### ♻️ Refactoring
- refactor: remove App Router projects page in favor of Pages Router (27488410)

### 📝 Documentation
- docs: update learnings and KB with Sprint 1 patterns (ac90eb4b)
- docs: update learnings and KB for OES format change (f0f27c26)
- docs: add unified architecture learning to knowledge base (928b2aee)
- docs: add knowledge-base with filter-aware exports pattern (abca62e9)
- docs: add Unified WhatsApp Bridge architecture to learnings and KB (21304bc6)
- docs: add WA Portal unification and DR Activity Timeline to KB (76df79fe)

### 📦 Other Changes
- feat(projects): implement Sprint 1 - Project Hub Foundation (b7217c26)
- fix(team-api): return structured response with members, stats, primaryManager (62f49b85)
- feat(navigation): implement tab-based navigation system (9eaa66b1)
- feat(maintenance): migrate to horizontal tab navigation (96ea3f84)
- docs(skills): add navigation skill for tab-based migration (d2f2c75d)
- feat(system): add unified Data Sync page (1a9000e2)
- feat(fleet): migrate Fleet module to horizontal tab navigation (19e7c863)
- fix(activate): fix VLM categorization storing empty results (964981f9)
- feat(navigation): migrate Assets, Procurement, Activate to tab-based nav (b8474793)
- feat(fleet): implement plate-based authentication for vehicle portal (51a0c6d0)
- feat(staff): migrate Staff module to horizontal tab navigation (caa31d6c)
- fix(qcontact): update existing ticket status instead of skipping during sync (8bd2d004)
- fix(staff): save all form fields to database, not just 15 (8549bb3a)
- feat(sidebar): make Human Resources a direct link to /staff (6653c3ca)
- feat(sidebar): convert 5 more sections to direct links (90bf774b)
- fix(oes-import): update parser for new Nokia OES format with Stack Ref column (79e97a07)
- fix(qcontact): add pagination to fetch ALL tickets, not just first 50 (c1c9401a)
- refactor(sidebar): simplify PROJECT MANAGEMENT section (e68527a6)
- feat(qa-centre): add subscriber contact info from 1Map and QContact (9d1d4dcd)
- feat(oes-import): add format validation to detect column misalignment (23bfb344)
- feat(imports): add format validation to ARCH and OLT Report imports (020eaf84)
- feat(activate): add sidebar navigation to activate pages (3c60d1f1)
- docs(learnings): add Excel import validation pattern (4c6ca3d5)
- fix(summary): use correct column name dr_number for maintenance_tickets (335d4be1)
- feat(olt-report): add missing stats, records, and imports API endpoints (4be4c8f0)
- feat(activate): convert to ModulePage tab-based navigation (f915923a)
- fix(olt-report): include not_found records in Pending/Fixable tab (ccba5e6c)
- feat(olt-report): add bulk select and fix functionality (68529a6b)
- feat(activate): unified architecture for contact info storage (3c39caf4)
- fix(activate): update DrListPage styling to match UI theme spec (2645549f)
- feat(activate): add explicit refresh endpoint, standardize BOSS API naming (22077f5e)
- fix(olt-report): move not_found records to Investigate tab (ee3e3a16)
- refactor(routes): move Health & Safety and Pipeline under /projects (4268067f)
- feat(olt-report): add Resolve and Escalate actions to Investigate tab (88827db5)
- docs(activate): document UNIFIED ARCHITECTURE pattern (b195e51f)
- docs(learnings): add CSS variables, ModulePage, and route restructuring patterns (e0968b12)
- fix(activate): remove duplicate header from QaCentrePage (c94f0e44)
- feat(olt-report): add records table and CSV export to Reporting tab (9969f3d2)
- fix(staff-api): handle empty strings for UUID and date fields (6d120c2a)
- fix(staff-api): fix RETURNING clause for emergency_contact JSONB (c00c01e9)
- docs(activate): add refresh endpoint to API tables (360e3725)
- fix(staff): fix emergency contact field mapping from API (d4c2b355)
- fix(staff): show only Emergency Contact on Overview page, not Next of Kin (97c34784)
- feat(olt-report): filter CSV export by selected status (30caa1f3)
- feat(activate): auto-sync photos from 1Map when QA opens (742e5e85)
- feat(exports): add filter-aware CSV exports across all modules (51dbdd1e)
- fix(settings): improve Access Control tab UI/UX with full-width layout (fb5a2766)
- fix(search): make list page search filters instant and consistent (dc1b185e)
- fix(nav): add Pipeline and Health & Safety back to sidebar (8a5e8401)
- fix(projects): add missing /api/projects endpoint (1c09653b)
- feat(projects): add Project Management Hub (PRD-058) (afabaf0f)
- feat(projects): add Agreements tab to project detail (PRD-058) (062bc486)
- feat(wa-portal): unify with wa_monitored_groups table (e0592f52)
- feat(agreements): implement SOW and MBA PDF generation (PRD-058) (ac85676c)
- feat(pipeline): add Kanban board view with drag-and-drop (PRD-058) (f3059c49)
- feat(expiry): implement unified document expiry tracking system (PRD-058) (4e2d02ea)
- fix(activate): show reviewer name in Activity Timeline and populate QA History (84c21c72)
- fix(activate): show reviewer name and QA details in Activity timeline (54fbdece)
- fix(activate): use first_name/last_name columns for user name lookup (51329d61)
- fix(activate): get user ID from req.user instead of x-user-id header (7c8c00e7)

---

## [2026-01-25]

### 🐛 Fixes
- fix: minor bug fixes for cost centers and VelocityInput (56b423bd)

### 📝 Documentation
- docs: add users table schema learning (first_name/last_name, not name) (4b7aba99)

### 📦 Other Changes
- fix(olt-report): proper duplicate handling during import (095981a8)
- fix(olt-report): resolve PostgreSQL type inference error in duplicate handling (76151be5)
- fix(olt-report): preserve original import_id for audit trail (25505e98)
- fix(olt-report): use first_name + last_name instead of non-existent name column (0a63380c)
- fix(olt-report): show actual error message in import detail modal (e42b2a6d)
- fix(olt-report): use correct column name 'actor' instead of 'created_by' (95fe05c9)
- feat(olt-report): add Reporting tab with time filters and CSV export (ba883fc0)
- fix(olt-report): improve CSV export error handling (316cda95)
- fix(auth): fix Chrome autofill putting email in password field (58340a1c)
- feat(activate): merge foto_ai_reviews into dr_photo_unified_reviews (270190ee)
- fix(auth): allow passwords containing @ symbol (c278c7a4)
- style(ui): redesign version notification to subtle toast (ef7286ac)
- feat(pipeline): add Service Authorities database and UI enhancements (60ce62ca)
- debug: add error tracing to authorities API (3466c370)
- fix(authorities): use sql template literals instead of query function (efc8c426)
- fix(pipeline): remove created_by/updated_by from authority API calls (983e52a9)
- fix(procurement): resolve supplier display and stock tab issues (e6979b12)
- fix(vlm-queue): improve error logging to capture actual error message (bb925315)
- fix(olt-report): use HTTP database connections instead of WebSocket (b6be87fe)
- fix(procurement): move Quick Actions to top of dashboard pages (b62421d0)
- fix(olt-report): use inline pg Pool instead of lib/db import (235e07bc)
- docs(kb): add VLM cron job troubleshooting to activate module (b658ef9f)
- feat(pipeline): add missing pages and fix Add button (40c1b21a)
- fix(pipeline): improve Project Details sidebar spacing (efaf9f83)
- docs(kb): add database connection pattern learning (6623b2ac)
- docs(procurement): add UI patterns and common issues to KB (b0be851c)
- fix(activate): use pg Pool for drops API (aed4e968)
- fix(api): replace @neondatabase/serverless with pg in 26 API files (cc6f4fc7)
- fix(fleet): handle unknown vehicle status in vehicles list (59175fdb)
- docs(kb): add config lookup fallback pattern learning (642a3f55)
- fix(procurement): add missing Requisitions and Goods Receipt tab content (3ae35903)
- fix(procurement): navigate directly to tab pages instead of showing intermediate cards (62c21d79)
- fix(vlm-queue): remove neonConfig reference after pg migration (6213ce0c)
- fix(procurement): navigate before updating tab state to prevent URL race (e6e7930e)
- fix(procurement): prevent localStorage from overriding URL tab param (17a7c2f1)
- fix(procurement): use direct tab URLs to fix client-side navigation (9d270354)
- feat(procurement): implement fully functional Stock Management dashboard (efc04551)
- fix(stock): query stock_items table instead of empty stock_positions (c40ef00e)
- fix(vlm-queue): exclude already-categorized DRs from processing queue (ce287d01)
- feat(odoo): add stock movements sync from Odoo (7c440759)
- feat(grn): add GRN confirm workflow with stock movements integration (780a4fa5)
- feat(olt-report): add investigation workflow with escalation and resolution (df40c2ed)
- fix(olt-report): use first_name/last_name instead of non-existent name column (732360ff)
- docs(kb): add stock movements architecture and GRN workflow (d12e76c6)
- fix(olt-report): make activity logging non-blocking for resolve/escalate (62933e39)
- fix(olt-report): use correct 1Map URL path /apps/app (a009543c)
- fix(olt-report): add workspace param to 1Map links (8a76762e)

---

## [2026-01-24]

### 📝 Documentation
- docs: add manual DR acknowledgment procedure to KB (12b86e16)
- docs: update CLAUDE.md and QField sync documentation (91bd31ad)
- docs: add ONT serial mismatch analysis and correction log (3058f62f)
- docs: update corrections log with correct layer name (20c29658)

### 🔧 Chores
- chore: update session state for reports completion (0a4773ca)

### 📦 Other Changes
- feat(pipeline): add standalone Smartsheet document sync script (eee9f1e4)
- feat(pipeline): enhance document sync toast with detailed stats (7f663cb2)
- feat(rbac): add auth middleware to all 65 procurement API routes (a1376fac)
- feat(odoo): add inventory sync services for suppliers, products, receipts, transfers, and stock levels (7ab0b684)
- feat(rbac): add auth middleware to all 56 fleet API routes (c8687bd6)
- feat(rbac): add auth middleware to all 22 pipeline API routes (828d2559)
- feat(rbac): add withAuth middleware to 131 API routes (c22ebaec)
- feat(rbac): add withAuth middleware to remaining 157 API routes (1490d697)
- feat(rbac): add role-based access control to sensitive routes (1cd7571a)
- feat(activate): add Installation Gaps report for tracking installed-but-not-activated DRs (181261d9)
- feat(auth): add password reset flow (5636efd6)
- fix(activate): remove duplicate age filters from Installation Gaps report (53712a64)
- fix(health-check): adjust WhatsApp Bridge thresholds for overnight gaps (86283553)
- feat(odoo): add invoice sync and procurement reporting (36979ea7)
- feat(auth): add password reset pages with premium UI (d7090806)
- feat(activate): add 'All' date filter and update Installation Gaps UI (09fb160a)
- feat(auth): add automatic redirect to sign-in on 401 errors (df913ec7)
- feat(odoo): add comprehensive Odoo sync scripts (6519abef)
- fix(auth): make WA Bridge endpoints public (f7af2d34)
- fix(auth): install fetch interceptor at module load time (792102cb)
- feat(fleet): add fleet documents sync from Odoo (22f94ed7)
- fix(auth): disable TLS cert validation for expired SMTP cert (186bb060)
- fix(auth): use correct column name 'password' instead of 'password_hash' (37f2e9a1)
- refactor(reports): use shared ReportCard in SerialMismatchReports (686991a0)
- fix(auth): use AuthContext for login to fix sidebar race condition (65b1af1e)
- fix(auth): add name/id attributes for proper browser autofill (c1e21e33)
- fix(reports): use same date for WA and OES in discrepancy report (f8a9d907)
- feat(rbac): add custom roles system with create/delete/clone (82ec64dd)
- feat(rbac): add role management UI with create/clone/delete modals (920a6ff4)
- feat(system): add self-healing infrastructure module (2648a798)
- feat(system): add self-healing API endpoints and UI (8a76af46)
- feat(system): add self-healing infrastructure module (9f46b9a1)
- feat(activate): add WA photos display in QA Centre (fbfd9209)
- fix(activate): match WA photos API response to WAPhotosGallery interface (9811fe8b)
- fix(system): use dynamic db imports for production bundling (c7a59f6a)
- fix(activate): proxy WA photos from VPS instead of Velocity (75c9eca8)
- fix(activate): use regular img for WA photo thumbnails (e725e693)
- fix(system): normalize db query results for self-healing services (abb5c492)
- feat(nav): add System Health Hub to sidebar menu (917a968a)
- feat(system): integrate QFieldDashboard into System Health Hub (1c2fb448)
- fix(api): correct export in qfield API endpoint (a4afe79a)
- refactor(system): consolidate QField into System Health Hub (4fcf11a6)
- feat(activate): add serial change audit trail (3a9e0d40)
- feat(activate): add Serial History tab to Activity section (e89bc137)
- feat(activate): add 4-way serial comparison with WA photo VLM (6ef1ee97)
- feat(activate): add serial verification badge on DR Summary page (3e2feca0)
- feat(system): integrate dashboard with Python AI Recovery Agent (84c65d70)
- fix(activate): update WA photo VLM processing to use correct photo URL (6aee1f3a)
- fix(activate): correct WA photo proxy to use VPS photo viewer (5b6c712e)
- fix(activate): update wa-photo proxy to use VPS photo viewer (b9866d7e)
- fix(system): add services array to self-healing API and null safety (3e9e289f)
- fix(photo-proxy): route 1Map photos to Velocity, WA photos to VPS (bfaf2fe3)
- fix(serial-verification): remove non-existent ups_serial from oes_activations query (a9f8f1a7)
- feat(activate): add serial status audit script (dab4faeb)
- feat(system): add OLT Report import and 1Map fix system (ab7eb29d)
- fix(olt-report): store wrong 1Map serial from Excel for comparison (35ad2825)
- fix(migration-124): use pg client and drop/recreate view (3ac4e053)
- fix(olt-report): use dr_activity_log instead of dr_timeline_events (e0593fc0)
- feat(olt-report): add olt_mismatch_records table for complete tracking (c8082d43)
- fix(olt-report): show full serial numbers in UI (b04959dd)
- fix(olt-report): correct terminology - ONT serial not OLT serial (2055b9a9)
- fix(olt-report): consistent ONT terminology throughout UI (b45bebbf)
- feat(olt-report): add import detail modal with full audit trail (5c09d869)
- feat(olt-report): add investigate tab for records missing 1Map serial (917f4bce)
- fix(1map): add 8-second timeout to prevent gateway timeout (b896b569)
- fix(olt-report): show Fix button for pending mismatch records (a3e6cd74)
- fix(olt-report): correct fixable logic - only ONT serial (column B) required (7fb5bfab)
- fix(olt-report): don't update 1Map if already correct, log verification (25917a5d)
- fix(olt-report): reduce timeout and extend API duration for 1Map calls (8ede76f3)
- feat(olt-report): add bulk progress UI for sequential processing (3cc37ca4)
- fix(olt-report): move "not found in 1Map" records to investigate tab (81027384)
- fix(olt-report): use 'not_found' status to match DB constraint (847defed)
- fix(1map): pick highest prop_id when multiple records found (b8d1d442)
- feat(olt-report): fetch active projects dynamically for dropdown (48ab3ac9)

---

## [2026-01-23]

### 🐛 Fixes
- fix: resolve 3 UI display bugs from production audit (8f712d00)
- fix: use sender_name instead of sender in wa-dr-photos (2adb270d)

### ♻️ Refactoring
- refactor: rename WA Tracking to Offline Tracking (cc371ee3)

### 📝 Documentation
- docs: add VPS backup infrastructure and fix duplicate BOQ header (7d1989ea)
- docs: update ONEMAP_HOST references to Tailscale IP (07434dbe)
- docs: add OES import project mapping fix to changelog and module docs (a6b3a1f6)
- docs: update QField sync documentation and KB (d88e5c9b)
- docs: update qfield-sync module with OES sync details (96a5ba09)

### 📦 Other Changes
- fix(projects): display created date using correct field name (66dedff2)
- feat(maintenance): enhance KanbanBoard with drag-and-drop (729fea27)
- fix(maintenance): resolve AnimatePresence/Draggable ref conflict (fd8be82c)
- feat(staff): add bank document validation with account holder check (f313d53a)
- feat(auth): implement internal JWT authentication system (8c9dea00)
- feat(staff): add OCR verification data to staff notes (1d7bdb72)
- fix(auth): update session with final token hash after signing (da6804b3)
- fix(staff): save OCR notes to staff_notes table for UI display (bd55ef4c)
- fix(staff): handle API response structure in NotesTab (64637607)
- feat(staff): improve OCR notes with expand/collapse UI (f33fcf95)
- feat(staff): add audit trail system for staff actions (c9964a39)
- fix(staff): prevent duplicate audit log entries (ea2edcd4)
- feat(auth): add login page and update AuthContext for real JWT auth (42b20797)
- feat(qfield): pass reportDate to QField sync webhook (2c099eec)
- feat(activate): add installer name from 1Map via BOSS API (16031101)
- fix(auth): enable Sign Out button in header (fe4993c0)
- fix(activate): consistent styling for timeline dates (f3034720)
- feat(fleet): add driver's license upload from Fleet module (f189e117)
- refactor(sidebar): reorganize navbar and add all shortcuts (6b9a5206)
- feat(auth): add premium login page with fiber background (73a56783)
- fix(settings): add missing shortcut items to sidebar customization (8442fc5c)
- fix(auth): improve login form labels to avoid autofill overlap (32178bb4)
- feat(settings): increase sidebar shortcut limit to 5 (bc28eadf)
- fix(wishlist): enable drag for all users on dev queue board (cd3e03b8)
- fix(fleet): skip document type selection for driver's license upload (f715d247)
- fix(fleet): improve assign driver modal with searchable list (abf50d6b)
- feat(auth): First-time user onboarding flow (#45) (ca760486)
- feat(auth): add super_admin role for Hein van Vuuren (b26cd1a4)
- feat(wishlist): Add 2-stage pipeline (POC + Harness) (54d06f75)
- feat(assets): add category creation page (664475ba)
- fix(activate): lookup project from drops table during OES import (19e3d621)
- fix(assets): add missing category type labels and icons (94266a13)
- fix(activate): respect NEON_USE_HTTP env for database transport (8dd2409a)
- fix(wishlist): Correct harness trigger endpoint path (28fd0599)
- fix(wishlist): Transform payload to match mvp_pipeline.py format (c402ee35)
- fix(dev-queue): Use Authorization Bearer header for mvp_pipeline (5e408385)
- fix(dev-queue): Correct import paths to use dev-queue directory (f29dcafe)
- feat(sidebar): add System Health link to SYSTEM section (6d373d7d)
- fix(sidebar): make System Health available to all users (d3dbfedc)
- fix(dev-queue): Keep DB table names as wishlist_*, update nav menu (a9289d43)
- feat(rbac): implement database-driven role-based access control (ab348108)
- feat(system): add comprehensive infrastructure health monitoring (9cbf08bc)
- feat(rbac): add theme styling and staff provisioning to Access Control (68987aa1)
- feat(system): add health trend chart to infrastructure dashboard (cfae3563)
- feat(maintenance): add WhatsApp maintenance tracking for Mohadin QA (17f34079)
- fix(maintenance): use JS timestamp instead of INTERVAL in SQL query (d7fb65b5)
- fix(maintenance): use createLogger instead of log.child (25cf012f)
- feat(rbac): integrate RBAC permission keys into sidebar navigation (326bdbb6)
- feat(maintenance): add WhatsApp maintenance tracking for Mohadin QA (41262540)
- fix(activate): auto-sync missing DRs from qa_photo_reviews (b2558d94)
- fix(activate): auto-sync missing DRs from qa_photo_reviews with OES check (65ff72f6)
- fix(auth): fix user name and role display in sidebar (7261e8af)
- fix(ocr): improve SA ID extraction accuracy for large PDFs (d460e9c8)
- feat(maintenance): add WA Tracking tab to Data Sync page (2d2cf0a8)
- fix(maintenance): handle space in DR numbers (DR 1234567) (dbfddee1)
- fix(rbac): add missing user_audit_log table (1cd0d87a)
- feat(maintenance): add photo viewing to WA Tracking dashboard (3818542d)
- fix(maintenance): use correct column names for wa-photos API (39a1e031)
- fix(rbac): add key and label to getRolePermissions response (77a6d15d)
- feat(pipeline): add wayleave and cession date column mappings (0f65d4b1)
- fix(activate): sync ALL WhatsApp submissions, remove OES requirement (fed5ff95)
- feat(pipeline): add wayleave/cession date columns to Smartsheet sync (56eed971)
- feat(pipeline): add FibreFlow-style toast notifications for Smartsheet sync (9f42179d)

---

## [2026-01-22]

### ✨ Features
- feat: staff documents, notes, H&S tab, and QA improvements (84ef983a)

### 📝 Documentation
- docs: update KB with dark mode FOUC fix and theme system (dd45d4d7)
- docs: add FOUC prevention section to UI/UX spec (e1bb93e6)
- docs: unify theme specification and archive legacy docs (22ffa66f)
- docs: update QField to use OES_Project_Progress (production) (ade53050)
- docs: add cloudflared QUIC buffer fix to troubleshooting (1356312a)
- docs: update cloudflared fix - use HTTP/2 and run as root (4c4d3e07)
- docs: add missing DATABASE_URL troubleshooting to kb (302be7d0)
- docs: add dev environment (dev.fibreflow.app on port 3005) (1874cbaa)
- docs: update deployment workflow (Local → Dev → Staging → Prod) (3425e1ff)
- docs: recommend dev mode for local development (c3fc0708)
- docs: update WhatsApp architecture for VPS migration (d2c43cfd)

### 🔧 Chores
- chore: archive all legacy dark mode documentation (eea42b1e)
- chore: add debug endpoint for QContact case inspection (9d4281aa)

### 📦 Other Changes
- fix(projects): add skeleton loading to prevent layout flash (bf88e845)
- feat(pipeline): add document proxy for secure file viewing (e79c4f59)
- docs(kb): update pipeline module with doc proxy and flash fix learnings (4813b4cd)
- docs(kb): update procurement module with navigation structure (e6069118)
- refactor(sidebar): hide unused Project Management menu items (373059cc)
- fix(projects): add loading.tsx and improve loading state detection (75809291)
- feat(procurement): link requisitions to RFQs and POs (4b7a2fae)
- fix(procurement): match dashboard layout spacing with other pages (23361da6)
- fix(theme): prevent dark mode FOUC on App Router pages (6a40dec8)
- fix(layout): add missing AppLayout to clients/new and projects/new (5ea61125)
- fix(activate): require confirmation before showing success toast (20ecd466)
- fix(maintenance): add verification API endpoints (38b382bd)
- fix(procurement): prevent route abort errors on main portal page (cf16aa26)
- fix(procurement): show all tabs in All Projects view (c963aa48)
- docs(audit): add comprehensive UI/UX improvement plan (ed8afa8b)
- fix(analytics): remove duplicate stat cards grid (9e3e3cd4)
- fix(activate): correct QField status field names in polling (d2d2c50b)
- fix(maintenance): allow multiple weekly imports per week (04b0a5cf)
- fix(maintenance): allow multiple weekly imports per week (6fe21df5)
- fix(analytics): refactor to match Maintenance Dashboard pattern (514f55aa)
- fix(maintenance): update trigger to use maintenance_history table (d32c1ee4)
- fix(maintenance): return 'id' field in weekly import response (13de9ab9)
- fix(activate): correct field names in pending-aging report (357e9c57)
- fix(communications): refactor to match Maintenance Dashboard pattern (0d5dafc4)
- fix(maintenance): add progress endpoint for weekly import polling (7589063c)
- fix(maintenance): streamline weekly import with FormData and auto-parse (d88f9e7c)
- feat(maintenance): add progress overlay and toasts to weekly import (10751f64)
- feat(whatsapp): add message logging to send-feedback API (691bbbd3)
- fix(whatsapp): use Tailscale IP for sender URL in test endpoint (e4b67809)
- fix(maintenance): align weekly report SQL with database schema (cfb94432)
- fix(maintenance): use system user for weekly import created_by (168c8b1b)
- fix(whatsapp): add recipient_jid to test message request (70a8f40e)
- fix(maintenance): use correct TicketType enum for weekly imports (18fe1362)
- feat(whatsapp): add Send Message tab to WhatsApp Portal (329f895f)
- fix(maintenance): disable caching on weekly import status endpoint (b01bcbba)
- feat(whatsapp): add Chat tab for real-time messaging (661daf8f)
- feat(commands): add /infra skill for infrastructure management (530a8cd1)
- fix(whatsapp): use valid status value for inbound messages (ae75fb98)
- fix(maintenance): fix weekly import polling stuck on completion (c5b6d1b8)
- feat(maintenance): improve weekly import success messages (97c1190b)
- feat(maintenance): add refresh button and duplicates column to import history (fbe774f6)
- feat(wishlist): Add MVP automation with GitHub sync (b9b2ec5b)
- feat(procurement): add CRUD modals for inventory tabs (0a892f34)
- feat(maintenance): add QContact status discovery endpoint (2f6efe85)
- fix(maintenance): fetch case details for accurate status discovery (d2e8e6f0)
- feat(maintenance): add QContact ticket alignment comparison (b2170f12)
- fix(maintenance): use correct db import for alignment service (9fc4c4e6)
- feat(maintenance): add QContact alignment UI tab (389cdb8c)
- fix(maintenance): map QContact status during inbound sync (326a3446)
- feat(wishlist): Add harness integration for automated builds (b8d55cfe)
- fix(procurement): show project name instead of ID in requisition dropdown (efbcac34)
- fix(procurement): show only project name in requisition dropdown (5108d2ed)
- fix(db): auto-reconnect on Neon WebSocket socket hang up (cafa1381)
- feat(maintenance): add three-way alignment and VF renumbering (af85205d)
- feat(dates): standardize dates to YYYY-MM-DD format (Phase 1) (665c95ab)
- fix(staff): await refetch calls to prevent data disappearing (c940177b)
- refactor(nav): rename People section to Human Resources (f76dcabb)
- feat(dates): standardize dates to YYYY-MM-DD format (Phase 2) (3a9b7d8a)
- feat(dates): standardize dates to YYYY-MM-DD format (Phase 3) (e69307a6)
- fix(procurement): fix bundles creation - field mismatch and error handling (f47a926f)
- feat(procurement): add bundle items modal and reports (5e85d0c0)
- fix(bundles): wrap numeric values with Number() for .toFixed() (e31e87b0)
- fix(inventory): fix bundle price decimal display (2168e4af)
- fix(wishlist): Change columns endpoint from PUT to POST (92228d2c)
- refactor(procurement): migrate toast to notificationService (81999b4b)
- fix(procurement): fix dark theme colors in StockManagement (886ba599)
- Merge branch 'master' of https://github.com/VelocityFibre/FF_Next.js (d9c31877)
- fix(boq): use actual items array for stats instead of stale boq.itemCount (5a1a488c)
- feat(audit): add comprehensive production readiness audit system (44d2401d)
- feat(nav): add Health & Safety to sidebar navigation (679afe3b)
- feat(health-safety): add Health & Safety module (8dc080c4)
- chore(deps): add swr for data fetching (1f8d5f0b)
- feat(health-safety): add API endpoints (d6a3bb85)
- fix(health-safety): handle missing tickets table gracefully (d0bbc9e2)
- fix(health-safety): handle missing tickets table in incidents API (8372db72)
- feat(health-safety): add incidents and checklists pages (b064341a)
- fix(health-safety): wrap pages with AppLayout directly (0ce419bf)
- feat(activate): add DR-level expansion to dashboard hierarchy (3c77c9c0)
- fix(health-safety): fix dashboard API queries and add seed script (1272cc10)
- feat(staff): add alerts system with birthday reminders, document expiry, and compliance tracking (c91eafe2)
- fix(activate): show numeric values in DR row columns (2c7673ec)
- fix(health-safety): use maintenance_tickets table in incidents API (3bf02fbd)
- fix(whatsapp): update service URLs to VPS (72.61.197.178) (1abc0e98)

---

## [2026-01-21]

### ✨ Features
- feat: add xyOps and Grafana to System menu (ba87cd2e)

### 🐛 Fixes
- fix: standardize all service URLs to use Tailscale IP (62f1b7b5)

### 📝 Documentation
- docs: add comprehensive infrastructure documentation (1fbfe716)
- docs: add Progressive Knowledge Base system documentation (36745ac1)
- docs: add QFieldCloud infrastructure details (e64acfd8)
- docs: update module documentation and learnings (c5c9928e)
- docs: add pipeline module documentation and update KB (873bc601)
- docs: update WhatsApp integration for bridge-2 (063 841 2276) (05acbdc2)

### 🔧 Chores
- chore: add .env.production to gitignore to prevent credential loss (cedd4097)
- chore: remove .env.production from git tracking (226e1dfd)
- chore: update session state with WA architecture fixes (a6baffdf)

### 📦 Other Changes
- feat(procurement): add stock categories, bundles/kits, and stock takes (f041c37e)
- feat(procurement): add cost centers for hierarchical cost allocation (47ab08f3)
- feat(procurement): add budget templates and dashboard (3341481c)
- feat(procurement): add field stock technician locations and views (e2d6696e)
- feat(system): add QField Monitor dashboard (6bd1f471)
- fix(system): move QField Monitor to root level route (a0b99c49)
- fix(system): move QField Monitor to App Router (5aef168e)
- fix(wishlist): Fix storage upload endpoint path (829ff80d)
- fix(procurement): fix cost-centers ORDER BY column (5354b86b)
- fix(procurement): use numbers for LIMIT/OFFSET params (a793ed24)
- debug: add detailed error for cost-centers (b460a2f9)
- debug: add logging to cost-centers (ae4bb05c)
- fix(procurement): clean up debug logging from cost-centers (03ddf019)
- fix(procurement): add null safety to utilization_percent (829eafa7)
- fix(procurement): convert string utilization_percent to Number (59dedd9a)
- fix(procurement): cast varchar project_id to uuid in joins (8e847673)
- feat(qfield): Add Server Controls admin panel (bed3d666)
- fix(procurement): fix boq_items column name and filter invalid UUIDs (cc38fdfe)
- fix(activate): exclude OES-only records from QA Centre list (bd648d41)
- feat(qfield): Move Server Controls to QField Sync dashboard (b34b0501)
- feat(qfield): Add Server Controls tab to QField Monitor page (a62e6c62)
- fix(nav): Rename 'QField Monitor' to 'QField' in sidebar menu (2fdcaf7d)
- feat(nav): Add QField Sync to sidebar menu under System (116a283f)
- feat(qfield): Add Sync tab to QField page (6887273f)
- feat(procurement): Improve UX with collapsible sidebar groups and dashboard (1ed2f527)
- feat(activate): add SharePoint to health check endpoint (bd3df8ac)
- fix(procurement): transform RFQ date fields for correct display (3263eb49)
- fix(procurement): address audit findings from diagnostic report (5e0f8209)
- fix(procurement): address audit findings from diagnostic report (85d480aa)
- fix(procurement): resolve all API TypeScript errors (baa3379f)
- fix(activate): use Pool pattern for serial swaps API (0de012b9)
- fix(whatsapp): standardize WA URLs to use sender-2 via wa-feedback (ee4bb534)
- feat(pipeline): add document sync from Smartsheet (48390d10)
- fix(activate): set is_oes_only=FALSE on manual DR entry (f7f968d0)
- feat(db): add NEON_USE_HTTP toggle for transport mode (368c1977)
- fix(pipeline): fix blank alerts page and dark theme skeleton (95a36802)
- feat(pipeline): add project-level document management (6adc2395)
- feat(sidebar): add Pipeline to Project Management section (095c15c5)

---

## [2026-01-20]

### 📝 Documentation
- docs: add ticket source tracking to module KB (837934aa)
- docs: add WhatsApp Communications Admin module KB and update wa-agent (32a77d09)
- docs: update knowledge base - bridge now uses unified 082 number (4de7b7da)
- docs: add PDFCraft deployment to knowledge base (d9bd1d25)
- docs: add SharePoint DR sync setup guide (b9de6a26)

### 🔧 Chores
- chore: remove unused BMad commands (532457f2)
- chore: update knowledge base with recent features (0d4e81da)
- chore: update knowledge base session state (47334f99)
- chore: add PDFCraft as submodule (1e8665f4)
- chore: add debug logging to activity timeline (15f1b6f9)
- chore: add debug timeline endpoint (606a233f)
- chore: move debug endpoint to /api/debug/timeline (4ef1ba62)
- chore: move debug endpoint to /api/test-timeline (00b962fc)
- chore: add version marker to activity-log API (69b9e9bc)
- chore: remove debug endpoint (ecb20224)

### 📦 Other Changes
- feat(activate): add confirmation mode for serial validation (8dc62f96)
- feat(activate): add fuzzy matching for serial validation (1bc81d88)
- feat(activate): add blur detection for VLM extraction pipeline (597dc5a1)
- feat(oes-import): add confirmation toast for database sync (4ea5fe37)
- fix(fleet): improve VLM odometer extraction accuracy with multi-pass verification (09061e62)
- feat(fleet): add audit trail page and validation UI indicators (7c7aa702)
- fix(fleet): fix SQL syntax in audit API discrepancy query (3d7d52fa)
- fix(fleet): use sql.query() for parameterized dynamic queries (c6e7eccb)
- feat(activate): add standalone NAFNet deblur service (ad04b653)
- feat(fleet): add Check-In Audit page to sidebar navigation (d079306e)
- feat(activate): Add automated OES to QFieldCloud sync with labeled drop numbers (dea9a830)
- fix(activate): Remove non-existent column reference in OES sync query (ca9cb1d7)
- feat(activate): add Offline Devices report to Reports dashboard (5bf43943)
- feat(activate): add sync progress spinner to OES and ARCH imports (151b2872)
- feat(activate): Add diagnostic endpoint to check OES coordinates (1f6799e1)
- feat(activate): add progress overlays to QA Wizard (47ccb6af)
- fix(activate): Fix OES to QFieldCloud sync webhook integration (213b69a8)
- docs(activate): add progress overlay documentation (f1feffdf)
- feat(fleet): add verified override flow for rejected VLM readings (a29ba63c)
- feat(activate): Add diagnostic endpoint to check OES view for sync (497a945d)
- feat(activate): add Create Ticket action to Offline Devices report (86524be6)
- feat(maintenance): add OFFLINE_REPORT and QA_REVIEW ticket sources (1032ff84)
- fix(qfield): Update sync to use correct OES_Project_Progress project (15f8ad1b)
- feat(fleet): add vehicle calibration API for first-time check-in (551f5e47)
- feat(activate): add draft state for QA Wizard Phase 4 (336e2b8f)
- fix(wishlist): Add form validation feedback for required title field (c408324d)
- docs(activate): add Phase 4 draft state to module KB (d84f9292)
- feat(wishlist): Add vote and move API endpoints (c1a5335f)
- feat(communications): add WhatsApp Admin Portal with accessibility improvements (b7aa6d55)
- feat(fleet): add vehicle calibration modal for first-time check-in (1b9e2ce2)
- feat(wishlist): Add attachments feature for wishlist items (6c8f6335)
- feat(activate): add photo rejection with Fibertime-spec reasons (d5ade502)
- fix(wishlist): Add modal close handlers (Escape, backdrop click, X button) (de01cc26)
- docs(activate): update KB with photo rejection reasons (cd53f6c7)
- fix(wa-admin): dark theme styling for WhatsApp Portal (97d7de4c)
- fix(wa-admin): align header and tabs with FibreFlow design system (267a613f)
- fix(activate): show warning when feedback already sent (c517676f)
- fix(wa-admin): complete dark theme compliance for WhatsApp Portal (ccdaa0ba)
- feat(wa-admin): add phones API and service pairing endpoints (87135381)
- feat(activate): complete DR resubmission workflow (589da03d)
- fix(activate): remove non-existent step_completion column from resubmission snapshot (45d7640e)
- feat(communications): add PDF Tools module (e451b63a)
- feat(wa-admin): add multi-phone support and service improvements (9d838b1c)
- feat(sidebar): add external link support and PDFCraft integration (7f90b907)
- fix(wishlist): Resolve hydration error and fetch race conditions (e5bd369f)
- feat(claude): add self-maintaining knowledge base system (2dc1f085)
- fix(claude): add /kb command to commands directory (ccd4aa36)
- fix(sidebar): use nginx proxy path for PDF Tools (68be122b)
- docs(wa-monitor): update knowledge base with WhatsApp Portal info (398cd443)
- feat(wishlist): Add card click-to-edit functionality (daa715f2)
- feat(wishlist): Add Settings tab with WIP limits and column management (3b4aa016)
- feat(wishlist): Add admin-only drag-and-drop permissions (7d134c70)
- docs(claude): add fleet and activate module profiles (1a142061)
- feat(wishlist): Add Agent OS spec fields for automated development (51d09af3)
- fix(activate): reduce visual disruption from auto-refresh (f7195b61)
- feat(activate): show WA submission time below Installed date (5daaec72)
- fix(activate): use waReceivedAt for WA submission time display (c8398928)
- feat(activate): show OES import timestamp below Activated date (7211ecba)
- feat(activate): add serial swap detection and tracking (ff66946d)
- feat(activate): add serial mismatch tracking with team accountability (830f99eb)
- feat(activate): add quick sync with serial tracking on DR view (7805fda4)
- docs(kb): update activate and wishlist module context (bfba5b56)
- feat(activate): add SWAP_DETECTED activity logging (90116359)
- fix(activate): fix activity log service to match table schema (767a678f)
- feat(activate): add SharePoint DR photo sync system (f9dfac67)
- fix(procurement): resolve critical blockers - real DB operations (5d834887)
- feat(activate): show detailed serial changes in Activity timeline (b3f5eab9)
- fix(activate): clarify timestamp labels in Activity timeline (129a320f)
- feat(activate): comprehensive DR lifecycle timeline (fe31fd41)
- fix(activate): use sender_phone instead of submitter_id in timeline query (5d6759ee)
- fix(sharepoint): use correct column name project_name (279be325)
- fix(config): move OCR service to port 8093 (c779e932)
- refactor(ui): migrate stat cards to unified StatCard component (0adc7a42)
- fix(ui): apply dark theme to native select elements (40f81a85)
- feat(sharepoint): trigger SharePoint sync on QA completion (b35fda71)
- chore(session): update KB scan results and session state (cf1f2e12)
- feat(sharepoint): add comprehensive full sync script (b6d9944b)
- fix(sharepoint): correct activity log column names (1eba3a9a)

---

## [2026-01-19]

### ✨ Features
- feat: Add wishlist feature under Communications menu (94328b47)
- feat: Migrate wishlist from Clerk to PostgreSQL auth (0b226701)

### 🐛 Fixes
- fix: stop version checker from constantly showing "new version" banner (2dc9d7ce)
- fix: Remove PageContainer import and use standard div wrapper for wishlist page (a8ca7876)
- fix: Export API route functions directly for Next.js 14 App Router compatibility (11b2ea4b)
- fix: Remove AppLayout wrapper from WishlistDashboard and fix API responses (431cab46)
- fix: Calculate stats from columns data to prevent undefined error (a2e31c00)
- fix: Use next/navigation router for App Router compatibility (4b8749cf)

### 📝 Documentation
- docs: update skills with VLM extraction troubleshooting (28b55301)
- docs: add Activity Tab documentation to CLAUDE.md (b9a4595a)

### 📦 Other Changes
- feat(procurement): complete RFQ workflow with supplier/stock integration and PO conversion (38c8bde8)
- feat(activate): add expandable Zone/PON breakdown to Dashboard (f42e47e7)
- docs(activate): update KB with Dashboard expandable breakdown and Reports tab changes (c01bd601)
- feat(activate): improve QA Wizard feedback with specific missing photos (20f31979)
- fix(activate): link OES-only activations to projects via drops table (c895cacb)
- docs(activate): add project attribution logic for OES-only activations (aed0184b)
- fix(procurement): render StockItemSelector modal via portal (b220d12d)
- feat(activate): add WhatsApp message threading for QA feedback replies (02ef8bc2)
- feat(activate): improve QA data fetching with ensure-data endpoint (c368b8ea)
- refactor(activate): reorder QA tabs and remove AI Evaluation (1921b1b1)
- feat(activate): add comprehensive reporting dashboard (0ebb45c8)
- feat(activate): add DR Summary page as landing tab (b8573df8)
- fix(activate): correct column names in reporting SQL queries (8deffb40)
- fix(activate): fix summary API column names (76ca28d0)
- fix(procurement): RFQ save and dark mode fixes from E2E testing (04369657)
- fix(activate): add dark mode support to PhotoGalleryUnified (bbcc5eaf)
- fix(procurement): update RFQ list to match Suppliers styling (facde44c)
- docs(e2e): add cross-page styling consistency check (02a8e884)
- fix(activate): pass photos to evaluateAutoFail in Final Decision (7866a79d)
- docs(activate): update knowledge base with QA Wizard and reporting (d4d8dc74)
- fix(rfq): remove gray background wrapper for dark mode consistency (596fd1b5)
- docs(rfq): update E2E test log with background color fix (91e64eb5)
- fix(activate): use VLM categorization results for step data in fetch-photos (80e22f2b)
- docs(ui): add page background anti-pattern to KB (2d8d51fd)
- feat(activate): add backfill cron to sync missing OneMap photos/serials (a9dcaf91)
- feat(activate): improve DR Summary with accurate state and step coverage (bce1f471)
- fix(activate): trust Step 6 serial over Step 9 for ONT validation (b819a4b3)
- feat(activate): store feedback message ID for future threading (c1154e27)
- feat(skills): add comprehensive Final Audit skill for production testing (71f11823)
- docs(activate): add WhatsApp threading and serial validation documentation (76a60da3)
- feat(activate): add inline photo categorization editing (49ef1aa5)
- feat(activate): add VLM queue cron for automatic extraction (ffb90a5a)
- fix(activate): use OneMap URLs for VLM extraction (af058492)
- fix(activate): try multiple Step 9 photos for extraction (d0b8a871)
- fix(activate): try multiple photos for all extraction steps (e9c71ac0)
- fix(procurement): prevent NaN% display in BOQ card mapped percentage (24d033ee)
- feat(activate): align status filters with dashboard states (6187220d)
- feat(activate): add barcode scanning for ONT serial extraction (4f42d5ba)
- fix(sidebar): remove dead links for Drop Dashboard and Home Installations (ef828631)
- fix(activate): use activeProjects from API for project filter dropdown (b3fe05c4)
- fix(activate): implement server-side search for QA Centre (38dfb288)
- fix(activate): add loading indicator to Re-categorize button (a6af4b7c)
- docs(skills): update KB with E2E audit results and troubleshooting (db164535)
- fix(activate): add migration to assign project to OES imports (12bf0f20)
- docs(activate): update KB with OES project mapping and search info (656172fd)
- fix(activate): improve QA wizard UX and add project tracking (f9593bae)
- fix(activate): use approvals map for step counts after override (e68e5fb6)
- feat(activate): compact step indicator with labels under circles (f6636c68)
- style(activate): increase step label font size from 10px to 12px (ddfcfc26)
- feat(activate): add Edit mode for approved categorizations (89a5cccd)
- feat(activate): UX improvements for QA Wizard (70773f41)
- feat(activate): show discarded photos in edit mode for reassignment (5f21b84e)
- feat(activate): separate technician feedback from internal QA data (60343226)
- fix(activate): use correct API format for swap ticket creation (9a6654a2)
- docs(activate): update CLAUDE.md with serial swap detection features (1fce7ba2)
- docs(activate): update module README with serial swap detection (a8af2aca)
- fix(activate): return actual message with @mention in send-feedback response (cb260ae8)
- docs(skill): update activate skill with serial swap detection (51d255c6)
- feat(activate): improve serial feedback with partial serial display (4db4bbd2)
- docs(skill): add serial feedback functions to activate skill (0f81540e)
- feat(activate): improve QA Centre card display with rich status model (b16cd38a)
- feat(activate): add staff tagging and task creation in QA feedback (483af8d8)
- fix(activate): improve QA Centre card UI/UX (37fc0199)
- fix(db): robust migration script with DO blocks for missing constraints (842ac06f)
- feat(activate): add status timeline to QA Centre cards (ec79e16c)
- fix(activate): split status timeline - dates left, QA status right (2913e546)
- feat(maintenance): rename remaining ticket tables to maintenance (f8c57646)
- feat(staff): add WhatsApp JID field to staff edit form (22b0307c)
- feat(activate): compact inline status badges for QA Centre cards (994b364c)
- feat(staff): add script to populate WhatsApp IDs from phone numbers (719c8185)
- docs(skill): add QA Centre compact card layout documentation (bc9c89ca)
- docs(memory): add static assets 404 staging fix (6fa77304)
- fix(maintenance): use correct table name in sync status API (542886fd)
- fix(activate): auto-fetch photos for OES-only DRs (417d1494)
- feat(whatsapp): route QA feedback through dedicated sender (082 418 9511) (a0e108eb)
- feat(activate): add batch sync script for OneMap photos/serials (79080cf7)
- feat(activate): enhance QA Centre card with status badges and maintenance ticket (fe9e7f44)
- refactor(activate): improve QA Centre card layout with clearer structure (66d0fe24)
- refactor(activate): table-based QA Centre layout with column headers (edb197ce)
- style(activate): move QA Status and Outcome to middle of table (43447cd2)
- style(activate): center QA status/outcome, move serials to row 2 (978331fc)
- fix(activate): combine OES/ARCH import into single Data Import tab (8be54058)
- style(activate): show full ONT/UPS serials in QA Centre cards (46671464)
- feat(activate): add QA Status and Install Status filters to QA Centre (f08db85b)
- chore(activate): hide more test projects from filter dropdown (f0601727)
- feat(qfield): add OES data sync from Neon to QFieldCloud (4258503c)
- feat(activate): add Serial Status filter to QA Centre (6a346fa9)
- feat(activate): add daily target benchmark to trend reports (b80afbc0)
- feat(activate): add series and project visibility toggles to trend reports (20130ff8)
- fix(reports): show projects separately in bar chart, hide test projects (5c7ed685)
- fix(reports): exclude Marketing Activations from project toggles (a90d3a4a)
- style(reports): improve color contrast for trend chart series (bac78557)
- docs(activate): add Trend Reports documentation with toggles and colors (bc1797af)
- fix(api): use sql.query() for parameterized queries in qa-review-history (62c06ba5)
- fix(activate): remove Submitted date from DR Summary Timeline (f3a38be0)
- fix(activate): use WA Monitor review_date as fallback for Installed date (e4d55ead)

---

## [2026-01-18]

### 📝 Documentation
- docs: update skills and KB for Excel export feature (b77a7df0)

### 📦 Other Changes
- fix(procurement): fix API response parsing for projects (baf00ac9)
- fix(procurement): fix suppliers API response parsing in RFQ new page (7c83ba98)
- fix(theme): update BOQ list and card components to use dark theme variables (3ad9935d)
- fix(theme): apply dark theme to BOQ pages using correct CSS variables (6a9b01cd)
- fix(activate): use correct photo type to step mappings from stepMapper (6b205c75)
- fix(activate): remove ph_sign1 from step 10 mapping (374ebcde)
- fix(activate): add ph_sign1 to step 10 mapping (abd87376)
- fix(boq): align filters and status badges with dark mode spec (24ffb5cc)
- fix(boq): remove incorrect bg-tertiary wrapper, use AppLayout background (00fd5601)
- fix(layout): use primary background for outer wrapper (fcf2f933)
- fix(activate): resolve VLM image URL for server-side fetching (a0339bab)
- fix(boq): add p-6 padding to match Suppliers layout (ada5a393)
- feat(qa-learning): add HITL few-shot learning for VLM categorization (f4b05baf)
- feat(activate): add robust photo fetch service with retry logic (814eec28)
- feat(activate): add 'Discard - Rubbish' option for photo categorization (7ef24de2)
- fix(activate): add step 0 to stepMapper for correct_category in corrections (692d5ae4)
- fix(procurement): handle multiple status filters and supplier name display (7dfea466)
- fix(fleet): improve VLM accuracy with image resizing and result persistence (851a2492)
- fix(fleet): add VLM persistence logging and knowledge capture hook (f31ef75c)
- feat(fleet): add last reading display and anomaly detection for check-in (1c198a80)
- feat(fleet): add driver details and last readings to vehicle portal (050bdd63)
- fix(fleet): add emergency contact text to Fleet Manager notice (074f4fbe)
- feat(fleet): add last check-in info and history card to vehicle portal (ae5a0274)
- fix(fleet): correct check-in query column names (driver_name, check_date) (8812c4f5)
- feat(fleet): add vehicle-specific check-in history page (c21847eb)
- fix(fleet): fix dynamic route naming conflict for check-in history (a57cbf45)
- fix(fleet): fallback to check-in records for last ODO reading (b70929a7)
- docs(skill): update VLM skill with Fleet Portal and anomaly detection (485a2b43)
- fix(fleet): improve fuel gauge VLM prompt for better accuracy (f66579fe)
- fix(suppliers): add GRN dependency check to prevent FK violations on delete (41d97b53)
- fix(activate): use OES activation_date for Activated count (86b7b65f)
- feat(activate): add Status/Project/Date filters to Dashboard (52692e45)
- feat(activate): add CSV export with filter support (d7fdcc42)
- fix(activate): add missing searchTerm to handleClearFilters (5414c590)
- feat(activate): change export format from CSV to Excel (2971cce7)
- fix(activate): correct export SQL query for missing columns (98d613b2)
- feat(activate): add ONT/UPS serials to Excel export (efa5de23)
- refactor(activate): move Export Excel button next to filters in QA Centre (61cb95a0)
- fix(activate): correct WA Sender port from 8081 to 8090 (accb3ad2)
- fix(activate): support wa-feedback health response format (ef218aea)
- fix(activate): correct reporting calculations for INSTALLED/ACTIVATED (a69a2c64)
- fix(activate): align Dashboard stats with reporting (Total includes OES-only) (62b19094)
- refactor(activate): change Complete/Incomplete to Reviewed/Not Reviewed (a49fdafa)
- feat(activate): implement 5-phase QA Wizard with VLM integration (ba68e359)

---

## [2026-01-17]

### 🐛 Fixes
- fix: rename to 1M (not 1Map) (279d827a)
- fix: close health dropdown when clicking outside (a4df93e2)
- fix: resolve Clients RNaN bug and SOW dark theme issue (7a755828)
- fix: resolve procurement page hydration errors (196657fd)
- fix: prevent white flash on dark theme page refresh (7db4588f)

### 📝 Documentation
- docs: update session memory with health check fixes (6f51cf2b)

### 🔧 Chores
- chore: rename OneMap to 1Map in health dashboard (f6aa02e1)

### 📦 Other Changes
- fix(health-check): query correct table for WhatsApp Bridge status (3985077a)
- fix(health-check): get last submission from all records, not just last hour (ef09fce2)
- feat(health-dashboard): add expandable service status dropdown (c19a5aac)
- fix(procurement): resolve hydration errors with loading state (762d9a7d)
- fix(procurement): ensure all hooks called before early return (643cc51e)
- fix(procurement): add navigation to ProcurementTabs (e08981b8)
- feat(budget): add Budget Items tab and BOQ import modal to project budget page (eb46fc80)
- feat(sage): add public pages and database migration for Sage integration (fbeab58b)
- feat(sage): add Sage API client and endpoints (37a70669)
- fix(sage): redirect OAuth callback to /home instead of non-existent /settings/integrations (bd9013a9)
- feat(sage): add Integrations tab to Settings page with Sage configuration UI (340e5bf3)
- feat(sage): add supplier, invoice, payment sync services and cron job (f8ff36e2)
- fix(sage): use snake_case for API request/response fields (760ac6b3)
- feat(sage): implement Basic Auth for South African Sage API (118e22b5)
- feat(activate): add Reports tab with comprehensive reporting system (5a2212b2)
- fix(sage): improve error messages for API authentication failures (d5733e4b)
- fix(activate): use photo_count for completion status in reports (b2874b45)
- feat(sage): implement OAuth 2.0 for SA Sage Business Cloud API (0caf6572)
- feat(sage): update UI for OAuth 2.0 authentication (f4abe04f)
- feat(sage): switch to Basic Auth for SA Sage API v2.0.0 (162dc854)
- feat(reporting): update terminology to Installed/Complete/Incomplete/Activated (d0347f27)
- docs(sage): add SA Sage API knowledge and fix auth method (260b217c)
- feat(activate): add missing photo detection to WhatsApp feedback (fa05a989)
- feat(nav): add Activate menu item to Field Operations section (934a8b2a)
- fix(activate): correct WhatsApp bridge port and endpoint (d9eca442)
- docs(skill): update activate-module skill with Reports tab and terminology (c3b405f9)
- fix(activate): add null safety for incorrect_steps in send-feedback (f17081a3)
- fix(activate): add detailed logging to send-feedback for debugging (6b085f08)
- fix(activate): use hardcoded WhatsApp group mappings (7c2987ca)
- refactor(activate): clean up verbose debugging logs (d26a3a09)
- feat(activate): fix missing photos detection with correct 1Map mappings (b5a39cbe)
- feat(activate): simplify feedback to receipt acknowledgment with serials (49597a21)
- feat(activate): use friendly step descriptions in feedback (f2dbc561)
- fix(activate): add 'with labels' to green lights description (c11d8d21)
- fix(activate): prevent acknowledgment for DRs not found in 1Map (43cf1e08)
- feat(activate): add auto-refresh system with shared context (ab383ae3)
- feat(stock-items): add Stock Items CRUD module with Odoo sync (3f8c90a9)
- feat(activate): add comprehensive stats and reporting system (5ceb4ef3)
- fix(activate): prevent duplicate counts in Installed/Activated stats (bf42b28b)
- fix(activate): fix ambiguous column reference in activated query (3cf83419)
- checkpoint: before procurement navigation reorganization (c1a785a1)
- refactor(navigation): reorganize procurement and rename inventory to assets (c821e3d9)
- fix(procurement): add AppLayout wrapper to BOQ, RFQ, and Stock pages (c6a007ab)
- fix(procurement): convert StockManagement from react-router to Next.js (42d73630)
- feat(activate): implement 3-phase QA workflow with VLM validation (192a1c6d)
- feat(procurement): add missing pages and fix mock data issues (1994c48c)
- fix(build): resolve all build warnings and errors (28eadea0)
- feat(fleet): add debug photo saving for plate verification (f2ce61a9)
- fix(fleet): resize iPhone photos before VLM processing (bdaadfdd)
- fix(ocr): resize large images before VLM processing (daf9aa2d)
- fix(ocr): add sa_id document type alias for VLM extraction (cef350d7)

---

## [2026-01-16]

### 🐛 Fixes
- fix: use vf.fibreflow.app URL for staging in OES docs (979c52b7)

### ♻️ Refactoring
- refactor: rename dr-photo-unified to activate module (d645b7c5)

### 📝 Documentation
- docs: add DR Photo Unified module documentation to CLAUDE.md (38956244)
- docs: add dr-photo-unified module profile (831ecf88)
- docs: update server credentials and deployment commands (814f299e)
- docs: add OES import skill and command (b0c9e994)
- docs: update knowledge base with DR acknowledgment system (45fae7d6)

### 🔧 Chores
- chore: cleanup import paths and fix ticketing column names (7e577d73)
- chore: add Go bridge patch scripts for DR acknowledgment (0aa19683)

### 📦 Other Changes
- fix(dr-photo-unified): add photo proxy to fix image loading from external (0e1d396f)
- fix(dr-photo-unified): use PhotoGalleryUnified component in Photos tab (eb433dc5)
- fix(ticketing): align weeklyReportService with database schema (c45062ac)
- fix(dr-photo-unified): create unified review on-demand from qa_photo_reviews (63085255)
- feat(dr-photo-unified): add Fetch Photos button to load photos from OneMap (d9bdad66)
- feat(dr-photo-unified): auto-fetch photos and sync serial numbers from OneMap (474e2e5d)
- fix(dr-photo-unified): trigger download when OneMap record exists but photos empty (c62399de)
- fix(dr-photo-unified): pass force=true when manually fetching photos (01a3ba97)
- fix(procurement): fix VAT calculation in PO create (b3dbf699)
- refactor(dr-photo-unified): convert from 12-step to 10-step photo checklist (f6566d72)
- refactor(dr-photo-unified): update Qwen3 VLLM prompts for 10-step structure (dd0af6ca)
- fix(ticketing): add sheet auto-detection to weekly import API (4bcdadfa)
- fix(ticketing): use correct column name 'type' instead of 'ticket_type' (25e640e3)
- fix(procurement): fix PR to PO conversion API and UI (7318485c)
- fix(procurement): add tab content rendering to procurement portal (2b30cd3e)
- feat(procurement): add GRN and Approvals pages (a8aab227)
- fix(procurement): correct project column name in requisitions API (6319e133)
- feat(dr-photo-unified): add VLM categorization, health monitoring, and UI improvements (cc431f8b)
- fix(ticketing): persist QContact activities locally and fix weekly import (c3c51b36)
- feat(dr-photo-unified): default to today's filter with filters panel visible (cd60de3b)
- fix(dr-photo-unified): keep filters panel collapsed, only apply today filter by default (969a6eda)
- fix(dr-photo-unified): initialize date filters synchronously to fix project stats race condition (2489deb7)
- fix(dr-photo-unified): don't overwrite filtered projectStats from fetchDrops (4395dd48)
- feat(budget): add project budget tracking system (PRD-057) (c4e661a4)
- feat(projects): add Budget tab to project detail view (d716befc)
- feat(dr-photo-unified): use unified reviews table for DR list (14a5fc71)
- fix(dr-photo-unified): use correct column names after migration 054 (5b1a478a)
- fix(dr-photo-unified): fix date filter SQL with explicit DATE casting (6957d8b3)
- fix(budget): resolve SQL syntax errors in alerts and transactions APIs (65b4bfd8)
- fix(budget): correct data extraction for transactions and alerts (ec0bc104)
- feat(dr-photo-unified): add duplicate detection with submission history (2a4b742b)
- feat(dr-photo-unified): add submitted_date field for retroactive DR entry (6de7685e)
- feat(dr-photo-unified): add toast notifications for Manual Entry results (8a962a2c)
- debug: add logging to ManualDREntry for resubmission detection (ae594814)
- feat(dr-photo-unified): add agent phone number tracking from WA Monitor (893281be)
- fix(dr-photo-unified): filter by submitted_date instead of created_at (cffb5b0a)
- fix(dr-photo-unified): fix timezone handling for submitted_date filtering (c8a58ff6)
- feat(dr-photo-unified): add site submission tracking and OES import (e51806e6)
- feat(oes-import): add upsert support for repeated imports (b2a9c4e5)
- fix(dr-photo-unified): preserve original timestamp from qa_photo_reviews when syncing (5fb17a06)
- perf(oes-import): batch processing for 10x faster imports (e0926836)
- fix(oes-import): show results before refreshing page (a4175d2c)
- fix(oes-import): properly track inserts vs updates in batch mode (ae8dd80f)
- fix(oes-import): use count-based approach for insert/update tracking (30418b33)
- Merge pull request #43 from VelocityFibre/feature/rename-to-activate (fd8ede6c)
- refactor(activate): rename DR List tab to Dashboard (d1207362)
- fix(activate): apply project filter to dashboard stats and project table (36d377a1)
- fix(activate): server-side filtering for dashboard stats (32a7f8b0)
- fix(activate): trigger fetch on filter changes (8e946da0)
- fix(activate): call getTodaySAST() for initial date state (a86d0f91)
- fix(activate): only fetch when date filters are initialized (b4747106)
- fix(activate): use COALESCE for date filter when submitted_date is null (84f2b153)
- perf(activate): improve UX with skeleton loading and parallel queries (08af0574)
- feat(activate): add DR acknowledgment API for instant WhatsApp feedback (b5ef3a25)
- fix(activate): extract ONT serial from barcode scan data (87f72708)
- fix(activate): correct OneMap health check endpoint (d5b8cdb6)
- feat(activate): add WhatsApp Sender to health check (96f7636b)

---

## [2026-01-15]

### 📝 Documentation
- docs: add project import skill and enhance import script (669f62e7)
- docs: add theme-audit skill for light/dark theme visual audits (4c94aee4)

### 📦 Other Changes
- feat(fleet): add Vehicle Portal with plate verification and enhanced tracking (3b856b29)
- feat(sidebar): add customizable main menu items and improve navigation UX (dd53b492)
- fix(sidebar): prioritize dedicated sections over MAIN shortcuts (93c78cdd)
- feat(fleet): add comprehensive Fleet Analytics system (PRD-046) (562f3eb6)
- fix(fleet): replace alert() with toast notifications on Driver Leaderboard (2ecc721c)
- fix(fleet): add toast notifications to Maintenance page (3be24b2a)
- fix(fleet): add toast notification to Analytics page (14112526)
- fix(ui): replace remaining alert() calls with toast notifications (736fc91c)
- refactor(ui): replace all alert() calls with toast notifications (6baa459e)
- fix(dr-photo-unified): add server-side pagination to resolve 4MB API limit (#41) (05f689e6)
- fix(dr-photo-unified): fix quick filter button highlighting timezone mismatch (cb98a03e)
- feat(import): add unified project import system (PRD-047) (e2e7c1f5)
- fix(import): handle comma numbers and trailing space headers (4693f197)
- feat(fleet): add unified Fleet Drivers page with 4-tab structure (ff133347)
- fix(dr-photo-unified): calculate per-project stats from all records (32aab66d)
- fix(api): correct column names in projects API to match table schema (f81aa20b)
- fix(api): add project_code generation for new projects (f64e383f)
- fix(env): update production env with correct credentials (4d31cdc4)
- fix(api): accept project_name from frontend and handle nested location object (ea88064e)
- fix(ui): navigate to /projects/new instead of inline form (412b5f5e)
- fix(ui): update Project Detail cards to use dark theme CSS variables (26f135d4)
- fix(ui): improve dark theme contrast for project detail tabs and header (fca22bd2)
- fix(ticketing): remove view=all param from QContact API call (7d4f8792)
- fix(procurement): resolve React hydration errors #418/#423 (0506f1e1)
- fix(layout): resolve React hydration errors in AppLayout and AppRouterLayout (c46bd183)
- fix(hydration): use static dates in AuthContext mockUser (151c9615)
- docs(skills): add comprehensive QContact integration documentation (0df11615)
- refactor(themes): limit UI to Light and Dark themes only (8cc52dae)
- fix(theme): prevent hydration mismatch when theme preference is invalid (64336d62)
- fix(hydration): add protection for Date() calls in Footer and DashboardHeader (36ab3dbe)
- fix(ticketing): add weekly import parse endpoint and fix import flow (ae849458)
- fix(ticketing): weekly maintenance import with correct schema mapping (6939f677)
- feat(ticketing): add upsert logic for weekly import (3736eddb)
- refactor(ticketing): combine QContact Sync and Weekly Import into Data Sync page (721bc763)
- feat(ticketing): wire Risk Acceptance and Handover Center UIs to APIs (8e8583ed)
- fix(ticketing): cast text to uuid in risk acceptance join query (4b6f588d)
- fix(ticketing): use project_name column instead of name (8bfc3bdf)
- fix(ticketing): fix handover service project_name column and UUID cast (48710544)
- fix(ticketing): correct column names in handover service (zone, pole_id, pon, contractor_id) (20f576a6)
- fix(ticketing): handle nested error structure in weekly import (1db17dcf)

---

## [2026-01-14]

### ✨ Features
- feat: DR Photo Unified System - Complete Phase 6 Rollout (#40) (7582b10e)

### ♻️ Refactoring
- refactor: rename foto-review to photo-review (76073a38)

### 📦 Other Changes
- Merge branch 'feature/onemap-auto-sync' (c6d0d24a)
- feat(dr-photo): move ONT and UPS serials to dedicated row side-by-side (4e97bef1)
- checkpoint: before foto-review to photo-review rename (0e0ec2e2)
- Migrate BOSS VPS API references from 72.61.197.178 to Velocity Server (100.96.203.105) (16ab1e94)
- feat(fleet): add vehicle ownership management with tabbed detail page (#39) (7c7de5d0)
- feat(fleet): add investigation detail page for GPS analysis results (4719fa1c)
- feat(fleet): add daily vehicle check-in system for pre-trip inspections (318f2189)
- feat(fleet): add daily/weekly check-in modes with VLM integration (f9b23e53)
- fix(wa-monitor): revert UnifiedReviewCard integration from WA Monitor (cb7cc2cf)
- feat(fleet): improve vehicle retire/delete UX with toast notifications (3ff42d19)
- feat(fleet): add unified driver-vehicle assignment system (fef0db08)

---

## [2026-01-13]

### 📦 Other Changes
- fix(staff): fetch hasValidLicense from API instead of using complianceComplete (c9e90a70)
- feat(staff): complete HR system with tabbed edit form and enhanced vehicles (78d4377b)
- feat(staff): sync document data to employee details on upload (cdc0c4cf)
- feat(staff): add comprehensive document compliance tracking (8dcc0044)
- fix(staff): display SA ID and Passport in Overview tab (2a207552)
- fix(staff): enable clearing identity document fields in edit form (2e43bf66)
- fix(staff-docs): correct field name for document number sync (fb6b573c)
- feat(staff): add face photo extraction from ID documents using VLM (fb2aa0ea)
- refactor(staff): reorganize Overview tab layout for better UX (e47835f2)
- fix(staff): prevent ID photo replacement unless explicitly forced (e2762e8d)
- feat(ocr): add passport document type with proper field extraction (0a899f2d)
- feat(stock-tracking): implement 4-stage site stock tracking system (#37) (8281712b)
- feat(ocr): add driver's license OCR extraction with expiry detection (7b59b378)
- feat(ocr): replace tesseract with Qwen3-VL for all document OCR (e520823e)
- feat(staff): verification-based OCR sync for compulsory documents (0110c2ec)
- feat(onemap): implement automatic serial sync when DR submitted to WA Monitor (33aba264)
- feat(dr-photo-api): add ONT and UPS serial number cards to UI (998416ff)
- feat(dr-photo-api): improve serial card layout with click-to-copy functionality (b560b848)

---

## [2026-01-12]

### 📦 Other Changes
- fix(ocr): resolve double-click upload bug and add field extraction improvements (38612a91)
- Merge pull request #34 from VelocityFibre/feature/ocr-document-extraction (488e10ec)
- feat(sidebar): add collapsible sections and separate Clients from Staff (#35) (710232b1)
- feat(ocr): implement OcrResultsModal component for document extraction review (9df2f7d5)
- fix(ticketing): correct ticket count and set Kanban as default view (5ee692ad)
- fix(ocr): improve SA ID detection for both Smart ID cards and old ID books (3ae30dfa)
- fix(ocr): update server-side classification for Smart ID cards (26540b4a)
- feat(ocr): add Smart ID card and passport support to document classification (b69ee50a)
- feat(ocr): add international passport support for document classification (0a3566c0)
- fix(ocr): improve field extraction for bilingual passport format (9e85419e)
- feat(ticketing): add search functionality and QContact note sync (e31df44c)
- fix(ocr): improve classification scoring for large keyword sets (ae79b4bf)
- fix(ticketing): use correct QContact env vars for note sync (24040cde)
- fix(ocr): extract values from OCR field objects before upload (116568db)
- fix(ocr): always extract SA Smart ID card issued date (a7baef4a)
- fix(ocr): boost confidence for strong keyword+pattern evidence (e101319f)
- feat(staff): add document verification panel modal (4bc20f51)
- feat(ticketing): add QContact note sync with proper error handling (68431863)
- feat(staff-docs): implement type-first document upload flow (ffac3428)
- feat(ticketing): add clickable status and priority badges with flexible status system (ff33e73f)
- fix(ocr): simplify driver's license to single-file upload (front only) (b4bf4e29)
- feat(staff): comprehensive HR system expansion with 7-tab staff detail (#36) (05e48a8c)

---

## [2026-01-11]

### 📦 Other Changes
- feat(staff): implement document management with VF Storage (09e19dcb)
- feat(staff): implement OCR-first document upload wizard (PRD-033) (8f25a773)
- fix(ocr): correct OCR service health endpoint path (5eefb920)
- fix(ocr): add drag-and-drop handlers to document upload wizard (d66b3722)
- fix(ocr): make file input accessible for click-to-upload (cb660d49)
- feat(ocr): verify OCR wizard end-to-end with successful test (8b70b3ca)
- fix(ocr): add explicit onClick handler for file input trigger (19ef19d0)

---

## [2026-01-10]

### ✨ Features
- feat: Field Stock Control (PRD-027) + Complete Dark Mode (f1250292)

### 🐛 Fixes
- fix: resolve dashboard hydration errors and loading issues (d2e3c271)
- fix: remove App Router page routes that conflict with Pages Router (04a8523f)

### ♻️ Refactoring
- refactor: remove Clerk authentication references (f3aad28d)

### 📝 Documentation
- docs: update memories and skills with session progress (4c0e8bd9)
- docs: update memories with suppliers fix (039465c2)

### 🔧 Chores
- chore: trigger Vercel redeploy to fix intermittent 404s (07cd767a)
- chore: trigger fresh Vercel deployment (fb402687)

### 📦 Other Changes
- Merge pull request #32 from VelocityFibre/develop (59c73b9d)
- Revert "fix: remove App Router page routes that conflict with Pages Router" (23f84814)
- fix(sidebar): fix navigation by using Pages Router API (28d90f6d)
- feat(nav): add Field Stock Control to sidebar menu (c926f8fa)
- fix(suppliers): replace react-router useNavigate with Next.js useRouter (e9436967)
- fix(ui): standardize page spacing across Staff, Clients, Contractors, Projects (70ef4d94)
- fix(router): use next/navigation for hybrid App/Pages Router support (8b397616)
- fix(drops): fix spacing to match standard page layout (5d163565)
- feat(staff): improve staff import with flexible header mapping (e2421d75)

---

## [2026-01-09]

### ✨ Features
- feat: add PAI integration, GitHub workflow, and TDD enforcement (4ffd0757)

### 📝 Documentation
- docs: add comprehensive module documentation system for all 34 FF modules (c68df533)
- docs: add comprehensive development workflow guide (74ca8e9e)
- docs: add comprehensive database audit report (150175e0)

### 🔧 Chores
- chore: add OneMap sync script and misc updates (0bbcb18f)

### 📦 Other Changes
- ci: add Claude PR assistant GitHub Action (1f8c9ee5)
- Merge pull request #30 from VelocityFibre/develop (a67f53ca)
- Merge pull request #31 from VelocityFibre/develop (720981a6)

---


## [RESET] - 2026-01-09

### 🔄 Complete Repository Reset to Clean Foundation

**BREAKING CHANGE**: Force pushed to remove all authentication systems

#### Removed
- **All Clerk authentication code** (169 files cleaned)
- **PostgreSQL JWT authentication** (incomplete implementation)  
- **Development bypass sign-in page**
- **All auth-related dependencies**

#### Changed
- Reset to December 2024 base (commit `07372867`)
- Deployed production build (no dev mode)
- Force pushed to GitHub master (`1400838b`)

#### Technical Details
- No authentication system present
- Production build eliminates WebSocket/HMR issues
- Stable deployment on VF Server port 3006
- See `CLEAN_FOUNDATION.md` for complete details

---

## Previous History

- December 2024: Staff management, documents, exit workflow
- Earlier: See git history before reset
