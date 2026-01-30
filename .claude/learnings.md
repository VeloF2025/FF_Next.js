# FibreFlow - Global Learnings

> Project-wide learnings that apply across all modules.

---

## 2026-01-30: QA Centre — Typo DR Filtering & Self-Healing Photo Fetch

**Problem 1 — Typo DRs polluting QA Centre list:**
WhatsApp installers occasionally send mistyped DR numbers (e.g., `DR18633092` instead of `DR1863309`, `DR173622` instead of `DR1736220`). These typos create records in `dr_photo_unified_reviews` via the Go Bridge, but have 0 photos and no valid data. They inflate the "Installed" count and clutter the list.

**Fix — EXISTS filter against drops table (commit `d95ea2b7`):**
The `drops` table (populated from SOW imports) is the canonical source of valid DR numbers. Added `EXISTS (SELECT 1 FROM drops d WHERE d.drop_number = u.drop_number)` to **4 query locations** in `pages/api/activate/drops.ts`:
1. `getPaginatedDrops()` — base WHERE conditions (line ~167)
2. `calculateSummary()` — installed count query (line ~486)
3. `getProjectStats()` — per-project counts (line ~621)
4. `processOrphanedRecordsInBackground()` — orphan detection (line ~822)

**Critical:** All 4 locations must stay in sync. If you add the filter to the list query but not the summary, counts won't match the visible rows.

**Known typo DRs (as of 2026-01-30):** DR18633092, DR173622, DR2750491, DR18663403, DR17385904, DR736188, DR18563323, DR18628799

**Problem 2 — Go Bridge dropping ~20% of process-new-dr calls:**
The Go Bridge calls two endpoints sequentially: `dr-acknowledgment.ts` then `process-new-dr.ts`. Approximately 20-40% of `process-new-dr` calls get dropped, leaving "shell" records with 0 photos, no `wa_message_id`, and no WA context.

**Fix — Self-healing `processOrphanedRecordsInBackground()` (commit `13c11713`):**
Fire-and-forget function that runs on each QA Centre page load:
- Detects orphaned DRs: `photo_count = 0`, `wa_message_id IS NULL`, created in last 48 hours, exists in drops table
- Fetches photos from BOSS API (`http://100.96.203.105:8003/api/record/{DR}`)
- Triggers VLM categorization pipeline
- Max 5 DRs per page load to avoid blocking

**Problem 3 — backfillOrphanedRecords caused "0 photos" display (commit `6ef2eb12` reverted it):**
An earlier attempt (`backfillOrphanedRecords`) created unified records for WA-submitted DRs that had `wa_monitor_drops` entries but no unified record. However, it created records with `photo_count = 0` because it didn't fetch photos from BOSS API — just created empty shells. This made previously-working DRs show "0 photos". Reverted and replaced with `processOrphanedRecordsInBackground` which actually fetches photos.

**DR Submission Pipeline — Full Data Flow:**
```
WhatsApp Group → Go Bridge → dr-acknowledgment.ts (shell record)
                           → process-new-dr.ts (full record with photos)
                                    ↓ (if dropped)
                           → processOrphanedRecordsInBackground() (self-healing)
                                    ↓
                           → BOSS API → photos → VLM pipeline
```

**Reconciliation Pattern — WA Bridge vs Neon DB:**
When verifying DR counts, cross-reference 3 sources:
1. **WA Bridge SQLite** (`/opt/whatsapp-bridge/store/messages.db`) — raw WhatsApp messages
2. **Neon `wa_monitor_drops`** — Go Bridge creates these
3. **Neon `dr_photo_unified_reviews`** — processing pipeline creates these

Expected relationships:
- WA Bridge >= wa_monitor_drops (bridge stores all messages; Go Bridge may not create wa_monitor_drops for all)
- wa_monitor_drops >= unified_reviews created today (some may be resubmissions with older unified records)
- Valid DRs = those that `EXISTS` in `drops` table (canonical source from SOW imports)
- Typo DRs exist in unified but are filtered by EXISTS — they still take up space but don't show in UI

**Verification queries:**
```sql
-- Count valid DRs in QA Centre for today
SELECT COUNT(*) FROM dr_photo_unified_reviews
WHERE created_at::date = CURRENT_DATE
  AND (is_oes_only = FALSE OR is_oes_only IS NULL)
  AND EXISTS (SELECT 1 FROM drops d WHERE d.drop_number = dr_photo_unified_reviews.drop_number);

-- Find typo DRs (in unified but not in drops)
SELECT drop_number FROM dr_photo_unified_reviews u
WHERE NOT EXISTS (SELECT 1 FROM drops d WHERE d.drop_number = u.drop_number)
  AND (u.is_oes_only = FALSE OR u.is_oes_only IS NULL);
```

**Key Files:**
- `pages/api/activate/drops.ts` — Main QA Centre API with all 4 EXISTS filters
- `pages/api/activate/process-new-dr.ts` — Go Bridge entry point for WA submissions
- `pages/api/activate/dr-acknowledgment.ts` — Go Bridge shell record creator
- `src/modules/activate/services/photoFetchService.ts` — BOSS API photo fetching

---

## 2026-01-30: QA Centre — DR Acknowledgment Race Condition & Data Completeness

**Problem:** Three regressions on QA Centre page:
1. Projects showing "Unknown" and sender phone missing for many DRs
2. Row duplication ("Showing 72 of 69 drops") — some DRs appearing multiple times
3. False resubmission classification — DRs marked as resubmission #2 when only submitted once

**Root Cause — dr-acknowledgment race condition:**

The Go WhatsApp Bridge calls two endpoints in sequence:
1. `dr-acknowledgment.ts` → Creates unified record with just `drop_number` + `onemap_status` (no project, sender_phone, submitted_date, or WA context)
2. `process-new-dr.ts` → Processes the actual WA submission

Three failure modes:
- **Idempotency guard gap**: The UPDATE path (record < 60s old) was missing `project` field
- **Brand new DR INSERT gap**: Was missing `sender_phone` column
- **False resubmission**: When dr-acknowledgment creates a record and the WA submission arrives >60s later, the code treated it as a genuine resubmission because it only checked record age, not whether the record had WA context

**Fix — Three code paths in process-new-dr.ts:**

| Path | Condition | Action |
|------|-----------|--------|
| Idempotency guard | Record < 60s old | Update fields, keep count |
| **First WA submission** (NEW) | Record has NO `wa_message_id` AND NO `wa_received_at` | Update fields, keep count |
| Genuine resubmission | Record has WA context already | Increment count, save snapshot |

**Fix — LEFT JOIN row multiplication:**

`drops` table can have duplicate entries per DR (e.g., DR1753212 had 4 rows with different project_ids). Regular `LEFT JOIN drops d ON d.drop_number = u.drop_number` multiplied unified rows.

**Pattern — Always use LATERAL for tables with potential duplicates:**
```sql
-- BAD: Regular LEFT JOIN multiplies rows
LEFT JOIN drops d ON d.drop_number = u.drop_number
LEFT JOIN projects p ON p.id = d.project_id

-- GOOD: LATERAL with LIMIT 1 prevents multiplication
LEFT JOIN LATERAL (
  SELECT p.project_name FROM drops d
  JOIN projects p ON p.id = d.project_id
  WHERE d.drop_number = u.drop_number
  LIMIT 1
) dp ON true
```

**Note:** `oes_activations` is safe with regular LEFT JOIN (no duplicates). `maintenance_tickets` CAN have multiple per DR (legitimate — multiple issues), so use LATERAL with `ORDER BY created_at DESC LIMIT 1` to get latest.

**Commits:**
- `37e97952` — Add project and sender_phone to all process-new-dr paths
- `b3e9cdf3` — Prevent row duplication from LEFT JOINs in drops query
- `cf8beb04` — Prevent false resubmission when dr-acknowledgment creates record first

**Key Files:**
- `pages/api/activate/process-new-dr.ts` — Three code paths (lines 484-612)
- `pages/api/activate/drops.ts` — LATERAL JOINs (lines 264-294)

**Backfills Applied:** 7 false resubmissions reset, 4 NULL submitted_dates, 2 NULL sender_phones, 37 NULL projects

**Post-deployment straggler:** DR1735961 was processed at 14:40 SAST — 3 minutes before the production deployment completed. It hit the old code and was falsely classified as resubmission #2. Manually backfilled `submission_count` to 1. Lesson: always check for stragglers processed in the deployment window.

**Key Insight — Multiple unified record creators:**
Records in `dr_photo_unified_reviews` can be created by ANY of these paths:
- `process-new-dr.ts` (WA submission — 2 INSERT paths)
- `dr-acknowledgment.ts` (Go Bridge — 2 INSERTs)
- `ensure-data.ts` (QA Wizard open)
- `drops.ts:syncMissingFromQaPhotoReviews()` (legacy backfill)
- `import-oes.ts` (OES Excel import)

All code paths must handle the case where another path created the record first.

---

## 2026-01-30: VLM Categorization — Full Backlog Cleared (7,638 DRs)

**Problem:** ~7,600 DRs with photos needed VLM categorization + data extraction. The cron job (`process-vlm-queue.ts`) was processing ~53/hour sequentially — ETA 3+ days.

**Optimizations Applied:**
1. **Parallelized processing** — Changed from sequential `for` loop to `Promise.allSettled` batches of 3 concurrent DRs. ~3x throughput per batch.
2. **Increased limits** — Default limit 10→20, cron frequency `*/10`→`*/5` minutes, maxDuration 30s→60s.
3. **Bumped VLM server** — `--max-num-seqs` 4→8 in `/etc/systemd/system/vllm-qwen.service`.
4. **Background burst script** — `/tmp/vlm-burst.sh` continuously calls the endpoint (limit=6, concurrency=3) with 5s sleep between rounds. Runs until backlog is cleared.
5. **NVIDIA driver update** — 580.95.05→580.126.09, gave ~20x speedup for extraction-only DRs.

**Bugs Fixed:**
- **Infinite reprocessing loop** — 1,352 DRs categorized but without step 6/7/9 photos were re-queued forever. Fix: added else branch marking them `data_validation_completed=true, vlm_power_meter_status='no_photo', overall_status='NEEDS_REVIEW'`. Added `data_validation_completed IS NULL OR data_validation_completed = false` filter to cron query.
- **varchar overflow** — `overall_status` was varchar(10), `NEEDS_REVIEW` is 12 chars. Widened to varchar(30). Required dropping/recreating views `v_dr_installation_status` and `v_foto_ai_reviews`.
- **Burst script fragility** — Script exited on single timeout (JSON parse returned 0). Fixed with resilient mode: needs 5 consecutive zeros with 30s retry between each before stopping.

**Key Files:**
- `pages/api/cron/process-vlm-queue.ts` — Parallel processing, priority ordering, loop fix
- `/etc/systemd/system/vllm-qwen.service` — max-num-seqs=8
- `/tmp/vlm-burst.sh` — Resilient burst script template

**Final Result:** 7,638 categorized, 2 failed (photos unfetchable), 0 remaining. Completed overnight.

**Key Pattern — Resilient Burst Script:**
```bash
# Track consecutive zeros to distinguish timeout from truly done
ZERO_COUNT=0; MAX_RETRIES=5
if [ "$P" = "0" ]; then
  ZERO_COUNT=$((ZERO_COUNT + 1))
  if [ "$ZERO_COUNT" -ge "$MAX_RETRIES" ]; then break; fi
  sleep 30  # Wait before retry
else
  ZERO_COUNT=0  # Reset on success
  sleep 5
fi
```

**Key Pattern — VLM Cron Priority Ordering:**
```sql
-- Process extraction-only DRs first (already categorized, just need data)
ORDER BY
  CASE WHEN vlm_categorization_status IN ('categorized','approved') THEN 0 ELSE 1 END,
  created_at DESC
```

---

## 2026-01-30: Procurement Module — Mock Data Elimination

**Problem:** Procurement module had mock/placeholder data throughout: hardcoded aggregate metrics, fake tab badges, empty onClick handlers, permissions always returning `true` with role `'admin'`, and QuoteEvaluationPage returning empty arrays.

**Solution:** Created 3 new API endpoints and rewrote 5 existing files:

**New APIs:**
- `pages/api/procurement/aggregate-metrics.ts` — Real DB queries for projects, BOQs, RFQs, POs, stock, suppliers; returns `{ metrics, projectSummaries }`
- `pages/api/procurement/tab-badges.ts` — Real counts per tab (BOQ drafts, open RFQs, pending POs, low stock); supports optional `?projectId=` filter
- `pages/api/procurement/quote-evaluations.ts` — Derives evaluation state from RFQ status + quote presence; statuses: PENDING/IN_PROGRESS/COMPLETED/AWARDED

**Key Rewrites:**
- `useProcurementPermissions.ts` — Real AuthContext RBAC using `hasPermission()` + `hasAnyRole()`. Maps `UserRole` → procurement capabilities. Approval limits: admin=1M, manager=500K, supervisor=100K. Differentiates no-project (view-only) vs project-selected (full RBAC).
- `ProcurementPage.tsx` — `loadAggregateMetrics()` and `loadTabBadges()` now call real APIs. Tab filtering uses real permission checks.
- `QuoteEvaluationPage.tsx` — 7 empty onClick handlers wired: view/edit/award → navigate to RFQ, export → CSV download, analytics → reports page.
- `ProcurementDashboard.tsx` — Export Report button generates CSV from real stats.
- `field-stock/dashboard.ts` — Fixed `low_stock` query (was hardcoded `0`, now queries `stock_items WHERE quantity <= min_stock_level`).

**Key Pattern — Procurement Permission Mapping:**
```typescript
// AuthContext roles → procurement capabilities
SUPER_ADMIN/ADMIN → all permissions, approvalLimit: 1_000_000
PROJECT_MANAGER → most permissions, approvalLimit: 500_000
SITE_SUPERVISOR → stock access + create GRN/requisitions, approvalLimit: 100_000
FIELD_TECHNICIAN → field stock access only
CONTRACTOR → field stock access only
// No projectId → view-only permissions (tabs visible, no create/edit)
```

**Commit:** `2db4f38d` — Deployed to all environments.

---

## 2026-01-29: Staff Department-Position Alignment & Persistence

**Problem:** Department and Position dropdowns were misaligned — selecting a department didn't filter positions. Position disappeared after save because the detail view couldn't display values not in the options list.

**Root Causes:**
1. `getPositionsByDepartment()` in `src/types/staff-hierarchy.types.ts` had incomplete mappings — only covered ~5 of 21 departments
2. DB department names (e.g., "Field Operations", "Administration") differ from `StaffDepartment` enum values (e.g., "Operations", "Admin") — no alias mapping existed
3. No interceptor in `handleInputChange` to clear position when department changes
4. Staff API `pages/api/staff/index.ts` had `AND deleted_at IS NULL` but departments table uses `is_active` boolean column

**Fixes (3 commits):**
1. `617562af` — Complete department-to-position mappings for all 21 departments + position clearing interceptor + current position fallback in dropdown
2. `ec96c7e0` — `DEPARTMENT_ALIASES` map for DB↔enum mismatches + `dbOnlyPositions` for Executive/Management/Project Management
3. `67385961` — Changed `deleted_at IS NULL` → `is_active = true` in department lookup query

**Key Architecture:**
- **Department dropdown**: Populated from `departments` table (18 active rows with `is_active=true`)
- **Position dropdown**: Populated from `getPositionsByDepartment()` function in `staff-hierarchy.types.ts`
- **DB schema**: `departments` table has `id, name, code, description, manager_id, is_active, created_at, updated_at` — NO `deleted_at` column
- **Staff table**: `department` VARCHAR(100) stores display name + `department_id` UUID FK
- **Position**: Stored as display name string in `position` VARCHAR(100) — no FK constraints
- **Alias mapping**: DB names like "Field Operations" → enum `StaffDepartment.OPERATIONS`, "HR" → `StaffDepartment.HR`, "IT" → `StaffDepartment.IT_DATA`
- **DB-only departments**: Executive, Management, Project Management have no enum equivalent — handled via `dbOnlyPositions` map

**Key Files:**
- `src/types/staff-hierarchy.types.ts` — Position/department enums + `getPositionsByDepartment()` with aliases
- `src/modules/staff/components/StaffEditForm.tsx` — Department change interceptor in `handleInputChange`
- `src/modules/staff/components/StaffForm.tsx` — Same interceptor for create form
- `src/modules/staff/components/edit-sections/EmploymentEditSection.tsx` — Department/position dropdowns
- `pages/api/staff/index.ts` — PUT handler with department→UUID lookup (line ~465)

---

## 2026-01-29: Staff UI Polish (formatLabel, Next of Kin, SA ID Sync)

**formatLabel fix:** Snake_case values like `field_operations` displayed raw in UI. Applied `formatLabel()` utility across staff directory page (`pages/staff/index.tsx`) and all detail/edit components to show "Field Operations" instead.

**Next of Kin hidden:** Section removed from edit form (`OverviewEditSection.tsx`) per user request — data fields still exist in DB/types but UI section hidden.

**SA ID Number sync:** Two separate fields (`saIdNumber` on Overview tab, `idNumber` on Compliance tab) now sync bidirectionally via `handleInputChange` interceptor in `StaffEditForm.tsx`. On load, both fields are set to whichever has a value.

---

## 2026-01-29: Input Leap (iLeap) KVM Troubleshooting

**Problem:** Input Leap keyboard/mouse sharing wasn't running.

**Root Causes:**
1. User service was **disabled** — not set to auto-start
2. `DISPLAY=:0` was wrong — hein's session runs on `:1`, velo on `:2`

**Fix:**
- Changed `DISPLAY=:0` → `DISPLAY=:1` in `/home/hein/.config/systemd/user/input-leap.service`
- Enabled with `systemctl --user enable --now input-leap.service`

