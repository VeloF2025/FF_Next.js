# Activate Module Skill

Comprehensive guide for the Activate (DR Photo Unified) system - AI-powered photo review with 5-phase QA Wizard and WhatsApp integration.

## Purpose

Handle all Activate module operations:
1. **5-Phase QA Wizard** - Prerequisites → Photo Review → Data Validation → Final Decision → Feedback
2. DR photo review and AI categorization
3. VLM data extraction (power meter, serial numbers)
4. System health monitoring (5 services)
5. WhatsApp acknowledgments and feedback
6. **DR Summary** - Landing page with Zone/PON drill-down
7. **QA Centre** - DR list with filters and export
8. **Reports** - 8 report types (Trends, Funnel, Team, Serial, etc.)
9. OES import integration
10. HITL few-shot learning from human corrections

## Quick Reference

| Setting | Value |
|---------|-------|
| **Navigation** | Sidebar → FIELD OPERATIONS → Activate (first item, ✨ sparkles icon) |
| **Dashboard URL** | `https://dev.fibreflow.app/activate` |
| **Production URL** | `https://app.fibreflow.app/activate` |
| **API Prefix** | `/api/activate/*` |
| **Database Tables** | `dr_photo_unified_reviews`, `dr_activity_log`, `qa_correction_examples`, `oes_activations` |
| **VLM Server** | `http://100.96.203.105:8100` (Qwen3) |
| **WA Feedback** | `http://100.96.203.105:8090` (wa-feedback service) |
| **Go Bridge** | `/home/louis/whatsapp-bridge-go/` |

### Tab-Based UI
| Tab | Purpose |
|-----|---------|
| **DR Summary** | Landing page - Project stats with expandable Zone → PON breakdown |
| **QA Centre** | DR list with filters, pagination, Excel export |
| **Reports** | 8 report types: Trends, Funnel, Team, Discrepancy, Serial, Anomaly, User Attribution, Resubmissions |
| **OES Import** | Import OES Excel activation reports |
| **Manual Entry** | Add DRs manually |

### QA Centre Card Layout (Jan 2026)

Compact 2-row layout with inline status badges:

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Mohadin] DR1855476 [Jan 19] [✓ OES Jan 14] [✗ FAIL] [Sent] [⚠ SWAP] │
│ 👤 Unknown  📷 0     ONT: Not scanned  UPS: Not scanned                │
└────────────────────────────────────────────────────────────────────────┘
```

**Row 1: Header + Status Badges (flex-wrap for mobile)**
- Project badge (colored by project)
- DR number (bold)
- Installed date badge (blue) - always shown
- Activated/OES date badge (green) - when OES confirmed
- QA decision badge (green=PASS, red=FAIL, orange=Rework)
- Feedback sent badge (purple)
- Serial swap warning (red) - when serials swapped

**Row 2: Details**
- Agent phone (masked)
- Photo count
- ONT serial with validation status (✓/⚠/✗)
- UPS serial with validation status (✓/⚠/✗)

**Component:** `InlineStatusBadges` in `QaCentrePage.tsx`

**Badge Styling:**
| Badge | Color | Example |
|-------|-------|---------|
| Installed | Blue `bg-blue-900/40` | `[Jan 19]` |
| Activated | Green `bg-green-900/40` | `[✓ OES Jan 14]` |
| In Review | Yellow `bg-yellow-900/40` | `[In Review]` |
| QA PASS | Green `bg-green-900/40` | `[✓ PASS]` |
| QA FAIL | Red `bg-red-900/40` | `[✗ FAIL]` |
| Rework | Orange `bg-orange-900/40` | `[Rework]` |
| Feedback Sent | Purple `bg-purple-900/40` | `[Sent]` |
| Serial Swap | Red `bg-red-900/30` | `[⚠ SWAP]` |

### 5-Phase QA Wizard
| Phase | Name | API Endpoint | Purpose |
|-------|------|--------------|---------|
| 1 | Prerequisites | `/validate-prerequisites` | Check photos, categorization, step coverage |
| 2 | Photo Review | `/approve-categorization` | Review + reject photos with Fibertime reasons |
| 3 | Data Validation | `/extract-data` | Validate power (-18 to -24 dBm), serial matches |
| 4 | Final Decision | `/final-decision` | PASS / FAIL / REWORK + swap detection + auto-ticket |
| 5 | Feedback | `/send-feedback` | Send WhatsApp feedback (technician-actionable only) |

### Phase 2: Photo Rejection with Reasons (Jan 2026)

**Allows QA reviewers to reject photos with Fibertime-spec quality reasons.**

| Feature | Behavior |
|---------|----------|
| **Reject photo** | Untick "Approve" checkbox → rejection reason dropdown appears |
| **Rejection reasons** | 7 Fibertime quality criteria (see below) |
| **Step count update** | Rejected photos excluded from step coverage cards |
| **Step card display** | Shows "Step N" prefix above label (e.g., "Step 1" + "House Photo") |
| **Visual indicator** | Rejected photos have red border styling |

**Rejection Reasons (Fibertime Quality Spec):**
| Code | Label |
|------|-------|
| `BLURRY` | Blurry/Out of Focus |
| `WRONG_ANGLE` | Wrong Angle |
| `WRONG_SUBJECT` | Wrong Subject |
| `POOR_LIGHTING` | Poor Lighting |
| `OBSTRUCTED` | Obstructed View |
| `DUPLICATE` | Duplicate Photo |
| `NOT_INSTALLATION` | Not Installation Related |

**API:** `POST /approve-categorization` with `override_reason` field for rejected photos.

**Key files:**
- `src/modules/activate/utils/stepMapper.ts` - `PHOTO_REJECTION_REASONS` constant
- `src/modules/activate/components/wizard/PhotoReviewPhase.tsx` - UI implementation

### Phase 4 Draft State (Jan 2026)

**Prevents data loss when navigating back from Final Decision phase.**

| Feature | Behavior |
|---------|----------|
| **Auto-save on Back** | Draft saved automatically when clicking "Back" button |
| **Draft recovery** | State restored when returning to Phase 4 |
| **Fields saved** | Decision, issue classification, internal notes, technician feedback |
| **Final submit** | Clears draft flag and advances to Phase 5 |

**Database columns (migration 095):**
- `qa_decision_is_draft` - Boolean flag for draft vs finalized
- `qa_internal_notes` - Internal QA team notes
- `qa_technician_feedback` - Feedback for technician (sent via WhatsApp)
- `qa_issue_classification` - JSONB with issue type, correct value, ticket flags

**API behavior:**
- `POST /final-decision` with `isDraft: true` → saves without advancing phase
- `POST /final-decision` without `isDraft` → finalizes and advances to feedback
- `GET /final-decision` → returns all draft fields including `issueClassification`

### QA Decision Values
| Decision | Meaning |
|----------|---------|
| `PASS` | All checks passed, activation approved |
| `FAIL` | Critical issues, requires re-installation |
| `REWORK_NEEDED` | Minor issues, technician can fix |

### Fail Reason Codes
- `MISSING_PHOTOS` - Required step photos missing
- `SERIAL_MISMATCH` - ONT serial doesn't match OES
- `POWER_OUT_OF_RANGE` - Not in -18 to -24 dBm range
- `PHOTO_QUALITY` - Photos too blurry/dark
- `WRONG_EQUIPMENT` - Wrong ONT/UPS installed
- `SERIALS_SWAPPED` - ONT and UPS serials in wrong fields (auto-ticket created)

## Serial Swap Detection (Jan 2026)

**Critical feature for detecting when ONT and UPS serials are entered in wrong fields.**

### Serial Patterns

| Device | Pattern | Example |
|--------|---------|---------|
| **Nokia ONT** | `ALCL*` or `ALCB*` | `ALCLB48CC3CA` |
| **Gizzu UPS** | `GU18W*` | `GU18W12V2508057584` |

### Detection Flow

1. **First WhatsApp Response** - `dr-acknowledgment.ts` detects swap immediately
   - Returns `serialsSwapped: true` with details
   - Go Bridge sends warning in threaded reply with correction instructions

2. **QA Wizard Phase 4** - Prominent "🔴 SERIALS SWAPPED" warning
   - Shows which serial is in which field
   - Explains correct format for each device
   - Badge shows "🎫 Auto-ticket on submit"

3. **Auto-Ticket Creation** - Creates ticket on submit via `/api/ticketing/tickets`
   - `source: 'ont_swap'`
   - `ticket_type: 'ont_swap'`
   - `priority: 'high'`
   - `dr_number: <drop_number>`

4. **Tracking** - Ticket tracks resolution until technician corrects in 1Map

### Key Functions (`qaAutoFailService.ts`)

```typescript
// Pattern matching
looksLikeOntSerial(serial)     // Matches ALCL/ALCB pattern
looksLikeGizzuSerial(serial)   // Matches GU18W pattern

