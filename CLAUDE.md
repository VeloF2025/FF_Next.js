# CLAUDE.md - AI Assistant Context Guide

## Project Overview
**FibreFlow Next.js** - A fiber network project management application
- **Framework**: Next.js 14+ with App Router
- **Auth**: PostgreSQL-based authentication (role-based)
- **Database**: Neon PostgreSQL (direct SQL)
- **Storage**: Firebase Storage (files/images)

## Essential Directory Structure
```
src/
├── modules/           # Modular features (Lego blocks)
│   ├── wa-monitor/    # WhatsApp monitor (fully isolated)
│   ├── activate/      # DR Photo review with VLM + HITL learning
│   ├── qa-learning/   # HITL few-shot learning (shared)
│   └── rag/           # Contractor health monitoring
├── components/        # Shared UI (AppLayout is standard)
├── services/          # API services
└── lib/              # Utilities

scripts/           # Build scripts & database tools
SOW/              # Statement of Work import
neon/             # Database configuration
docs/             # Documentation & logs
```

## 🚨 CRITICAL: Database Configuration

**Neon Branching Setup (Jan 2026):**

All environments use branches within the **FF_React** project (sparkling-bar-47287977):

| Environment | Branch | Endpoint | Worktree |
|-------------|--------|----------|----------|
| **Production** | `production` | `ep-dry-night-a9qyh4sj` | `FF_Next.js` (master) |
| **Development** | `hein-dev` | `ep-aged-poetry-a9bbd8e9` | `FF_Next.js-hein` (hein/dev) |

**Connection Strings (Updated Jan 2026):**
```bash
# PRODUCTION (master branch) - REAL CUSTOMER DATA
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'

# DEVELOPMENT (hein-dev branch) - SAFE TO EXPERIMENT
DATABASE_URL='postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-aged-poetry-a9bbd8e9.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require'
```

**Sync Dev from Production (reset to fresh data):**
```bash
export NEON_API_KEY="napi_2afbjxk3l7jh71x10log1icm4yycl3n2hqag9wrg1jgvwqg5z955c2tnt0ip4gwx"
npx neonctl branches reset br-summer-brook-a9jlv58r --project-id sparkling-bar-47287977 --parent
```

**Git Worktrees:**
```bash
git worktree list  # See all worktrees
# /home/hein/Workspace/FF_Next.js       [master]      - Production DB
# /home/hein/Workspace/FF_Next.js-hein  [hein/dev]    - Dev DB (branch)
```

- ❌ Never use: `ep-damp-credit-a857vku0` (old/incorrect)
- ❌ Deprecated: `ep-jolly-flower-a8zu8hnz` (separate project, not a branch)

### Two Drop Tables - DO NOT CONFUSE!

**1. `drops` Table** - SOW imports from Excel
- API: `/api/sow/drops`, `/api/sow/fibre`
- Import scripts: `/scripts/sow-import/`

**2. `qa_photo_reviews` Table** - WhatsApp QA data
- API: `/api/wa-monitor-drops`, `/api/wa-monitor-daily-drops`
- Source: WhatsApp groups via server monitor

**Query Examples:**
```sql
-- SOW drops
SELECT * FROM drops WHERE project_id = '...';

-- WhatsApp QA drops
SELECT * FROM qa_photo_reviews WHERE project = 'Lawley';
```

**Documentation:**
- `docs/DATABASE_TABLES.md` - Complete schema reference
- `src/modules/wa-monitor/README.md` - WA Monitor details

## 🚨 Starting the Server

**ALWAYS use production mode locally:**
```bash
npm run build
PORT=3005 npm start
# Access at http://localhost:3005
```

Dev mode now works after removing duplicate routes in src/app/ and src/pages/

## Key Commands
```bash
# Development
npm run build && PORT=3005 npm start  # Local development
npm run lint                          # ESLint
npm run type-check                    # TypeScript checking

# Database
npm run db:migrate                    # Run migrations
npm run db:seed                       # Seed data

# Testing
npm test                             # Vitest
npm run test:e2e                     # Playwright
npm run antihall                     # Validate code references
```

## Development Guidelines

### API Response Standards
Use `apiResponse` helper from `lib/apiResponse.ts`:
```typescript
import { apiResponse } from '@/lib/apiResponse';

return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
return apiResponse.internalError(res, error);
```

### SOW Import Process
After creating a project, import data:
```bash
# Edit script with PROJECT_ID, then:
node scripts/sow-import/import-fibre-louissep15.cjs
node scripts/sow-import/verify-fibre-louissep15.cjs
```

### Coding Standards
- Files < 300 lines, components < 200 lines
- Extract business logic to hooks
- Type organization by module
- Domain-focused services