**Key Facts:**
- Server IP: `192.168.1.47` (MAC: `ac:b4:80:d9:bc:c6`)
- Server **blocks ICMP/ping** — don't rely on ping to check connectivity
- Use `nc -w 2 192.168.1.47 24800` to verify server is reachable
- Port: 24800 (Barrier/Input Leap default)
- Binary: `/usr/local/bin/input-leapc`
- Smart client script: `/usr/local/bin/input-leap-smart-client.sh` (auto-detects display)
- System service: `/etc/systemd/system/input-leap-client.service` (disabled, uses smart script)
- User service: `/home/hein/.config/systemd/user/input-leap.service` (enabled, hardcodes display)
- Desktop autostart: `/home/hein/.config/autostart/input-leap.desktop`

**Display Mapping:** `who` output shows which display each user owns (hein=`:1`, velo=`:2`)

---

## 2026-01-29: QField OES Sync - Multi-Project + 2-Layer Redesign

**Multi-Project Support:** Syncs to ALL `is_active=true AND sync_enabled=true` projects from `qfield_projects` table. Falls back to hardcoded project ID if DB query fails.

**Current sync-enabled projects:**
- `af058301-32d1-4bca-84f9-83b899fcbb34` (Production, `is_default=true`)
- `e849b878-f8a8-4f84-a3f1-9fbd051686c0` (Test Project)

**2-Layer Redesign (was 3 layers):**

| Layer | Color | Data | Records |
|-------|-------|------|---------|
| `OES FF DDMMYYYY All` | Green | All activated DRs (drops table coords) | ~7,662 |
| `FF Remaining DRs DDMMYYYY` | Orange | ALL drops NOT in `oes_activations` | ~63,306 |