// Swap detection
detectSwappedSerials(ontSerial, upsSerial)
// Returns: { swapped: boolean, details: string }

// Technician issues (for WhatsApp feedback)
getTechnicianIssues(data)
// Returns: TechnicianIssue[] with actionable items only

// Serial masking (show partial for privacy + verification)
maskSerial(serial)
// Examples: ALCLB48CC3CA -> ALC***3CA, GU18W12V2508057584 -> GU18***7584

// Detailed serial status for feedback
getSerialStatus(serial, expectedType: 'ont' | 'ups')
// Returns: { status: SerialStatus, message: string }
// Status: 'present_valid' | 'present_swapped' | 'present_invalid' | 'missing'

// Format both serial lines for WhatsApp feedback
formatSerialFeedback(ontSerial, upsSerial)
// Returns: { ontLine: string, upsLine: string, hasIssues: boolean }
```

### Serial Feedback Format (Jan 2026)

| Status | WhatsApp Message |
|--------|------------------|
| **Present & Valid** | `Present in 1Map ✓ (ALC***3CA)` |
| **Missing** | `❌ Not scanned in 1Map - please scan ONT barcode` |
| **Swapped** | `⚠️ Wrong field - has Gizzu serial (GU18***5029) instead of ONT` |
| **Invalid Format** | `⚠️ Invalid format (XYZ***456) - expected ALCL/ALCB serial` |

### Technician Issues vs Internal QA

**Technician-Actionable (sent via WhatsApp):**
- `ONT_NOT_SCANNED` - ONT serial missing
- `UPS_NOT_SCANNED` - UPS serial missing
- `SERIALS_SWAPPED` - ONT/UPS in wrong fields (CRITICAL)
- `ONT_INVALID_FORMAT` - ONT serial wrong format
- `UPS_INVALID_FORMAT` - UPS serial wrong format
- `MISSING_PHOTOS` - Required photos missing
- `POWER_OUT_OF_RANGE` - Power meter out of spec

**Internal QA Only (NOT sent to technicians):**
- VLM extraction comparison (Step 6 vs Step 9 vs OneMap)
- OCR confidence scores
- AI categorization mismatches
- Few-shot learning corrections

This separation ensures technicians only receive actionable feedback, not internal AI debugging info.

## 4-Way Serial Verification System (Jan 2026)

**Purpose**: Track and verify ONT/UPS serials across 4 sources with full audit trail.

### Serial Sources

| Source | Database | Field | Purpose |
|--------|----------|-------|---------|
| **OES** | `oes_activations` | `serial_number` | Reference truth from activation report |
| **Offline** | `offline_devices` | `serial_number` | Current offline device report |
| **OneMap** | `dr_photo_unified_reviews` | `ont_serial_scanned`, `ups_serial_scanned` | Scanned barcodes |
| **WA Photo** | `wa_photos` | `vlm_ont_serial`, `vlm_ups_serial` | VLM extracted from WhatsApp photos |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/serial-verification` | GET | 4-way comparison status + badge |
| `/api/activate/serial-history` | GET | Serial change audit trail |
| `/api/activate/wa-photos` | GET | WA photos with VLM results |