### 🚨 CRITICAL: Confirmation Before Success Display
**System-wide rule (Jan 2026):** Toast notifications and any success confirmations must WAIT for actual confirmation before showing approval checkmarks.

**Principle:** Never show success (checkmarks, green indicators) until the operation is actually confirmed complete.

**Pattern:**
```typescript
// ❌ WRONG - Fire and forget, shows success immediately
await triggerSync();
toast.success("Sync complete ✓");  // Lies! We don't know if it worked

// ✅ CORRECT - Wait for confirmation, then show status
const result = await triggerSyncWithConfirmation();
if (result.confirmed) {
  toast.success("Sync complete ✓");
} else {
  toast.error("Sync failed: " + result.error);
}
```

**Applies to:**
- Database inserts/updates - wait for DB confirmation
- External API syncs (QField, WhatsApp, etc.) - poll for status if async
- File uploads - wait for storage confirmation
- Any async operation shown to user

**Implementation Examples:**
- `import-oes.ts`: Polls QField sync status for up to 60s before returning
- `OESImportTab.tsx`: Shows conditional checkmarks based on `dbSyncConfirmed` and `qfieldSyncStatus.success`

### API Route Naming
**Consistent dynamic parameters required:**
```bash
# ✅ CORRECT
pages/api/contractors/[contractorId].ts
pages/api/contractors/[contractorId]/documents.ts

# ❌ WRONG - Conflicts
pages/api/contractors/[id].ts
pages/api/contractors/[contractorId]/documents.ts
```

### Page Layouts
```tsx
// Standard layout with sidebar
import { AppLayout } from '@/components/layout';

export default function MyPage() {
  return <AppLayout>{/* content */}</AppLayout>;
}

// Fullscreen without sidebar
FotoReviewPage.getLayout = (page) => page;
```

### ⚠️ Vercel Nested Routes Issue
**Nested dynamic routes fail in production!** Use flattened routes:
```bash
# ❌ FAILS in production
pages/api/contractors/[contractorId]/onboarding/stages.ts

# ✅ WORKS everywhere
pages/api/contractors-onboarding-stages.ts?contractorId={id}
```

## Modular Architecture

Each module in `src/modules/` is self-contained:
```
module-name/
├── types/          # TypeScript interfaces
├── services/       # Business logic & API
├── utils/         # Helpers
├── components/    # UI components
└── hooks/         # Custom hooks
```

**WA Monitor** - Fully isolated module (zero dependencies)
- Can be extracted to microservice
- See: `src/modules/wa-monitor/ISOLATION_GUIDE.md`

## WhatsApp Monitor (WA Monitor)

**Status:** ✅ FULLY ISOLATED MODULE

### Quick Reference
- **Dashboard:** `/wa-monitor`
- **API:** `/api/wa-monitor-*`
- **Table:** `qa_photo_reviews`
- **Services:** `wa-monitor-prod`, `wa-monitor-dev`

### Common Issues & Fixes

**"Send Feedback" button not working:**
```bash
ssh velo@100.96.203.105  # Password: velo2026
echo 'velo2026' | sudo -S systemctl restart whatsapp-bridge-prod
```

**Add new WhatsApp group (5 minutes):**
```bash
ssh velo@100.96.203.105  # Password: velo2026
nano /opt/wa-monitor/prod/config/projects.yaml
# Add group in YAML format
/opt/wa-monitor/prod/restart-monitor.sh  # ✅ Use safe restart
```

**⚠️ CRITICAL: Always use safe restart for production:**
```bash
/opt/wa-monitor/prod/restart-monitor.sh  # ✅ Clears Python cache
# NOT: systemctl restart wa-monitor-prod  # ❌ Keeps stale cache
```

### Monitored Groups
- **Lawley**: 120363418298130331@g.us
- **Mohadin**: 120363421532174586@g.us
- **Velo Test**: 120363421664266245@g.us
- **Mamelodi**: 120363408849234743@g.us

**Full Documentation:**
- `src/modules/wa-monitor/README.md`
- `src/modules/wa-monitor/TROUBLESHOOTING.md`

## Activate Module (Activations Hub)

**Status:** ✅ PRODUCTION - VLM-powered photo categorization with 5-phase QA Wizard

### Overview
Unified system for DR (Drop Receipt) photo review with AI-powered categorization using Qwen3 VLM, 5-phase QA Wizard, comprehensive reporting, and WhatsApp integration.

### Quick Reference
- **Dashboard:** `/activate` (DR Summary landing tab)
- **QA Centre:** `/activate/qa-centre`
- **Monitoring:** `/activate/monitoring`
- **Review Page:** `/activate/[dropNumber]` (5-phase wizard)
- **API Prefix:** `/api/activate/*`
- **Main Table:** `dr_photo_unified_reviews`
- **VLM:** Qwen3 via VLLM on 100.96.203.105:8100
- **WA Feedback:** Port 8090 on 100.96.203.105

