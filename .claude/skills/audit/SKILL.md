---
name: audit
description: Comprehensive FibreFlow audit framework. 6-layer deep audit covering infrastructure, data integrity, functional correctness, UI/UX, security, and performance across all 58 modules, 170+ pages, 600+ APIs. USE WHEN user says '/audit', 'audit system', 'run audit', 'health check', 'system audit', 'full audit'.
disable-model-invocation: true
---

# /audit - FibreFlow Comprehensive Audit

Full-stack audit framework covering every module, page, API endpoint, button, link, form, modal, and integration in FibreFlow. Organized in 6 layers from infrastructure up to performance.

## Quick Reference

```bash
# Full audit (all layers, all modules)
tsx scripts/daily-audit/runner.ts

# Quick audit (P0 infrastructure only)
tsx scripts/daily-audit/runner.ts --quick

# Single layer
tsx scripts/daily-audit/runner.ts --suite <layer-name>

# Single module
tsx scripts/daily-audit/runner.ts --module <module-name>
```

---

## AUDIT LAYERS

| # | Layer | Priority | What It Covers | Est. Tests |
|---|-------|----------|----------------|------------|
| 1 | **Infrastructure** | P0 | DB, services, connectivity | ~30 |
| 2 | **Data Integrity** | P0 | Orphans, constraints, consistency, row counts | ~80 |
| 3 | **Functional** | P0 | Every API endpoint returns correct data, every workflow completes | ~650 |
| 4 | **UI/UX** | P1 | Every page loads, every button/link/modal/form works, themes | ~400 |
| 5 | **Security** | P1 | Auth enforcement, RBAC, injection, secrets, OWASP top 10 | ~60 |
| 6 | **Performance** | P2 | Response times, baselines, regressions, Lighthouse scores | ~50 |

**Total: ~1,270 tests across 58 modules**

---

## LAYER 1: INFRASTRUCTURE (P0)

Existing suite — validates that the platform is running.

### 1.1 Database Connectivity
| Test | Check | Pass Criteria |
|------|-------|---------------|
| DB ping | `SELECT 1` | Response < 1000ms |
| DB latency | 5-query average | Avg < 300ms, max < 1000ms |
| DB version | PostgreSQL version | Returns valid version |
| Connection pool | Concurrent connections | 5 parallel queries succeed |

### 1.2 Critical Tables (15 tables)
| Table | Min Rows | Purpose |
|-------|----------|---------|
| `users` | 1 | Authentication |
| `projects` | 1 | Project management |
| `clients` | 1 | Client records |
| `contractors` | 1 | Contractor records |
| `drops` | 1 | SOW drop data |
| `qa_photo_reviews` | 0 | WhatsApp QA data |
| `dr_photo_unified_reviews` | 0 | Unified DR reviews |
| `purchase_orders` | 0 | Procurement |
| `fleet_vehicles` | 0 | Fleet management |
| `fleet_check_records` | 0 | Fleet check-ins |
| `boq_items` | 0 | Bill of quantities |
| `rfqs` | 0 | Requests for quote |
| `staff` | 1 | Staff records |
| `custom_roles` | 1 | RBAC roles |
| `access_permissions` | 1 | RBAC permissions |

### 1.3 External Services
| Service | URL | Health Endpoint | Priority |
|---------|-----|-----------------|----------|
| VLM (Qwen3) | `100.96.203.105:8100` | `/health` | P0 |
| WA Bridge | `72.61.197.178:8083` | `/health` | P0 |
| VF Storage | `100.96.203.105:8091` | `/health` | P1 |
| QField Sync | `100.96.203.105:8095` | `/health` | P1 |
| 1Map API | `api.1map.co.za` | `/v1/layers` | P1 |
| Sage ERP | `oauth.accounting.sage.com` | `/token` | P1 |
| Resend Email | `api.resend.com` | `/domains` | P1 |

### 1.4 Backup Verification
| Test | Check | Pass Criteria |
|------|-------|---------------|
| Latest backup exists | `/home/velo/backups/neon/` | File < 7 days old |
| Backup size | Compressed `.sql.gz` | > 1MB (not empty) |
| Neon PITR | Neon console API | 30-day window active |

---

## LAYER 2: DATA INTEGRITY (P0)

Deep database validation — ensures data is correct, not just present.

### 2.1 Orphan Detection
| Test | Query | Pass Criteria |
|------|-------|---------------|
| Drops without project | `drops WHERE project_id NOT IN (SELECT id FROM projects)` | 0 rows |
| Staff without user | `staff WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)` | 0 rows |
| POs without supplier | `purchase_orders WHERE supplier_id NOT IN (SELECT id FROM suppliers)` | 0 rows |
| BOQ items without BOQ | `boq_line_items WHERE boq_id NOT IN (SELECT id FROM boqs)` | 0 rows |
| RFQ items without RFQ | `rfq_line_items WHERE rfq_id NOT IN (SELECT id FROM rfqs)` | 0 rows |
| GRN without PO | `goods_receipt_notes WHERE po_id NOT IN (SELECT id FROM purchase_orders)` | 0 rows |
| Fleet records without vehicle | `fleet_check_records WHERE vehicle_id NOT IN (SELECT id FROM fleet_vehicles)` | 0 rows |
| Tickets without project | `noc_tickets WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)` | 0 rows |
| DR reviews without drop | `dr_photo_unified_reviews WHERE drop_number NOT IN (SELECT drop_number FROM drops)` | Warning only (WA data may precede SOW) |
| Permissions without role | `role_permissions WHERE role_id NOT IN (SELECT id FROM custom_roles)` | 0 rows |
| User overrides without user | `user_permission_overrides WHERE user_id NOT IN (SELECT id FROM users)` | 0 rows |
| Action items without meeting | `action_items WHERE meeting_id IS NOT NULL AND meeting_id NOT IN (SELECT id FROM meetings)` | 0 rows |
| Vehicle assignments without vehicle | `vehicle_project_assignments WHERE vehicle_id NOT IN (SELECT id FROM fleet_vehicles)` | 0 rows |
| Snags without project | `snags WHERE project_id NOT IN (SELECT id FROM projects)` | 0 rows |

### 2.2 Referential Integrity
| Test | Check | Pass Criteria |
|------|-------|---------------|
| Projects have valid client | `projects.client_id` → `clients.id` | All match |
| Contractors have valid projects | `contractor_projects.project_id` → `projects.id` | All match |
| Staff department exists | `staff.department_id` → `departments.id` (if FK) | All match |
| PO line items match stock | `po_line_items.stock_item_id` → `stock_items.id` | All match |

### 2.3 Business Rule Validation
| Test | Check | Pass Criteria |
|------|-------|---------------|
| No duplicate drop numbers per project | `SELECT drop_number, project_id, COUNT(*) ... HAVING COUNT(*) > 1` | 0 duplicates |
| No duplicate ONT serials (active) | `SELECT ont_serial, COUNT(*) FROM drops WHERE status='active' ... HAVING COUNT(*) > 1` | 0 duplicates |
| PO totals match line items | `purchase_orders.total_amount = SUM(po_line_items.total)` | All match |
| BOQ totals match line items | `boqs.total_amount = SUM(boq_line_items.total)` | All match |
| No future-dated DRs | `dr_photo_unified_reviews.created_at > NOW()` | 0 rows |
| User emails unique | `SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1` | 0 duplicates |
| Active vehicles have license plate | `fleet_vehicles WHERE status='active' AND license_plate IS NULL` | 0 rows |
| Approved POs have approver | `purchase_orders WHERE status='approved' AND approved_by IS NULL` | 0 rows |