### Database Tables

**`serial_change_history`** - Audit trail for ALL serial changes:
- `change_type`: `ont_serial` or `ups_serial`
- `old_value`, `new_value`: Change delta
- `change_source`: `onemap_sync`, `manual_edit`, `vlm_extraction`, `wa_photo_vlm`
- `actor`: User ID, `system`, or `vlm`
- `metadata`: Additional context (swap detection, confidence)

**`wa_photos`** - WhatsApp photos with VLM extraction:
- `vlm_ont_serial`, `vlm_ups_serial`: Extracted serials
- `vlm_confidence`: Extraction confidence (0-100)
- `vlm_processed`: Boolean processing flag

### Key Functions

**`activityLogService.ts`**:
```typescript
logSerialChange(
  drNumber: string,
  changeType: 'ont_serial' | 'ups_serial',
  oldValue: string | null,
  newValue: string | null,
  source: SerialChangeSource,
  actor: string,
  reason?: SerialChangeReason,
  metadata?: Record<string, unknown>
): Promise<{ historyId: string; activityId: string }>
```

**`vlmExtractionService.ts`**:
```typescript
extractSerialsFromWaPhoto(photoUrl: string): Promise<{
  ontSerial: string | null;
  upsSerial: string | null;
  confidence: number;
}>
```

### Badge Status Logic

| Badge | Criteria | Color |
|-------|----------|-------|
| 🥇 **Gold** | Both ONT + UPS have 3+ sources agreeing | `bg-yellow-500` |
| 🥈 **Silver** | At least one fully verified (3+ sources) | `bg-gray-400` |
| 🥉 **Bronze** | ONT matches across 2+ sources | `bg-amber-600` |
| ⚠️ **Warning** | Serial mismatch detected | `bg-red-500` |

### Audit Script

```bash
# Run full serial status audit
DATABASE_URL='...' node scripts/audit-serial-status.js

# Filter by project
DATABASE_URL='...' node scripts/audit-serial-status.js --project Lawley

# Export to CSV
DATABASE_URL='...' node scripts/audit-serial-status.js --output csv > audit.csv
```

### Activity Tab - Serial History View

The Activity tab has 3 sub-views:
1. **Timeline** - Event history (categorization, QA, feedback)
2. **QA History** - Historical QA reviews
3. **Serial History** - Serial change audit trail

Serial History shows:
- Current ONT/UPS serials
- Change summary (total changes, ONT changes, UPS changes, swaps)
- Timeline of all changes with old→new, source, actor, timestamp

### WA Photo VLM Processing

1. Photos received via WhatsApp → stored in `wa_photos` table
2. `scripts/process-wa-photos-vlm.ts` processes unprocessed photos
3. VLM extracts ONT/UPS serials with confidence scores
4. Results compared to OneMap serials
5. Mismatches/matches logged to `serial_change_history`

## Slash Commands

### `/activate` or `/dr-photo`

Main entry point for Activate operations.

**Usage**:
```
/activate                 # Show module overview
/activate health          # Run health check
/activate dr DR1234567    # Look up specific DR
/activate retry           # Retry failed categorizations
/activate debug           # Full diagnostics
```

### `/activate health`

Check all 5 system services.

**Response Template**:
```
🏥 Activate System Health:

Services:
  🗄️ Database:    ✅ Connected (45ms)
  🗺️ 1M:          ✅ Responding (120ms)
  🤖 VLM (AI):    ✅ Online, 1 model (89ms)
  💬 WA Bridge:   ✅ 3 DRs in last hour (12ms)
  📤 WA Sender:   ✅ Connected (34ms)

Activity (24h):
  Total DRs: 47
  Pending: 2
  Failed: 0

Overall: ✅ All systems operational
```

### `/activate debug`

Full system diagnostics.

**Response Template**:
```
🔧 Activate Diagnostics:

API Endpoints:
  /api/activate/health-check: ✅ 200
  /api/activate/process-new-dr: ✅ 200
  /api/activate/dr-acknowledgment: ✅ 200

Database:
  Connection: ✅ OK
  dr_photo_unified_reviews: [count] records
  Last DR: [timestamp]

VLM Server:
  Status: ✅ Running
  Model: Qwen3
  Endpoint: http://100.96.203.105:8100/v1/models

Go Bridge:
  Service: whatsapp-bridge.service
  Log: /home/louis/whatsapp-bridge-go/bridge.log
  Last activity: [timestamp]

WhatsApp Feedback:
  Service: wa-feedback
  Health: http://100.96.203.105:8090/health
  Status: ✅ healthy
```