### Key Features
1. **5-Phase QA Wizard:** Prerequisites → Photo Review → Data Validation → Final Decision → Feedback
2. **AI Categorization:** Qwen3 VLM categorizes photos to 10-step checklist
3. **Data Extraction:** VLM extracts power meter dBm, ONT serials, DR numbers
4. **Comprehensive Reporting:** 8 report types (Trends, Funnel, Team, Serial Validation, etc.)
5. **WhatsApp Integration:** Threaded acknowledgments + QA feedback
6. **HITL Learning:** Human corrections stored for few-shot prompting

### Tab-Based UI
| Tab | Purpose |
|-----|---------|
| **DR Summary** | Landing page - Project stats with Zone/PON drill-down |
| **QA Centre** | DR list with filters, pagination, export |
| **Reports** | 8 report types with date/project filters |
| **OES Import** | Import OES Excel activation reports |
| **Manual Entry** | Add DRs manually |

### 5-Phase QA Wizard
| Phase | Name | Purpose |
|-------|------|---------|
| 1 | Prerequisites | Validate photos, categorization, step coverage |
| 2 | Photo Review | Review and approve photo assignments (edit mode shows discarded photos) |
| 3 | Data Validation | Validate power (-18 to -24 dBm), serial matches |
| 4 | Final Decision | PASS / FAIL / REWORK_NEEDED with reason codes, auto-ticket for swaps |
| 5 | Feedback | Generate and send WhatsApp feedback (technician issues only) |

### Serial Swap Detection (Jan 2026)
**Critical feature for detecting when ONT and UPS serials are in wrong fields.**

**Serial Patterns:**
| Device | Pattern | Example |
|--------|---------|---------|
| Nokia ONT | `ALCL*` or `ALCB*` | `ALCLB48CC3CA` |
| Gizzu UPS | `GU18W*` | `GU18W12V2508057584` |

**Swap Detection Flow:**
1. **First WhatsApp Response:** `dr-acknowledgment.ts` detects swap immediately and warns technician
2. **QA Wizard Phase 4:** Shows prominent "🔴 SERIALS SWAPPED" warning
3. **Auto-Ticket Creation:** Creates ticket with `source=ont_swap`, `ticket_type=ont_swap`
4. **Tracking:** Ticket tracks resolution until technician corrects in 1Map

**Key Functions in `qaAutoFailService.ts`:**
```typescript
looksLikeOntSerial(serial)    // Matches ALCL/ALCB pattern
looksLikeGizzuSerial(serial)  // Matches GU18W pattern
detectSwappedSerials(ont, ups) // Returns { swapped: boolean, details: string }
getTechnicianIssues(data)      // Returns actionable issues for technicians
```

### Technician Feedback vs Internal QA
**Separation of concerns for WhatsApp feedback:**

**Technician-Actionable (sent via WhatsApp):**
- ONT not scanned
- UPS not scanned
- Serials swapped (CRITICAL - with correction instructions)
- Invalid serial format
- Missing required photos
- Power meter out of range

**Internal QA Only (NOT sent to technicians):**
- VLM extraction comparison (Step 6 vs Step 9 vs OneMap)
- OCR confidence scores
- AI categorization mismatches
- Few-shot learning corrections

### API Endpoints (Key)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/drops` | GET | Paginated DR list with stats |
| `/api/activate/summary` | GET | DR summary for detail view |
| `/api/activate/fetch-photos` | POST | Fetch from OneMap/BOSS |
| `/api/activate/categorize-photos` | POST | VLM categorization |
| `/api/activate/extract-data` | POST | VLM data extraction |
| `/api/activate/validate-prerequisites` | POST | Phase 1 validation |
| `/api/activate/human-review` | POST | Human corrections |
| `/api/activate/final-decision` | POST | Phase 4 decision + auto-ticket for swaps |
| `/api/activate/send-feedback` | POST | WhatsApp feedback (technician issues only) |
| `/api/activate/dr-acknowledgment` | POST | **First WA response** - photo count, serials, swap detection |
| `/api/activate/reporting/*` | GET | 8 report endpoints |
| `/api/activate/health-check` | GET | 5-service health |
| `/api/activate/export` | GET | Excel export |

### Database Tables
- `dr_photo_unified_reviews` - Main review table with QA wizard fields
- `dr_activity_log` - Event tracking for full lifecycle
- `qa_review_history` - Historic QA reviews (Excel imports, comments)
- `qa_correction_examples` - Human corrections for few-shot learning
- `oes_activations` - OES activation data
- `qa_photo_reviews` - WhatsApp submissions (source)

### Activity Tab (DR Review Page)
**Location:** `/activate/[dropNumber]` → Activity tab