### 2.4 Data Freshness
| Test | Check | Pass Criteria |
|------|-------|---------------|
| Recent DR activity | `MAX(created_at) FROM dr_photo_unified_reviews` | < 48 hours (weekdays) |
| Recent fleet check-ins | `MAX(created_at) FROM fleet_check_records` | < 48 hours (weekdays) |
| Recent QField sync | `MAX(synced_at) FROM qfield_sync_history` | < 7 days |
| OES data current | `MAX(import_date) FROM oes_activations` | < 7 days |

### 2.5 Volume Sanity
| Table | Expected Range | Alert If |
|-------|---------------|----------|
| `users` | 20-500 | < 5 or > 1000 |
| `projects` | 5-100 | < 1 or > 500 |
| `drops` | 1000-100000 | < 100 |
| `staff` | 10-500 | < 5 |
| `fleet_vehicles` | 5-200 | < 1 |
| `purchase_orders` | 10-5000 | < 1 |
| `noc_tickets` | 100-50000 | < 10 |
| `access_permissions` | 50-500 | < 20 |

---

## LAYER 3: FUNCTIONAL (P0)

Every API endpoint tested for correct behavior, every workflow validated end-to-end.

### 3.1 API Endpoint Coverage

Auto-discovered from `pages/api/`. Each endpoint tested for:
1. **Reachability** — returns HTTP response (not timeout/crash)
2. **Auth enforcement** — protected endpoints reject unauthenticated requests
3. **Response format** — returns valid JSON with expected shape
4. **Error handling** — invalid input returns 400, not 500

#### Module: Activate (58 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/activate/drops` | GET | Yes | Returns array, pagination works |
| `/api/activate/summary` | GET | Yes | Returns object with stats |
| `/api/activate/[dropNumber]` | GET | Yes | Returns single DR detail |
| `/api/activate/fetch-photos` | POST | Yes | Accepts drop_number, returns photos |
| `/api/activate/categorize-photos` | POST | Yes | VLM categorization returns step mapping |
| `/api/activate/extract-data` | POST | Yes | VLM extraction returns serial/power data |
| `/api/activate/validate-prerequisites` | POST | Yes | Returns validation result |
| `/api/activate/human-review` | POST | Yes | Saves correction, returns updated record |
| `/api/activate/final-decision` | POST | Yes | Saves PASS/FAIL/REWORK decision |
| `/api/activate/send-feedback` | POST | Yes | Sends WA message, returns confirmation |
| `/api/activate/dr-acknowledgment` | POST | Yes | Processes DR ACK |
| `/api/activate/health-check` | GET | Yes | Returns 5 service statuses |
| `/api/activate/serial-verification` | POST | Yes | Validates ONT serial |
| `/api/activate/serial-history` | GET | Yes | Returns serial change log |
| `/api/activate/sync-installer-names` | POST | Yes | Syncs names from OES |
| `/api/activate/sync-oes-to-qfield` | POST | Yes | Pushes data to QField |
| `/api/activate/trigger-qfield-sync` | POST | Yes | Initiates QField sync |
| `/api/activate/validate-qa` | POST | Yes | Runs QA validation rules |
| `/api/activate/auto-qa-reset` | POST | Yes | Resets stuck QA items |
| `/api/activate/import-oes` | POST | Yes | Imports OES Excel |
| `/api/activate/import-offline` | POST | Yes | Offline import |
| `/api/activate/import-pp-data` | POST | Yes | Pre-provision data |
| `/api/activate/pp-data-resolve` | POST | Yes | Resolve PP conflicts |
| `/api/activate/pp-data-tickets` | GET | Yes | PP ticket list |
| `/api/activate/wa-photos` | GET | Yes | WA photo list |
| `/api/activate/check-photos` | POST | Yes | Photo availability check |
| `/api/activate/check-oes-view` | POST | Yes | OES view check |
| `/api/activate/check-oes-coordinates` | POST | Yes | Coordinate check |
| `/api/activate/activity-log` | GET | Yes | Activity history |
| `/api/activate/staff-by-project` | GET | Yes | Staff per project |
| `/api/activate/sharepoint-sync` | POST | Yes | SharePoint photo sync |
| `/api/activate/sharepoint-sync-batch` | POST | Yes | Batch SharePoint sync |
| `/api/activate/admin/retry-failed` | POST | Yes | Retry failed items |
| `/api/activate/approve-categorization` | GET | Yes | Approve AI category |
| `/api/activate/wa-contacts` | GET | Yes | WA contact list |
| `/api/activate/wa-swap-message` | POST | Yes | Swap notification |
| `/api/activate/ensure-data` | POST | Yes | Ensure data completeness |
| `/api/activate/update-photo-step` | POST | Yes | Update step assignment |
| `/api/activate/export` | POST | Yes | Excel export |
| `/api/activate/evaluate` | POST | Yes | Evaluate DR quality |
| **Reporting (18 endpoints):** | | | |
| `/api/activate/reporting/activation-progress` | GET | Yes | Progress chart data |
| `/api/activate/reporting/daily-counts` | GET | Yes | Daily count data |
| `/api/activate/reporting/discrepancy` | GET | Yes | Discrepancy report |
| `/api/activate/reporting/funnel` | GET | Yes | Conversion funnel |
| `/api/activate/reporting/installation-gaps` | GET | Yes | Gap analysis |
| `/api/activate/reporting/maturity-tracking` | GET | Yes | Maturity curve |
| `/api/activate/reporting/offline-devices` | GET | Yes | Offline device list |
| `/api/activate/reporting/pending-aging` | GET | Yes | Aging analysis |
| `/api/activate/reporting/penetration-curve` | GET | Yes | Penetration data |
| `/api/activate/reporting/resubmissions` | GET | Yes | Resubmission stats |
| `/api/activate/reporting/serial-mismatches` | GET | Yes | Serial mismatch list |
| `/api/activate/reporting/serial-swaps` | GET | Yes | Serial swap list |
| `/api/activate/reporting/serial-validation` | GET | Yes | Validation report |
| `/api/activate/reporting/team-performance` | GET | Yes | Team metrics |
| `/api/activate/reporting/time-to-activation` | GET | Yes | Time analysis |
| `/api/activate/reporting/trends` | GET | Yes | Trend data |
| `/api/activate/reporting/user-attribution` | GET | Yes | User contribution |
| `/api/activate/reporting/vlm-accuracy` | GET | Yes | VLM accuracy stats |

#### Module: Procurement (60+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/procurement/boqs` | GET | Yes | List with pagination |
| `/api/procurement/boqs` | POST | Yes | Create BOQ |
| `/api/procurement/boqs/[id]` | GET | Yes | Single BOQ detail |
| `/api/procurement/boqs/[id]` | POST | Yes | Update BOQ |
| `/api/procurement/rfqs` | GET/POST | Yes | CRUD |
| `/api/procurement/rfqs/[id]` | GET | Yes | RFQ detail with line items |
| `/api/procurement/quotes` | GET/POST | Yes | Quote CRUD |
| `/api/procurement/quotes/[id]` | POST | Yes | Update quote |
| `/api/procurement/purchase-orders` | GET/POST | Yes | PO CRUD |
| `/api/procurement/purchase-orders/[id]` | GET/POST | Yes | PO detail/update |
| `/api/procurement/goods-receipt-notes` | GET/POST | Yes | GRN CRUD |
| `/api/procurement/stock` | GET | Yes | Stock levels |
| `/api/procurement/stock-takes` | GET/POST | Yes | Stock take CRUD |
| `/api/procurement/stock-movements` | GET/POST | Yes | Movement history |
| `/api/procurement/purchase-requisitions` | GET/POST | Yes | Requisition CRUD |
| `/api/procurement/suppliers` | GET/POST | Yes | Supplier CRUD |
| `/api/procurement/approval-workflows` | GET/POST | Yes | Workflow config |
| `/api/procurement/approval-requests` | GET/POST | Yes | Approval CRUD |
| `/api/procurement/field-stock/movements` | GET/POST | Yes | Field stock movements |
| `/api/procurement/stock-adjustments` | GET/POST | Yes | Adjustments |