**Removed:** "Actual" layer (OES Excel GPS), "Missing from OES" layer (only QA'd DRs not in OES).

**Other changes:**
- Circle size: 3mm → 1.5mm
- Date format: `DD-MM-YY` → `DDMMYYYY` (e.g., `29012026`)
- GPKG filename: `OES FF DDMMYYYY.gpkg`
- QFieldCloud `admin` user must be a collaborator on target projects

**To add a new sync target:** Insert into `qfield_projects` table with `sync_enabled=true`.

---

## 2026-01-29: QFieldCloud - Docker Image Pull Failure Breaks process_projectfile

**Issue:** After OES import, QField sync uploaded files successfully but `process_projectfile` and `package` jobs failed with:
```
404 Client Error for http+docker://localhost/v1.50/images/create?tag=latest&fromImage=qfieldcloud-qgis: Not Found
("pull access denied for qfieldcloud-qgis, repository does not exist or may require 'docker login'")
```

**Root Cause:** The QFieldCloud worker_wrapper spawns `qfieldcloud-qgis` Docker containers for QGIS processing. The Docker SDK calls `images.pull()` before creating the container. Since `qfieldcloud-qgis` is a locally-built image (not on Docker Hub), the pull fails with 404. The image existed locally but became stale/unresolvable after some time.

**Symptoms:**
- OES import shows "QField sync triggered but confirmation timed out"
- Sync service status shows `last_error` with Docker pull error
- `process_projectfile` jobs in QFieldCloud DB show `status=failed`
- Files ARE uploaded to QFieldCloud (GPKG + QGS) but not processed

**Diagnosis Steps:**
```bash
# Check sync service status (port 8095)
curl -s http://100.96.203.105:8095/status | jq .

# Check recent jobs in QFieldCloud
docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import Job
for j in Job.objects.filter(type='process_projectfile').order_by('-created_at')[:10]:
    print(f'{j.created_at} | {j.status} | {j.project.name}')
"

# Verify qgis image exists locally
docker images | grep qfieldcloud-qgis
```

**Fix:**
```bash
# 1. Rebuild the qgis image
cd /opt/qfieldcloud && sudo docker-compose build qgis

# 2. Restart all worker wrappers
sudo docker-compose restart worker_wrapper

# 3. Re-trigger the sync
curl -s -X POST http://100.96.203.105:8095/sync/oes \
  -H "Content-Type: application/json" \
  -d '{"reportDate": "2026-01-29"}'
```

**Prevention:** If `process_projectfile` jobs start failing, first check `docker images | grep qgis` and rebuild if needed. This may happen periodically when Docker's image cache becomes stale.

**Key Files:**
- `/opt/qfieldcloud/docker-compose.yml` - QFieldCloud stack (qgis service definition)
- `/opt/qfield-sync/sync_oes_db_to_qfield.py` - Python sync script (triggers jobs)
- Sync service: `http://100.96.203.105:8095/status`

---

## 2026-01-28: Reporting - Exclude Invalid DRs with INNER JOIN

**Issue:** Daily reporting counts included DRs that don't exist in the SOW-imported `drops` table (e.g., DR18628799 showing "Unknown" project and "DR_NOT_FOUND" error).

**Root Cause:** Using `LEFT JOIN drops` allowed records to be counted even when the DR didn't exist in the drops table.

**File:** `src/modules/activate/services/reportingService.ts`

**Bad Pattern:**
```sql
-- ❌ Counts ALL records, even invalid DRs
SELECT upr.drop_number, d.zone_no
FROM dr_photo_unified_reviews upr
LEFT JOIN drops d ON d.drop_number = upr.drop_number
```

**Good Pattern:**
```sql
-- ✅ Only counts DRs that exist in drops table (from SOW import)
SELECT upr.drop_number, d.zone_no
FROM dr_photo_unified_reviews upr
INNER JOIN drops d ON d.drop_number = upr.drop_number
```

**Affected Queries:**
1. Daily counts (installed DRs from WA)
2. Daily counts (activated DRs from OES)
3. Trend analysis CTEs (wa_counts, oes_counts)
4. Per-project breakdown (oes_by_project)

**Key Insight:** The `drops` table is the source of truth for valid DR numbers (populated from SOW imports). Any DR not in this table is either:
- A typo in the submission
- From a project not yet imported
- Test/invalid data

Always use `INNER JOIN drops` when counting installation/activation metrics to ensure data integrity.

**Commits:**
- `a8cae39f` - fix(reporting): exclude invalid DRs from daily counts and trend analysis
- `9e0ce79e` - fix(reporting): remove non-existent d.project_name column references

---

## 2026-01-28: Drops Table Schema - No project_name Column

**Issue:** SQL query failed with "column d.project_name does not exist" error.

**Root Cause:** The `drops` table has `project_id` (UUID foreign key), NOT `project_name`. To get project name, you must JOIN to the `projects` table.

**Bad Pattern:**
```sql
-- ❌ Column doesn't exist
SELECT d.project_name FROM drops d
```

**Good Pattern:**
```sql
-- ✅ Join to projects table for project name
SELECT p.project_name
FROM drops d
LEFT JOIN projects p ON d.project_id = p.id

-- Or use dr_photo_unified_reviews which stores project name directly
SELECT upr.project FROM dr_photo_unified_reviews upr
```

**Drops Table Key Columns:**
- `drop_number` - DR number (e.g., DR1731166)
- `project_id` - UUID foreign key to projects
- `zone_no`, `pon_no`, `pole_number` - Location data
- `latitude`, `longitude` - Coordinates (source of truth for mapping)
- `address` - Physical address

**Key Insight:** When building reporting queries, get project name from `dr_photo_unified_reviews.project` (already stored) rather than joining through `drops → projects`.

---

## 2026-01-28: QField OES Sync - Dual Layer System

**Context:** QField mobile app needs visual distinction between activated (OES report) and remaining (not yet activated) drops.

**Architecture - Two GeoJSON Layers:**

| Layer | Source Query | Color | Purpose |
|-------|--------------|-------|---------|
| **OES FF {date}** | `INNER JOIN oes_activations` | Orange (255,140,0) | Activated drops from OES report |
| **Remaining Drops {date}** | `NOT EXISTS (oes_activations)` | Green (34,139,34) | Drops not yet in OES report |

**Key Code - Remaining Drops Query:**
```typescript
const remainingQuery = `
  SELECT d.drop_number, p.project_name, d.address, d.latitude, d.longitude
  FROM drops d
  LEFT JOIN projects p ON d.project_id = p.id
  WHERE d.latitude BETWEEN ${SA_BOUNDS.minLat} AND ${SA_BOUNDS.maxLat}
    AND d.longitude BETWEEN ${SA_BOUNDS.minLon} AND ${SA_BOUNDS.maxLon}
    AND NOT EXISTS (
      SELECT 1 FROM oes_activations oes WHERE oes.drop_id = d.id
    )
  ORDER BY d.drop_number
`;
```

**Coordinate Source of Truth:**
- Both layers use `drops` table coordinates (from Neon DB/OneMap planning)
- NOT OES coordinates from Nokia Excel (those were ~200m off from planning)

**QGS Styling:**
```xml
<!-- Both layers use singleSymbol renderer with size 2 (matches manual imports) -->
<renderer-v2 type="singleSymbol">
  <symbol type="marker">
    <layer class="SimpleMarker">
      <Option name="color" value="255,140,0,255"/>  <!-- Orange for OES -->
      <Option name="size" value="2"/>
    </layer>
  </symbol>
</renderer-v2>
```

**API Response:**
```typescript
return res.status(200).json({
  success: true,
  message: `Synced ${activatedCount} activated + ${remainingCount} remaining drops`,
  activatedCount: 7545,    // Example
  remainingCount: 63423,   // Example
  files: { activated: 'OES FF 28-01-2026.geojson', remaining: 'Remaining Drops 28-01-2026.geojson' },
});
```

**Key Files:**
- `pages/api/activate/sync-oes-to-qfield.ts` - Dual layer sync API
- QGS project file on QFieldCloud - Layer definitions and styling

**Key Insights:**
1. Use `NOT EXISTS` for inverse layer - more efficient than `LEFT JOIN ... WHERE NULL`
2. Match dot size (2) with manual import layers for visual consistency
3. Use contrasting colors (orange/green) for easy field identification

---

## 2026-01-28: Asset Purchase Price Validation - Zero Value Rejected

**Issue:** Creating a new asset with purchase price of `0` (for donated assets) failed with 400 validation error.

**Root Cause:** The `CreateAssetSchema` in `src/modules/assets/utils/schemas.ts` used `PositiveNumberSchema` for `purchasePrice`, which requires `> 0`. A value of `0` failed the `.positive()` validation.

**File:** `src/modules/assets/utils/schemas.ts:93`

**Wrong:**
```typescript
purchasePrice: PositiveNumberSchema.optional(),  // Requires > 0
```

**Fixed:**
```typescript
purchasePrice: NonNegativeNumberSchema.optional(),  // Allows >= 0
```

**Key Insight:** Assets can have zero purchase price (donated equipment, internal transfers, promotional items). Always use `NonNegativeNumberSchema` for monetary fields that can legitimately be zero.

**Commit:** `72a1a6ba` - fix(assets): allow zero purchase price for donated assets

---

## 2026-01-28: Contract Type Persistence - Legacy Value Mapping

**Issue:** Staff edit form contract type dropdown not showing correct value for existing staff; compliance labels not changing based on Employee vs IC.

**Root Cause:** Database had legacy values (`full-time`, `fulltime`) that weren't mapped in `mapLegacyContractType()`. The function only mapped `permanent` but not hyphenated/concatenated variants.

**Files involved:**
- `src/types/staff/compliance.types.ts` - `mapLegacyContractType()` function
- `src/modules/staff/components/StaffEditForm.tsx` - Form initialization
- `pages/api/staff/[staffId]/compliance.ts` - Dynamic labels

**Solution:**
1. Added legacy mappings to `mapLegacyContractType()`:
```typescript
const mapping = {
  permanent: SAContractType.PERMANENT,
  'full-time': SAContractType.PERMANENT,  // Added
  fulltime: SAContractType.PERMANENT,     // Added
  'fixed-term': SAContractType.FIXED_TERM, // Added
  // ... other mappings
};
```

2. StaffEditForm now maps existing contract_type to saContractType on load:
```typescript
// In form initialization
saContractType: existingStaff?.contract_type
  ? mapLegacyContractType(existingStaff.contract_type)
  : SAContractType.PERMANENT,
```

3. Compliance API dynamically sets labels based on contract type:
```typescript
function getRequiredDocuments(contractType: SAContractType | null) {
  const config = contractType ? SA_CONTRACT_CONFIG[contractType] : null;
  const isEmployee = config?.isEmployee ?? true;

  return [
    { type: 'employment_contract', label: isEmployee ? 'Employment Contract' : 'IC Agreement', required: true },
    { type: 'tax_document', label: isEmployee ? 'Tax Document (IRP5)' : 'Tax Document (IT3a)', required: false },
    // ...
  ];
}
```

**Prevention:** When adding new contract types or labels, always check `mapLegacyContractType()` for all possible DB values.

**Commits:** `d8d0ded5`, `b51e34d7`

---

## 2026-01-28: WA Bridge Disconnection - Missed DR Acknowledgments

**Issue:** DR submissions (DR1738553, DR1862759) were received and stored in the database, but WhatsApp acknowledgment messages were never sent.

**Root Cause:** The Go WhatsApp Bridge (VPS:8083) websocket disconnected at 05:57 UTC, but the Python WA Monitor service (which receives messages) kept running. This caused:
- ✅ Messages received and stored in `qa_photo_reviews` and `dr_photo_unified_reviews`
- ❌ Ack messages failed: `websocket not connected`

**Architecture:**
```
WhatsApp Message → Python WA Monitor (stores in DB) → ✅ Works independently
                → Go Bridge (sends acks) → ❌ Was disconnected
```

**Diagnosis:**
```bash
# Check bridge health
curl -s http://72.61.197.178:8083/health | jq '.connected'
# false = disconnected, needs restart

# Check bridge logs for errors
ssh root@72.61.197.178 "grep 'websocket not connected' /opt/whatsapp-bridge/bridge.log | tail -10"
```

**Fix:** Updated `/opt/wa-healthcheck.sh` on VPS to check actual connection status:
```bash
# OLD (bad) - only checked log file freshness
local log_age=$(( $(date +%s) - $(stat -c %Y "$log_file") ))

# NEW (good) - checks /health endpoint connected status
local connected=$(curl -s http://localhost:8083/health | jq -r '.connected')
if [ "$connected" != "true" ]; then
    systemctl restart whatsapp-bridge
fi
```

**Manual Ack Recovery:**
```bash
curl -s -X POST "http://72.61.197.178:8083/api/send" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "GROUP_JID@g.us",
    "message": "📸 *DR123456 Received!*\n\n✅ Photos: X\n\n(Delayed ack)",
    "mention_jid": "USER_JID@s.whatsapp.net"
  }'
```

**Prevention:** Health check cron runs every 5 minutes and auto-restarts bridge when disconnected.

---

## 2026-01-27: PO Approval - POStatus Enum vs Database Values

**Issue:** Type errors when comparing `po.status` with strings like `'draft'` or `'pending_approval'`.

**Root Cause:** Two different `POStatus` types exist:
1. `src/types/procurement/purchase-order.types.ts` - lowercase string union: `'draft' | 'pending_approval' | ...`
2. `src/types/procurement/po.types.ts` - UPPERCASE enum: `POStatus.DRAFT = 'DRAFT'`

Database stores lowercase values, but TypeScript expects enum comparisons.

**Solution:** Normalize to lowercase before comparing:
```typescript
const statusLower = String(po.status).toLowerCase();
const canApprove = statusLower === 'pending_approval';
const canEdit = statusLower === 'draft';
```

**Prevention:** When adding new status comparisons, always use lowercase string comparison to handle both enum and DB values.

---

## 2026-01-27: WhatsApp Bridge API - Snake_case Field Names

**Issue:** Direct calls to bridge `/send-message` endpoint returned `{"error": "Missing group_jid or message"}` despite sending all fields.

**Root Cause:** Bridge uses **snake_case** field names, not camelCase:
```bash
# ❌ WRONG - camelCase
{"groupJid": "...", "message": "...", "mentionJid": "..."}

# ✅ CORRECT - snake_case
{"group_jid": "...", "message": "...", "mention_jid": "..."}
```

**Direct Bridge API:**
```bash
curl -X POST "http://72.61.197.178:8083/send-message" \
  -H "Content-Type: application/json" \
  -d '{"group_jid": "GROUP@g.us", "message": "text", "mention_jid": "USER@lid"}'
```

**See:** `.claude/knowledge-base/wa-monitor/whatsapp-mentions.md` for full documentation.

---

## 2026-01-27: WhatsApp Bridge - Case-Sensitive Drop Number Regex

**Issue:** DR469378 was submitted via WhatsApp as "Dr469378" (lowercase 'r') but never received an acknowledgment and wasn't processed.

**Root Cause:** The Go WhatsApp bridge had a case-sensitivity bug in `processDropNumbers`:
```go
// Pattern requires uppercase DR
var dropPattern = regexp.MustCompile(`DR\d+`)

// BUG: Didn't uppercase content before matching
dropNumbers := dropPattern.FindAllString(content, -1)  // "Dr469378" doesn't match
if len(dropNumbers) == 0 {
    return  // Silent return - no logging!
}
```

**Why it was hard to find:**
1. Log showed "🎯 Processing drop numbers from message: 'Dr469378'" - making it look like processing started
2. No error was logged when pattern didn't match (silent `return`)
3. The 401 error that appeared was from a DIFFERENT function (`forwardToFibreFlow`), red herring

**Fix:** Uppercase content before pattern matching:
```go
// ✅ FIXED: Uppercase before matching
dropNumbers := dropPattern.FindAllString(strings.ToUpper(content), -1)
```

**Prevention:**
1. Log when early-returning due to no matches: `log.Printf("No DR patterns found in: %s", content)`
2. Use case-insensitive regex: `(?i)DR\d+`
3. Test with variations: "DR123", "Dr123", "dr123", "dR123"

**Affected File:** `/home/louis/whatsapp-bridge-go/main.go:2561`

**Recovery:** Manually process missed DRs via:
```bash
curl -X POST "https://dev.fibreflow.app/api/activate/process-new-dr" \
  -H "Content-Type: application/json" \
  -d '{"dropNumber": "DR469378", "projectName": "Mamelodi", "source": "manual_recovery"}'
```

---

## 2026-01-26: Unified Architecture - Store Data During Processing, Not During Display

**Issue:** Summary page was making live API calls to BOSS API (1Map) and querying maintenance_tickets table on every page view. This was:
1. Slow (API calls add latency)
2. Confusing (some data from DB, some from live API)
3. Unreliable (API timeouts affect user experience)

**Root Cause:** Architectural inconsistency where some DR data was stored in the unified table during processing, but contact info was fetched live during display.

**Solution:** UNIFIED ARCHITECTURE - ALL DR data should be stored in `dr_photo_unified_reviews` during processing (in `process-new-dr.ts`), then display endpoints simply read from the unified table.

**Migration 131 added these columns:**
```sql
-- Subscriber contact from 1Map
subscriber_name, subscriber_phone, subscriber_email, subscriber_language

-- QContact/Maintenance contact
qcontact_name, qcontact_phone, qcontact_email

-- Staff info from 1Map
signup_agent, installer_name
```

**Pattern to follow:**
```typescript
// ✅ GOOD: Fetch and store during processing (process-new-dr.ts)
const [subscriberContact, qContactInfo] = await Promise.all([
  fetchSubscriberContact(dropNumber),  // BOSS API
  fetchQContactInfo(dropNumber),       // maintenance_tickets
]);

await pool.query(`
  INSERT INTO dr_photo_unified_reviews (
    drop_number, subscriber_name, subscriber_phone, ...
  ) VALUES ($1, $2, $3, ...)
`, [dropNumber, subscriberContact?.subscriber_name, ...]);

// ❌ BAD: Fetch live during display (summary.ts - OLD approach)
const bossData = await fetchBossApiData(dropNumber);  // Live API call on every view
```

**Summary API now simply reads:**
```typescript
// ✅ GOOD: Read from unified table only
const result = await pool.query(`
  SELECT drop_number, subscriber_name, subscriber_phone, ...
  FROM dr_photo_unified_reviews
  WHERE drop_number = $1
`, [dropNumber]);
```

**For existing DRs:** Run `node scripts/backfill-contact-info.js` to populate contact info for DRs processed before this change.

**Key Principle:** The unified table (`dr_photo_unified_reviews`) is the single source of truth for DR data. All data should be stored there during processing, not fetched live during display.

**Affected Files:**
- `pages/api/activate/process-new-dr.ts` - Stores contact info
- `pages/api/activate/summary.ts` - Reads from unified table only
- `pages/api/activate/[dropNumber].ts` - Reads from unified table only
- `scripts/migrations/131_unified_contact_fields.sql` - Added columns
- `scripts/backfill-contact-info.js` - Backfill for existing DRs

### BOSS API Usage Classification

**BOSS API Host:** `http://100.96.203.105:8003` (Docker container on Velocity server)

The BOSS API is a caching layer for 1Map photo data. Here's when to use it:

**✅ LEGITIMATE BOSS API Calls:**

| Endpoint | Purpose | When Called |
|----------|---------|-------------|
| `dr-acknowledgment.ts` | Check if DR exists, get photo count for WhatsApp ack | Once per DR submission |
| `ensure-data.ts` | Download photos before QA review | Once when opening QA Wizard |
| `refresh.ts` | Manual refresh when user clicks "Refresh" | On-demand, user-initiated |
| `process-new-dr.ts` | Fetch photos/contact info during processing | Once during DR processing |
| `photo/[...path].ts` | Serve actual photo images | Every photo display (required) |

**❌ NEVER Call BOSS API From:**

| Endpoint | Why |
|----------|-----|
| `[dropNumber].ts` GET | Page view - use unified table |
| `summary.ts` | Page view - use unified table |
| Any listing/dashboard | Use unified table |

**Key Principle:** BOSS API calls are only legitimate for:
1. **Initial processing** (once per DR)
2. **Photo serving** (images can't be stored in DB)
3. **User-initiated refresh** (explicit action)

Never for passive page views or data display.

---

## 2026-01-22: Use Dev Mode for Local Development

**Issue:** Repeated `ChunkLoadError` and React error #423 when running production build locally (`npm run build && npm start`). After each rebuild, browser tries to load old cached chunk URLs that no longer exist.

**Symptoms:**
- `ChunkLoadError: Loading chunk XXXX failed`
- `React error #423` (hydration mismatch)
- Page stuck loading or shows stale content
- Must hard-refresh (Ctrl+Shift+R) after every rebuild

**Root Cause:** Production builds generate unique chunk hashes (e.g., `runtime-5044df1c70f18193.js`). Browser caches these URLs aggressively. After rebuild, hashes change but browser still requests old URLs → 400 errors.

**Solution:** Use `npm run dev` for local development instead of production mode.

```bash
# ✅ For local development
PORT=3004 npm run dev

# ❌ Avoid for rapid iteration (causes chunk caching issues)
npm run build && PORT=3005 npm start
```

**Benefits of Dev Mode:**
- Hot Module Replacement (HMR) - updates modules in place without full reload
- No chunk caching issues - dev server handles module updates
- Instant refresh on file changes - no manual rebuild needed
- Better error messages (not minified)
- Source maps for debugging

**When to Use Production Mode:**
- Final testing before deploy
- Performance testing
- Reproducing production-only bugs

**Affected Areas:** All modules - this is a Next.js/webpack behavior, not module-specific.

---

## 2026-01-22: Null-Safe Search Pattern (TODO: Global Implementation)

**Issue:** Search functionality crashed with `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` when filtering data with potentially null/undefined fields.

**Bad Pattern:**
```typescript
// ❌ Crashes if member.name or member.employeeId is undefined
const filtered = staff.filter(member => {
  return member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         member.employeeId.toLowerCase().includes(searchTerm.toLowerCase());
});
```

**Good Pattern:**
```typescript
// ✅ Null-safe search with early return and optional chaining
const filtered = staff.filter(item => {
  const search = searchTerm.toLowerCase();
  return !searchTerm ||  // Early return if no search term
    item.name?.toLowerCase().includes(search) ||
    item.employeeId?.toLowerCase().includes(search) ||
    item.email?.toLowerCase().includes(search) ||
    item.phone?.toLowerCase().includes(search) ||
    item.position?.toLowerCase().includes(search) ||
    item.department?.toLowerCase().includes(search);
});
```

**Key Principles:**
1. **Always use optional chaining (`?.`)** on any field that could be null/undefined
2. **Early return for empty search** - `!searchTerm ||` prevents unnecessary processing
3. **Search multiple fields** - name, ID, email, phone, position, department for better UX
4. **Case insensitive** - convert both search term and values to lowercase

**TODO: Audit and fix search in these pages:**
- [ ] `/staff` - ✅ Fixed (2026-01-22)
- [ ] `/projects` - needs audit
- [ ] `/suppliers` - needs audit
- [ ] `/contractors` - needs audit
- [ ] `/clients` - needs audit
- [ ] `/fleet/vehicles` - needs audit
- [ ] `/assets` - needs audit
- [ ] `/procurement/*` tables - needs audit
- [ ] Any DataGrid/table with search functionality

**Affected Areas:** All list pages with search/filter functionality.

---

## 2026-01-25: Database Connection Pattern - Use Inline pg Pool

**Issue:** Using `import db from '@/lib/db'` and `db.connect()` causes runtime errors in production builds:
```
TypeError: s.default.connect is not a function
```

**Root Cause:** The `lib/db.ts` default export doesn't work correctly when compiled. The minified code (`s.default.connect`) fails to resolve the Pool's connect method.

**Bad Pattern:**
```typescript
// ❌ Causes runtime errors in production
import db from '@/lib/db';

async function handler(req, res) {
  const client = await db.connect();  // TypeError: s.default.connect is not a function
  // ...
}
```

**Good Pattern:**
```typescript
// ✅ Works reliably in production
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(req, res) {
  const client = await pool.connect();
  try {
    // ... use client
  } finally {
    client.release();
  }
}
```

**Key Points:**
1. **Use inline Pool from 'pg'** - not the lib/db module
2. **Always use SSL** - `ssl: { rejectUnauthorized: false }` for Neon
3. **Always release client** - in finally block to prevent connection leaks
4. **Use HTTP, not WebSocket** - `pg` driver uses HTTP which is stable; `@neondatabase/serverless` uses WebSocket which fails when database sleeps

**When to use each driver:**
- `pg` (HTTP) - Stable, recommended for API routes
- `@neondatabase/serverless` (WebSocket) - Only if you need real-time/streaming features and can handle connection drops

**Affected Areas:** All API routes that need database connections, especially in `/pages/api/`.

---

## 2026-01-25: Config Lookup Fallback Pattern

**Issue:** `TypeError: Cannot read properties of undefined (reading 'icon')` when accessing properties from a config lookup where the key doesn't exist.

**Root Cause:** Using a config object to map status/type values to display properties without handling unknown values.

**Bad Pattern:**
```typescript
// ❌ Crashes if vehicle.status is not in statusConfig
const statusConfig = {
  active: { label: 'Active', icon: Car },
  maintenance: { label: 'Maintenance', icon: Wrench },
  retired: { label: 'Retired', icon: XCircle },
};

const status = statusConfig[vehicle.status];
const StatusIcon = status.icon;  // TypeError if status is undefined
```

**Good Pattern:**
```typescript
// ✅ Fallback for unknown values
const status = statusConfig[vehicle.status as keyof typeof statusConfig] || {
  label: vehicle.status || 'Unknown',
  color: 'bg-gray-100 text-gray-800',
  icon: Car,  // Default icon
};
const StatusIcon = status.icon;  // Always defined
```

**Key Points:**
1. **Always provide a fallback** when using config lookups with dynamic keys
2. **Use the raw value as label** - `vehicle.status || 'Unknown'` shows actual value
3. **Neutral styling for unknowns** - gray color indicates unexpected state
4. **Default icon** - use a sensible default that won't look broken

**Also Consider:**
- Database cleanup: Fix inconsistent values at the source (e.g., `inactive` → `retired`)
- Add new values to config if they're legitimate statuses

**Affected Areas:** Any component using config objects for status/type display (vehicles, projects, staff, etc.).

---

## 2026-01-25: Users Table Schema - Use first_name/last_name, Not name

**Issue:** `column "name" does not exist` or `column et.name does not exist` when querying users table for display names.

**Root Cause:** The `users` table has `first_name` and `last_name` columns, NOT a `name` column. This is a common mistake when writing queries that JOIN to the users table.

**Bad Pattern:**
```typescript
// ❌ Crashes - column "name" doesn't exist
const result = await client.query(`
  SELECT id, email, name FROM users WHERE role = 'admin'
`);

// ❌ Crashes when joining
const result = await client.query(`
  SELECT m.*, u.name as assigned_to_name
  FROM records m
  LEFT JOIN users u ON m.assigned_to = u.id
`);
```

**Good Pattern:**
```typescript
// ✅ Use COALESCE with first_name and last_name
const result = await client.query(`
  SELECT id, email, first_name, last_name,
         COALESCE(first_name || ' ' || last_name, first_name, last_name, email) as display_name
  FROM users
  WHERE role = 'admin'
`);

// ✅ Same pattern for JOINs
const result = await client.query(`
  SELECT m.*,
         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.last_name, u.email) as assigned_to_name
  FROM records m
  LEFT JOIN users u ON m.assigned_to = u.id
`);
```

**COALESCE Explained:**
The pattern `COALESCE(first_name || ' ' || last_name, first_name, last_name, email)` handles all cases:
1. Both names exist: "John Smith"
2. Only first_name: "John"
3. Only last_name: "Smith"
4. Neither name: falls back to email

**Users Table Schema:**
```sql
users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),  -- NOT "name"
  last_name VARCHAR(100),
  role VARCHAR(50),  -- 'admin', 'manager', 'user'
  is_active BOOLEAN DEFAULT true,
  ...
)
```

**Affected Areas:** Any API route or query that JOINs to the users table or needs to display user names. Common cases:
- Escalation lookups (escalated_to, escalated_by)
- Assignment lookups (assigned_to, created_by)
- Audit trails (modified_by, approved_by)
- Admin user dropdowns

---

## 2026-01-26: Tab-Based Navigation Pattern

**Context:** FibreFlow modules are migrating from sidebar sub-items to horizontal tab navigation at the top of each page. This provides a cleaner UI and better module organization.

**Architecture:**

```
src/modules/navigation/           # Navigation system
├── config/
│   ├── modules/                  # Per-module tab configs
│   │   ├── maintenance.config.ts
│   │   └── [module].config.ts
│   ├── registry.ts               # Module registration
│   └── index.ts                  # Exports
├── components/
│   ├── ModuleTabs.tsx            # Horizontal tab bar
│   └── SubTabs.tsx               # Sub-tab navigation
├── hooks/
│   └── useModuleTabs.ts          # Tab state management
└── types.ts                      # TypeScript types

src/components/module-page/       # Page wrapper
├── ModulePage.tsx                # Unified page wrapper
├── ModuleHeader.tsx              # Header with icon/title/actions
└── types.ts
```

**Module Config Pattern:**

```typescript
// src/modules/navigation/config/modules/[module].config.ts
import type { ModuleNavigationConfig } from '../../types';

export const [module]Config: ModuleNavigationConfig = {
  moduleId: '[module]',
  moduleName: '[Module Name]',
  description: '[Description]',
  basePath: '/[module]',
  icon: ModuleIcon,
  tabs: [
    { id: 'dashboard', label: 'Dashboard', icon: Icon, path: '/[module]' },
    { id: 'sub-page', label: 'Sub Page', icon: Icon, path: '/[module]/sub-page' },
  ],
};
```

**Page Wrapper Pattern:**

```typescript
// app/(main)/[module]/[page]/client.tsx
import { ModulePage } from '@/components/module-page';
import { [module]Config } from '@/modules/navigation';

export default function PageClient() {
  const headerActions = <button>Action</button>;  // Optional

  return (
    <ModulePage config={[module]Config} headerActions={headerActions}>
      <div>{/* Page content */}</div>
    </ModulePage>
  );
}
```

**Sidebar Reduction:**

```typescript
// Before: 7 items
items: [
  { to: '/module', label: 'Dashboard' },
  { to: '/module/page1', label: 'Page 1' },
  // ... 5 more items
]

// After: 1 item (tabs handle sub-navigation)
items: [
  { to: '/module', label: 'Module Name', icon: ModuleIcon },
]
```

**Key Files:**
| Component | Location |
|-----------|----------|
| ModulePage | `src/components/module-page/ModulePage.tsx` |
| ModuleTabs | `src/modules/navigation/components/ModuleTabs.tsx` |
| useModuleTabs | `src/modules/navigation/hooks/useModuleTabs.ts` |
| Configs | `src/modules/navigation/config/modules/*.config.ts` |

**Reference Implementation:**
- Module: Maintenance
- Commit: `96ea3f84` - feat(maintenance): migrate to horizontal tab navigation
- Skill: `/navigation` - Full migration process

**Affected Areas:** All modules being migrated to tab-based navigation. Current status:
- [x] Maintenance - Completed (2026-01-26)
- [x] Activate - Completed (2026-01-26) - Dashboard, QA Centre, Reports tabs
- [x] Assets - Completed (2026-01-26)
- [ ] Procurement - Pending
- [ ] Fleet - Pending
- [ ] Projects - Pending
- [ ] HR/Staff - Pending

---

## 2026-01-26: API Response Structure Must Match Component Expectations

**Issue:** `Cannot read properties of undefined (reading 'filter')` when clicking the Team tab on Project Detail page.

**Root Cause:** The API returned a flat array but the component expected a structured object with `members`, `stats`, and `primaryManager` properties.

**Bad Pattern (API):**
```typescript
// ❌ Returns flat array - component will crash trying to access .members
const response = teamMembers.map(member => ({...}));
return apiResponse.success(res, response);
```

**Good Pattern (API):**
```typescript
// ✅ Returns structured object matching component expectations
const members = teamMembers.map(member => ({...}));
const primaryManager = members.find(m => m.is_primary) || null;
const stats = {
  staff: members.filter(m => m.person_type === 'staff').length,
  contractors: members.filter(m => m.person_type === 'contractor').length,
  total: members.length,
};
return apiResponse.success(res, { primaryManager, members, stats });
```

**Component Defensive Pattern:**
```typescript
// ✅ Always add defensive null checks even when API should return correct structure
const members = teamData.members || [];
const stats = teamData.stats || { staff: 0, contractors: 0, total: 0 };
const filteredMembers = members.filter(m => ...);
```

**Key Learnings:**
1. **Document API response shape** in component interfaces
2. **Add defensive defaults** for all nested properties
3. **Test API responses** before building UI components
4. **Match snake_case vs camelCase** - be consistent (this codebase uses snake_case for DB fields)

**Affected Areas:** All new tab components that consume project APIs:
- `ProjectTeamTab.tsx` - uses `/api/projects/[projectId]/team`
- `ProjectProcurementTab.tsx` - uses `/api/projects/[projectId]/procurement-summary`
- `ProjectMaintenanceTab.tsx` - uses `/api/projects/[projectId]/maintenance-summary`

---

## 2026-01-26: Project Hub Database Views

**Context:** Sprint 1 created two database views for unified project data:

**v_project_team View:**
```sql
-- Unified staff + contractors for a project
SELECT
  sp.project_id,
  sp.staff_id::text as person_id,
  'staff' as person_type,
  COALESCE(s.first_name || ' ' || s.last_name, 'Unknown') as name,
  s.email, s.phone, sp.role,
  sp.is_active, sp.is_primary
FROM staff_projects sp
JOIN staff s ON s.id = sp.staff_id
UNION ALL
SELECT
  cp.project_id,
  cp.contractor_id::text as person_id,
  'contractor' as person_type,
  c.company_name as name,
  c.email, c.phone, cp.role,
  cp.is_active, cp.is_primary_contractor as is_primary
FROM contractor_projects cp
JOIN contractors c ON c.id = cp.contractor_id;
```

**PM Tracking Pattern:**
- Old: `projects.project_manager` (UUID to staff)
- New: `staff_projects.is_primary` (boolean flag)

Benefits:
- Single source of truth in junction table
- Supports multiple PMs per project if needed
- Works with unified team view

**Migration Reference:**
- Migration: `scripts/migrations/130_system_integration.sql`
- PM Migration: `scripts/migrations/run-pm-migration.js`

---

## 2026-01-26: Nokia OES Format Changes - Track Column Alignment

**Issue:** OES import preview shows wrong data - Status displays dB values, Team displays coordinates.

**Root Cause:** Nokia changes their OES Excel report format periodically, adding or removing columns.

**Format History:**

| Date | Columns | Change |
|------|---------|--------|
| Pre-Jan 2026 | 13 | Original format |
| Jan 2026 | 14 | Added "Stack Ref." at column E |
| Jan 2027 | 13 | Removed "Stack Ref." column |

**Current Format (Jan 2027 - 13 columns):**
```
A: Drop Number, B: Serial, C: Timestamp, D: OLT Address,
E: ONT Rx SIG, F: Link Budget ONT→OLT, G: OLT Rx SIG, H: Link Budget OLT→ONT,
I: Status, J: Latitude, K: Longitude, L: Current ONT RX, M: Team
```

**Detection Pattern:**
When preview shows numeric values in text fields (Status, Team), columns are misaligned:
```
Status: -26.21       ← Should be "Active" (numeric = wrong column)
Team: -21.307682     ← Should be "moa1" (coordinate = wrong column)
```

**Fix Pattern:**
1. Check actual Excel headers with test script
2. Update `EXPECTED_HEADERS` array (count and positions)
3. Update column indices in row parsing
4. Update `OESRow` interface if fields added/removed
5. Update DB insert if schema changed

**Reference Commits:**
- `701969e2` - Jan 2027: Removed Stack Ref (14→13 columns)
- `79e97a07` - Jan 2026: Added Stack Ref (13→14 columns)

**Lesson:** External data sources change format without notice. Always verify column positions when import data looks wrong.

---

## 2026-01-26: Excel Import Validation Pattern

**Context:** All Excel imports (OES, ARCH, OLT Report) now have format validation to detect column misalignment before data corruption occurs.

**Validation Pattern:**

```typescript
// 1. Define expected headers
const EXPECTED_HEADERS = ['Drop Number', 'Serial Number', 'Status', 'Team'];

// 2. Validate headers at key positions
function validateHeaders(headers: string[]): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check column count
  if (headers.length < 14) {
    warnings.push(`Column count mismatch: expected 14, got ${headers.length}`);
  }

  // Check key header positions contain expected keywords
  const expectedAt = { 0: 'drop', 9: 'status', 13: 'team' };
  for (const [idx, keyword] of Object.entries(expectedAt)) {
    if (!headers[+idx]?.toLowerCase().includes(keyword)) {
      warnings.push(`Column ${idx}: expected "${keyword}", got "${headers[+idx]}"`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

// 3. Validate data sample for alignment issues
function validateDataSample(rows: Row[]): string[] {
  const warnings: string[] = [];
  const sampleSize = Math.min(10, rows.length);

  let badStatusCount = 0;
  for (let i = 0; i < sampleSize; i++) {
    // Status should be text like "Active", not numeric like "-26.21"
    if (!isNaN(parseFloat(rows[i].status))) badStatusCount++;
  }

  if (badStatusCount > sampleSize / 2) {
    warnings.push(`⚠️ Status contains numeric values. Columns may be misaligned!`);
  }

  return warnings;
}
```

**API Response Pattern:**
```typescript
return res.status(200).json({
  success: true,
  preview: rows,
  totalRows: rows.length,
  warnings: warnings.length > 0 ? warnings : undefined,
  headerMismatch,
});
```

**UI Display Pattern:**
```tsx
{formatWarnings.length > 0 && (
  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg p-4">
    <AlertTriangle className="w-5 h-5 text-amber-600" />
    <h4>Format Validation Warnings</h4>
    <ul>
      {formatWarnings.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  </div>
)}
```

**Files with validation:**
- `pages/api/activate/import-oes.ts` - OES Import (14 columns)
- `pages/api/activate/import-offline.ts` - ARCH Import (Summary/Audit formats)
- `pages/api/system/olt-report/import.ts` - OLT Report (22+ columns)

**Key Detection Patterns:**
| Issue | Detection |
|-------|-----------|
| Column count changed | `headers.length !== expected` |
| Column shifted | Numeric value in text field |
| Wrong format | Missing expected keywords in headers |
| Coordinate in text field | `/^-?\d+\.\d+$/` matches team/status |

---

## 2026-01-26: Type Casting in PostgreSQL JOINs

**Issue:** `operator does not exist: text = uuid` or `operator does not exist: character varying = uuid` when joining tables with mismatched ID column types.

**Root Cause:** Some tables store `project_id` as UUID, others as TEXT or VARCHAR. PostgreSQL requires explicit casting.

**Bad Pattern:**
```sql
-- ❌ Fails if maintenance_tickets.project_id is TEXT but projects.id is UUID
SELECT * FROM maintenance_tickets mt
JOIN projects p ON mt.project_id = p.id
```

**Good Pattern:**
```sql
-- ✅ Cast both sides to text for safe comparison
SELECT * FROM maintenance_tickets mt
JOIN projects p ON mt.project_id::text = p.id::text
```

**Affected Tables (project_id column types):**
- `projects.id` - UUID
- `staff_projects.project_id` - UUID
- `maintenance_tickets.project_id` - TEXT
- `rfqs.project_id` - VARCHAR

**Best Practice:** When creating views that join across multiple tables, always cast to `::text` for safety.

---

## 2026-01-26: CSS Variables Pattern for Component Styling

**Issue:** Components using hardcoded Tailwind dark mode classes (`bg-white dark:bg-gray-800`) created inconsistency when the design system evolved.

**Root Cause:** Hardcoded color values scattered across components make theme changes difficult and create visual inconsistencies.

**Bad Pattern:**
```tsx
// ❌ Hardcoded dark mode classes - hard to maintain
<div className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
  <span className="text-gray-900 dark:text-white">Primary</span>
  <span className="text-gray-600 dark:text-gray-400">Secondary</span>
</div>
```

**Good Pattern:**
```tsx
// ✅ CSS variables - centralized theme control
<div className="bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]">
  <span className="text-[var(--ff-text-primary)]">Primary</span>
  <span className="text-[var(--ff-text-secondary)]">Secondary</span>
</div>
```

**FibreFlow CSS Variables:**
| Variable | Light Mode | Dark Mode | Usage |
|----------|------------|-----------|-------|
| `--ff-bg-primary` | white | gray-900 | Page background |
| `--ff-bg-secondary` | white | gray-800 | Card backgrounds |
| `--ff-bg-tertiary` | gray-50 | gray-900/50 | Nested backgrounds, table headers |
| `--ff-text-primary` | gray-900 | white | Headings, main text |
| `--ff-text-secondary` | gray-600 | gray-400 | Labels, descriptions |
| `--ff-text-tertiary` | gray-400 | gray-500 | Muted text, placeholders |
| `--ff-border-light` | gray-200 | gray-700 | Card borders, dividers |
| `--ff-primary-500` | blue-600 | blue-500 | Primary actions, links |

**When to Keep Semantic Colors:**
Status indicators should stay as Tailwind classes (not CSS variables):
- `text-blue-500` - Installed count
- `text-purple-500` - Activated count
- `text-yellow-500` - Pending/Warning
- `text-green-500` - Success/Reviewed
- `text-red-500` - Error/Failed

**Reference:**
- Commit: `2645549f` - fix(activate): update DrListPage styling to match UI theme spec
- File: `src/modules/activate/components/DrListPage.tsx`

---

## 2026-01-26: ModulePage Content Wrapper Pattern

**Issue:** Double padding when components wrap their own content in padded containers, but ModulePage already provides `p-6` padding.

**Root Cause:** Content components were designed before ModulePage existed, and had their own outer padding/background.

**Bad Pattern:**
```tsx
// ❌ Component has its own padding - creates double padding inside ModulePage
function MyComponent() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* content */}
      </div>
    </div>
  );
}
```

**Good Pattern:**
```tsx
// ✅ Component uses space-y-6 for internal spacing only
function MyComponent() {
  return (
    <div className="space-y-6">
      {/* ModulePage provides p-6 padding, bg comes from layout */}
      <Card>...</Card>
      <Card>...</Card>
    </div>
  );
}
```

**ModulePage Structure:**
```tsx
<ModulePage config={moduleConfig}>
  {/* Header with icon, title, description */}
  {/* Tab navigation with px-6 */}
  <div className="p-6">  {/* Content area - padding provided here */}
    {children}           {/* Your component goes here - NO outer padding needed */}
  </div>
</ModulePage>
```

**Checklist When Converting to ModulePage:**
1. Remove outer `min-h-screen bg-* p-*` wrapper
2. Remove `max-w-7xl mx-auto` container (unless specifically needed)
3. Use `space-y-6` for vertical spacing between sections
4. Keep card/section backgrounds (`bg-[var(--ff-bg-secondary)]`)

**Reference:**
- Component: `src/components/module-page/ModulePage.tsx`
- Example: `src/modules/activate/components/DrListPage.tsx`

---

## 2026-01-26: Route Restructuring with Redirect Pages

**Context:** FibreFlow is consolidating project-related modules under `/projects/` namespace for cleaner URL structure.

**Pattern:** Old routes become simple redirect pages, new routes contain the actual content.

**Redirect Page Pattern:**
```tsx
// pages/health-safety/index.tsx (OLD location - now a redirect)
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/health-safety',
      permanent: true,  // 301 redirect for SEO
    },
  };
};

export default function RedirectPage() {
  return null;  // Never rendered
}
```

**New Page Location:**
```tsx
// pages/projects/health-safety/index.tsx (NEW location)
import { HealthSafetyDashboard } from '@/modules/health-safety/components';

export default function HealthSafetyPage() {
  return <HealthSafetyDashboard />;
}
```

**Route Restructuring Map:**
| Old Route | New Route | Status |
|-----------|-----------|--------|
| `/health-safety/*` | `/projects/health-safety/*` | ✅ Completed |
| `/pipeline/*` | `/projects/pipeline/*` | ✅ Completed |
| `/daily-progress` | `/projects/progress` | ✅ Completed |
| `/tasks` | `/projects/tasks` | ✅ Completed |

**Benefits:**
1. **SEO Friendly** - 301 redirects preserve link juice
2. **Backwards Compatible** - Old bookmarks/links still work
3. **Clean Namespace** - Related modules grouped under `/projects/`
4. **Gradual Migration** - Can migrate one module at a time

**Sidebar Update:**
When restructuring routes, update sidebar config to point to new locations:
```typescript
// src/components/layout/sidebar/config/projectSection.ts
items: [
  { to: '/projects/health-safety', label: 'Health & Safety' },  // Not /health-safety
  { to: '/projects/pipeline', label: 'Pipeline' },              // Not /pipeline
]
```

**Reference:**
- Commit: `4268067f` - refactor(routes): move Health & Safety and Pipeline under /projects
- Navigation Config: `src/modules/navigation/config/modules/projects.config.ts`

---

## 2026-01-26: Filter-Aware CSV Export Pattern

**Context:** All CSV/Excel exports should reflect the current filter state and include filter info in the filename.

**Pattern Components:**

1. **Dynamic Button Text** - Shows what's being exported:
```tsx
// In header/toolbar component
const hasFilters = filter?.status || filter?.type || filter?.searchTerm;
const exportLabel = hasFilters
  ? `Export ${filter?.status || 'Filtered'}`
  : 'Export All';

<button onClick={onExport} title={`Export ${hasFilters ? 'filtered' : 'all'} data to CSV`}>
  <Download className="h-4 w-4" />
  {exportLabel}
</button>
```

2. **Descriptive Filename** - Includes active filters:
```typescript
// In export handler
const filterParts: string[] = [];
if (filter.status) filterParts.push(filter.status);
if (filter.department) filterParts.push(filter.department.replace(/\s+/g, '-'));
if (filter.searchTerm) filterParts.push('search');
const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
a.download = `staff${filterSuffix}-${new Date().toISOString().split('T')[0]}.csv`;
// Result: "staff-active-Engineering-2026-01-26.csv"
```

3. **API-Side Filtering** (if export via API endpoint):
```typescript
// pages/api/module/export.ts
const filterParts: string[] = [];
if (filters.direction) filterParts.push(filters.direction);
if (filters.status) filterParts.push(filters.status);
if (filters.project) filterParts.push(filters.project.replace(/\s+/g, '-'));

const filterSuffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';
const filename = `module_export${filterSuffix}-${new Date().toISOString().split('T')[0]}.csv`;

res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
```

**Components Updated (2026-01-26):**
| Module | Component | Filter Fields |
|--------|-----------|---------------|
| Staff | StaffList, StaffListHeader | status, department, position |
| Clients | ClientList, ClientListHeader | status, type |
| Projects | ProjectList, ProjectListHeader | status, priority |
| WA Logs | LogsTab, export.ts API | direction, status, project, drop_number |
| Activate DR List | DrListPage | statusFilter, projectFilter |
| Serial Mismatch | SerialMismatchReports | status, team, zone |
| Serial Swap | SerialSwapReports | status |
| Offline Devices | OfflineDevicesReports | zone, bucket, matchStatus, serialMismatchOnly |

**Reference Commit:** `51dbdd1e` - feat(exports): add filter-aware CSV exports across all modules

**Key Principles:**
1. **Export what's shown** - The exported data should match what the user sees on screen
2. **Filename tells the story** - User can identify export contents from filename alone
3. **Dynamic button feedback** - User knows what they're exporting before clicking
4. **Pass filters to header** - Header component needs filter state for dynamic button text

---

## 2026-01-26: Access Control System - Settings vs Dedicated Page

**Context:** FibreFlow has a comprehensive RBAC (Role-Based Access Control) system accessible at Settings > Access Control tab.

**Location:** `/settings` → Access Control tab (NOT a separate page in System section)

**Components:**
| Component | Location | Purpose |
|-----------|----------|---------|
| `AccessControlTab.tsx` | `src/components/settings/AccessControlTab.tsx` | Main 1089-line RBAC UI |
| `UserPermissionsModal` | Inside AccessControlTab | Individual user permission overrides |
| Settings page | `src/pages/Settings.tsx` | Tab container |

**Three Sub-Tabs:**

1. **Users (61)** - User management
   - Search, filter by role/status
   - Role dropdown selector (immediate change)
   - "Permissions" button opens individual override modal
   - "Deactivate" action

2. **Roles (9)** - Role permission matrix
   - Role list with user counts
   - Permission grid: VIEW | CREATE | EDIT columns
   - Editable checkboxes per permission
   - Super Admin is not editable (71 permissions)

3. **Permissions** - Permission hierarchy tree
   - 12 modules: Dashboard, Projects, Activations, Field Operations, Maintenance, People, Clients, Contractors, Procurement, Assets, Fleet, Communications
   - Expandable to show sub-permissions

**Role Hierarchy (levels):**
```
6: super_admin (all permissions, not editable)
5: system
4: admin (Administrator)
3: manager
2: technician (Field Technician)
1: viewer
```

**Individual Permission Overrides:**
The `UserPermissionsModal` allows granting/revoking specific permissions beyond the user's role:
- From Role (checkbox) - inherited from role
- Custom Grant (green) - manually granted
- Custom Revoke (red X) - manually revoked
- No Access (unchecked)
- Auto-save functionality
- "Show only custom overrides" filter

**Database Tables:**
| Table | Purpose |
|-------|---------|
| `access_permissions` | Permission definitions |
| `role_permissions` | Role-to-permission mappings |
| `user_permission_overrides` | Individual user grants/revokes with expiry |

**APIs:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/permissions` | GET | List all permissions (flat or tree) |
| `/api/admin/roles` | GET | List roles with permissions |
| `/api/admin/users/[userId]/permissions` | GET/POST/DELETE | User permission overrides |

**Key Learning:** Don't create duplicate Access Control pages. The functionality already exists in Settings.

**Reference Files:**
- `src/components/settings/AccessControlTab.tsx` - Main component (1089 lines)
- `src/lib/permissions/index.ts` - Permission service
- `src/lib/auth/middleware.ts` - Auth middleware with `withAuth`, `withRole`, `withPermission`

---

## 2026-01-26: Settings Page Full-Width for Data Tables

**Issue:** Access Control tab data table was constrained by `max-w-4xl` container, making the user table cramped.

**Solution:** Conditionally remove width constraints for tabs that need full width (like data tables).

**Pattern:**
```tsx
// src/pages/Settings.tsx
const isFullWidth = activeTab === 'access';

return (
  <div className={`p-6 ${isFullWidth ? '' : 'max-w-4xl mx-auto'}`}>
    {renderTabContent()}
  </div>
);
```

**When to Use Full Width:**
- Data tables with many columns
- Complex forms with side-by-side layouts
- Permission matrices

**When to Keep Constrained:**
- Simple forms (General settings)
- Theme selection
- Toggle lists

---

## 2026-01-26: Photo Fetching API Architecture (BOSS API)

**Current Implementation**: All photo fetching goes through the BOSS API Docker container on Velocity server.

**BOSS API Host:** `http://100.96.203.105:8003`

**API Endpoints Used:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/record/{dropNumber}` | GET | Get DR metadata (photo list, serials, status) |
| `/api/download/{dropNumber}` | POST | Trigger photo download from 1Map cloud to local cache |
| `/api/photo/{dropNumber}/{filename}` | GET | Serve actual photo file |
| `/health` | GET | Health check |

**Data Flow:**
```
1Map Cloud → BOSS API (caching layer) → FibreFlow APIs → Browser
    ↓                   ↓
  Source          Local cache at:
                  /var/lib/docker/volumes/boss_dr_photos/_data/{DR}/
```

**Files using BOSS API:**

| File | Endpoint Used | When |
|------|---------------|------|
| `dr-acknowledgment.ts` | `/api/record/` | DR submission (check photo count) |
| `process-new-dr.ts` | `/api/record/` | Initial processing |
| `ensure-data.ts` | `/api/record/`, `/api/download/` | QA Wizard open (sync new photos) |
| `refresh.ts` | `/api/record/`, `/api/download/` | User-initiated refresh |
| `fetch-photos.ts` | `/api/record/`, `/api/download/` | Legacy photo fetch |
| `extract-data.ts` | `/api/photo/` | VLM data extraction (actual image URLs) |
| `photo/[...path].ts` | `/api/photo/` | Photo proxy (serves to browser) |
| `health-check.ts` | `/health` | System health check |
| `photoFetchService.ts` | `/api/record/`, `/api/download/` | Service layer with retry logic |

**Environment Variable:**
```bash
ONEMAP_HOST=http://100.96.203.105:8003  # Default if not set
BOSS_API_HOST=http://100.96.203.105:8003  # Alias used in some files
VELOCITY_PHOTO_URL=http://100.96.203.105:8003  # For photo proxy
```

**Note:** "BOSS API", "ONEMAP_HOST", and "Velocity Photo API" all refer to the same service - the Docker container on Velocity that caches 1Map data.

---

## 2026-01-26: Unified WhatsApp Bridge Architecture

**Context:** Consolidated two separate WhatsApp services (sender on 8081, receiver/bridge on 8083) into a single unified service on port 8083.

**Why Unified?**
1. Single service handles both sending AND receiving
2. Groups managed via database (`wa_monitored_groups`), not hardcoded
3. No service restart needed to add new groups (use `/reload-groups`)
4. Reduced complexity and potential for session conflicts

**Architecture:**
```
                    ┌─────────────────────────────────────────────────────┐
                    │           UNIFIED BRIDGE (VPS:8083)                 │
                    │              +27 63 841 2276                        │
                    ├─────────────────────────────────────────────────────┤
FibreFlow APIs ───► │  SEND                    │  RECEIVE                │
wa-feedback:8092    │  • /send-message         │  • DR submissions       │
                    │  • /delete-message       │  • Maintenance photos   │
                    │  • /react                │  • Admin commands       │
                    │  • /groups               │                         │
                    │  • /reload-groups        │                         │
                    └─────────────────────────────────────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
              SQLite (local)        Neon DB               Command Bot
              messages.db        wa_monitored_groups        (8086)
```

**Key Services:**

| Service | Server | Port | Purpose |
|---------|--------|------|---------|
| `whatsapp-bridge` | VPS (72.61.197.178) | 8083 | Unified send + receive |
| `wa-command-bot` | VPS | 8086 | WhatsApp admin commands |
| `wa-feedback` | Velocity (100.96.203.105) | 8092 | Proxy to VPS bridge |
| ~~`whatsapp-sender`~~ | ~~VPS~~ | ~~8081~~ | **DISABLED** - merged into bridge |

**Unified Bridge Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check with connection status |
| `/send-message` | POST | Send message with @mention support |
| `/delete-message` | POST | Delete sent message (within 1 hour) |
| `/react` | POST | Send emoji reaction (👍 or ❌) |
| `/groups` | GET | List monitored groups from database |
| `/reload-groups` | GET | Reload groups from DB without restart |
| `/list-recent` | GET | List deletable messages from last hour |

**DB-Driven Groups Pattern:**

Groups are stored in `wa_monitored_groups` table and loaded into memory at startup:

```go
type MonitoredGroup struct {
    ID          string
    GroupJID    string    // e.g., "120363418298130331@g.us"
    GroupName   string    // e.g., "Lawley"
    ProjectName string    // e.g., "Lawley"
    GroupType   string    // "dr_submission", "maintenance", "admin"
    Description string
    IsActive    bool
}
```

**Group Types:**
- `dr_submission` - DR photo submissions → processed and acknowledged
- `maintenance` - Maintenance photos → 👍 reaction on success, ❌ on failure
- `admin` - WhatsApp commands only (for wa-command-bot)

**Adding New Groups:**

1. **Via FibreFlow UI:** `/communications/whatsapp` → Groups tab
2. **Via Direct SQL:**
```sql
INSERT INTO wa_monitored_groups (group_jid, group_name, project_name, group_type, description)
VALUES ('120363XXXXXXXXXX@g.us', 'Group Name', 'Project', 'dr_submission', 'Description');
```
3. **Reload without restart:**
```bash
curl http://72.61.197.178:8083/reload-groups
```

**Finding Group JID:**
1. Add the bridge phone (+27 63 841 2276) to the WhatsApp group
2. Send any message in the group
3. Check bridge logs: `ssh root@72.61.197.178 "tail -20 /opt/whatsapp-bridge/bridge.log"`
4. Look for line: `📝 Storing message from GROUP_JID`

**Fallback Behavior:**
The bridge has a hardcoded `PROJECTS` map as fallback if DB is unreachable. DB-loaded groups take priority.

**Key Files:**
| File | Location | Purpose |
|------|----------|---------|
| `main.go` | `/home/louis/whatsapp-bridge-go/` (Velocity) | Bridge source code |
| `whatsapp-bridge` | `/opt/whatsapp-bridge/` (VPS) | Compiled binary |
| `wa-feedback-service.js` | `/home/louis/wa-feedback-service/` (Velocity) | Proxy service |
| `wa-monitor.md` | `.claude/modules/` | Full documentation |

**Reference:**
- Plan: `.claude/plans/toasty-jumping-pearl.md` (Unified WhatsApp Bridge Implementation)
- Module doc: `.claude/modules/wa-monitor.md`

---

## 2026-01-26: WA Portal Database Unification Pattern

**Issue:** WA Portal UI (`/communications/whatsapp` → Groups tab) was using a different database table (`wa_group_config`) than the unified bridge (`wa_monitored_groups`).

**Root Cause:** Historical split where portal and bridge evolved independently with different tables.

**Bad Pattern:**
```
WA Portal UI ───► wa_group_config (4 rows)      ❌ Disconnected
                      │
                      └── enabled, phone_number, capture_photos

Unified Bridge ───► wa_monitored_groups (7 rows) ❌ Different table
                      │
                      └── group_type, is_active, description
```

**Good Pattern:**
```
WA Portal UI ─────┐
                  ├──► wa_monitored_groups (single source of truth)
Unified Bridge ───┘
```

**Migration Commit:** `e0592f52`

**Files Updated:**

| File | Change |
|------|--------|
| `pages/api/communications/whatsapp/groups/index.ts` | `wa_group_config` → `wa_monitored_groups` |
| `pages/api/communications/whatsapp/groups/[id].ts` | Same + bridge reload trigger |
| `pages/api/communications/whatsapp/groups/[id]/test.ts` | Port 8081 → 8083 |
| `GroupsTab.tsx` | Added `group_type` dropdown |
| `ChatTab.tsx`, `SendTab.tsx` | `WaGroupConfig` → `WaMonitoredGroup` |
| `waAdminApiService.ts` | Updated types |

**Bridge Auto-Reload:**
```typescript
// Trigger after any CRUD operation
try {
  await fetch('http://72.61.197.178:8083/reload-groups', { method: 'GET' });
} catch (e) {
  console.warn('[WA Groups] Failed to trigger bridge reload:', e);
}
```

**Type Safety for Optional Fields:**
```typescript
// ❌ BAD: project_name might be null
const veloTest = data.find(g => g.project_name.toLowerCase().includes('velo'));

// ✅ GOOD: Null-safe with optional chaining
const veloTest = data.find(g =>
  g.group_name?.toLowerCase().includes('velo server') ||
  g.project_name?.toLowerCase().includes('velo')
);
```

**Key Principle:** WA Portal and Bridge should ALWAYS use the same database table. Changes in UI should immediately reflect in bridge behavior.

---

## 2026-01-27: Next.js Route Resolution - Directory Takes Precedence Over Flat File

**Issue:** API endpoint `/api/qa-review-history` kept returning old code behavior despite source file being updated. Multiple clean rebuilds and service restarts didn't fix it.

**Root Cause:** Next.js route resolution prioritizes `pages/api/route/index.ts` (directory) over `pages/api/route.ts` (flat file). Both files existed:
```
pages/api/qa-review-history.ts      ← Updated code (NOT being compiled)
pages/api/qa-review-history/
  └── index.ts                      ← Old code (WAS being compiled)
```

**Debugging Signs:**
1. Source file has correct code but built `.next/server/pages/api/*.js` has old code
2. Clean rebuild (`rm -rf .next`) doesn't fix it
3. Cache clearing (`rm -rf node_modules/.cache`) doesn't fix it
4. Version markers added to source never appear in API responses

**Verification Commands:**
```bash
# Check if both directory AND flat file exist
ls -la pages/api/route-name*

# If directory exists, it takes precedence
cat pages/api/route-name/index.ts   # This is what gets compiled
cat pages/api/route-name.ts         # This is IGNORED
```

**Solution:**
```bash
# Remove the directory to allow flat file to be compiled
rm -rf pages/api/route-name/

# Then rebuild
rm -rf .next && npm run build
```

**Prevention:**
1. Never have both `route.ts` AND `route/index.ts` in pages/api
2. When refactoring from directory to flat file, DELETE the directory
3. Add version markers (`_v: '2026-01-27-v1'`) to API responses for deployment verification

**Affected Files:**
- `pages/api/qa-review-history.ts` - Fixed by removing duplicate directory
- Commit: `ca90e61e` - fix(qa-history): remove duplicate directory causing old code to be used

---

## 2026-01-26: DR Activity Timeline System

**Context:** The Activate module has a comprehensive activity tracking system that logs all DR lifecycle events.

**Database Table:** `dr_activity_log`

**Schema:**
```sql
CREATE TABLE dr_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(20) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_title VARCHAR(200) NOT NULL,
  event_description TEXT,
  event_data JSONB,
  actor_type VARCHAR(50),  -- 'system', 'user', 'vlm', 'whatsapp-sender'
  actor_id UUID,
  actor_name VARCHAR(200),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Event Types & Actors:**

| Event Type | Title | Actor | When Logged |
|------------|-------|-------|-------------|
| `dr_received` | DR Received | system | WhatsApp submission received |
| `photos_categorized` | AI Photo Categorization | vlm | VLM categorizes photos |
| `vlm_validated` | VLM QA Validated | vlm | Automated QA validation |
| `human_review_complete` | Human Review Complete | user | QA Wizard Phase 2-3 |
| `final_decision` | Final Decision | user | Phase 4 PASS/FAIL/REWORK |
| `feedback_sent` | Feedback Sent | whatsapp-sender | WhatsApp message sent |
| `serial_updated` | Serial Updated | user | Manual serial correction |
| `serial_verified` | Serial Verified | system | 1Map serial confirmed |

**Activity Tab UI Components:**

1. **Timeline Sub-Tab** - Chronological event list
   - Event icon with color-coded dot
   - Title, description, timestamp
   - Actor attribution (by vlm, by user, by whatsapp-sender)

2. **QA History Sub-Tab** - Historic QA reviews
   - From `qa_review_history` table (Excel imports)
   - Shows reviewer, decision, timestamps

3. **Serial History Sub-Tab** - Serial change tracking
   - From `olt_mismatch_records` table
   - Shows old→new serial corrections

**Logging Pattern:**
```typescript
// Log activity event
await pool.query(`
  INSERT INTO dr_activity_log (
    drop_number, event_type, event_title, event_description,
    event_data, actor_type, actor_name
  ) VALUES ($1, $2, $3, $4, $5, $6, $7)
`, [
  dropNumber,
  'feedback_sent',
  'Feedback Sent',
  `Sent to ${groupJid}`,
  JSON.stringify({ message_id, group_jid }),
  'whatsapp-sender',
  'whatsapp-sender',
]);
```

**DR Summary Tab Components:**

| Section | Data Source | Fields |
|---------|-------------|--------|
| **Timeline** | `dr_photo_unified_reviews` | installed_at, reviewed_at, feedback_at, activated_at |
| **Team** | `dr_photo_unified_reviews` + 1Map | activations_team, installation_team, oes_team, reviewer |
| **Subscriber Contact** | `dr_photo_unified_reviews` | subscriber_name, subscriber_language |
| **QA Status** | `dr_photo_unified_reviews` | photo_steps_completed, ont_serial, ups_serial |

**Key Files:**
- `pages/api/activate/activity-log.ts` - Activity log API
- `src/modules/activate/components/ActivityTab.tsx` - Activity tab UI
- `pages/api/activate/[dropNumber].ts` - Full DR detail with timeline

---

## 2026-01-27: UI/UX Audit Findings - Project Pages

**Context:** Comprehensive audit of project-related pages uncovered several common issues.

### 1. Nested Dynamic Routes Fail in Vercel (and Self-Hosted)

**Issue:** BOQ Edit button navigated to `/procurement/boq/[id]/edit` which returned 404.

**Root Cause:** Next.js Pages Router doesn't reliably support deeply nested dynamic routes like `[id]/edit.tsx`.

**Bad Pattern:**
```typescript
// ❌ Creates nested dynamic route - fails in production
onClick={() => router.push(`/procurement/boq/${boq.id}/edit`)}
// Requires: pages/procurement/boq/[id]/edit.tsx
```

**Good Patterns:**
```typescript
// ✅ Option 1: Flattened route
onClick={() => router.push(`/procurement/boq-edit/${boq.id}`)}
// File: pages/procurement/boq-edit/[id].tsx

// ✅ Option 2: Query parameter
onClick={() => router.push(`/procurement/boq/${boq.id}?mode=edit`)}
// Handle edit mode in existing [id].tsx

// ✅ Option 3: Modal (no navigation)
onClick={() => setShowEditModal(true)}
```

**Quick Fix (interim):**
```typescript
// Show notification until proper edit is implemented
onClick={() => notificationService.info('Editing coming soon.')}
```

**Affected Areas:** Any nested `[id]/action.tsx` patterns across the codebase.

---

### 2. Tab Query Params Must Be Read from Router

**Issue:** Clicking tabs updated URL but page refresh didn't preserve tab selection.

**Root Cause:** Tab state was managed with `useState` only, not synced with URL query params.

**Bad Pattern:**
```typescript
// ❌ State-only tabs - lost on refresh
const [activeTab, setActiveTab] = useState('overview');
```

**Good Pattern:**
```typescript
// ✅ URL-synced tabs - persists across refresh
const tabFromUrl = router.query.tab as TabId | undefined;
const activeTab = tabFromUrl || 'overview';

const handleTabChange = (newTab: TabId) => {
  router.push(
    { pathname: router.pathname, query: { ...router.query, tab: newTab } },
    undefined,
    { shallow: true }  // Don't trigger full page reload
  );
};
```

**Key Points:**
1. Read initial tab from `router.query.tab`
2. Use `shallow: true` for client-side navigation
3. Preserve other query params with spread (`...router.query`)

---

### 3. Circular Redirect Detection

**Issue:** `/health-safety/incidents` redirected to `/projects/health-safety/incidents` which redirected back, causing infinite loop.

**Root Cause:** Both pages were redirect stubs pointing to each other during route restructuring.

**Detection:**
- Browser shows "too many redirects" error
- Network tab shows 301/302 loop

**Fix Pattern:**
1. Choose ONE canonical location for the page
2. Make that location the actual page (with content)
3. Make all other locations redirect TO it (one-way)

```typescript
// pages/health-safety/incidents/index.tsx - CANONICAL (has content)
export default function IncidentsPage() {
  return <IncidentsListContent />;
}

// pages/projects/health-safety/incidents/index.tsx - REDIRECT
export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: { destination: '/health-safety/incidents', permanent: true }
  };
};
export default function Redirect() { return null; }
```

---

### 4. GRN Queries Need JOIN Through Purchase Orders

**Issue:** Procurement summary tab failed with "column total_received_value does not exist".

**Root Cause:** `goods_receipt_notes` table lacks `project_id` and `total_received_value` columns. Must JOIN through `purchase_orders` and sum from `goods_receipt_items`.

**Bad Pattern:**
```sql
-- ❌ These columns don't exist
SELECT project_id, total_received_value
FROM goods_receipt_notes
WHERE project_id = $1
```

**Good Pattern:**
```sql
-- ✅ JOIN through purchase_orders, sum from line items
SELECT
  COUNT(DISTINCT grn.id) as total,
  COALESCE(SUM(gri.total_cost), 0) as total_value
FROM goods_receipt_notes grn
LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
LEFT JOIN goods_receipt_items gri ON gri.grn_id = grn.id
WHERE po.project_id = $1
```

**Table Relationships:**
```
projects → purchase_orders → goods_receipt_notes → goods_receipt_items
           (project_id)      (purchase_order_id)    (grn_id, total_cost)
```

---

### 5. API Response Array Safety

**Issue:** "data.filter is not a function" when API returned unexpected format.

**Root Cause:** Component assumed `data.data` was always an array, but API could return object or null.

**Bad Pattern:**
```typescript
// ❌ Crashes if data.data is not an array
const items = data?.data || [];
const filtered = items.filter(item => ...);
```

**Good Pattern:**
```typescript
// ✅ Explicitly check for array
const items = Array.isArray(data?.data) ? data.data : [];
const filtered = items.filter(item => ...);
```

**Affected Areas:** Any SWR/fetch that expects array responses.

---

### 6. CSS Variables for Dark Mode Consistency

**Issue:** Timeline tab had white background in dark mode.

**Root Cause:** Hardcoded `bg-white` instead of CSS variable.

**Reference:** See "2026-01-26: CSS Variables Pattern for Component Styling" above for full pattern.

**Quick Fix:**
```tsx
// ❌ Before
<div className="bg-white text-gray-900">

// ✅ After
<div className="bg-[var(--ff-card-bg)] text-[var(--ff-text-primary)]">
```

---

## 2027-01-27: Nginx Proxy Timeout for Large Imports

**Issue:** Large Excel imports (7000+ rows) fail with 504 Gateway Timeout. Browser shows "Unexpected token '<', "<!DOCTYPE"... is not valid JSON".

**Root Cause:** Nginx `proxy_read_timeout` defaults to 60s. Large imports take longer. The Next.js `maxDuration` config only works on Vercel, not self-hosted.

**Detection:**
```
POST /api/activate/import-oes 504 (Gateway Timeout)
```
Check nginx error logs:
```bash
tail -20 /var/log/nginx/error.log | grep "upstream timed out"
```

**Fix:**
Add proxy timeouts to nginx server block:
```nginx
server {
    server_name dev.fibreflow.app;

    # Timeout settings for large imports
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;

    location / {
        proxy_pass http://localhost:3005;
        # ... other settings
    }
}
```

Apply changes:
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S nginx -t && echo 'velo2026' | sudo -S systemctl reload nginx"
```

**Recommended Timeouts by Data Size:**

| Rows | Timeout |
|------|---------|
| <3000 | 60s (default) |
| 3000-5000 | 120s |
| 5000-8000 | 300s |
| >8000 | 600s |

**Key Points:**
1. `maxDuration` in Next.js config is Vercel-only
2. Self-hosted needs nginx proxy timeout configuration
3. The error "<!DOCTYPE" means HTML error page (504) was returned instead of JSON
4. Each environment (dev, staging, production) may need separate timeout config

**Affected Files:**
- `/etc/nginx/sites-enabled/vf-fibreflow` - Nginx config on Velocity server
- `pages/api/activate/import-oes.ts` - OES import API (has maxDuration for Vercel)

---

## 2026-01-27: EnhancedStatCard Must Be Router-Agnostic (Pages + App Router)

**Issue:** `EnhancedStatCard` used `useRouter` from `next/router` for navigation. This crashed with "NextRouter was not mounted" error when rendered in App Router context (e.g., Maintenance module at `app/(main)/maintenance/`).

**Root Cause:** `useRouter` from `next/router` only works in Pages Router. App Router uses `useRouter` from `next/navigation` instead. Importing from the wrong package crashes.

**Bad Pattern:**
```typescript
// ❌ Only works in Pages Router - crashes in App Router
import { useRouter } from 'next/router';

const MyComponent = ({ route }: { route?: string }) => {
  const router = useRouter();  // 💥 "NextRouter was not mounted" in App Router
  return <div onClick={() => router.push(route!)}>Click</div>;
};
```

**Good Pattern:**
```typescript
// ✅ Link works in BOTH Pages Router and App Router
import Link from 'next/link';

const MyComponent = ({ route, onClick }: Props) => {
  const cardContent = <>{/* ... card body ... */}</>;

  // Use Link wrapper for route navigation (universal)
  if (route) {
    return <Link href={route} className="block no-underline">{cardContent}</Link>;
  }

  // Use div for onClick-only or non-interactive cards
  return <div onClick={onClick}>{cardContent}</div>;
};
```

**Key Principles:**
1. **Never use `useRouter` in shared components** - Use `next/link` `Link` instead
2. **`next/link` is universal** - Works in both Pages Router and App Router
3. **Conditional wrapper pattern** - Render `<Link>` when `route` provided, `<div>` otherwise
4. **No `useCallback` dependency on router** - Simpler, fewer re-renders

**Router Context Quick Reference:**
| Directory | Router Type | `useRouter` import |
|-----------|------------|-------------------|
| `pages/` | Pages Router | `next/router` |
| `app/` | App Router | `next/navigation` |
| `src/components/` (shared) | **BOTH** | Use `next/link` Link only |

**Affected Files:**
- `src/components/dashboard/EnhancedStatCard.tsx` - Fixed (commit `98f82be1`)
- All dashboards using `StatsGrid`: Fleet, Staff, H&S, Activate, Maintenance

**Dashboards Now Using Unified EnhancedStatCard:**
| Module | File | Router | Columns |
|--------|------|--------|---------|
| Dashboard | `pages/dashboard.tsx` | Pages | 5 |
| Fleet | `pages/fleet/index.tsx` | Pages | 4 |
| Staff | `pages/staff/index.tsx` | Pages | 5 |
| H&S | `pages/projects/health-safety/index.tsx` | Pages | 3 |
| Activate | `src/modules/activate/components/DrListPage.tsx` | Pages | 5 |
| Maintenance | `src/modules/maintenance/components/Dashboard/TicketingDashboard.tsx` | App | 4 |

---

## 2026-01-27: QFieldCloud Database - Correct Host is Velocity Server

**Issue:** QFieldCloud project discovery only returned 17 of 34 projects. Project `af058301-32d1-4bca-84f9-83b899fcbb34` (OES_Project_Progress) was missing from discover dropdown.

**Root Cause:** `qfieldcloudApiService.ts` was connecting to the **VPS** (`72.61.166.168:5433`) which had a stale/incomplete copy of the QFieldCloud database (17 projects). The actual QFieldCloud instance runs on the **Velocity server** (`100.96.203.105:5433`) via Docker with all 34 projects.

**Bad Pattern:**
```typescript
// ❌ Wrong host - VPS has stale QFieldCloud DB copy
const qfieldPool = new Pool({
  host: '72.61.166.168',   // VPS - old/incomplete data
  port: 5433,
  database: 'qfieldcloud_db',
});
```

**Good Pattern:**
```typescript
// ✅ Correct host - Velocity server runs QFieldCloud Docker
const qfieldPool = new Pool({
  host: '100.96.203.105',  // Velocity - actual QFieldCloud instance
  port: 5433,
  database: 'qfieldcloud_db',
});
```

**QFieldCloud Infrastructure:**
```
Velocity Server (100.96.203.105)
├── qfieldcloud-db-1       → PostgreSQL on port 5433 (34 projects) ✅
├── qfieldcloud-app-1      → Django app on port 8000
├── qfieldcloud-nginx-1    → Nginx on port 8082
├── qfieldcloud-worker_wrapper-{1..8}  → Background workers
├── qfieldcloud-minio-1    → S3 storage (ports 8009/8010)
└── qfieldcloud-memcached-1