**Two Views:**
| View | Data Source | Purpose |
|------|-------------|---------|
| **Timeline** | `dr_activity_log` | Real-time workflow events (submissions, categorization, decisions) |
| **QA History** | `qa_review_history` | Historic manual QA reviews with comments |

**Viewing Comments:**
1. Click **Activity** tab
2. Click **"📋 QA History (N)"** toggle
3. Click on a **review row** to expand and see:
   - Comment text
   - QA Steps grid (green=pass, red=fail)
   - Completed/Outstanding counts

**API Endpoints:**
- `/api/activate/activity-log?dropNumber=X` - Timeline events
- `/api/qa-review-history?dropNumber=X` - Historic QA reviews

**Data Flow:**
- Excel imports → `qa_review_history` table → Activity Tab QA History view
- QA Wizard actions → `dr_activity_log` table → Activity Tab Timeline view
- WA Monitor submissions → `qa_photo_reviews` (separate, not in Activity Tab)

### WhatsApp Integration

**WhatsApp Services (Updated Jan 2026):**

| Service | Port | Number | Purpose |
|---------|------|--------|---------|
| `whatsapp-sender-2` | 8081 | 063 841 2276 | **SENDING** - REST API `/send-message` |
| `whatsapp-bridge-2` | 8083 | 063 841 2276 | **RECEIVING** - Incoming messages |
| `wa-feedback` | 8092 | - | FibreFlow proxy → sender-2 |

**Architecture (Jan 2026):**
```
FibreFlow APIs → wa-feedback (8092) → sender-2 (8081) → WhatsApp (063 841 2276)
                                            ↓
                 bridge-2 (8083) ← WhatsApp incoming messages
```

**All services use Tailscale IP for consistency across dev/staging/prod:**
- Sender-2: `http://100.96.203.105:8081`
- Bridge-2: `http://100.96.203.105:8083`
- WA Feedback: `http://100.96.203.105:8092`

**Sender-2 (for SENDING):** `/home/louis/whatsapp-sender-2/`
```bash
curl http://100.96.203.105:8081/health  # Check connection status
# Send with @mention:
curl -X POST http://100.96.203.105:8081/send-message -H "Content-Type: application/json" \
  -d '{"group_jid": "120363418298130331@g.us", "recipient_jid": "27123456789@s.whatsapp.net", "message": "Test"}'
# Send without @mention (use dummy recipient):
curl -X POST http://100.96.203.105:8081/send-message -H "Content-Type: application/json" \
  -d '{"group_jid": "120363418298130331@g.us", "recipient_jid": "0@s.whatsapp.net", "message": "Test"}'
```

**Bridge-2 (for RECEIVING):** `/home/louis/whatsapp-bridge-2/`
```bash
tail -f /home/louis/whatsapp-bridge-2/bridge.log
echo 'velo2026' | sudo -S systemctl restart whatsapp-bridge-2.service
```

**WA Feedback Service (FibreFlow proxy):** Port 8092
```bash
curl http://100.96.203.105:8092/health
echo 'velo2026' | sudo -S systemctl restart wa-feedback
# Config: /etc/systemd/system/wa-feedback.service
# Code: /home/louis/wa-feedback-service/wa-feedback-service.js
# Proxies to sender-2 (8081) with /send-message endpoint
```

**Group Mapping:**
- Lawley: `120363418298130331@g.us`
- Mohadin: `120363421532174586@g.us`
- Velo Test: `120363421664266245@g.us`
- Mamelodi: `120363408849234743@g.us`

### 10-Step Photo Checklist
| Step | Label | OneMap Types |
|------|-------|--------------|
| 1 | House Photo | `ph_prop` |
| 2 | Cable from Pole | `ph_pole`, `ph_outs` |
| 3 | Entry Outside | `ph_entry_out`, `ph_hm_ln` |
| 4 | Entry Inside | `ph_entry_in`, `ph_hm_en` |
| 5 | Wall | `ph_wall` |
| 6 | ONT Back | `ph_ont`, `ph_drop`, `ph_cbl_r`, `ph_bl` |
| 7 | Power Meter | `ph_powm`, `ph_powm1`, `ph_powm2` |
| 8 | Final Installation | `ph_after`, `ph_final` |
| 9 | Green Lights | `ph_lights`, `ph_led` |
| 10 | Signature | `ph_sign1`, `ph_sign2`, `ph_signature` |

### Troubleshooting

**VLM not responding:**
```bash
ssh velo@100.96.203.105  # Password: velo2026
echo 'velo2026' | sudo -S systemctl status vllm-qwen.service
/home/velo/scripts/vllm/startup.sh  # Restart
```

**Photos not categorizing:**
1. Check health dashboard: `/activate/monitoring`
2. Review failed queue: `/api/activate/admin/retry-failed`
3. Check `vlm_error` in `dr_photo_unified_reviews`