#### Module: Projects (20+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/projects` | GET | Yes | List with filters |
| `/api/projects` | POST | Yes | Create project |
| `/api/projects/[id]` | GET | Yes | Project detail |
| `/api/projects/[id]` | POST | Yes | Update project |
| `/api/projects/[id]` | DELETE | Yes | Delete project |
| `/api/projects/summary` | GET | Yes | Summary stats |
| `/api/projects/[id]/installations` | GET | Yes | Installation list |
| `/api/projects/[id]/tasks` | GET | Yes | Task list |
| `/api/projects/[id]/tracker` | GET | Yes | Progress tracker |
| `/api/projects/[id]/budget` | GET/POST | Yes | Budget CRUD |
| `/api/projects/[id]/health-safety` | GET/POST | Yes | H&S records |

#### Module: Fleet (25+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/fleet/vehicles` | GET/POST | Yes | Vehicle CRUD |
| `/api/fleet/vehicles/[id]` | GET/POST/DELETE | Yes | Vehicle detail/update/delete |
| `/api/fleet/check-records` | GET/POST | Yes | Check-in CRUD |
| `/api/fleet/check-records/[recordId]` | GET | Yes | Record detail |
| `/api/fleet/drivers` | GET/POST | Yes | Driver CRUD |
| `/api/fleet/fuel` | GET/POST | Yes | Fuel tracking |
| `/api/fleet/maintenance` | GET/POST | Yes | Maintenance CRUD |
| `/api/fleet/mileage` | GET | Yes | Mileage report |
| `/api/fleet/analytics` | GET | Yes | Fleet analytics |
| `/api/fleet/locations` | GET | Yes | Vehicle locations |
| `/api/fleet/investigation` | GET/POST | Yes | Investigation CRUD |
| `/api/fleet/import` | POST | Yes | Data import |
| `/api/fleet/calibration` | GET/POST | Yes | Calibration records |

#### Module: Staff (15+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/staff` | GET/POST | Yes | Staff CRUD |
| `/api/staff/[id]` | GET/POST/DELETE | Yes | Staff detail |
| `/api/staff/import` | POST | Yes | Bulk import |
| `/api/staff/departments` | GET/POST | Yes | Department CRUD |
| `/api/staff/summary` | GET | Yes | Stats |
| `/api/staff/compliance` | GET | Yes | Compliance report |
| `/api/staff/alerts` | GET | Yes | Alert list |
| `/api/staff/birthdays` | GET | Yes | Birthday list |

#### Module: Clients (8 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/clients` | GET/POST | Yes | Client CRUD |
| `/api/clients/[id]` | GET/POST/DELETE | Yes | Client detail |
| `/api/clients/[id]/projects` | GET | Yes | Client projects |
| `/api/clients/[id]/kyc-documents` | GET/POST | Yes | KYC CRUD |
| `/api/clients/summary` | GET | Yes | Stats |

#### Module: Contractors (15 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/contractors` | GET/POST | Yes | Contractor CRUD |
| `/api/contractors/[contractorId]` | GET/POST/DELETE | Yes | Detail |
| `/api/contractors/[contractorId]/onboarding/stages` | GET | Yes | Onboarding stages |
| `/api/contractors/[contractorId]/onboarding/stages/[stageId]` | GET/POST | Yes | Stage detail |
| `/api/contractors/[contractorId]/onboarding/complete` | POST | Yes | Complete onboarding |
| `/api/contractors-detail` | GET | Yes | Extended detail |
| `/api/contractors-directors` | GET | Yes | Director list |

#### Module: Communications/WhatsApp (30 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/communications/messages` | GET/POST | Yes | Message CRUD |
| `/api/communications/messages-unread-count` | GET | Yes | Unread count |
| `/api/communications/messages-read` | POST | Yes | Mark read |
| `/api/communications/messages-archive` | POST | Yes | Archive |
| `/api/communications/email-outbox` | GET/POST | Yes | Email queue |
| `/api/communications/email-send` | POST | Yes | Send email |
| `/api/communications/badge-counts` | GET | Yes | Notification counts |
| `/api/communications/feed` | GET | Yes | Activity feed |
| `/api/communications/settings` | GET/POST | Yes | Config |
| `/api/communications/whatsapp/config` | GET/POST | Yes | WA config |
| `/api/communications/whatsapp/groups` | GET/POST | Yes | WA groups |
| `/api/communications/whatsapp/phones` | GET/POST | Yes | WA phones |
| `/api/communications/whatsapp/templates` | GET/POST | Yes | WA templates |
| `/api/communications/whatsapp/send-message` | POST | Yes | Send WA message |
| `/api/communications/whatsapp/service-status` | GET | Yes | Service status |
| `/api/communications/whatsapp/logs` | GET | Yes | Message logs |

#### Module: Construction QA (15 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/construction-qa/features` | GET | Yes | Feature list |
| `/api/construction-qa/pon-features` | GET | Yes | PON features |
| `/api/construction-qa/review` | POST | Yes | Submit review |
| `/api/construction-qa/batch-approve` | POST | Yes | Batch approve |
| `/api/construction-qa/photo-step` | POST | Yes | Photo step assignment |
| `/api/construction-qa/vlm-validate` | POST | Yes | VLM validation |
| `/api/construction-qa/ingest-qfield` | POST | Yes | QField ingestion |
| `/api/construction-qa/project-dashboard` | GET | Yes | Dashboard data |
| `/api/construction-qa/final-decision` | POST | Yes | QA decision |
| `/api/construction-qa/zone-hierarchy` | GET | Yes | Zone tree |
| `/api/construction-qa/export` | POST | Yes | Export data |
| `/api/construction-qa/reports` | GET | Yes | Report data |
| `/api/construction-qa/search` | GET | Yes | Search |
| `/api/construction-qa/photo-proxy` | GET | Yes | Photo proxy |

#### Module: Field Ops (25+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/field-ops/reviews` | GET/POST | Yes | Review CRUD |
| `/api/field-ops/[reviewId]` | GET/POST | Yes | Review detail |
| `/api/field-ops/snags` | GET/POST | Yes | Snag CRUD |
| `/api/field-ops/snags-query` | POST | Yes | Advanced query |
| `/api/field-ops/snags/upload-photo` | POST | Yes | Photo upload |
| `/api/field-ops/snags/photos` | GET | Yes | Photo list |
| `/api/field-ops/snags/stats` | GET | Yes | Snag stats |
| `/api/field-ops/otdr` | GET | Yes | OTDR data |
| `/api/field-ops/reports` | GET/POST | Yes | Report CRUD |

#### Module: Ticketing/NOC (40+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/ticketing/tickets` | GET/POST | Yes | Ticket CRUD |
| `/api/ticketing/tickets/[id]` | GET/POST | Yes | Ticket detail |
| `/api/ticketing/tickets/[id]/notes` | GET/POST | Yes | Note CRUD |
| `/api/ticketing/teams` | GET/POST | Yes | Team CRUD |
| `/api/ticketing/escalations` | GET/POST | Yes | Escalation CRUD |
| `/api/ticketing/risks` | GET/POST | Yes | Risk CRUD |
| `/api/ticketing/data-sync` | GET/POST | Yes | QContact sync |
| `/api/noc/dashboard` | GET | Yes | NOC dashboard |
| `/api/noc/wa-tracking` | GET | Yes | WA tracking |

