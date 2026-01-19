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
| **Dashboard URL** | `https://vf.fibreflow.app/activate` |
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

### 5-Phase QA Wizard
| Phase | Name | API Endpoint | Purpose |
|-------|------|--------------|---------|
| 1 | Prerequisites | `/validate-prerequisites` | Check photos, categorization, step coverage |
| 2 | Photo Review | `/human-review` | Review and approve photo assignments |
| 3 | Data Validation | `/extract-data` | Validate power (-18 to -24 dBm), serial matches |
| 4 | Final Decision | `/final-decision` | PASS / FAIL / REWORK_NEEDED with reason codes |
| 5 | Feedback | `/send-feedback` | Generate and send WhatsApp feedback |

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
│  sends DR123456 │     │  (Velocity VPS)  │     │  (Staging)      │
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
curl http://192.168.1.150:8003/health
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

## SSH Commands Reference

```bash
# Check health via API
curl -s https://vf.fibreflow.app/api/activate/health-check | jq .

# Test acknowledgment API
curl -s -X POST https://vf.fibreflow.app/api/activate/dr-acknowledgment \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR1750922","project":"Lawley"}' | jq .

# Check Go bridge logs
sshpass -p 'velo2026' ssh velo@100.96.203.105 "tail -50 /home/louis/whatsapp-bridge-go/bridge.log"

# Filter for acknowledgment logs
sshpass -p 'velo2026' ssh velo@100.96.203.105 "grep -E '(Sent ack|photos:|ACK)' /home/louis/whatsapp-bridge-go/bridge.log | tail -20"

# Restart Go bridge
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart whatsapp-bridge.service"

# Check VLM server
curl -s http://100.96.203.105:8100/v1/models | jq .

# Check WA Feedback
curl -s http://100.96.203.105:8090/health | jq .

# Restart WA Feedback
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart wa-feedback"
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
# Check Go bridge logs
sshpass -p 'velo2026' ssh velo@100.96.203.105 "grep -E 'ACK|ERROR' /home/louis/whatsapp-bridge-go/bridge.log | tail -30"
```

**Common Causes**:
1. API unreachable - check staging is running
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

# Check docker
sshpass -p 'velo2026' ssh velo@100.96.203.105 "docker ps | grep vllm"
```

**Fix**:
```bash
# Restart VLM container
sshpass -p 'velo2026' ssh velo@100.96.203.105 "docker restart vllm-qwen3"
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

## Component Files

### Main Pages
| File | Purpose |
|------|---------|
| `src/modules/activate/components/DrListPage.tsx` | Main page with tabs |
| `src/modules/activate/components/DrSummaryPage.tsx` | DR Summary landing tab |
| `src/modules/activate/components/QaCentrePage.tsx` | QA Centre with filters + Export |
| `src/modules/activate/components/SystemHealthDashboard.tsx` | Health monitoring UI |

### QA Wizard (5-Phase)
| File | Purpose |
|------|---------|
| `src/modules/activate/components/wizard/QaWizardContainer.tsx` | Wizard orchestrator |
| `src/modules/activate/components/wizard/PrerequisitesPhase.tsx` | Phase 1 |
| `src/modules/activate/components/wizard/PhotoReviewPhase.tsx` | Phase 2 |
| `src/modules/activate/components/wizard/DataValidationPhase.tsx` | Phase 3 |
| `src/modules/activate/components/wizard/FinalDecisionPhase.tsx` | Phase 4 |
| `src/modules/activate/components/wizard/FeedbackPhase.tsx` | Phase 5 |

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
| `src/modules/activate/services/activateDataService.ts` | Main data fetching |
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

## Related Skills

- `/photo-categorization` - **CANONICAL** photo type → step mappings (must reference this for any mapping changes)
- `/ai-qa-validation` - VLM quality validation criteria (FiberTime standards)
- `/deploy` - Deploy to staging
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