**Full Documentation:** `src/modules/activate/README.md`

## QA Learning Module (HITL Few-Shot)

**Status:** ✅ ACTIVE - VLM learns from human corrections via few-shot prompting

- **Module:** `src/modules/qa-learning/` - See README for details
- **Tables:** `qa_correction_examples`, `qa_workflow_steps`
- **Supports:** `dr_photo`, `civil_works`, `optical_works` (isolated learning)

## VLM Infrastructure (Qwen3-VL-8B)

**Status:** ✅ PRODUCTION - Running on Velocity Server

### Quick Reference
- **URL:** `http://100.96.203.105:8100`
- **Model:** Qwen/Qwen3-VL-8B-Instruct
- **Service:** `vllm-qwen.service`
- **Config:** `/etc/systemd/system/vllm-qwen.service`

### VLM Configuration
```bash
# Current stable settings (Jan 2026)
--model Qwen/Qwen3-VL-8B-Instruct
--max-model-len 16384      # Max tokens (increased from 12288)
--gpu-memory-utilization 0.90
--dtype bfloat16
--max-num-seqs 4           # 4 parallel sequences
--enforce-eager            # REQUIRED: prevents FLASHINFER backend crashes
```

**Note:** RTX 5090 is in compute-only mode (Exclusive_Process). Display uses AMD integrated GPU.

### Image Size Limits
**CRITICAL:** Large images exceed VLM token limits (16384 max)
- Resize images before sending to VLM
- Max recommended: 1024x768 for plates, 1280x960 for documents
- Use `sharp` library for resizing:
```typescript
import sharp from 'sharp';
const resized = await sharp(buffer)
  .resize(1024, 768, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer();
```

### VLM Benchmark System
**Location:** `/home/velo/scripts/vllm/`

**Test Images:**
```
/home/velo/scripts/vllm/benchmarks/test-images/
├── plate.jpg           # Expected: KR 27 FN GP
├── odometer.jpg        # Expected: 167443
├── fuel.jpg            # Expected: 1/4
├── sa_id.jpg           # Expected: 7802035087081
└── drivers_license.jpg # Expected: 7802035087081
```

**7 Benchmark Tests:**
| Test | Type | Expected | Typical Time |
|------|------|----------|--------------|
| text_math | Text | "4" | ~35ms |
| text_plate_format | Text | "Gauteng" | ~55ms |
| image_plate | Image | KR27FNGP | ~90ms |
| image_odometer | Image | 167443 | ~90ms |
| image_fuel | Image | 1/4 | ~57ms |
| image_sa_id | Image | 7802035087081 | ~170ms |
| image_license_id | Image | 7802035087081 | ~190ms |

**Cron Schedule:**
```bash
0 3 * * *           # 3:00 AM - Nightly restart
*/5 * * * *         # Every 5 min - Health check
0 6,12,18,23 * * *  # 6am, 12pm, 6pm, 11pm - Benchmarks (4x daily)
```

**Results:**
```bash
# Latest results
cat /home/velo/scripts/vllm/benchmarks/latest_results.json

# Historical results
ls /home/velo/scripts/vllm/benchmarks/results_*.json
```

**Manual Commands:**
```bash
ssh velo@100.96.203.105

# Run benchmark manually
/home/velo/scripts/vllm/benchmark.sh

# Check service status
echo 'velo2026' | sudo -S systemctl status vllm-qwen.service

# View logs
tail -f /var/log/vllm-benchmark.log
tail -f /var/log/vllm-maintenance.log

# Restart VLM
/home/velo/scripts/vllm/startup.sh
```

### VLM Troubleshooting

**Service not starting:**
```bash
# Check GPU memory
nvidia-smi

# Check logs
echo 'velo2026' | sudo -S journalctl -u vllm-qwen.service -n 50

# Clean restart
/home/velo/scripts/vllm/startup.sh
```

**Token limit errors (400 response):**
- Image too large - resize before sending
- Error: "decoder prompt is longer than maximum model length"
- Solution: Resize to max 1024x768

**Benchmark failures:**
- Check `/var/log/vllm-benchmark.log`
- Verify test images exist in `/home/velo/scripts/vllm/benchmarks/test-images/`
- Run manually: `/home/velo/scripts/vllm/benchmark.sh`

## QField Sync (OES to QFieldCloud)

**Status:** ✅ PRODUCTION - OES data syncs to QFieldCloud for mobile viewing
**Last Updated:** Jan 2026 - Race condition fix applied

### Quick Reference
- **Webhook:** `http://100.96.203.105:8095`
- **Trigger:** Auto via OES Import UI, or manual
- **Script:** `/opt/qfield-sync/sync_oes_db_to_qfield.py`
- **Logs:** `/var/log/qfield-oes-sync.log`
- **Data Source:** `v_qfield_oes_activations` view
- **Skill:** `/Qfield` - Full management commands