#### Module: Accounting (165 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/accounting/chart-of-accounts` | GET/POST | Yes | COA CRUD |
| `/api/accounting/journal-entries` | GET/POST | Yes | JE CRUD |
| `/api/accounting/journal-entries-action` | POST | Yes | JE actions (post/reverse) |
| `/api/accounting/fiscal-periods` | GET/POST | Yes | Period CRUD |
| `/api/accounting/supplier-invoices` | GET/POST | Yes | Invoice CRUD |
| `/api/accounting/supplier-payments` | GET/POST | Yes | Payment CRUD |
| `/api/accounting/ap-aging` | GET | Yes | AP aging report |
| `/api/accounting/customer-payments` | GET/POST | Yes | Customer payment CRUD |
| `/api/accounting/ar-aging` | GET | Yes | AR aging report |
| `/api/accounting/credit-notes` | GET/POST | Yes | Credit note CRUD |
| `/api/accounting/bank-transactions` | GET | Yes | Bank transactions |
| `/api/accounting/bank-transactions-import` | POST | Yes | Import bank statement |
| `/api/accounting/bank-reconciliations` | GET/POST | Yes | Reconciliation CRUD |
| `/api/accounting/reports-trial-balance` | GET | Yes | Trial balance |
| `/api/accounting/reports-income-statement` | GET | Yes | Income statement |
| `/api/accounting/reports-balance-sheet` | GET | Yes | Balance sheet |
| `/api/accounting/reports-vat-return` | GET | Yes | VAT return |
| *(+135 additional accounting endpoints)* | | | |

#### Module: QField Sync (30+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/qfield-sync-dashboard` | GET/POST | Yes | Dashboard data |
| `/api/qfield-sync-current` | GET | Yes | Current sync status |
| `/api/qfield-sync-history` | GET | Yes | Sync history |
| `/api/qfield-sync-start` | POST | Yes | Start sync |
| `/api/qfield-sync-cancel` | POST | Yes | Cancel sync |
| `/api/qfield-sync-conflicts` | POST | Yes | Resolve conflicts |
| `/api/qfield-sync-config` | GET/PUT | Yes | Config CRUD |
| `/api/qfield-sync-poles` | GET | Yes | Pole data |
| `/api/qfield-sync-cables` | GET | Yes | Cable data |
| `/api/qfield-sync-drops` | GET | Yes | Drop data |

#### Module: Admin/Auth (28 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/auth/login` | POST | No | Login with credentials |
| `/api/auth/logout` | POST | Yes | Invalidate session |
| `/api/auth/me` | GET | Yes | Current user |
| `/api/auth/check-email` | GET | No | Email availability |
| `/api/auth/forgot-password` | POST | No | Password reset email |
| `/api/auth/reset-password` | POST | No | Reset with token |
| `/api/admin/permissions` | GET/POST | Yes (admin) | Permission CRUD |
| `/api/admin/permissions/me` | GET | Yes | My permissions |
| `/api/admin/roles` | GET/POST | Yes (admin) | Role CRUD |
| `/api/admin/users` | GET/POST | Yes (admin) | User CRUD |
| `/api/admin/users/[userId]` | GET/POST | Yes (admin) | User detail |
| `/api/admin/users/[userId]/permissions` | POST | Yes (admin) | Set permissions |

#### Module: Analytics/Reports (10+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/analytics/dashboard/stats` | GET | Yes | Dashboard stats |
| `/api/analytics/dashboard/summary` | GET | Yes | Summary data |
| `/api/analytics/dashboard/trends` | GET | Yes | Trend data |
| `/api/analytics/projects/summary` | GET | Yes | Project analytics |
| `/api/reports/progress-today` | GET | Yes | Today's progress |
| `/api/reports/weekly-activations` | GET | Yes | Weekly activations |

#### Module: SOW (10+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/sow/drops` | GET/POST | Yes | Drop CRUD |
| `/api/sow/import` | POST | Yes | Excel import |
| `/api/sow/list` | GET | Yes | SOW list |
| `/api/sow/grid` | GET | Yes | Grid data |

#### Module: OneMap (15+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/onemap/layers` | GET/POST | Yes | Layer CRUD |
| `/api/onemap/map-data` | GET | Yes | Map data |
| `/api/onemap/features` | GET/POST | Yes | Feature CRUD |
| `/api/onemap/search` | GET | Yes | Search |
| `/api/onemap/import` | POST | Yes | Data import |
| `/api/onemap/export` | POST | Yes | Data export |
| `/api/onemap/poles` | GET | Yes | Pole data |
| `/api/onemap/cables` | GET | Yes | Cable data |
| `/api/onemap/drop-locations` | GET | Yes | Drop locations |

#### Module: Health & Safety (10+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/health-safety/audits` | GET/POST | Yes | Audit CRUD |
| `/api/health-safety/incidents` | GET/POST | Yes | Incident CRUD |
| `/api/health-safety/checklists` | GET/POST | Yes | Checklist CRUD |
| `/api/health-safety/capa` | GET/POST | Yes | CAPA CRUD |
| `/api/health-safety/risks` | GET/POST | Yes | Risk CRUD |

#### Module: Suppliers (10 endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/suppliers` | GET/POST | Yes | Supplier CRUD |
| `/api/suppliers/[id]` | GET/POST/DELETE | Yes | Detail |
| `/api/suppliers/performance` | GET | Yes | Performance metrics |
| `/api/suppliers/categories` | GET | Yes | Category list |

#### Module: Settings/System (15+ endpoints)

| Endpoint | Method | Auth | Test |
|----------|--------|------|------|
| `/api/settings` | GET/POST | Yes | App settings |
| `/api/system/health` | GET | No | System health |
| `/api/system/infrastructure` | GET | Yes | Infra status |
| `/api/system/data-sync` | GET/POST | Yes | Sync status |
| `/api/health` | GET | No | Basic health |
| `/api/version` | GET | No | Version info |

#### Remaining Modules (misc endpoints)

| Module | Endpoints | Auth | Notes |
|--------|-----------|------|-------|
| Meetings | 5+ | Yes | Meeting CRUD, action items |
| Action Items | 5+ | Yes | CRUD, status updates |
| Notifications | 5+ | Yes | CRUD, mark read |
| Billing | 5+ | Yes | Billing CRUD |
| Data Sync | 10+ | Yes | OLT, document sync |
| Pipeline | 8+ | Yes | Pipeline CRUD, authorities |
| LiveKit | 3+ | Yes | Room management |
| Help Center | 3+ | Yes | Article CRUD |
| Barcode Scanner | 2+ | Yes | Scan processing |

### 3.2 Workflow End-to-End Tests

Complete business workflows that span multiple modules.

| # | Workflow | Steps | Modules Involved |
|---|----------|-------|------------------|
| W1 | **SOW → Drop → Activate → QA → Feedback** | Import SOW Excel → drops created → DR submitted via WA → VLM categorizes → QA wizard review → PASS/FAIL → WA feedback sent | SOW, Activate, WA Monitor, VLM |
| W2 | **BOQ → RFQ → Quote → PO → GRN → Stock** | Create BOQ → Generate RFQ → Supplier submits quote → Convert to PO → Approve → Receive goods → Stock updated | Procurement (full chain) |
| W3 | **Staff → User → RBAC → Access** | Create staff → Provision user → Assign role → Verify page access → Verify API access | Staff, Admin, Access Control |
| W4 | **Project → Budget → Procurement → Tracking** | Create project → Set budget → Create BOQ → Link PO → Track spend vs budget | Projects, Procurement |
| W5 | **Fleet Check-in → VLM → Maintenance** | Select vehicle → Complete checklist → Upload photos → VLM reads plate/odometer → Flag maintenance | Fleet, VLM |
| W6 | **Contractor Onboarding → Documents → RAG** | Create contractor → Start onboarding → Upload documents → Complete stages → RAG status green | Contractors |
| W7 | **Ticket → Escalation → Resolution → Close** | Create ticket → Auto-escalate (SLA) → Assign team → Resolve → Team lead closes | Ticketing/NOC |
| W8 | **QField Sync → Poles → Cables → Map** | Trigger sync → Poles imported → Cables linked → Map renders → Search works | QField, OneMap |
| W9 | **Field Ops → Snag → Photo → Ticket** | Create field review → Report snag → Upload photo → Auto-create NOC ticket | Field Ops, Ticketing |
| W10 | **Construction QA → VLM → Approve → QField** | Ingest QField photos → VLM validates → Human QA review → Push comment to QField | Construction QA, VLM, QField |
| W11 | **Accounting → Invoice → Payment → Reconciliation** | Create invoice → Record payment → Import bank statement → Match transactions → Reconcile | Accounting |
| W12 | **H&S Incident → CAPA → Risk → Checklist** | Report incident → Create CAPA → Update risk register → Generate checklist | Health & Safety |

