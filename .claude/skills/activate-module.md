# Activate Module Skill

Comprehensive guide for the Activate (DR Photo Unified) system - AI-powered photo review with WhatsApp integration.

## Purpose

Handle all Activate module operations:
1. DR photo review and AI categorization
2. System health monitoring (5 services)
3. WhatsApp acknowledgments and feedback
4. OES import integration
5. **Reporting** - Daily counts, discrepancy, serial validation, user attribution
6. Troubleshooting and diagnostics

## Quick Reference

| Setting | Value |
|---------|-------|
| **Navigation** | Sidebar → FIELD OPERATIONS → Activate (first item, ✨ sparkles icon) |
| **Dashboard URL** | `https://vf.fibreflow.app/activate` |
| **Production URL** | `https://app.fibreflow.app/activate` |
| **API Prefix** | `/api/activate/*` |
| **Database Tables** | `qa_photo_reviews`, `dr_photo_unified_reviews`, `oes_activations` |
| **VLM Server** | `http://100.96.203.105:8100` (Qwen3) |
| **WA Sender** | `http://100.96.203.105:8081` |
| **Go Bridge** | `/home/louis/whatsapp-bridge-go/` |

### Tab-Based UI
| Tab | Purpose |
|-----|---------|
| **Dashboard** | DR list with filters, stats, project breakdown |
| **Manual Entry** | Add DRs manually |
| **OES Import** | Import OES Excel activation reports |
| **Reports** | Daily counts, discrepancy, serial validation, user attribution |

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

WhatsApp Sender:
  Service: whatsapp-sender
  Health: http://100.96.203.105:8081/health
  Connected: ✅ Yes
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

### 5. WhatsApp Sender
```bash
curl http://100.96.203.105:8081/health
# Returns: {"connected": true}
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

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/health-check` | GET | System health status |
| `/api/activate/dr-acknowledgment` | POST | Get acknowledgment data |
| `/api/activate/process-new-dr` | POST | Validate & process new DR |
| `/api/activate/admin/retry-failed` | POST | Retry failed categorizations |
| `/api/activate/import-oes` | POST | Import OES Excel data |
| `/api/activate/reporting/daily-counts` | GET | Daily DR counts with zone/PON breakdown |
| `/api/activate/reporting/discrepancy` | GET | WhatsApp vs OES comparison |
| `/api/activate/reporting/serial-validation` | GET | ONT/UPS serial matching |
| `/api/activate/reporting/user-attribution` | GET | User/team performance metrics |

## Reports Tab (4 Report Types)

### 🚨 CRITICAL: Reporting Terminology

**MUST use consistent terminology across ALL reports:**

| Term | Definition | Database Logic | Color |
|------|------------|----------------|-------|
| **INSTALLED** | DR submitted via WhatsApp (installation was done) | Record exists in `qa_photo_reviews` | Blue (`text-blue-600`) |
| **COMPLETE** | All required steps/photos verified by QA | `vlm_categorization_status = 'approved'` | Green (`text-green-600`) |
| **INCOMPLETE** | Missing steps/photos OR not verified by QA | NOT complete (inverse) | Yellow (`text-yellow-600`) |
| **ACTIVATED** | DR confirmed as active on OES report | Record exists in `oes_activations` | Purple (`text-purple-600`) |

### Report Types

#### 1. Daily Counts Report
- **Purpose**: Zone/PON breakdown per project
- **UI**: Expandable accordion (Project → Zone → PON)
- **Metrics**: Installed/Complete/Incomplete/Activated per level
- **API**: `GET /api/activate/reporting/daily-counts?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

#### 2. Discrepancy Report
- **Purpose**: Compare WhatsApp submissions vs OES activations
- **Categories**:
  - **Matched**: Present in both WhatsApp and OES
  - **WA Only**: Submitted but not yet activated
  - **OES Only**: In OES but not from WhatsApp (manual install?)
- **API**: `GET /api/activate/reporting/discrepancy?waDate=YYYY-MM-DD`

#### 3. Serial Validation Report
- **Purpose**: ONT/UPS serial matching between WhatsApp and OES
- **Status Values**: Match, Mismatch, Missing WA, Missing OES, Both Missing
- **Critical**: Mismatches indicate wrong ONT installed
- **API**: `GET /api/activate/reporting/serial-validation?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

#### 4. User/Team Attribution Report
- **Purpose**: Performance metrics per installer/team
- **Per-user**: Installed, Complete, Completion %, Serial %, Activation %
- **Per-team**: Total activations, WA match rate
- **API**: `GET /api/activate/reporting/user-attribution?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

### Reporting Components

| File | Purpose |
|------|---------|
| `src/modules/activate/components/reporting/ReportsTab.tsx` | Main reports container with sub-navigation |
| `src/modules/activate/services/reportingService.ts` | Database queries for all reports |
| `src/modules/activate/types/reporting.types.ts` | TypeScript interfaces |
| `pages/api/activate/reporting/*.ts` | API endpoints |

## Database Schema

### dr_photo_unified_reviews
```sql
CREATE TABLE dr_photo_unified_reviews (
  id UUID PRIMARY KEY,
  drop_number VARCHAR(20) NOT NULL,
  project VARCHAR(100),
  submitted_by VARCHAR(50),
  agent_phone VARCHAR(20),
  photos JSONB,
  vlm_categorization JSONB,
  vlm_categorization_status TEXT DEFAULT 'pending',
  vlm_error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### VLM Status Values
- `pending` - Awaiting categorization
- `processing` - Being analyzed
- `completed` - Successfully categorized
- `failed` - Error occurred
- `approved` - Human-approved

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

# Check WA Sender
curl -s http://100.96.203.105:8081/health | jq .

# Restart WA Sender
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart whatsapp-sender"
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
- WA Sender: Restart whatsapp-sender service
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

| File | Purpose |
|------|---------|
| `src/modules/activate/components/DrListPage.tsx` | Main page with tabs |
| `src/modules/activate/components/SystemHealthDashboard.tsx` | Health monitoring UI |
| `src/modules/activate/components/OESImportTab.tsx` | OES import UI |
| `src/modules/activate/components/ManualDREntry.tsx` | Manual DR addition |
| `src/modules/activate/components/reporting/ReportsTab.tsx` | Reports tab with 4 report types |
| `src/modules/activate/services/reportingService.ts` | Reporting database queries |
| `src/modules/activate/types/reporting.types.ts` | Reporting TypeScript interfaces |
| `pages/api/activate/health-check.ts` | Health check API |
| `pages/api/activate/dr-acknowledgment.ts` | Acknowledgment data API |
| `pages/api/activate/process-new-dr.ts` | DR validation & processing |
| `pages/api/activate/import-oes.ts` | OES import API |
| `pages/api/activate/reporting/daily-counts.ts` | Daily counts report API |
| `pages/api/activate/reporting/discrepancy.ts` | Discrepancy report API |
| `pages/api/activate/reporting/serial-validation.ts` | Serial validation API |
| `pages/api/activate/reporting/user-attribution.ts` | User attribution API |

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