### Available Projects

| Project | UUID | UPLOAD_QGS | Notes |
|---------|------|------------|-------|
| **OES_Project_Progress** | `ad3b1035-ddb3-42a3-8077-175f9400b38a` | `false` | **PRODUCTION** - Has existing .qgs |
| FibreFlow_OES_Automations | `067b51c8-6e96-4e0c-9462-d4890763758b` | `true` | Test project |
| Test_Project__Automations | `e849b878-f8a8-4f84-a3f1-9fbd051686c0` | N/A | Has .qgs conflicts - DO NOT USE |

**Collaborators (OES_Project_Progress):** Hein
**Note:** Projects with existing `.qgs` must use `UPLOAD_QGS=false` in systemd service

### How It Works
1. **OES Import** at `/activate` → OES Import tab
2. **import-oes.ts** inserts data + calls webhook (fire-and-forget)
3. **Webhook** runs sync script on Velocity server
4. **Script** queries Neon DB → creates GeoPackage → uploads via SDK
5. **CRITICAL:** 10-second waits between uploads to avoid race conditions
6. **QFieldCloud** triggers `process_projectfile` + `package` jobs
7. **QField app** syncs to see data on mobile

### Commands
```bash
# Check status
ssh velo@100.96.203.105 "curl -s http://localhost:8095/status"

# Manual sync trigger
ssh velo@100.96.203.105 "curl -s -X POST http://localhost:8095/sync/oes \
  -H 'Content-Type: application/json' -d '{\"batchId\": \"manual\"}'"

# View logs
ssh velo@100.96.203.105 "tail -30 /var/log/qfield-oes-sync.log"

# Change target project (edit script)
ssh velo@100.96.203.105 "nano /opt/qfield-sync/sync_oes_db_to_qfield.py"
# Update QFIELD_PROJECT_ID variable
```

### Troubleshooting
- **Sync not triggering:** Check webhook health at `:8095/health`
- **Package not updating:** Check `data_last_packaged_at` via API
- **Layer `is_valid: False`:** Race condition - ensure 10s waits between uploads
- **Data not visible:** Verify gpkg filename matches QGIS project layer reference
- **Full guide:** Run `/Qfield` skill for detailed troubleshooting

## Arcjet Security

API protection with rate limiting and bot detection:
- **Location:** `src/lib/arcjet.ts`
- **Levels:** ajStrict (30/min), aj (100/min), ajGenerous (300/min)

```typescript
import { withArcjetProtection, aj } from '@/lib/arcjet';
export default withArcjetProtection(handler, aj);
```

## Deployment Architecture

### 🚀 Velocity Server (New Infrastructure)
**Server Access (Updated Jan 2026):**
```bash
# Primary access (use velo user)
ssh velo@100.96.203.105     # via Tailscale (recommended)
ssh velo@192.168.1.150      # via LAN (same network)
# Password: velo2026

# Legacy access (louis user - deprecated)
ssh louis@100.96.203.105
# Password: VeloAdmin2025!
```

**Server Specs:**
- **GPU:** NVIDIA RTX 5090
- **RAM:** 128GB
- **Storage:** 500GB SSD
- **OS:** Ubuntu Server
- **Tailnet:** velof2025.github

### Three Environment Setup

> **Full infrastructure details:** `docs/INFRASTRUCTURE.md`

**IMPORTANT:** All three environments share the **same production database** (Neon PostgreSQL).

| Environment | URL | Port | Directory | Service |
|-------------|-----|------|-----------|---------|
| **Production** | app.fibreflow.app | 3000 | `/home/velo/fibreflow-production` | `fibreflow-production.service` |
| **Staging** | vf.fibreflow.app | 3006 | `/home/louis/apps/fibreflow` | `fibreflow.service` |
| **Dev** | localhost:3005 | 3005 | `/home/velo/fibreflow` | manual |

### Deployment Workflow
1. **Local:** Develop on feature branch
2. **Staging:** Push to master → Deploy to vf.fibreflow.app (test)
3. **Production:** After staging verified → Deploy to app.fibreflow.app

### Deployment Commands (Updated Jan 2026)

**Deploy to STAGING (vf.fibreflow.app):**
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 \
  "echo 'velo2026' | sudo -S bash -c 'cd /home/louis/apps/fibreflow && chown -R louis:louis .git && su louis -c \"git pull origin master && npm run build\"' && sudo systemctl restart fibreflow.service"
```

**Deploy to PRODUCTION (app.fibreflow.app):**
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 \
  "cd /home/velo/fibreflow-production && git pull origin master && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"
```