### 3.3 CRUD Completeness Matrix

Every entity must support its full lifecycle:

| Entity | Create | Read | Update | Delete | List | Filter | Export |
|--------|--------|------|--------|--------|------|--------|--------|
| Project | C | R | U | D | L | F | E |
| Client | C | R | U | D | L | F | - |
| Contractor | C | R | U | D | L | F | - |
| Staff | C | R | U | D | L | F | E |
| Supplier | C | R | U | D | L | F | - |
| Vehicle | C | R | U | D | L | F | E |
| BOQ | C | R | U | D | L | F | E |
| RFQ | C | R | U | - | L | F | E |
| PO | C | R | U | - | L | F | E |
| GRN | C | R | U | - | L | F | - |
| Ticket | C | R | U | - | L | F | E |
| DR Review | - | R | U | - | L | F | E |
| Snag | C | R | U | - | L | F | E |
| Meeting | C | R | U | D | L | F | - |
| Action Item | C | R | U | D | L | F | - |
| Journal Entry | C | R | - | - | L | F | E |
| Invoice | C | R | U | - | L | F | E |

---

## LAYER 4: UI/UX (P1)

Every page, button, link, modal, form, filter, and theme tested via browser automation.

### 4.1 Page Load Matrix

Every page must:
1. Return HTTP 200 (or 302 for auth-required)
2. Render without JavaScript errors
3. Display correct content (not blank/loading forever)
4. Work in both light and dark theme

#### Main Pages (8)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Dashboard | `/dashboard` | P0 | Stats cards, charts render |
| Home | `/` | P0 | Redirect to dashboard |
| Profile | `/profile` | P1 | User details display |
| Settings | `/settings` | P1 | Settings form loads |
| Meetings | `/meetings` | P2 | Meeting list loads |
| Action Items | `/action-items` | P2 | Action item list loads |
| Analytics | `/analytics` | P1 | Charts render |
| KPI Dashboard | `/kpi-dashboard` | P1 | KPI cards render |

#### Activate Pages (10)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| DR Summary | `/activate` | P0 | Project cards with stats |
| QA Centre | `/activate/qa-centre` | P0 | DR list with filters |
| QA Detail | `/activate/qa-centre/[drop]` | P0 | 5-phase wizard renders |
| DR Detail | `/activate/[drop]` | P0 | Full DR detail |
| Monitoring | `/activate/monitoring` | P1 | 5 service cards |
| Reports | `/activate/reports` | P1 | Report tabs |
| Technicians | `/activate/technicians` | P1 | Tech list |
| Tech Detail | `/activate/technicians/[id]` | P1 | Tech profile |
| Data Sync | `/activate/data-sync` | P1 | Sync status |

#### Procurement Pages (23)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Dashboard | `/procurement` | P0 | Stats cards, quick actions |
| BOQ List | `/procurement/boq` | P0 | Table with filters |
| BOQ Create | `/procurement/boq/new` | P0 | Form renders |
| BOQ Detail | `/procurement/boq/[id]` | P0 | Line items display |
| RFQ List | `/procurement/rfq` | P0 | Table with filters |
| RFQ Create | `/procurement/rfq/new` | P0 | Form renders |
| RFQ Detail | `/procurement/rfq/[id]` | P0 | Detail with suppliers |
| PO List | `/procurement/purchase-orders` | P0 | Table with filters |
| PO Create | `/procurement/purchase-orders/new` | P0 | Form renders |
| PO Detail | `/procurement/purchase-orders/[id]` | P0 | PO with line items |
| GRN List | `/procurement/grn` | P1 | Table loads |
| GRN Create | `/procurement/grn/new` | P1 | Form renders |
| Requisitions | `/procurement/requisitions` | P1 | Table loads |
| Stock | `/procurement/stock` | P1 | Stock levels display |
| Stock Items | `/procurement/stock-items` | P1 | Catalog loads |
| Stock Takes | `/procurement/stock-takes` | P2 | Table loads |
| Field Stock | `/procurement/field-stock` | P1 | Location stats |
| Reconciliation | `/procurement/field-stock/reconciliation` | P2 | Variance display |
| Approvals | `/procurement/approvals` | P1 | Pending items |
| Bundles | `/procurement/bundles` | P2 | Bundle list |
| Financial | `/procurement/financial` | P2 | Financial reports |
| Reports | `/procurement/reports` | P2 | Report tabs |
| Open Orders | `/procurement/open-orders` | P2 | Open order list |

#### Projects Pages (15)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Project List | `/projects` | P0 | Grid/table view |
| Create Project | `/projects/new` | P0 | Form renders |
| Project Detail | `/projects/[id]` | P0 | Tabs load |
| Edit Project | `/projects/[id]/edit` | P0 | Form prefilled |
| Tracker | `/projects/[id]/tracker` | P1 | Progress chart |
| Budget | `/projects/[id]/budget` | P1 | Budget overview |
| Tasks | `/projects/tasks` | P1 | Task list |
| Progress | `/projects/progress` | P1 | Progress report |
| Reports | `/projects/reports` | P2 | Report tabs |
| Daily Progress | `/projects/daily-progress` | P1 | Daily report |
| Pipeline | `/projects/pipeline` | P1 | Pipeline board |
| H&S | `/projects/health-safety` | P1 | H&S dashboard |
| H&S Incidents | `/projects/health-safety/incidents` | P2 | Incident list |
| H&S Checklists | `/projects/health-safety/checklists` | P2 | Checklist list |

#### Fleet Pages (16)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Dashboard | `/fleet` | P0 | Stats, recent activity |
| Vehicles | `/fleet/vehicles` | P0 | Vehicle list |
| Vehicle Detail | `/fleet/vehicles/[id]` | P0 | Tabs load |
| Drivers | `/fleet/drivers` | P1 | Driver list |
| Driver Detail | `/fleet/drivers/[staffId]` | P1 | Driver profile |
| Check-in | `/fleet/check-in` | P0 | Check-in form |
| Check-in History | `/fleet/check-in/history` | P1 | History list |
| Templates | `/fleet/check-in/templates` | P2 | Template list |
| Fuel | `/fleet/fuel` | P1 | Fuel records |
| Mileage | `/fleet/mileage` | P1 | Mileage report |
| Maintenance | `/fleet/maintenance` | P1 | Maintenance list |
| Investigation | `/fleet/investigation` | P1 | Investigation list |
| Investigation Detail | `/fleet/investigation/[jobId]` | P1 | Job detail |
| Analytics | `/fleet/analytics` | P2 | Fleet charts |
| Locations | `/fleet/locations` | P2 | Map view |
| Portal | `/fleet/portal` | P1 | Driver portal |

#### Staff Pages (8)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Staff List | `/staff` | P0 | Table with pagination |
| Create Staff | `/staff/new` | P0 | Form renders |
| Staff Detail | `/staff/[id]` | P0 | Profile loads |
| Edit Staff | `/staff/[id]/edit` | P0 | Tabs with forms |
| Import | `/staff/import` | P1 | Upload form |
| Departments | `/staff/departments` | P1 | Department list |
| Compliance | `/staff/compliance` | P1 | Compliance report |
| Alerts | `/staff/alerts` | P2 | Alert list |