VPS (72.61.166.168)
└── PostgreSQL on port 5433 → OLD/stale QFieldCloud DB copy (17 projects) ❌
```

**Verification:**
```bash
# Check project count on correct host
node -e "
const { Pool } = require('pg');
const pool = new Pool({ host: '100.96.203.105', port: 5433, database: 'qfieldcloud_db', user: 'qfieldcloud_db_admin', password: 'c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753' });
pool.query('SELECT COUNT(*) FROM core_project').then(r => { console.log('Projects:', r.rows[0].count); pool.end(); });
"
```

**Admin UI:** `https://qfield.fibreflow.app/admin/core/project/` (Django admin, shows all projects)

**Affected Files:**
- `src/modules/qfield-sync/services/qfieldcloudApiService.ts` - Fixed host (commit `d22fee08`)

---

## 2026-01-27: QField Dynamic Project Registry

**Context:** QFieldCloud project IDs were hardcoded in env vars and constants. Now managed via a database registry with UI at `/system/data-sync?group=qfield&tab=projects`.

**Database Tables:**
```sql
-- Project registry
qfield_projects (
  id UUID PRIMARY KEY,
  qfield_project_id VARCHAR(100) NOT NULL UNIQUE,  -- QFieldCloud UUID
  name VARCHAR(255) NOT NULL,                       -- Display name
  description TEXT,
  qfield_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  sync_enabled BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Many-to-many link to FibreFlow projects
qfield_project_links (
  qfield_project_id UUID REFERENCES qfield_projects(id),
  fibreflow_project_id UUID REFERENCES projects(id),
  UNIQUE(qfield_project_id, fibreflow_project_id)
);
```