### Server Quick Reference
```bash
ssh velo@100.96.203.105           # Connect to server

# Staging
echo 'velo2026' | sudo -S systemctl status fibreflow.service
echo 'velo2026' | sudo -S systemctl restart fibreflow.service
echo 'velo2026' | sudo -S journalctl -u fibreflow.service -f

# Production
echo 'velo2026' | sudo -S systemctl status fibreflow-production.service
echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service
echo 'velo2026' | sudo -S journalctl -u fibreflow-production.service -f
```

### Additional Services
| Service | Port | URL |
|---------|------|-----|
| **PDFCraft** | 3007 | https://vf.fibreflow.app/pdf-tools/ |
| **Portainer** | 9443 | https://100.96.203.105:9443 |
| **Grafana** | 3000 | http://100.96.203.105:3000 |
| **Ollama** | 11434 | http://100.96.203.105:11434 |
| **Qdrant** | 6333 | http://100.96.203.105:6333 |

### PDFCraft (PDF Tools)
**URL:** `https://vf.fibreflow.app/pdf-tools/`
- **Source:** `/home/hein/Workspace/PDFCraft`
- **Deployment:** `/home/velo/pdfcraft/out/` (static export)
- **Service:** `pdfcraft.service` on port 3007
- **Nginx:** Proxied at `/pdf-tools/` in `/etc/nginx/sites-available/vf-fibreflow`
- **Config:** `basePath: '/pdf-tools'` in next.config.js

**Rebuild & Deploy:**
```bash
cd /home/hein/Workspace/PDFCraft
npm run build
tar czf - out | sshpass -p 'velo2026' ssh velo@100.96.203.105 "rm -rf /home/velo/pdfcraft/out && tar xzf - -C /home/velo/pdfcraft/"
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart pdfcraft"
```

### Rollback Process
```bash
ssh velo@100.96.203.105
cd /home/velo/fibreflow
git log --oneline -5
git reset --hard <commit-hash>
npm ci && npm run build
echo 'velo2026' | sudo -S systemctl restart fibreflow.service
```

### Staging Troubleshooting (vf.fibreflow.app)

**Full troubleshooting guide:** `.claude/skills/staging-deploy.md`

**Quick Fixes for Common Issues:**

| Issue | Symptom | Quick Fix |
|-------|---------|-----------|
| **DB Auth Failed** | 500 errors, "password authentication failed" | `sed -i 's/npg_aRNLhZc1G2CD/npg_MIUZXrg1tEY0/g' .env.production` |
| **Wrong Directory** | 404 on all routes | Fix `WorkingDirectory` in `/etc/systemd/system/fibreflow.service` |
| **Old Commit** | Missing features, reverted settings | `git reset --hard origin/master` |
| **Git Permission** | "Permission denied" on git ops | `chown -R louis:louis .git` |
| **VLM Extraction Failed** | "fetch failed" in Data Validation | Check `VLM_API_URL` and `NEXT_PUBLIC_APP_URL` in .env.production |
| **Cloudflared 502** | 502 via Cloudflare but nginx/app work locally | `sudo systemctl restart cloudflared-tunnel.service` |
| **Port 3006 In Use** | 500 errors, service keeps restarting | `sudo fuser -k 3006/tcp && sudo systemctl restart fibreflow.service` |

**Cloudflared 502 Diagnostic Path:**
1. Test via Cloudflare: `curl https://vf.fibreflow.app/api/activate/health-check` → 502
2. Test via nginx: `curl -H 'Host: vf.fibreflow.app' http://127.0.0.1:80/api/activate/health-check` → 200 ✅
3. Test via app: `curl http://localhost:3006/api/activate/health-check` → 200 ✅
4. If nginx and app work but Cloudflare fails → Restart cloudflared tunnel

**Staging Server Details:**
- **URL:** https://vf.fibreflow.app
- **Port:** 3006
- **Service:** `fibreflow.service`
- **Location:** `/home/louis/apps/fibreflow`
- **Correct DB Password:** `npg_MIUZXrg1tEY0`

**Required Environment Variables (.env.production):**
```bash
VLM_API_URL=http://localhost:8100          # Must use localhost, not Tailscale IP
NEXT_PUBLIC_APP_URL=http://localhost:3006  # For internal photo fetching (must match port)
```

**Quick Recovery:**
```bash
# Full reset and rebuild
sshpass -p 'velo2026' ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S bash -c 'chown -R louis:louis /home/louis/apps/fibreflow/.git && su louis -c \"cd /home/louis/apps/fibreflow && git fetch origin && git checkout -- . && git reset --hard origin/master && npm install && npm run build\"' && sudo systemctl restart fibreflow.service"
```

## Important Notes