#### Ticketing/NOC Pages (8)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Dashboard | `/ticketing` (redirect) | P0 | Dashboard loads |
| Tickets | `/ticketing/tickets` | P0 | Ticket list |
| Create Ticket | `/ticketing/tickets/new` | P0 | Form renders |
| Ticket Detail | `/ticketing/tickets/[id]` | P0 | Detail with notes |
| Teams | `/ticketing/teams` | P1 | Team list |
| Escalations | `/ticketing/escalations` | P1 | Escalation list |
| Risks | `/ticketing/risks` | P2 | Risk list |
| Data Sync | `/ticketing/data-sync` | P1 | QContact sync |

#### Communications Pages (4)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Communications | `/communications` | P0 | Tab layout |
| WhatsApp | `/communications/whatsapp` | P0 | 8 sub-tabs |
| Mission Control | `/communications/mission-control` | P1 | MC dashboard |
| Help Center | `/communications/help-center` | P2 | Articles |

#### Accounting Pages (26)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Dashboard | `/accounting` | P0 | Stats and navigation |
| Journal Entries | `/accounting/journal-entries/new` | P0 | Form renders |
| JE Detail | `/accounting/journal-entries/[id]` | P0 | Entry detail |
| Supplier Invoices | `/accounting/supplier-invoices` | P0 | Invoice list |
| Invoice Create | `/accounting/supplier-invoices/new` | P0 | Form renders |
| Supplier Payments | `/accounting/supplier-payments` | P1 | Payment list |
| AP Aging | `/accounting/ap-aging` | P1 | Aging report |
| Customer Payments | `/accounting/customer-payments` | P1 | Payment list |
| AR Aging | `/accounting/ar-aging` | P1 | Aging report |
| Credit Notes | `/accounting/credit-notes` | P1 | Credit note list |
| Bank Reconciliation | `/accounting/bank-reconciliation` | P0 | Recon dashboard |
| Bank Import | `/accounting/bank-reconciliation/import` | P1 | Import form |
| Trial Balance | `/accounting/reports/trial-balance` | P1 | Report renders |
| Income Statement | `/accounting/reports/income-statement` | P1 | Report renders |
| Balance Sheet | `/accounting/reports/balance-sheet` | P1 | Report renders |
| VAT Return | `/accounting/reports/vat-return` | P1 | Report renders |
| Sage Migration | `/accounting/sage-migration` | P2 | Migration tool |

#### Field Ops Pages (6)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Field Ops | `/field-ops` | P0 | Review list |
| Review Detail | `/field-ops/[reviewId]` | P0 | Review detail |
| Snags | `/field-ops/snags` | P0 | Snag list |
| OTDR | `/field-ops/otdr` | P1 | OTDR data |
| Reports | `/field-ops/reports` | P1 | Report tabs |
| Project View | `/field-ops/project/[projectId]` | P1 | Project field ops |

#### SOW Pages (4)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| SOW | `/sow` | P0 | SOW list |
| Import | `/sow/import` | P0 | Upload form |
| List | `/sow/list` | P1 | List view |
| Grid | `/sow/grid` | P1 | Grid view |

#### OneMap Pages (6)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| OneMap | `/onemap` | P0 | Map renders |
| Map View | `/onemap/map` | P0 | Full map |
| Grid | `/onemap/grid` | P1 | Data grid |
| Layers | `/onemap/layers` | P1 | Layer config |
| Import | `/onemap/import` | P1 | Import form |
| Search | `/onemap/search` | P1 | Search works |

#### System Pages (7)
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Health | `/system/health` | P0 | All services green |
| Infrastructure | `/system/infrastructure` | P1 | Server stats |
| Data Sync | `/system/data-sync` | P1 | Sync status |
| Design Audit | `/system/design-audit` | P2 | Audit results |
| VLM Learning | `/system/vlm-learning` | P2 | Learning dashboard |
| OLT Report | `/system/data-management/olt-report` | P2 | OLT data |
| Doc Expiry | `/system/data-management/document-expiry` | P2 | Expiry list |

#### Remaining Pages
| Page | Route | Priority | Checks |
|------|-------|----------|--------|
| Clients | `/clients` | P1 | Client list |
| Client Detail | `/clients/[id]` | P1 | Client profile |
| Contractors | `/contractors` (redirect) | P1 | Contractor list |
| Suppliers | `/suppliers` | P1 | Supplier list (style reference) |
| H&S | `/health-safety` | P1 | H&S dashboard |
| Pipeline | `/pipeline` | P1 | Pipeline board |
| Drops | `/drops` | P2 | Drop list |
| Reports | `/reports` | P1 | Report hub |
| Progress Today | `/reports/progress-today` | P1 | Today's report |
| Weekly Activations | `/reports/weekly-activations` | P1 | Weekly report |
| Stock Portal | `/stock/portal` | P2 | Stock overview |
| NOC WA Tracking | `/noc/wa-tracking` | P1 | WA tracking |
| Deploy Health | `/deploy-health` | P2 | Deploy status |

### 4.2 Modal Inventory (Must Test Open/Close/Submit)

| Modal | Module | Trigger | Test Actions |
|-------|--------|---------|--------------|
| `StockItemSelector` | Procurement | Add item to BOQ/RFQ | Open, search, select, create new |
| `ConvertToPOModal` | Procurement | Convert RFQ to PO | Open, review, submit |
| `POCreateModal` | Procurement | Create PO | Open, fill, submit |
| `StockReceiptModal` | Procurement | GRN receipt | Open, scan, submit |
| `DailyCheckoutModal` | Procurement | Field stock issue | Open, select items, sign, submit |
| `CreateReturnModal` | Procurement | Field stock return | Open, select items, submit |
| `QuoteSubmissionModal` | Procurement | Submit supplier quote | Open, fill quote, submit |
| `BudgetAdjustmentModal` | Projects | Adjust budget | Open, fill, submit |
| `ExitEmployeeModal` | Staff | Exit employee | Open, select type, submit |
| `WorkflowAssignmentModal` | Projects | Assign workflow | 3-step wizard |
| `ScheduleMeetingModal` | LiveKit | Schedule meeting | Open, fill, submit |
| `BarcodeScannerModal` | Multiple | Scan barcode | Open camera, scan, close |
| `OcrResultsModal` | Documents | Review OCR | Toggle fields, apply |
| `TaskDialog` | Field App | View task | View, update status |
| `ConfirmationDialog` | Global | Delete/approve | Open, confirm/cancel |
| `PhotoViewerModal` | Activate, QA | View photo | Open, zoom, navigate |
| `QAWizardModal` | Activate | QA review | 5-phase wizard |
| `SnagCreateModal` | Field Ops | Create snag | Open, fill, photo, submit |
| `IncidentReportModal` | H&S | Report incident | Open, fill, submit |
| `VehicleCheckInModal` | Fleet | Quick check-in | Open, checklist, submit |

### 4.3 Form Validation Matrix

| Form | Module | Required Fields | Validations |
|------|--------|----------------|-------------|
| Project Form | Projects | name, client | dates valid, budget > 0 |
| Client Form | Clients | name | email format if provided |
| Contractor Form | Contractors | company_name | registration number format |
| Staff Form | Staff | first_name, last_name | email format, ID number |
| Supplier Form | Suppliers | name | email format |
| Vehicle Form | Fleet | make, model, license_plate | plate format |
| BOQ Form | Procurement | project, title | at least 1 line item |
| RFQ Form | Procurement | project, title, deadline | deadline future, suppliers selected |
| PO Form | Procurement | supplier, items | amounts > 0 |
| Ticket Form | Ticketing | title, project | title min length |
| Invoice Form | Accounting | supplier, items | amounts balance, GL codes valid |
| JE Form | Accounting | description, lines | debits = credits |
| Snag Form | Field Ops | title, location | GPS coordinates valid |
| Incident Form | H&S | title, date, severity | date not future |