**Multi-Project OES Sync:**
```typescript
// OES data syncs to ALL active + sync_enabled projects
async function getSyncTargetProjectIds(): Promise<string[]> {
  const result = await pool.query(
    'SELECT qfield_project_id FROM qfield_projects WHERE is_active = true AND sync_enabled = true'
  );
  return result.rows.map(r => r.qfield_project_id);
}
// GeoJSON built once, uploaded to each project independently
```

**API Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `GET /api/qfield/projects` | List registered projects with linked FF projects |
| `POST /api/qfield/projects` | Register new project |
| `PUT /api/qfield/projects/[id]` | Update project settings/links |
| `DELETE /api/qfield/projects/[id]` | Soft-delete (is_active=false) |
| `GET /api/qfield/projects/discover` | Fetch from QFieldCloud DB, mark already registered |

**Key Files:**
- `scripts/migrations/134_qfield_projects.sql` - Schema + seed
- `pages/api/qfield/projects.ts` - CRUD API
- `pages/api/qfield/projects/[id].ts` - Single project API
- `pages/api/qfield/projects/discover.ts` - QFieldCloud discovery
- `src/modules/data-sync/components/groups/qfield/` - UI components
- `pages/api/activate/sync-oes-to-qfield.ts` - Multi-project sync

**Affected Files:**
- Migration: `134_qfield_projects.sql` (commit `4a2ee1e2`)
- Multi-project sync: `sync-oes-to-qfield.ts` (commit `de4f4703`)
- DB host fix: `qfieldcloudApiService.ts` (commit `d22fee08`)