- **Server**: Now hosted on Velocity Server (migrated from old VPS)
- **Migration Complete**: Next.js in production, React/Vite archived
- **Authentication**: PostgreSQL-based authentication (mock auth for development)
- **Database**: Direct SQL with Neon serverless client (no ORM)
- **Archive**: `../FF_React_Archive/` has old files for reference
- **Full Server Docs**: `~/VF/server/LOUIS_VELOCITY_SERVER_ACCESS.md`

### Page Development Logging
After changes, update `docs/page-logs/{page-name}.md` with:
- Timestamp (Month DD, YYYY - HH:MM AM/PM)
- Problem description
- Solution with file:line references
- Testing results

### AI Assistant Guidelines
1. Always work on feature branches
2. Deploy to dev.fibreflow.app first
3. Wait for user confirmation before production
4. Document changes in page logs
5. Use antihall validator for code verification
6. Prefer editing existing files over creating new ones

## 🚨 CRITICAL: Browser Automation

**ALWAYS use `claude-in-chrome` (mcp__claude-in-chrome__*) for browser automation.**

❌ **DO NOT USE:** `boss-ghost-mcp` or `chrome-devtools` MCP tools
✅ **USE:** `mcp__claude-in-chrome__*` tools

**Why:** Claude-in-chrome requires the Chrome extension and `claude --chrome` flag, providing better stability and user control.

**Workflow:**
1. User runs: `claude --chrome`
2. Use `mcp__claude-in-chrome__tabs_context_mcp` first to get tab context
3. Create new tab with `mcp__claude-in-chrome__tabs_create_mcp`
4. Use `mcp__claude-in-chrome__navigate`, `read_page`, `computer`, etc.

**Key tools:**
- `tabs_context_mcp` - Get/create tab context (REQUIRED FIRST)
- `navigate` - Go to URL
- `read_page` - Get accessibility tree
- `computer` - Click, type, screenshot
- `find` - Find elements by natural language
- `form_input` - Fill form fields

## GitHub Workflow

### Branch Naming
- `feature/<name>` - New features
- `fix/<name>` - Bug fixes
- `refactor/<name>` - Code improvements

### PR Standards
- Title: Conventional commits (feat:, fix:, refactor:)
- Description: What, Why, How
- Always link related issues
- Request review from team member

### Slash Commands
| Command | Description |
|---------|-------------|
| `/pr` | Create PR with FF standards |
| `/review <num>` | Review PR thoroughly |
| `/sync` | Morning status check |
| `/tdd spec <name>` | Create test specification |
| `/tdd validate` | Check TDD compliance |

### CLI Shortcuts (source scripts/gh-workflows.sh)
| Command | Description |
|---------|-------------|
| `ff-sync` | Morning status check |
| `ff-pr` | Create PR |
| `ff-review 123` | Quick review |
| `ff-merge 123` | Approve and merge |
| `ff-team` | See Louis's PRs |
| `ff-feature <name>` | Create feature branch |
| `ff-tdd-check` | Validate TDD compliance |

## TDD Enforcement

### Principle
> "No feature code without test specification first"

### Workflow: Spec → Test → Code
1. **Spec**: Create requirement document or GitHub issue
2. **Test Spec**: Create `tests/specs/<feature>.spec.md`
3. **Tests**: Generate failing tests from spec
4. **Implement**: Write code to make tests pass
5. **Refactor**: Improve code, keep tests green

### Test Structure
```
tests/
├── specs/              # Test specifications (BEFORE code)
│   └── _TEMPLATE.spec.md
├── unit/               # Unit tests
│   └── modules/<module>/
├── integration/        # Integration tests
│   └── api/
└── e2e/                # End-to-end tests
```

### TDD Commands
```bash
/tdd spec "feature-name"     # Create test spec from requirements
/tdd generate specs/x.md     # Generate test skeletons
/tdd validate                # Check compliance before PR
/tdd implement specs/x.md    # Full RED-GREEN-REFACTOR cycle
```

### Enforcement Levels
1. **Reminder**: Hook shows warning when editing src/ without tests
2. **PR Check**: CI validates test coverage
3. **Review**: `/review` checks for TDD compliance

### Exceptions (mark in commit)
```
fix: critical hotfix
[TDD-EXEMPT: Hotfix - tests to follow in #123]
```

## Protocols (PAI Integration)

### Zero Tolerance Quality
- No `console.log` - use `log` from `@/lib/logger`
- No empty catch blocks
- 100% type coverage
- Max 300 lines per file

### NLNH (No Lies, No Hallucinations)
- Say "I don't know" when uncertain
- Use confidence levels: HIGH/MEDIUM/LOW
- Mark code status: `// WORKING:`, `// PARTIAL:`, `// UNTESTED:`

### DGTS (Don't Game The System)
- No fake tests (`expect(true).toBe(true)`)
- No mocked implementations pretending to be real
- Tests must actually test behavior