### 4.4 Filter/Search Components

| Component | Module | Filters | Test |
|-----------|--------|---------|------|
| DR Filters | Activate | status, project, date, technician | Each filter updates results |
| Project Filters | Projects | status, client, date range | Each filter updates results |
| Staff Filters | Staff | department, status, role | Each filter updates results |
| Ticket Filters | Ticketing | status, priority, team, assignee | Each filter updates results |
| PO Filters | Procurement | status, supplier, date range | Each filter updates results |
| Vehicle Filters | Fleet | status, type, location | Each filter updates results |
| Snag Filters | Field Ops | status, severity, project | Each filter updates results |
| Stock Filters | Procurement | category, location, status | Each filter updates results |
| Global Search | Header | Cross-module search | Returns results from all modules |

### 4.5 Navigation/Links

| Test | Check | Pass Criteria |
|------|-------|---------------|
| Sidebar sections | All 11 sections render | No missing sections |
| Sidebar links | Every link navigates to correct page | No 404s |
| Breadcrumbs | Present on detail pages | Correct hierarchy |
| Tab navigation | ModuleNav tabs in multi-page modules | All tabs switch correctly |
| Back buttons | Return to list from detail | Correct list page |
| Quick actions | Dashboard action buttons | Navigate to correct create forms |
| External links | 1Map, QFieldCloud links | Open in new tab |

### 4.6 Theme Testing

For every page in 4.1:

| Check | Dark Mode | Light Mode |
|-------|-----------|------------|
| Background color consistency | `--ff-bg-primary` (#0f172a) | White/light gray |
| Text readability (contrast) | WCAG AA minimum | WCAG AA minimum |
| Card/panel backgrounds | `--ff-bg-secondary` (#1e293b) | White with border |
| Form input styling | Dark inputs, visible borders | Standard inputs |
| Modal backgrounds | Dark overlay + dark modal | Standard overlay |
| Status badge visibility | Badges readable | Badges readable |
| Hover states | Visible contrast change | Visible contrast change |
| Chart/graph colors | Visible on dark bg | Visible on light bg |
| Table row alternation | Subtle stripe | Subtle stripe |

### 4.7 Excel Export Tests

Every module with export:

| Module | Export Button Location | Expected Columns | Format |
|--------|----------------------|-----------------|--------|
| Activate | QA Centre toolbar | DR#, Status, Project, Date, Tech | .xlsx |
| Staff | Staff list toolbar | Name, Position, Dept, Status | .xlsx |
| Fleet | Vehicle list toolbar | Plate, Make, Model, Status | .xlsx |
| Procurement (PO) | PO list toolbar | PO#, Supplier, Amount, Status | .xlsx |
| Ticketing | Ticket list toolbar | ID, Title, Status, Priority | .xlsx |
| Snags | Snag list toolbar | Title, Status, Severity, Location | .xlsx |
| Reports | Report pages | Varies per report | .xlsx |

---

## LAYER 5: SECURITY (P1)

### 5.1 Static Analysis (from security-audit skill)

| Check | Target | Pass Criteria |
|-------|--------|---------------|
| `eval()` detection | `pages/api/`, `src/` | 0 matches |
| Unauthenticated endpoints | `pages/api/` | Only known public endpoints |
| Hardcoded secrets | `pages/api/`, `src/` | 0 hardcoded credentials |
| `console.log` violations | All `.ts`/`.tsx` | 0 active console calls |
| SQL string concatenation | `pages/api/` | 0 string-built SQL |
| `Math.random()` in auth | `src/lib/auth/`, `pages/api/auth/` | 0 matches |
| Empty catch blocks | All `.ts`/`.tsx` | All catches have handling |
| Localhost in CORS | `src/lib/apiResponse.ts` | Only in dev mode |
| Hardcoded IPs | All `.ts`/`.tsx` | All from env vars |
| File size compliance | All `.ts`/`.tsx` | < 300 lines |
| Dependency vulnerabilities | `npm audit` | 0 critical, 0 high |

### 5.2 RBAC Enforcement Audit

| Check | Test | Pass Criteria |
|-------|------|---------------|
| API auth middleware | Every `pages/api/*.ts` uses `withAuth` or `withPermission` | Only known public endpoints exempt |
| Permission granularity | `access_permissions` covers all modules | 14+ modules, 50+ pages |
| Role coverage | `custom_roles` has all required roles | 6 roles minimum |
| Permission matrix | Every role has explicit permissions | No implicit access |
| UI sidebar filtering | Sidebar shows only permitted modules | Test with viewer role |
| UI tab filtering | Module tabs respect permissions | Test with restricted role |
| UI button visibility | Create/Edit/Delete hidden without permission | Test with viewer role |
| API permission check | Protected endpoints reject unauthorized roles | 401/403 for wrong role |

### 5.3 Authentication Tests

| Test | Check | Pass Criteria |
|------|-------|---------------|
| Login with valid credentials | POST `/api/auth/login` | 200 + session cookie |
| Login with bad password | POST `/api/auth/login` | 401, no session |
| Login with non-existent email | POST `/api/auth/login` | 401, generic message |
| Access protected route without auth | GET `/api/projects` | 401 |
| Session expiry | Wait > session timeout | Next request returns 401 |
| Logout clears session | POST `/api/auth/logout` | Subsequent requests 401 |
| Password reset flow | Forgot → Email → Reset | New password works |
| Rate limiting | 10+ rapid login attempts | 429 after threshold |

### 5.4 Input Validation / Injection

| Test | Target | Attack Vector | Pass Criteria |
|------|--------|---------------|---------------|
| SQL injection | All POST endpoints | `'; DROP TABLE users; --` | No SQL error, input escaped |
| XSS | All text input fields | `<script>alert('xss')</script>` | Rendered as text, not executed |
| Path traversal | File upload endpoints | `../../etc/passwd` | Rejected |
| IDOR | Detail endpoints | Change `[id]` to other user's | 403 or scoped to own data |
| CSRF | State-changing endpoints | Cross-origin POST | Rejected without token |
| Header injection | API responses | CRLF in header values | Sanitized |

---

## LAYER 6: PERFORMANCE (P2)

### 6.1 API Response Time Baselines

| Category | Warning | Critical | Timeout |
|----------|---------|----------|---------|
| Simple GET (list) | > 500ms | > 2000ms | 10s |
| Complex GET (joins) | > 1000ms | > 3000ms | 15s |
| POST (create) | > 1000ms | > 3000ms | 15s |
| Report generation | > 3000ms | > 10000ms | 30s |
| File upload | > 5000ms | > 15000ms | 60s |
| VLM processing | > 10000ms | > 30000ms | 60s |

### 6.2 Critical Path Performance

| Path | Target | Measure |
|------|--------|---------|
| Dashboard load | < 2s | Time to interactive |
| QA Centre list (1000 DRs) | < 3s | Full render |
| PO list (500 POs) | < 2s | Full render |
| Ticket list (2500 tickets) | < 3s | Full render |
| Map render (500 poles) | < 5s | All markers visible |
| Report generation | < 10s | Data returned |
| Excel export (1000 rows) | < 15s | File downloaded |

### 6.3 Database Query Performance

| Query Pattern | Warning | Critical |
|--------------|---------|----------|
| Simple SELECT | > 100ms | > 500ms |
| JOIN (2 tables) | > 200ms | > 1000ms |
| Aggregate (COUNT, SUM) | > 300ms | > 1500ms |
| Full-text search | > 500ms | > 2000ms |
| Report queries | > 2000ms | > 5000ms |

### 6.4 Lighthouse Scores (sampled pages)

| Page | Performance | Accessibility | Best Practices | SEO |
|------|-------------|---------------|----------------|-----|
| Dashboard | > 70 | > 80 | > 80 | > 70 |
| Activate QA Centre | > 60 | > 80 | > 80 | > 70 |
| Procurement Dashboard | > 70 | > 80 | > 80 | > 70 |
| Fleet Dashboard | > 70 | > 80 | > 80 | > 70 |
| Projects List | > 70 | > 80 | > 80 | > 70 |

### 6.5 Memory & Resource

| Check | Warning | Critical |
|-------|---------|----------|
| Node.js heap usage | > 500MB | > 800MB |
| Active DB connections | > 20 | > 50 |
| Disk usage (deploy dir) | > 80% | > 95% |
| Log file size | > 500MB | > 1GB |

---

## CROSS-MODULE INTEGRATION MATRIX

Which modules talk to which:

| Source Module | Target Module | Integration Point | Test |
|--------------|--------------|-------------------|------|
| SOW | Drops | `drops` table population | Import creates drops |
| Activate | VLM | Photo categorization | VLM returns categories |
| Activate | WhatsApp | Feedback messages | Message delivered |
| Activate | OES | Serial validation | OES data matches |
| Activate | QField | Sync push | Data arrives in QField |
| Procurement | Stock | Stock level updates | GRN updates stock |
| Procurement | Projects | Budget linking | PO affects project budget |
| Procurement | Suppliers | Supplier selection | Supplier list in RFQ |
| Fleet | VLM | Plate/odometer reading | VLM returns values |
| Fleet | Staff | Driver assignment | Staff → Driver |
| Ticketing | QContact | Bi-directional sync | Status parity |
| Ticketing | Projects | Ticket context | Project dropdown |
| Construction QA | QField | Photo ingestion | Photos imported |
| Construction QA | VLM | Photo validation | VLM validates |
| Field Ops | Ticketing | Auto-ticket creation | Snag → Ticket |
| Staff | Users | Account provisioning | Staff → User account |
| Staff | Contractors | Assignment | Staff assigned to contractor |
| H&S | Projects | Incident context | Project dropdown |
| Accounting | Procurement | Invoice matching | PO → Invoice |
| OneMap | QField | Map data | Poles/cables display |
| Notifications | All | Event triggers | Events create notifications |
| RBAC | All | Permission enforcement | Access control |

---

## EXECUTION MODES

### Full Audit (~1,270 tests, ~60-90 min)
```bash
tsx scripts/daily-audit/runner.ts
```
Runs all 6 layers, all modules, generates full report.

### Quick Audit (~150 tests, ~5 min)
```bash
tsx scripts/daily-audit/runner.ts --quick
```
P0 only: Infrastructure + critical API health + DB connectivity.

### Layer-Specific
```bash
tsx scripts/daily-audit/runner.ts --suite infrastructure
tsx scripts/daily-audit/runner.ts --suite data-integrity
tsx scripts/daily-audit/runner.ts --suite functional
tsx scripts/daily-audit/runner.ts --suite ui-ux
tsx scripts/daily-audit/runner.ts --suite security
tsx scripts/daily-audit/runner.ts --suite performance
```

### Module-Specific
```bash
tsx scripts/daily-audit/runner.ts --module activate
tsx scripts/daily-audit/runner.ts --module procurement
tsx scripts/daily-audit/runner.ts --module fleet
tsx scripts/daily-audit/runner.ts --module accounting
```

### Combined
```bash
tsx scripts/daily-audit/runner.ts --suite functional --module activate
tsx scripts/daily-audit/runner.ts --suite security --quick
```

---

## REPORTS

| Format | Location | Content |
|--------|----------|---------|
| HTML | `public/audit-report.html` | Interactive dashboard |
| JSON | `scripts/daily-audit/results/YYYY-MM-DD.json` | Machine-readable |
| Latest | `scripts/daily-audit/results/latest.json` | Most recent run |
| Trends | `scripts/daily-audit/results/trends.json` | Historical comparison |

### Report Sections
1. **Executive Summary** — Overall status, pass/fail/warning counts
2. **Layer Breakdown** — Each layer with suite results
3. **Module Breakdown** — Each module with test results
4. **Failing Tests** — Detailed failure list with reproduction steps
5. **Performance Trends** — Response time graphs over time
6. **Recommendations** — Prioritized fix list

---

## EXIT CODES

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | P0 failures (critical — system unhealthy) |
| 2 | P1 failures (important — system degraded) |
| 3 | P2 failures only (minor — system functional) |

---

## SCHEDULING

| Schedule | What | Where |
|----------|------|-------|
| 05:30 daily | Full audit | Velocity systemd timer |
| Pre-deploy | Quick audit | `deploy-local.sh` hook |
| Pre-merge | Security layer | CI/CD pipeline |
| Weekly | Performance layer | Velocity cron |

---

## RELATED SKILLS

| Skill | Relationship |
|-------|-------------|
| `/final-audit` | Browser-based production readiness (subset of Layer 4) |
| `/security-audit` | Static analysis (subset of Layer 5) |
| `/audit-rbac` | RBAC verification (subset of Layer 5.2) |
| `/audit-procurement` | Procurement module audit (subset of Layer 3+4 for procurement) |
| `/e2e` | End-to-end browser testing (overlaps Layer 4) |
| `/ui-review` | User story validation (overlaps Layer 4) |

---

## MODULE COVERAGE CHECKLIST

| Module | L1 Infra | L2 Data | L3 Func | L4 UI | L5 Sec | L6 Perf |
|--------|----------|---------|---------|-------|--------|---------|
| Activate | DB, VLM, WA | DR orphans, serial dupes | 58 APIs, W1 workflow | 10 pages, QA wizard | Auth, RBAC | VLM timing |
| Procurement | DB | PO/BOQ orphans, totals | 60+ APIs, W2 workflow | 23 pages, 6 modals | Auth, RBAC | List perf |
| Projects | DB | Project refs | 20+ APIs, W4 workflow | 15 pages | Auth, RBAC | Dashboard |
| Fleet | DB, VLM | Vehicle refs | 25+ APIs, W5 workflow | 16 pages | Auth, RBAC | VLM timing |
| Staff | DB | Staff/user refs | 15+ APIs, W3 workflow | 8 pages, 1 modal | Auth, RBAC | List perf |
| Ticketing/NOC | DB | Ticket refs | 40+ APIs, W7 workflow | 8 pages | Auth, RBAC | List perf |
| Communications | WA Bridge | - | 30 APIs | 4 pages, 8 WA tabs | Auth | - |
| Accounting | DB | GL balance, JE integrity | 165 APIs, W11 workflow | 26 pages | Auth, RBAC | Report perf |
| Construction QA | VLM, QField | QA refs | 15 APIs, W10 workflow | 5 pages | Auth | VLM timing |
| Field Ops | DB | Snag refs | 25+ APIs, W9 workflow | 6 pages | Auth | - |
| QField Sync | QField Svc | Sync refs | 30+ APIs, W8 workflow | 3 pages | Auth | Sync timing |
| OneMap | 1Map API | Map data refs | 15+ APIs | 6 pages | Auth | Map render |
| SOW | DB | Drop refs | 10+ APIs | 4 pages | Auth | Import perf |
| Clients | DB | Client refs | 8 APIs | 4 pages | Auth | - |
| Contractors | DB | Contractor refs | 15 APIs, W6 workflow | 4 pages | Auth | - |
| Suppliers | DB | Supplier refs | 10 APIs | 2 pages | Auth | - |
| H&S | DB | H&S refs | 10+ APIs, W12 workflow | 5 pages | Auth | - |
| Admin/RBAC | DB | Permission refs | 28 APIs | Settings pages | Full RBAC audit | - |
| Analytics | DB | - | 10+ APIs | 3 pages | Auth | Report perf |
| Pipeline | DB | - | 8+ APIs | 4 pages | Auth | - |

**Total coverage: 58 modules, 170+ pages, 600+ APIs, 20 modals, 14 forms, 12 workflows, ~1,270 tests**