---

## 2026-01-27: PDF User Manual Generation with md-to-pdf

**Context:** Creating branded user manuals for FibreFlow modules using Markdown source files.

**Tool:** `md-to-pdf` (Node.js, uses Puppeteer under the hood)
```bash
npm install -g md-to-pdf
```

**Critical: --basedir Flag for Relative Paths:**
```bash
# ❌ BROKEN - relative paths like ../screenshots/... fail
npx md-to-pdf source/maintenance.md --dest pdf/maintenance.pdf

# ✅ WORKING - --basedir resolves relative paths correctly
npx md-to-pdf source/maintenance.md --dest pdf/maintenance.pdf --basedir ..
```

**File Structure:**
```
docs/user-manuals/
├── assets/
│   └── velocity-logo.jpg       # Downloaded brand logo (37KB)
├── screenshots/
│   └── maintenance/            # Module-specific screenshots
│       ├── dashboard.png
│       ├── ticket-detail.png
│       └── ...
├── source/
│   └── maintenance.md          # Markdown with YAML frontmatter
└── pdf/
    └── maintenance.pdf         # Generated output (1.7MB, 31 pages)
```

**YAML Frontmatter Structure for Branding:**
```yaml
---
pdf_options:
  format: A4
  margin: { top: 25mm, bottom: 25mm, left: 20mm, right: 20mm }
  displayHeaderFooter: true
  headerTemplate: |-
    <section style="font-family: 'IBM Plex Sans', sans-serif; font-size: 9px; width: 100%; margin: 0 20mm;">
      <div style="display: flex; justify-content: space-between;">
        <span style="color: #023047; font-weight: 600;">VELOCITY FIBRE</span>
        <span>FibreFlow Module — User Manual v1.0</span>
      </div>
    </section>
  footerTemplate: |-
    <section style="font-family: 'IBM Plex Sans', sans-serif; font-size: 9px; width: 100%; margin: 0 20mm;">
      <div style="display: flex; justify-content: space-between;">
        <span>Confidential — Velocity Fibre (Pty) Ltd</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    </section>
stylesheet: https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@400;500;600&display=swap
css: |-
  :root {
    --vf-navy: #023047;
    --vf-blue: #1e73be;
    --vf-teal: #219ebc;
    --vf-sky: #2ea3f2;
    --vf-body: #3c3a47;
  }
  body { font-family: 'IBM Plex Sans', sans-serif; color: var(--vf-body); }
  h1, h2, h3 { font-family: 'IBM Plex Sans Condensed', sans-serif; color: var(--vf-navy); }
  /* ... full CSS theme ... */
---
```

**Velocity Fibre Brand Colors:**
| Color | Hex | Usage |
|-------|-----|-------|
| Navy | `#023047` | Primary, headings, headers |
| Blue | `#1e73be` | Secondary buttons |
| Teal | `#219ebc` | Accent, table headers, highlights |
| Sky Blue | `#2ea3f2` | Links, hover states |
| Body Gray | `#3c3a47` | Body text |

**Typography:**
- **Body:** IBM Plex Sans (400, 500, 600, 700)
- **Headings:** IBM Plex Sans Condensed (400, 500, 600)

**Cover Page Pattern:**
```markdown
<!-- Cover Page -->
<div class="cover-page">
  <img src="../assets/velocity-logo.jpg" class="cover-logo" alt="Velocity Fibre">
  <h1 class="cover-title">Module Name</h1>
  <p class="cover-subtitle">User Manual</p>
  <div class="cover-meta">
    <p><strong>Version:</strong> 1.0</p>
    <p><strong>Last Updated:</strong> January 2026</p>
    <p><strong>Classification:</strong> Internal Use</p>
  </div>
</div>
<div class="page-break"></div>
```

**Skill:** `/manual` - See `.claude/skills/manual.md` for full workflow.

**Affected Files:**
- `docs/user-manuals/source/maintenance.md` - Branded manual source
- `docs/user-manuals/pdf/maintenance.pdf` - Generated PDF
- `.claude/skills/manual.md` - Manual generation workflow
- Commits: `3ab0c0d4` (initial), `fb349d07` (basedir fix), `4f71eb9a` (branding)

---

## 2026-01-27: WhatsApp Mentions - Bridge Handles Text AND Context

**Issue:** WhatsApp @mentions were showing double mentions like `@~weird sis 🦋 @~weird sis 🦋 DR1862728 - FAILED` - same person tagged twice in one message.

**Root Cause:** TWO systems were adding @mention text to the message:
1. FibreFlow API (`send-feedback.ts`) was adding `@phone` to the message text
2. WhatsApp Bridge (`whatsapp-bridge-go`) was ALSO adding `@user` prefix

The bridge adds BOTH the `@user` text prefix AND the `MentionedJID` context (which tells WhatsApp to display the contact name instead of raw numbers).

**Architecture Understanding:**

```
FibreFlow API                 wa-feedback-service           Unified Bridge (VPS:8083)
send-feedback.ts         →    :8092 (Velocity)         →    whatsapp-bridge-go
                                                              │
                                                              ├─ Adds @user prefix
                                                              └─ Adds MentionedJID context
```

**The bridge's message construction (Go):**
```go
// Bridge ALWAYS adds @user prefix when recipient_jid provided
messageText := fmt.Sprintf("@%s %s", recipientJID.User, req.Message)
msg := &waProto.Message{
    ExtendedTextMessage: &waProto.ExtendedTextMessage{
        Text: proto.String(messageText),  // Has @user prefix
        ContextInfo: &waProto.ContextInfo{
            MentionedJID: []string{req.RecipientJID},  // WhatsApp displays name
        },
    },
}
```

**Bad Pattern (FibreFlow API):**
```typescript
// ❌ WRONG - Don't add @phone in FibreFlow - bridge already handles this
const mentionParts: string[] = [];
if (review.wa_sender_jid) {
  mentionParts.push(`@${extractPhoneFromJid(review.wa_sender_jid)}`);
}
groupMessage = `${mentionParts.join(' ')} ${feedbackMessage}`;  // @phone + message
```

**Good Pattern (FibreFlow API):**
```typescript
// ✅ CORRECT - Just send the plain message, bridge adds @mention
// The bridge adds @user prefix AND MentionedJID context info
// This allows WhatsApp to display contact name instead of raw number
const groupMessage = feedbackMessage;  // No @phone prefix!
```

**What wa-feedback-service forwards:**
```javascript
// Forward recipient_jid to bridge - bridge uses this for mention
const response = await axios.post(`${bridgeUrl}/send-message`, {
  group_jid: targetRecipient,
  recipient_jid: mentionJid,  // Bridge needs this for @mention
  message: fullMessage        // Plain message, no @phone prefix
});
```

**Key Principle:** The Unified Bridge is the ONLY component that should add @mention text. FibreFlow APIs should:
1. Send the plain message (no `@phone` prefix)
2. Include `recipient_jid` (or `mentionJIDs`) for mention support
3. Let the bridge handle both the text prefix AND the WhatsApp `MentionedJID` context

**Affected Files:**
- `pages/api/activate/send-feedback.ts` - Removed @phone text addition
- `pages/api/wa-monitor-send-feedback.ts` - Added `recipient_jid` forwarding
- `/home/louis/wa-feedback-service/wa-feedback-service.js` (Velocity) - Forwards recipient_jid to bridge

**Commit:** `546f3c77` - fix(whatsapp): display user name instead of raw JID in @mentions

---

## GeoJSON Coordinates Must Be Numbers, Not Strings
**Date:** 2026-01-27
**Severity:** HIGH
**Context:** OES points uploaded to QFieldCloud were not displaying in QField despite the layer being visible