## When to Activate

### Trigger 1: DR Questions

**User says**:
- "check DR1234567"
- "why isn't this DR showing"
- "DR missing photos"
- "categorization failed"

**Automatic Actions**:
1. Query `dr_photo_unified_reviews` table
2. Check VLM categorization status
3. Look up in OneMap if needed
4. Report findings

### Trigger 2: Health Issues

**User says**:
- "activate not working"
- "health check failing"
- "VLM down"
- "WA sender not responding"
- "system issues"

**Automatic Actions**:
1. Call `/api/activate/health-check`
2. Identify failing service
3. Provide fix commands
4. Suggest next steps

### Trigger 3: WhatsApp Integration

**User says**:
- "acknowledgment not sending"
- "threaded reply broken"
- "feedback not working"
- "WA bridge issues"

**Automatic Actions**:
1. Check Go bridge logs
2. Verify WA Sender health
3. Test API endpoint
4. Diagnose LID issues if applicable

### Trigger 4: Categorization Issues

**User says**:
- "photos not categorizing"
- "VLM stuck"
- "retry failed"
- "pending queue"

**Automatic Actions**:
1. Check VLM server status
2. Query pending/failed counts
3. Trigger retry if requested
4. Report results

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  WhatsApp User  │────▶│   Go Bridge      │────▶│  FibreFlow API  │
│  sends DR123456 │     │  (Velocity VPS)  │     │  (Production)   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                        │
                               ▼                        ▼
                        ┌──────────────┐         ┌─────────────────┐
                        │  Threaded    │         │    OneMap API   │
                        │  Reply       │         │  192.168.1.150  │
                        └──────────────┘         └─────────────────┘
                                                        │
                                                        ▼
                                                 ┌─────────────────┐
                                                 │   VLM (Qwen3)   │
                                                 │ 100.96.203.105  │
                                                 └─────────────────┘
```

## 5-Service Health Check

### 1. Database (Neon PostgreSQL)
```sql
-- Health check query
SELECT 1 as health;
```

### 2. 1M (OneMap API)
```bash
curl http://100.96.203.105:8003/health
```

### 3. VLM Server (Qwen3)
```bash
curl http://100.96.203.105:8100/v1/models
```

### 4. WhatsApp Bridge
Inferred from recent DR activity:
- Healthy: DRs in last hour
- Degraded: No DRs for 4-12 hours
- Down: No DRs for 12+ hours

### 5. WhatsApp Feedback (wa-feedback service)
```bash
curl http://100.96.203.105:8090/health
# Returns: {"status": "healthy"} or {"connected": true}
# Health check accepts both response formats
```

## DR Acknowledgment System

When a user sends a DR number to WhatsApp:

1. **Go Bridge** detects DR pattern
2. Creates record in `dr_photo_unified_reviews`
3. Calls `/api/activate/dr-acknowledgment`
4. API queries OneMap for photo count, ONT, UPS
5. Go Bridge sends **threaded reply** to original message

### Message Templates

**All Data Present**:
```
📸 *DR123456 Received!*

✅ Photos: 12
✅ ONT Serial: ALCLB46BE62E
✅ UPS Serial: GU18W12V2562847

Thank you! QA review will follow shortly.
```

**Missing Items**:
```
📸 *DR123456 Received!*

✅ Photos: 8
✅ ONT Serial: ALCLB46BE62E
⚠️ UPS Serial: Not scanned - please upload to 1Map

Thank you! QA review will follow shortly.
```

**Swapped Serials (CRITICAL)**:
```
📸 *DR123456 Received!*

🔴 *ALERT: SERIALS APPEAR SWAPPED*

❌ ONT field has Gizzu serial: GU18W12V2508035029
❌ UPS field has ONT serial: ALCLB48CC3CA

*Please correct in 1Map:*
• ONT should be ALCL/ALCB serial
• UPS should be GU18W serial (Gizzu)

✅ Photos: 10
⚠️ ONT field: GU18W12V2508035029
⚠️ UPS field: ALCLB48CC3CA

⚠️ Please correct the swapped serials before QA review.
```

**DR Not in OneMap**:
```
📸 *DR123456 Received!*

⏳ Photos not yet available in 1Map.
Please ensure photos are uploaded to OneMap.