**Problem:** Database queries return latitude/longitude as strings (e.g., `'18.6741775'`). When these were used directly in GeoJSON coordinate arrays, QGIS/QField couldn't render the points because GeoJSON spec requires numeric coordinates.

**Symptom Detection:**
- Layer name appears in QField layer list ✅
- But no points render on the map ❌
- GeoJSON file size is correct (3+ MB)
- Downloading the file shows: `coordinates: ['18.67', '-34.00']` (strings with quotes)

**Bad Pattern:**
```typescript
// ❌ Database returns strings - GeoJSON can't parse them
const features = points.map(point => ({
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [point.longitude, point.latitude]  // Strings! ['18.67', '-34.00']
  },
  properties: { ... }
}));
```

**Good Pattern:**
```typescript
// ✅ Explicitly convert to numbers
const features = points.map(point => ({
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [Number(point.longitude), Number(point.latitude)]  // Numbers! [18.67, -34.00]
  },
  properties: { ... }
}));
```

**Verification:**
```javascript
// Check first feature coordinates after conversion
const first = geojson.features[0];
console.log('Coords:', first.geometry.coordinates);  // Should be [18.67, -34.00]
console.log('Types:', typeof first.geometry.coordinates[0], typeof first.geometry.coordinates[1]);  // Should be 'number', 'number'
```

**Root Cause:** PostgreSQL's `pg` driver returns numeric columns as JavaScript strings when the precision is high or when using certain column types. Always use `Number()` or `parseFloat()` for coordinate values.

**Affected Files:**
- `pages/api/activate/sync-oes-to-qfield.ts` - Fixed (commit `965e918a`)

**Key Principle:** When building GeoJSON from database queries, ALWAYS convert lat/lng to numbers. The GeoJSON specification requires coordinates to be numeric values.

---

## VF Storage Upload Path Pattern
**Date:** 2026-01-27
**Severity:** HIGH
**Context:** Asset document upload failing with 404: `Cannot POST /upload/assets/{assetId}/documents`

**Problem:** VF Storage expects simple, flat category paths. Using nested paths like `assets/${assetId}/documents` causes 404 errors.

**Wrong Pattern:**
```typescript
// ❌ Nested category path - fails with 404
const uploadUrl = `${VF_STORAGE_URL}/upload/assets/${assetId}/documents`;
```

**Correct Pattern:**
```typescript
// ✅ Simple category, assetId prefixed to filename
const category = 'documents';
const filename = `${assetId}_${Date.now()}_${file.name}`;
const uploadUrl = `${VF_STORAGE_URL}/upload/assets/${category}`;
```

**Key Insight:** The VF Storage service at `100.96.203.105:8091` uses flat category paths. Include identifying information (like assetId) in the filename, not the path.

**Affected Files:**
- `app/(main)/assets/[id]/documents/upload/DocumentUploadForm.tsx`
- Reference: `src/services/storage/vfStorageAdapter.ts` for patterns

---

## Lucide-react File Import Shadows Browser File Constructor
**Date:** 2026-01-27
**Severity:** HIGH
**Context:** Document upload throwing `TypeError: d.Z is not a constructor`

**Problem:** Importing `File` from lucide-react shadows the browser's native `File` constructor, causing crashes when creating File objects.

**Wrong Pattern:**
```typescript
// ❌ Shadows browser's File constructor
import { File, Upload, X } from 'lucide-react';

// Later in code - CRASHES
const file = new File([blob], filename); // TypeError: File is not a constructor
```

**Correct Pattern:**
```typescript
// ✅ Rename the icon import
import { File as FileIcon, Upload, X } from 'lucide-react';

// Now browser File works
const file = new File([blob], filename); // Works!
<FileIcon className="h-4 w-4" /> // Icon also works
```

**Key Principle:** When importing icons that share names with browser globals (File, Window, Document, etc.), always alias them with `as IconName`.

**Affected Files:**
- `app/(main)/assets/[id]/documents/upload/DocumentUploadForm.tsx`

---

## VF Storage to Proxy URL Transformation
**Date:** 2026-01-27
**Severity:** MEDIUM
**Context:** Displaying documents stored in VF Storage

**Problem:** VF Storage URLs (`http://100.96.203.105:8091/...`) are internal and not accessible from the browser. They must be transformed to proxy URLs.

**Pattern:**
```typescript
/**
 * Transform VF Storage URL to proxy URL for browser access
 * Input:  http://100.96.203.105:8091/uploads/assets/documents/file.pdf
 * Output: /api/uploads/uploads/assets/documents/file.pdf
 */
function getProxyUrl(vfStorageUrl: string | null | undefined): string | null {
  if (!vfStorageUrl) return null;
  const match = vfStorageUrl.match(/100\.96\.203\.105:8091\/(.+)/);
  if (match) return `/api/uploads/${match[1]}`;
  return vfStorageUrl;
}
```

**Usage for View vs Download:**
```typescript
// View in browser (opens in new tab)
<a href={getProxyUrl(doc.file_url)} target="_blank">View</a>

// Force download
<a href={`${getProxyUrl(doc.file_url)}?download=true`}>Download</a>
```

**Proxy Implementation** (`pages/api/uploads/[...path].ts`):
```typescript
const { download } = req.query;
const forceDownload = download === 'true' || download === '1';
const disposition = forceDownload ? 'attachment' : 'inline';
res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"`);
```

**Affected Files:**
- `app/(main)/assets/[id]/page.tsx` - Document display
- `pages/api/uploads/[...path].ts` - Proxy endpoint

---

## Next.js Cache Persists Despite force-dynamic
**Date:** 2026-01-27
**Severity:** HIGH
**Context:** Deleted asset still showing on dashboard after deletion and server restart

**Problem:** Next.js `.next` cache folder can hold stale data even when:
- Route has `export const dynamic = 'force-dynamic'`
- Server has been restarted with `systemctl restart`
- Database confirms the record is deleted

**Symptoms:**
- API returns deleted record even though database has 0 rows
- Restarting the service doesn't help
- Only affects production/staging builds (not dev mode)

**Solution:**
```bash
# On server, clear the .next cache and rebuild
cd /app/directory
rm -rf .next
npm run build
sudo systemctl restart fibreflow.service
```

**Key Insight:** `systemctl restart` only restarts the Node process - it doesn't clear Next.js's build cache. For persistent cache issues, delete `.next` and rebuild.

**Prevention:** When debugging "stale data" issues:
1. First check database directly: `SELECT COUNT(*) FROM table WHERE id = 'xxx'`
2. If DB shows deleted but API returns data → cache issue
3. Clear `.next` and rebuild

---

## Asset Deletion Restrictions and Double Confirmation
**Date:** 2026-01-27
**Severity:** MEDIUM
**Context:** Implementing safe asset deletion

**Pattern:** Assets cannot be deleted if they're currently assigned. The service validates status before deletion:

```typescript
// In assetService.delete()
if (asset.status === 'assigned') {
  return { success: false, error: 'Cannot delete an assigned asset. Return it first.' };
}
```

**UI Pattern - Double Confirmation:**
```typescript
// First click shows "Are you sure?" state
const [confirmDelete, setConfirmDelete] = useState(false);

// Second click actually deletes
const handleDelete = async () => {
  if (!confirmDelete) {
    setConfirmDelete(true);
    return;
  }
  // Actually delete
  await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
};

// Reset confirmation state if user clicks away
useEffect(() => {
  const timer = setTimeout(() => setConfirmDelete(false), 3000);
  return () => clearTimeout(timer);
}, [confirmDelete]);
```

**Affected Files:**
- `src/modules/assets/services/assetService.ts` - Status validation
- `app/(main)/assets/[id]/DeleteAssetButton.tsx` - Double confirmation UI

---

## Export API Must Mirror Display API Filters Exactly
**Date:** 2026-01-27
**Severity:** HIGH
**Context:** QA Centre export returned 102 records instead of 359 for "installed" filter

**Problem:** `pages/api/activate/export.ts` had completely different filter logic from `pages/api/activate/drops.ts` (the display API). Every filter type was wrong:

| Filter | export.ts (WRONG) | drops.ts (CORRECT) |
|--------|-------------------|---------------------|
| `installed` | All 10 steps complete | `NOT EXISTS (SELECT 1 FROM oes_activations)` |
| `activated` | LEFT JOIN IS NOT NULL | `EXISTS (SELECT 1 FROM oes_activations)` |
| `reviewed` | `qa_decision IS NOT NULL` | `feedback_sent = true` |
| `not_reviewed` | `qa_decision IS NULL` | `feedback_sent IS NULL OR false` |
| QA Status | Raw values (`passed`) | DB values (`PASS`, `FAIL`, `REWORK_NEEDED`) |
| Serial Status | `serial_validation_status` column | LIKE pattern matching (`ALCL%`, `GU18W%`) |

**Root Cause:** Export API was written independently and never kept in sync with display API updates.

**Fix:** Rewrote all filter conditions in `export.ts` to exactly match `drops.ts`. Added comments: `// MUST match drops.ts logic exactly`.

**Prevention Rule:** When changing filter logic in `drops.ts`, ALWAYS update `export.ts` to match. Both files have comments cross-referencing each other.

**Key Status Definitions (Activate Module):**
- **installed** = DR from WhatsApp NOT yet in OES activations
- **activated** = DR exists in `oes_activations` table
- **reviewed** = `feedback_sent = true` (NOT qa_decision)
- **not_reviewed** = `feedback_sent IS NULL OR false`
- **QA Status DB values:** `PASS`, `FAIL`, `REWORK_NEEDED` (not lowercase)
- **Serial validation:** Pattern-based LIKE matching, no dedicated status column

**Affected Files:**
- `pages/api/activate/export.ts` - Export API (FIXED)
- `pages/api/activate/drops.ts` - Display API (source of truth)
- `src/modules/activate/components/QaCentrePage.tsx` - Export button made dynamic
- `src/modules/activate/components/DrListPage.tsx` - Dashboard (already had dynamic button)

---

## 2026-01-27: Dynamic Routes Catch Named Paths - Create Explicit Pages

**Date:** 2026-01-27
**Severity:** HIGH
**Context:** Audit found `/projects/tasks`, `/projects/reports`, `/projects/progress` all showing "Project not found" errors

**Problem:** The `[id]` dynamic route in `pages/projects/[id]/` was catching URL paths like "tasks", "reports", "progress" and treating them as project IDs.

```
URL: /projects/tasks
Expected: Tasks management page
Actual: [id] route catches "tasks" → queries for project with id="tasks" → "Project not found"
```

**Root Cause:** Next.js Pages Router priority:
1. Exact match files (`/projects/tasks.tsx`)
2. Dynamic routes (`/projects/[id]/index.tsx`)

If no explicit file exists, the dynamic route catches EVERYTHING.

**Fix Pattern:** Create explicit page files for each named route:

```
pages/projects/
├── [id]/
│   └── index.tsx       # Dynamic project detail (catches IDs)
├── tasks.tsx           # ✅ EXPLICIT - prevents [id] from catching "tasks"
├── progress.tsx        # ✅ EXPLICIT - prevents [id] from catching "progress"
├── reports.tsx         # ✅ EXPLICIT - prevents [id] from catching "reports"
├── list.tsx            # ✅ EXPLICIT - all projects list
└── index.tsx           # Module landing page
```

**Redirect Pattern for Alternate URLs:**
```typescript
// pages/projects/daily-progress.tsx → redirects to /projects/progress
import type { GetServerSideProps } from 'next';

export default function DailyProgressRedirect() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/projects/progress',
      permanent: true,  // 301 for SEO
    },
  };
};
```

**Prevention Checklist:**
1. When adding tabs/links in navigation config, CREATE THE ACTUAL PAGES
2. Check if `[id]` or `[slug]` dynamic routes exist in the parent directory
3. If dynamic route exists, you MUST create explicit files for named routes
4. Test all sidebar/tab links before deploying

**Quick Diagnosis:**
```bash
# Check if named route will be caught by dynamic route
ls pages/projects/        # See if tasks.tsx exists
ls pages/projects/[id]/   # See if [id] directory exists
# If [id] exists but tasks.tsx doesn't → BUG!
```

**Affected Files (Fixed):**
- `pages/projects/tasks.tsx` - Created
- `pages/projects/progress.tsx` - Created
- `pages/projects/reports.tsx` - Created
- `pages/projects/list.tsx` - Created
- `pages/projects/daily-progress.tsx` - Created (redirect)
- `pages/human-resources.tsx` - Created (redirect to /staff)

**Reference:**
- Commit: `fb51b13c` - fix(routing): add missing project pages and human-resources redirect
- KB: `.claude/knowledge-base/nextjs-build-gotchas.md`

---

## 2026-01-28: API Exporting Wrong Function - Silent Complete Failure

**Date:** 2026-01-28
**Severity:** CRITICAL
**Context:** OCR document upload was timing out for all document types

**Problem:** API file was exporting a helper function instead of the handler:

```typescript
// pages/api/documents-ocr-preview.ts

// Line 384-428: Helper function for orientation detection
async function detectImageOrientation(imageUrl: string): Promise<number> { ... }

// Line 580-956: The actual API handler
async function handler(req: NextApiRequest, res: NextApiResponse) { ... }

// Line 992: WRONG EXPORT!
export default withAuth(detectImageOrientation);  // ❌ Exports helper, not handler!
```

**Symptoms:**
- All requests to the endpoint timeout
- No meaningful error messages
- Endpoint appears to "work" (returns 200) but does nothing useful
- Helper function receives wrong arguments and fails silently

**Root Cause:** Copy-paste error or accidental edit changed the export from `handler` to a helper function. TypeScript doesn't catch this because both are async functions.

**Fix:**
```typescript
// CORRECT:
export default withAuth(handler);
```

**Prevention Checklist:**
1. **Naming convention:** Always name the main handler `handler` (standard Next.js convention)
2. **Export at end of file:** Keep `export default` at the very end, right after the handler
3. **Visual check:** Before committing API changes, verify the export line
4. **Test the endpoint:** After changes, actually call the API and verify it works

**Quick Diagnosis:**
```bash
# Check what function is being exported
tail -5 pages/api/your-api.ts

# Should see:
# export default withAuth(handler);
# or
# export default handler;

# NOT:
# export default withAuth(someHelperFunction);
```

**Why This Is Dangerous:**
- No compile-time errors (both are valid functions)
- No runtime errors (function executes, just wrong one)
- Appears to work (returns HTTP response)
- Difficult to debug (no obvious error messages)

**Affected File:**
- `pages/api/documents-ocr-preview.ts` - Was exporting `detectImageOrientation` instead of `handler`

**Reference:**
- Commit: `4af1d20b` - fix(ocr): export handler instead of detectImageOrientation

---

## 2026-01-28: QFieldCloud OES Sync - Filename Based on Import Report Date

**Issue:** OES GeoJSON files synced to QField were named with upload date, but should use the report date selected during OES import.

**Solution:** Modified `sync-oes-to-qfield.ts` to:
1. Query latest `report_date` from `oes_import_batches` table
2. Use that date for filename instead of `new Date()`

**Filename Format:** `OES FF DD-MM-YYYY.geojson`
- Example: `OES FF 27-01-2026.geojson` (for report dated Jan 27, 2026)

**Priority for date source:**
1. `reportDate` from API request body
2. Latest `oes_import_batches.report_date`
3. Fallback to current date

**Code Change:**
```typescript
// Get the report date for the filename
let filenameDate: Date;
if (reportDate) {
  filenameDate = new Date(reportDate);
} else {
  const latestBatch = await pool.query(
    'SELECT report_date FROM oes_import_batches ORDER BY imported_at DESC LIMIT 1'
  );
  filenameDate = latestBatch.rows[0]?.report_date 
    ? new Date(latestBatch.rows[0].report_date) 
    : new Date();
}
const oesFilename = getOESReportFilename(filenameDate);
```

**Related:**
- `pages/api/activate/sync-oes-to-qfield.ts` - Sync API
- `oes_import_batches` table - Stores import metadata including `report_date`

**Reference:**
- Commit: `16b3ba95` - fix(qfield): use OES import report_date for filename

---

## 2026-01-28: QFieldCloud - Updating QGS Project Files via API

**Context:** When syncing new OES data files to QFieldCloud, the QGIS project file (.qgs) must be updated to reference the new filename.

**Process:**
1. Download current QGS file via API
2. Replace old filename references with new filename
3. Re-upload modified QGS file

**API Calls:**
```bash
# Download QGS
curl -s "https://qfield.fibreflow.app/api/v1/files/{project_id}/project.qgs/" \
  -H "Authorization: Token {token}" -o project.qgs

# Modify (sed example)
sed -i 's/OES FF 260127.geojson/OES FF 27-01-2026.geojson/g' project.qgs

# Upload updated QGS
curl -s -X POST "https://qfield.fibreflow.app/api/v1/files/{project_id}/project.qgs/" \
  -H "Authorization: Token {token}" \
  -F "file=@project.qgs"
```

**Note:** Layer styling (color, size) is stored in the QGS file, not the GeoJSON.

---

## 2026-01-28: Compliance Stats Missing Required Document - Check ALL APIs

**Issue:** Employment Contract / IC Agreement was marked as required in one API but not tracked in another, causing it to never show in the "Staff with Missing Documents" list on the compliance page.

**Root Cause:** Two different compliance APIs existed with different tracking logic:

| API | Purpose | What it tracked |
|-----|---------|-----------------|
| `/api/staff/[staffId]/compliance` | Individual staff compliance tab | SA ID, Employment Contract ✓, Bank Details |
| `/api/staff/alerts?type=compliance` | Compliance overview page | SA ID, Bank Details, DOB - **NO CONTRACT** ❌ |

The individual staff compliance API correctly had `employment_contract` as required, but the overview API (`alerts.ts`) that powers `/staff/compliance` page was missing it entirely.

**Symptoms:**
- Staff detail page showed Employment Contract as required
- But compliance overview never listed anyone as missing it
- Compliance percentage was based on only 2 items instead of 3

**Fix (commit `ada54839`):**
```typescript
// pages/api/staff/alerts.ts - getComplianceStats()

// 1. Add contract check to verified docs query
COUNT(DISTINCT staff_id) FILTER (
  WHERE document_type = 'employment_contract'
  AND verification_status = 'verified'
) as verified_contract

// 2. Add CTE to find staff without contracts
WITH staff_contracts AS (
  SELECT DISTINCT staff_id FROM staff_documents
  WHERE document_type = 'employment_contract'
    AND verification_status IN ('verified', 'pending')
)
...
CASE WHEN sc.staff_id IS NULL THEN 'Contract (Employment/IC)' END

// 3. Update compliance percentage (now 3 required items)
((withVerifiedId + withVerifiedBank + withVerifiedContract) / (totalStaff * 3)) * 100
```

**Prevention Checklist:**
1. **Audit all APIs** when adding a required document - search for all `/compliance` endpoints
2. **Keep requirements synchronized** - use a shared constant
3. **Test both views** - individual staff tab AND overview page

**Affected Files:**
- `pages/api/staff/alerts.ts` - Added contract tracking
- `pages/staff/compliance.tsx` - Added Contract stat card
- `pages/api/staff/[staffId]/compliance.ts` - Updated label to "Employment / IC Agreement"

---

## 2026-01-28: Session Timeout UX - Soft Notifications vs Error Toasts

**Issue:** When a user's session times out automatically, a red error toast flashed briefly before redirecting to login. This felt jarring - session timeout is expected behavior, not an error.

**Root Cause:** `src/lib/authErrorHandler.ts` used `toast.error()` for all 401 responses, treating expected timeouts the same as actual errors.

**Solution:** Changed to a soft, neutral notification:

```typescript
// BEFORE (jarring red error)
toast.error('Your session has expired. Please sign in again.', {
  duration: 4000,
  id: 'auth-error',
});

// AFTER (soft gray notification)
toast('Session timed out. Redirecting to sign in...', {
  duration: 3000,
  id: 'auth-error',
  icon: '⏱️',
  style: {
    background: '#374151', // gray-700
    color: '#f9fafb',      // gray-50
    borderRadius: '8px',
  },
});
```

**Key Insight:** Reserve `toast.error()` for actual errors the user should be concerned about. Expected system behaviors like session expiry should use neutral styling.

**Files:** `src/lib/authErrorHandler.ts`

---

## 2026-01-28: Login Page Footer - Professional Status Indicators

**Issue:** Login page had a dev hint ("Use your staff email to sign in") that should be replaced for production, plus excessive bottom padding causing scroll issues.

**Solution:** Replaced with professional footer showing:
1. Copyright: `© 2026 FibreFlow. All rights reserved.`
2. System status: Green pulsing dot + "System Online"
3. Security indicator: Lock icon + "Secure Connection"

```tsx
<div className="mt-4 text-center space-y-1">
  <p className="text-xs text-slate-500">
    © 2026 FibreFlow. All rights reserved.
  </p>
  <div className="flex items-center justify-center gap-3 text-xs text-slate-500">
    <span className="flex items-center gap-1">
      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
      System Online
    </span>
    <span className="text-slate-600">•</span>
    <span className="flex items-center gap-1">
      <svg>...</svg>
      Secure Connection
    </span>
  </div>
</div>
```

Also removed the `h-32` bottom gradient that was causing unnecessary scroll space.

**Files:** `src/components/auth/premium/PremiumLoginPage.tsx`

---

## 2026-01-28: Enhanced Barcode Service - 2D Barcode Support

**Context:** Nokia ONT labels have Data Matrix (2D) barcodes that contain the serial number. The existing Quagga2-based scanner only supported 1D barcodes.

**Solution:** Added `zxing-wasm` for server-side 2D barcode support:

```typescript
// src/modules/activate/services/enhancedBarcodeService.ts
import { readBarcodesFromImageData } from 'zxing-wasm/reader';

const results = await readBarcodesFromImageData(imageData, {
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  formats: ['QRCode', 'DataMatrix', 'Code128', 'Code39']
});
```

**Key Findings:**
1. **Data Matrix barcodes** contain encoded serial in format: `[)>...SALCLB48AD090...` - extract with regex
2. **Code 128 barcodes** contain direct serial: `ALCLB48AD090`
3. **Quick scan** (~150-250ms) usually sufficient - full multi-pass rarely needed
4. **zxing-wasm** handles rotation automatically with `tryRotate: true`

**Preprocessing Strategies (14 total):**
- Phase 1: original, contrast, sharpen, rotate90/180/270, binarize, invert
- Phase 2: clahe, adaptive, morphological, edge, clahe-90, adaptive-90

**Test Results on Real Nokia Labels:**
| Image | Serial | Format | Confidence |
|-------|--------|--------|------------|
| Rotated | ALCLB48AD090 | DATA_MATRIX | 95% |
| Cropped | ALCLB48CA013 | CODE_128 | 95% |
| Straight | ALCLB48ADE84 | DATA_MATRIX | 76.5% |

**Files:** 
- `src/modules/activate/services/enhancedBarcodeService.ts` (new)
- `src/modules/activate/services/barcodeExtractionService.ts` (updated)
- `scripts/test-enhanced-barcode.ts` (test script)

---

## 2026-01-28: VS Code OOM Crashes During Deployments

**Issue:** VS Code crashes with V8 OOM (Out of Memory) error when deploying to multiple servers. Crash dumps show:
```
OOM error in V8: MarkCompactCollector: young object promotion failed
Scavenge 3340.9 (3409.0) -> 3338.2 (3406.4) MB... allocation failure
```

**Root Cause:**
1. Project has **43,638 TypeScript files** (39K in node_modules)
2. Deployment triggers git operations → file change events
3. TypeScript server tries to re-index during heavy I/O
4. V8 heap exhausts at ~3.3GB

**Why Settings Didn't Work Initially:**
- `argv.json` with `--max-old-space-size` only affects main Electron process
- **Extension host** (where TS server runs) is a separate Node process
- Extension host needs `NODE_OPTIONS` environment variable

**Solution - Three Parts:**

1. **argv.json** (main process):
```json
{
  "js-flags": "--max-old-space-size=16384",
  "disable-hardware-acceleration": false
}
```

2. **~/.bashrc** (terminal launches):
```bash
export NODE_OPTIONS="--max-old-space-size=16384"
```

3. **~/.local/share/applications/code.desktop** (GUI launches):
```ini
Exec=env NODE_OPTIONS="--max-old-space-size=16384" /usr/share/code/code %F
```

4. **VS Code settings** (efficiency):
```json
{
  "extensions.experimental.affinity": {
    "vscode.git": 1,
    "vscode.github": 1,
    "anthropic.claude-code": 2
  },
  "typescript.tsserver.watchOptions": {
    "watchFile": "useFsEventsOnParentDirectory",
    "watchDirectory": "useFsEvents",
    "fallbackPolling": "dynamicPriority"
  }
}
```

**Key Insight:** Extension affinity separates extensions into different processes - if one crashes, others survive. TypeScript watch options use efficient OS-native file events instead of polling.

**Files:** 
- `~/.config/Code/argv.json`
- `~/.config/Code/User/settings.json`
- `~/.local/share/applications/code.desktop`
- `~/.bashrc`

---

## 2026-01-28: Access Control UX Improvements

**Issue:** Access Control tab had poor search UX and clunky toggle controls for managing user permissions.

**Improvements Made:**

1. **Enhanced Search:**
   - Debounced input (300ms) with loading indicator
   - Keyboard shortcut: `Ctrl+K` to focus, `Escape` to clear
   - Clear button (X) when text present
   - Results count shown below search

2. **Stats Dashboard:**
```tsx
<div className="grid grid-cols-4 gap-4">
  <StatCard label="Total Users" value={total} icon={Users} color="blue" />
  <StatCard label="Active" value={active} icon={UserCheck} color="green" />
  <StatCard label="Inactive" value={inactive} icon={UserX} color="red" />
  <StatCard label="Admins" value={admins} icon={ShieldCheck} color="orange" />
</div>
```

3. **Toggle Switches for Status:**
```tsx
// Custom ToggleSwitch component
<ToggleSwitch
  checked={user.isActive}
  onChange={() => toggleUserStatus(user.id, user.isActive)}
  activeColor="green"
  label={user.isActive ? 'Click to deactivate' : 'Click to activate'}
/>
```

4. **Quick Actions:**
   - "Full Access" button grants super_admin with one click
   - Loading spinner per-user during updates
   - Instant local state update for responsiveness

5. **Visual Improvements:**
   - User avatars with gradient colors (orange for admins)
   - Admin badge icon (ShieldCheck) next to admin names
   - Role dropdown with colored borders by role level
   - Status filter as button group instead of dropdown

**Files:** `src/components/settings/AccessControlTab.tsx`

---

## 2026-01-30: Serial Audit - Comprehensive Backfill & Swap Detection

**Problem:** 27% of DRs (5,248/8,205) were missing `ont_serial_scanned` in `dr_photo_unified_reviews`, and OES import silently ignored serial changes using `COALESCE`.

**Root Causes (2 bugs):**
1. `process-new-dr.ts` (line ~665): Early return when `photos.length === 0` discarded serials from BOSS API. Fix: Added `COALESCE($2, ont_serial_scanned)` to the zero-photos UPDATE.
2. `backfill-onemap-data.ts` (line ~237): `missing_serials` query had `photo_count > 0` filter, excluding DRs without photos from serial backfill. Fix: Changed to `ont_serial_scanned IS NULL OR ont_serial_scanned = ''`.

**Serial Data Hierarchy:**
- `ont_serial_scanned` = 1Map / WA group photo scan (install-time physical data)
- `oes_serial` = OES Nokia report (currently active on network, SOURCE OF TRUTH)
- `vlm_ont_serial_step6/9` = VLM AI extraction (supplementary)
- **Never overwrite ont_serial_scanned with OES data** - they track different things

**OES Import Fix (`import-oes.ts` Step 7):**
- Removed `COALESCE(u.oes_serial, data.serial)` - always update `oes_serial` (it's source of truth)
- Added pre-fetch of existing serials for comparison
- Detects `OES_SERIAL_CHANGED` (old vs new OES) and `SERIAL_MISMATCH_DETECTED` (OES vs scanned)
- Sets `serial_swap_detected`, `serial_swap_detected_at`, `serial_swap_details` flags
- Logs to `dr_activity_log` for forensic searching

**Backfill Results:**
- 4,893 DRs backfilled from 1Map (BOSS API at 100.96.203.105:8003)
- 355 still missing (245 not in 1Map, 110 no barcode data)
- 125 existing ONT-vs-OES mismatches found and logged

**Activity Log Events:**
- `SERIAL_BACKFILL` - 1Map backfill with source data
- `SERIAL_MISMATCH` - Baseline audit mismatch
- `SERIAL_MISMATCH_DETECTED` - OES import mismatch
- `OES_SERIAL_CHANGED` - OES serial changed between imports

**Deep reference:** `.claude/knowledge-base/activate/serial-audit-tracking.md`

**Key Files:**
- `pages/api/activate/process-new-dr.ts` - Fixed zero-photos serial capture
- `pages/api/cron/backfill-onemap-data.ts` - Fixed serial backfill query
- `pages/api/activate/import-oes.ts` - OES swap detection rewrite

---

## 2026-01-30: QFieldCloud Docker Image Self-Healing Fix

**Problem:** OES import from UI triggers QField sync, but `process_projectfile` jobs fail with `404 Client Error for qfieldcloud-qgis` because the Docker image periodically disappears (~every 24h). No container permanently uses the 2.7GB locally-built image, so something (likely Docker storage cleanup) removes it.

**Investigation:**
- `qfieldcloud-qgis` is a locally-built image (`docker-compose build qgis` in `/opt/qfieldcloud`), NOT from Docker Hub
- `worker_wrapper` containers spawn ephemeral containers from it per job — no persistent container keeps the image "in use"
- Existing `check_qgis_image.sh` cron ran every 6h but gaps allowed failures between checks
- Monitor log showed image disappearing Jan 28 06:00, Jan 29 06:00, and again by Jan 30 05:43
- No explicit `docker prune` or `docker rmi` found in any script, cron, or systemd timer
- Exact deletion cause unknown but pattern is consistent (~daily)

**Three-layered fix:**

1. **Self-healing sync server** (`/opt/qfield-sync/sync_server.py` v2.3 → v2.4):
   - `ensure_qgis_image()` pre-flight check before every sync
   - If missing: restore from backup (`docker load`) → fallback rebuild (`docker-compose build qgis`) → restart `worker_wrapper`
   - All automatic, no manual intervention needed

2. **Monitoring cron** (`check_qgis_image.sh`):
   - Increased frequency from `0 */6 * * *` (every 6h) to `0 * * * *` (every 1h)

3. **Observability** (health/status endpoints):
   - `/health` now reports `qgis_image: "present"/"MISSING"` and `last_image_restore`
   - `/status` includes same fields for monitoring

**Full OES→QField chain:**
```
UI Import → import-oes.ts → fire-and-forget POST :8095/sync/oes
  → sync_server.py run_sync()
    → ensure_qgis_image() ← NEW: self-heals Docker image
    → sync_oes_db_to_qfield.py
      → Fetch data from Neon DB
      → Generate GPKG (activated + remaining layers)
      → Upload GPKG + QGS to QFieldCloud via SDK
      → Trigger process_projectfile job ← needs qfieldcloud-qgis image
      → Trigger package job
```

**Key files:**
- `/opt/qfield-sync/sync_server.py` - Self-healing sync server v2.4
- `/opt/qfield-sync/sync_oes_db_to_qfield.py` - GPKG generation & upload
- `/home/velo/check_qgis_image.sh` - Backup monitoring (now hourly)
- `/home/velo/qfield-backups/qfieldcloud-qgis-20260113-1034.tar.gz` - Image backup for restore

**Backup image location:** `/home/velo/qfield-backups/qfieldcloud-qgis-20260113-1034.tar.gz`
**Rebuild command:** `cd /opt/qfieldcloud && docker-compose build qgis`

---

## 2026-01-30: Serial Audit — DRs Without ONT Barcode Data

**Context:** During the 1Map serial backfill (4,893 DRs), we identified DRs in `dr_photo_unified_reviews` that have no `ont_serial_scanned` (1Map barcode) and no `onemap_ont_serial`. These are DRs where the installer never scanned the ONT barcode sticker in 1Map.

**Analysis performed (production DB):**
- 236 total DRs with no barcode (excluding OES-only, test projects, non-production DR numbers)
- 92 had photos, 144 had no photos

**92 DRs with photos — serial source breakdown:**

| Source | Count | Notes |
|--------|-------|-------|
| OES serial (Nokia) | 28 | Finish point known from activation |
| VLM extracted from step 6/9 | 2 | DR1751092, DR1858326 |
| ONT photo exists (can run VLM) | 1 | DR1857412 |
| qa_photo_reviews / drops / OLT report | 0 | No cross-reference hits |
| **Truly unresolved** | **61** | No serial from any source |

**61 unresolved by project:**
- Mohadin: 43 DRs
- Lawley: 11 DRs
- Mamelodi: 4 DRs
- Marketing Activations: 3 DRs

**Why these 61 can't be resolved from existing data:**
1. All 61 have VLM categorization completed (`categorized` or `approved`)
2. Zero have WhatsApp photos (`wa_photo_count = 0`) — all photos sourced from 1Map
3. All 135 photos across 61 DRs are 1Map standard types: `ph_prop` (property), `ph_sign` (signature)
4. Zero non-1Map photos exist — recategorization will NOT discover hidden ONT photos
5. No ONT-related photo types (`ph_bl`, `ph_ont`) present in any of the 61

**Photo count distribution (61 DRs):**
- 2 photos: ~54 DRs (property + signature only)
- 3 photos: ~5 DRs
- 1 photo: ~2 DRs

**Action taken:**
- Excel exported to `~/Downloads/Unresolved_DRs_No_Serial_2026-01-30.xlsx` (Summary + per-project sheets)
- WhatsApp message sent to Velo Server group with clickable links to each DR's QA Centre page
- URL pattern: `https://app.fibreflow.app/activate/qa-centre/{DR}`

**Resolution path for 61 unresolved:**
1. Wait for future OES report (if activated on Nokia)
2. Field team scans ONT barcode via WhatsApp serial submission
3. Accept as data gaps in audit trail

**Key query pattern for finding these DRs:**
```sql
SELECT r.drop_number, r.project, r.photo_count
FROM dr_photo_unified_reviews r
WHERE (r.ont_serial_scanned IS NULL OR r.ont_serial_scanned = '')
  AND (r.onemap_ont_serial IS NULL OR r.onemap_ont_serial = '')
  AND (r.oes_serial IS NULL OR r.oes_serial = '')
  AND (r.vlm_ont_serial_step6 IS NULL OR r.vlm_ont_serial_step6 = '')
  AND r.drop_number ~ '^DR[0-9]{6,7}$'
  AND r.project NOT ILIKE '%test%'
  AND r.is_oes_only IS NOT TRUE
  AND r.photo_count > 0
ORDER BY r.project, r.drop_number;
```

**WA bridge endpoint for group messages:**
```bash
curl -s http://72.61.197.178:8083/send-message -X POST \
  -H "Content-Type: application/json" \
  -d '{"group_jid":"120363423864087150@g.us","message":"text"}'
```
Note: The feedback proxy (`:8092/send`) does NOT work for sending. Use bridge directly at `:8083/send-message`.

---