Thank you! We'll process your submission shortly.
```

### ONT Barcode Parsing

OneMap stores full barcode data:
```
(S)ALCLB46BE62E(23S)E03DA68BD340(20S)M022515ALU00136108(U)userAdmin(P)pass...
```

Extract serial with: `/\(S\)([^(]+)/`

## 10-Step Photo Checklist

**CANONICAL REFERENCE**: See `/photo-categorization` skill for full mapping details.

| Step | Label | 1Map Types | Description |
|------|-------|------------|-------------|
| 1 | House Photo | `ph_prop` | Photo of Property |
| 2 | Cable from Pole | `ph_pole`, `ph_outs` | Outside cable span: Pole to Pigtail screw |
| 3 | Entry Outside | `ph_entry_out`, `ph_hm_ln` | Home Entry Point: Outside |
| 4 | Entry Inside | `ph_entry_in`, `ph_hm_en` | Home entry point - Inside |
| 5 | Wall | `ph_wall` | Photo Showing Location on the Wall |
| 6 | ONT Back | `ph_ont`, `ph_ont_back`, `ph_drop`, `ph_cbl_r`, `ph_bl` | Fiber cable: entry to ONT |
| 7 | Power Meter | `ph_powm`, `ph_powm1`, `ph_powm2` | Powermeter reading |
| 8 | Final Installation | `ph_after`, `ph_final` | Overall work area after complete install |
| 9 | Green Lights | `ph_lights`, `ph_led` | Photo of Active Broadband Light |
| 10 | Signature | `ph_sign1`, `ph_sign2`, `ph_signature` | Signature of owner/tenant |

**Note**: Steps 11 & 12 (ONT Barcode, UPS Serial) are NOT photo steps - they are scanned barcodes stored in `ont_serial_scanned` and `ups_serial_scanned` fields.

## API Endpoints

### Core Operations
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/[dropNumber]` | GET/PATCH | Fetch or update unified review |
| `/api/activate/drops` | GET | Paginated DR list with stats |
| `/api/activate/summary` | GET | DR summary for detail view |
| `/api/activate/ensure-data` | POST | Ensure DR exists (idempotent) |
| `/api/activate/export` | GET | Export filtered data to Excel |

### Photo Processing
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/fetch-photos` | POST | Fetch from OneMap/BOSS/local |
| `/api/activate/categorize-photos` | POST | Run VLM categorization |
| `/api/activate/check-photos` | POST | Check if photos exist |

**Important:** `fetch-photos` uses VLM categorization results for step data when available (status ≠ 'pending'). This ensures accurate step coverage even before formal approval, fixing issues where `photos_metadata` had old step assignments but VLM had correct ones.

### QA Wizard (5 Phases)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/validate-prerequisites` | POST | Phase 1: Validate prerequisites |
| `/api/activate/extract-data` | POST | VLM extraction (power, serials) |
| `/api/activate/validate-qa` | POST | Separate QA validation |
| `/api/activate/human-review` | POST | Phase 2-3: Human corrections |
| `/api/activate/final-decision` | POST | Phase 4: Final decision |
| `/api/activate/approve-categorization` | POST | Approve AI results |

### WhatsApp Integration
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/dr-acknowledgment` | POST | Get ack data for Go Bridge |
| `/api/activate/process-new-dr` | POST | Process new DR from WhatsApp |
| `/api/activate/send-feedback` | POST | Phase 5: Send WA feedback |

### Maintenance Integration (Jan 2026)
**Ticket creation from Activate reports uses proper source tracking:**

| Report | Ticket Source | Use Case |
|--------|--------------|----------|
| Offline Devices (ARCH) | `offline_report` | Create tickets from offline device report |
| QA Centre | `qa_review` | Create tickets from QA review failures |
| Serial Swap | `ont_swap` | Auto-created when serials swapped |

**URL Format:** `/maintenance/tickets/new?source=offline_report&dr_number=DR123&title=...`

See `src/modules/maintenance/types/ticket.ts` for all `TicketSource` enum values:
- `qcontact`, `weekly_report`, `construction`, `ad_hoc`, `incident`, `revenue`, `ont_swap`, `manual`, `offline_report`, `qa_review`

### Reporting (8 Types)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/reporting/daily-counts` | GET | Zone/PON breakdown |
| `/api/activate/reporting/discrepancy` | GET | WA vs OES comparison |
| `/api/activate/reporting/funnel` | GET | QA workflow funnel |
| `/api/activate/reporting/resubmissions` | GET | Failed→Passed analysis |
| `/api/activate/reporting/serial-validation` | GET | Serial matching |
| `/api/activate/reporting/team-performance` | GET | Team leaderboard |
| `/api/activate/reporting/trends` | GET | Velocity trends |
| `/api/activate/reporting/user-attribution` | GET | User attribution |

### System
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/health-check` | GET | 5-service health status |
| `/api/activate/activity-log` | GET | DR lifecycle events |
| `/api/activate/admin/retry-failed` | GET/POST | Manage retry queue |
| `/api/activate/import-oes` | POST | Import OES Excel |

### Export API Parameters
- `dateFrom` - Start date (YYYY-MM-DD)
- `dateTo` - End date (YYYY-MM-DD)
- `project` - Filter by project (or 'all')
- `status` - Filter by status ('reviewed', 'notReviewed', or 'all')
- `format` - Output format ('json' for JSON, omit for Excel)

## Dashboard - Expandable Breakdown

The Dashboard's "Numbers per Project" table supports drill-down:

1. **Click Project Row** → Expands to show Zone breakdown
2. **Click Zone Row** → Expands to show PON breakdown

Each level shows: Total, Installed, Activated, Not Reviewed, Reviewed

Data fetched on-demand from `/api/activate/reporting/daily-counts?project=X`

### Project Attribution Logic (Jan 2026)

For OES-only activations (no WhatsApp submission), project is determined via fallback:

```sql
COALESCE(upr.project, p.project_name, 'Unknown') as project
-- 1. First try: dr_photo_unified_reviews.project (WhatsApp submission)
-- 2. Fallback: drops → projects table (SOW data)
-- 3. Last resort: 'Unknown'
```

**Why this matters:** Installers sometimes activate DRs on OES without submitting photos via WhatsApp. These OES-only activations are now correctly attributed to their projects using the SOW `drops` table instead of showing as "Unknown".

## Reports Tab (3 Report Types)

### 🚨 CRITICAL: Reporting Terminology

**MUST use consistent terminology across ALL reports:**

| Term | Definition | Database Logic | Color |
|------|------------|----------------|-------|
| **INSTALLED** | DR submitted via WhatsApp (installation was done) | Record exists in `dr_photo_unified_reviews` | Blue (`text-blue-600`) |
| **ACTIVATED** | DR confirmed as active on OES report | Record exists in `oes_activations` | Purple (`text-purple-600`) |
| **NOT REVIEWED** | Not yet QA reviewed | `vlm_categorization_status != 'approved'` | Yellow (`text-yellow-600`) |
| **REVIEWED** | QA review completed | `vlm_categorization_status = 'approved'` | Green (`text-green-600`) |

### Report Types

#### 1. Discrepancy Report
- **Purpose**: Compare WhatsApp submissions vs OES activations
- **Categories**:
  - **Matched**: Present in both WhatsApp and OES
  - **WA Only**: Submitted but not yet activated
  - **OES Only**: In OES but not from WhatsApp (manual install?)
- **API**: `GET /api/activate/reporting/discrepancy?waDate=YYYY-MM-DD`

#### 2. Serial Validation Report
- **Purpose**: ONT/UPS serial matching between WhatsApp and OES
- **Status Values**: Match, Mismatch, Missing WA, Missing OES, Both Missing
- **Critical**: Mismatches indicate wrong ONT installed
- **API**: `GET /api/activate/reporting/serial-validation?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

#### 3. User/Team Attribution Report
- **Purpose**: Performance metrics per installer/team
- **Per-user**: Installed, Complete, Completion %, Serial %, Activation %
- **Per-team**: Total activations, WA match rate
- **API**: `GET /api/activate/reporting/user-attribution?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

### Reporting Components

| File | Purpose |
|------|---------|
| `src/modules/activate/components/DrListPage.tsx` | Dashboard with expandable Project → Zone → PON |
| `src/modules/activate/components/reporting/ReportsTab.tsx` | Reports tab (3 report types) |
| `src/modules/activate/services/reportingService.ts` | Database queries for all reports |
| `src/modules/activate/types/reporting.types.ts` | TypeScript interfaces |
| `pages/api/activate/reporting/*.ts` | API endpoints |

## Database Schema

### dr_photo_unified_reviews (Main Table)
**Core Fields:**
- `id` (UUID), `drop_number`, `project`, `photo_source`, `photo_count`, `photos_metadata`

**Manual QA (10 steps):**
- `step_01_house_photo` through `step_10_signature` (boolean)
- `incorrect_steps` (text[]), `incorrect_comments` (JSONB)

**VLM Categorization:**
- `vlm_categorization_status` ('pending' | 'categorized' | 'approved')
- `vlm_categorization_results` (JSONB), `vlm_categorization_at`

**VLM QA Validation:**
- `vlm_qa_status`, `vlm_qa_results`, `vlm_qa_validated_at`, `vlm_qa_summary`

**Human Review:**
- `human_qa_overrides` (JSONB), `human_review_status`, `human_reviewer_id`

**QA Decision (Phase 4):**
- `qa_decision` ('PASS' | 'FAIL' | 'REWORK_NEEDED')
- `qa_decision_reasons` (JSONB array of fail codes)
- `qa_decision_at`, `qa_decision_by`, `qa_decision_notes`
- `qa_decision_is_draft` (boolean) - True if decision not yet finalized
- `qa_internal_notes` (text) - Internal QA team notes
- `qa_technician_feedback` (text) - Feedback for technician (WhatsApp)
- `qa_issue_classification` (JSONB) - Issue type, correct value, ticket flags

**Data Extraction:**
- `vlm_power_meter_dbm`, `vlm_power_meter_status` ('pass' | 'fail_high' | 'fail_low')
- `vlm_ont_serial_step6`, `vlm_ont_serial_step9`, `vlm_dr_number_step9`
- `serial_validation_status` ('match' | 'mismatch' | 'partial')

**QA Phases:**
- `qa_phase` ('prerequisites' | 'photo_review' | 'data_validation' | 'final_decision' | 'feedback' | 'completed')
- Phase completion flags: `prerequisites_passed`, `photo_review_completed`, `data_validation_completed`

**Lifecycle:**
- `whatsapp_submitted_at`, `acknowledged_at`, `photos_fetched_at`
- `feedback_sent`, `feedback_message`, `feedback_sent_at`

### dr_activity_log
Event tracking for DR lifecycle: `whatsapp_submitted`, `acknowledged`, `photos_fetched`, `categorization_*`, `qa_*`, `human_review_*`, `feedback_*`, `resubmission`

### qa_correction_examples
Human corrections for few-shot learning with `workflow_type`, `vlm_predicted_*`, `correct_*`, `is_canonical`

### VLM Status Values
- `pending` - Awaiting categorization
- `processing` - Being analyzed
- `categorized` - VLM assigned steps
- `approved` - Human-approved
- `failed` - Error occurred

## Commands Reference

```bash
# Check health via API
curl -s https://app.fibreflow.app/api/activate/health-check | jq .

# Test acknowledgment API
curl -s -X POST https://app.fibreflow.app/api/activate/dr-acknowledgment \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR1750922","project":"Lawley"}' | jq .

# Check Go bridge logs (SSH to VPS)
ssh root@72.61.197.178 "tail -50 /opt/whatsapp-bridge/bridge.log"

# Filter for acknowledgment logs (VPS)
ssh root@72.61.197.178 "grep -E '(Sent ack|photos:|ACK)' /opt/whatsapp-bridge/bridge.log | tail -20"

# Restart Go bridge (VPS)
ssh root@72.61.197.178 "systemctl restart whatsapp-bridge.service"

# Check VLM server
curl -s http://100.96.203.105:8100/v1/models | jq .

# Check WA Feedback
curl -s http://100.96.203.105:8090/health | jq .

# Restart WA Feedback (run locally on Velocity — passwordless sudo)
sudo systemctl restart wa-feedback
```

## Database Queries

```sql
-- Recent DRs
SELECT drop_number, project, vlm_categorization_status, created_at
FROM dr_photo_unified_reviews
ORDER BY created_at DESC
LIMIT 10;

-- Pending categorizations
SELECT COUNT(*) FROM dr_photo_unified_reviews
WHERE vlm_categorization_status = 'pending';

-- Failed categorizations
SELECT drop_number, vlm_error, retry_count
FROM dr_photo_unified_reviews
WHERE vlm_categorization_status = 'failed';

-- DRs in last 24 hours
SELECT COUNT(*) FROM dr_photo_unified_reviews
WHERE created_at > NOW() - INTERVAL '24 hours';

-- DR by number
SELECT * FROM dr_photo_unified_reviews
WHERE drop_number = 'DR1234567';
```

## Troubleshooting

### ISSUE: Health Check Shows "Some Issues"

**Diagnosis**:
1. Open health dashboard or call API
2. Look at expanded dropdown for red/yellow services
3. Check specific service

**Common Fixes**:
- VLM down: Check docker on Velocity server
- WA Feedback: Restart wa-feedback service (port 8090)
- 1M: Check 192.168.1.150 connectivity

---

### ISSUE: Acknowledgments Not Sending

**Symptoms**:
- User sends DR, no reply
- Go bridge log shows errors

**Diagnosis**:
```bash
# Check Go bridge logs (VPS)
ssh root@72.61.197.178 "grep -E 'ACK|ERROR' /opt/whatsapp-bridge/bridge.log | tail -30"
```

**Common Causes**:
1. API unreachable - check production is running
2. LID format issues - check QuotedMessage is included
3. OneMap timeout - check 1M health

---

### ISSUE: Reply Not Threading

**Symptoms**:
- Acknowledgment sends but not as reply to original message

**Root Cause**:
Missing `QuotedMessage` in ContextInfo.

**Required for threading**:
```go
ContextInfo: &waProto.ContextInfo{
    StanzaID:      proto.String(replyToID),      // Original message ID
    Participant:   proto.String(senderJID),       // Original sender (LID)
    QuotedMessage: quotedMsg,                     // Original message content
}
```

---

### ISSUE: VLM Not Categorizing

**Symptoms**:
- DRs stuck in "pending" status
- No categorization results

**Diagnosis**:
```bash
# Check VLM server
curl -s http://100.96.203.105:8100/v1/models | jq .

# Check VLM service (run locally on Velocity as user hein)
sudo systemctl status vllm-qwen.service
```

**Fix**:
```bash
# Restart VLM service (run locally on Velocity)
sudo systemctl restart vllm-qwen.service
```

---

### ISSUE: WA Bridge Shows "Unknown"

**Symptoms**:
- Health check shows WA Bridge as "unknown"
- Message: "No DR history found"

**Root Cause**:
Query checking wrong table or no DRs submitted yet.

**Verification**:
```sql
SELECT COUNT(*), MAX(created_at)
FROM dr_photo_unified_reviews;
```

---

### ISSUE: VLM Extraction "fetch failed"

**Symptoms**:
- Data Validation shows "Not extracted" for all fields
- API returns `"error": "fetch failed"` in extraction results
- Power meter, ONT serial, DR number all missing

**Root Cause**:
Missing environment variables in dev/production `.env.production`:
- `VLM_API_URL` - Must use `localhost:8100`, not Tailscale IP
- `NEXT_PUBLIC_APP_URL` - Must match port (`localhost:3005` for dev, `localhost:3000` for production)

**Quick Fix**:
```bash
# Add to .env.production (adjust port for environment)
VLM_API_URL=http://localhost:8100
NEXT_PUBLIC_APP_URL=http://localhost:3005  # dev
# or: NEXT_PUBLIC_APP_URL=http://localhost:3000  # production
```

## Component Files

### Main Pages
| File | Purpose |
|------|---------|
| `src/modules/activate/components/DrListPage.tsx` | Main page with tabs |
| `src/modules/activate/components/DrSummaryPage.tsx` | DR Summary landing tab |
| `src/modules/activate/components/QaCentrePage.tsx` | QA Centre with filters + Export (includes `InlineStatusBadges`, `ProjectBadge`, `SerialDisplay`) |
| `src/modules/activate/components/SystemHealthDashboard.tsx` | Health monitoring UI |

### QA Wizard (5-Phase)
| File | Purpose |
|------|---------|
| `src/modules/activate/components/wizard/QaWizardContainer.tsx` | Wizard orchestrator (loads/passes draft data) |
| `src/modules/activate/components/wizard/PrerequisitesPhase.tsx` | Phase 1 |
| `src/modules/activate/components/wizard/PhotoReviewPhase.tsx` | Phase 2 |
| `src/modules/activate/components/wizard/DataValidationPhase.tsx` | Phase 3 |
| `src/modules/activate/components/wizard/FinalDecisionPhase.tsx` | Phase 4 (draft save on Back, `initialData` prop) |
| `src/modules/activate/components/wizard/FeedbackPhase.tsx` | Phase 5 |
| `src/modules/activate/components/wizard/WizardProgressOverlay.tsx` | Progress spinner for 1Map sync & AI categorization |
| `pages/api/activate/final-decision.ts` | Phase 4 API (supports `isDraft` parameter) |

### Progress Overlays (Jan 2026)
| File | Purpose |
|------|---------|
| `src/modules/activate/components/ImportProgressOverlay.tsx` | Full-screen spinner for OES/ARCH imports |
| `src/modules/activate/components/wizard/WizardProgressOverlay.tsx` | Full-screen spinner for 1Map sync & AI categorization |

**Import Phases:** `parsing` → `uploading` → `processing` → `syncing` → `complete`
**1Map Sync Phases:** `fetching` → `loading_photos` → `checking` → `complete`
**Categorization Phases:** `analyzing` → `processing` → `saving` → `complete`

### Reporting (8 Types)
| File | Purpose |
|------|---------|
| `src/modules/activate/components/reporting/ReportsDashboard.tsx` | Reports container |
| `src/modules/activate/components/reporting/ReportsTab.tsx` | Reports tab |
| `src/modules/activate/components/reporting/TrendReports.tsx` | Velocity trends |
| `src/modules/activate/components/reporting/FunnelReports.tsx` | Workflow funnel |
| `src/modules/activate/components/reporting/TeamReports.tsx` | Team leaderboard |
| `src/modules/activate/components/reporting/AnomalyReports.tsx` | WA-only/OES-only |

### Services
| File | Purpose |
|------|---------|
| `src/modules/activate/services/activateDataService.ts` | Main data fetching + `DrListItem` type with rich status model |
| `src/modules/activate/services/reportingService.ts` | Report queries |
| `src/modules/activate/services/categorizationVlmService.ts` | VLM categorization |
| `src/modules/activate/services/vlmExtractionService.ts` | VLM data extraction |
| `src/modules/activate/services/vlmQaValidationService.ts` | VLM QA validation |
| `src/modules/activate/services/activityLogService.ts` | Event logging |
| `src/modules/activate/services/photoFetchService.ts` | Photo fetching |

### Types
| File | Purpose |
|------|---------|
| `src/modules/activate/types/unified.types.ts` | Core types |
| `src/modules/activate/types/summary.types.ts` | Summary types |
| `src/modules/activate/types/reporting.types.ts` | Report types |

### Context & Hooks
| File | Purpose |
|------|---------|
| `src/modules/activate/context/ActivateDataContext.tsx` | Shared state with auto-refresh |
| `src/modules/activate/hooks/useUnifiedReview.ts` | Single DR review hook |
| `src/modules/activate/hooks/useAutoRefresh.ts` | Auto-refresh hook |

### Utilities
| File | Purpose |
|------|---------|
| `src/modules/activate/utils/stepMapper.ts` | Photo type → step mapping |

## WhatsApp Group Mapping

| Project | Group JID |
|---------|-----------|
| Lawley | `120363418298130331@g.us` |
| Mohadin | `120363421532174586@g.us` |
| Velo Test | `120363421664266245@g.us` |
| Mamelodi | `120363408849234743@g.us` |

## WhatsApp Threading

### How Threading Works

When feedback is sent, it should reply to the original DR submission message.

**Message ID Storage:**
| Field | Source | Purpose |
|-------|--------|---------|
| `wa_message_id` | Go bridge | Original DR message ID for reply threading |
| `wa_sender_jid` | Go bridge | Original sender JID |
| `wa_original_text` | Go bridge | Original message text |
| `wa_group_jid` | Go bridge | WhatsApp group JID |

**Threading Flow:**
1. User sends DR → Go bridge stores `wa_message_id` in `dr_photo_unified_reviews`
2. QA review completed → `/send-feedback` called
3. If `wa_message_id` exists → Send as threaded reply
4. Our feedback message ID is stored for future threading (re-reviews)

### Historical DRs

DRs created before Jan 2026 don't have `wa_message_id`. For these:
- First feedback sends as non-threaded message
- Our feedback message ID is stored in `wa_message_id`
- Re-reviews thread off our previous feedback

### Serial Validation (Step 6 Priority)

Step 6 (ONT back) is the authoritative serial source because the sticker is clearly visible.

| Scenario | Result |
|----------|--------|
| Step 6 matches OneMap | ✅ PASS (ignore Step 9 mismatch) |
| Step 6 differs, Step 9 matches | ⚠️ PARTIAL (needs review) |
| Neither matches | ❌ MISMATCH |

**Example:** DR1737336 had Step 6 = `ALCLB48A9CF3` (matches OneMap) but Step 9 = `ALCL146A0CF3` (different). With the new logic, serial validation PASSES.

## Related Skills

- `/photo-categorization` - **CANONICAL** photo type → step mappings (must reference this for any mapping changes)
- `/ai-qa-validation` - VLM quality validation criteria (FiberTime standards)
- `/deploy` - Deploy to dev or production
- `/oes` - OES import operations
- `/wa-monitor` - WhatsApp monitor issues
- `/whatsapp` - **Full WhatsApp infrastructure** (Go bridge, services, message flow, phone numbers)

## Auto-Activation Rules

### DO Automatically:
- ✅ Run health check when issues reported
- ✅ Look up DR when number mentioned
- ✅ Show service status
- ✅ Query database for diagnostics

### ASK First:
- ❓ Retry failed categorizations
- ❓ Restart services
- ❓ Modify database records

### DON'T:
- ❌ Delete DR records
- ❌ Modify Go bridge code
- ❌ Change VLM configuration

## Success Criteria

Skill is successful when:
- ✅ Health issues diagnosed in <10 seconds
- ✅ DR lookups return complete info
- ✅ Acknowledgment flow fully documented
- ✅ Troubleshooting guides cover common issues
- ✅ User can self-serve most problems
