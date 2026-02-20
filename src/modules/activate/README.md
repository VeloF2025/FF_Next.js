# Activate Module (DR Photo Unified)

**Status:** PRODUCTION - VLM-powered photo categorization with 5-phase QA Wizard

## Overview

Unified system for DR (Drop Receipt) photo review with:
- AI-powered categorization using Qwen3 VLM
- 5-phase QA Wizard workflow
- WhatsApp integration for acknowledgments and feedback
- Comprehensive reporting and analytics
- HITL (Human-in-the-Loop) few-shot learning

## Quick Reference

| Setting | Value |
|---------|-------|
| **Dashboard URL** | `/activate` |
| **QA Centre** | `/activate/qa-centre` |
| **Monitoring** | `/activate/monitoring` |
| **API Prefix** | `/api/activate/*` |
| **Main Table** | `dr_photo_unified_reviews` |
| **VLM Server** | `http://100.96.203.105:8100` (Qwen3) |
| **WA Feedback** | `http://100.96.203.105:8092` |

## Tab-Based UI

| Tab | Purpose |
|-----|---------|
| **DR Summary** | Landing page - Project stats with Zone/PON drill-down |
| **QA Centre** | DR list for review with filters and pagination |
| **Reports** | 10 report types (Anomalies, Trends, Team Performance, QA Funnel, Offline Devices, Serial Swaps, Serial Mismatches, Installation Gaps, Activation Progress, Maturity Tracking) |
| **Data Import** | Import OES/ARCH Excel activation reports |
| **Manual Entry** | Add DRs manually |

## 5-Phase QA Wizard

When reviewing a DR (`/activate/[dropNumber]`), users go through:

| Phase | Name | Purpose |
|-------|------|---------|
| 1 | Prerequisites | Validate photos fetched, categorized, step coverage |
| 2 | Photo Review | Review photo categorizations (edit mode shows discarded photos) |
| 3 | Data Validation | Validate power meter, serial numbers |
| 4 | Final Decision | PASS / FAIL / REWORK with swap detection + auto-ticket |
| 5 | Feedback | Send WhatsApp feedback (technician-actionable issues only) |

### QA Decision Values
- `PASS` - All checks passed
- `FAIL` - Critical issues found
- `REWORK_NEEDED` - Minor issues, needs rework

### Fail Reason Codes
- `MISSING_PHOTOS` - Required photos missing
- `SERIAL_MISMATCH` - ONT serial doesn't match OES
- `POWER_OUT_OF_RANGE` - Power meter not in -18 to -24 dBm
- `PHOTO_QUALITY` - Photos too blurry/dark
- `WRONG_EQUIPMENT` - Wrong ONT/UPS installed
- `SERIALS_SWAPPED` - ONT and UPS serials in wrong fields

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
   - Go Bridge sends warning in threaded reply

2. **QA Wizard Phase 4** - Prominent "🔴 SERIALS SWAPPED" warning
   - Shows which serial is in which field
   - Explains correct format for each device

3. **Auto-Ticket Creation** - Creates ticket on submit
   - `source: 'ont_swap'`
   - `ticket_type: 'ont_swap'`
   - `priority: 'high'`

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
// Returns: TechnicianIssue[] with actionable items
```

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

## 10-Step Photo Checklist

| Step | Label | OneMap Types | Description |
|------|-------|--------------|-------------|
| 1 | House Photo | `ph_prop` | Property exterior |
| 2 | Cable from Pole | `ph_pole`, `ph_outs` | Aerial fiber drop |
| 3 | Entry Outside | `ph_entry_out`, `ph_hm_ln` | Cable entry point (exterior) |
| 4 | Entry Inside | `ph_entry_in`, `ph_hm_en` | Cable entry point (interior) |
| 5 | Wall | `ph_wall` | Wall mounting location |
| 6 | ONT Back | `ph_ont`, `ph_drop`, `ph_cbl_r`, `ph_bl` | Back panel connections |
| 7 | Power Meter | `ph_powm`, `ph_powm1`, `ph_powm2` | dBm reading display |
| 8 | Final Installation | `ph_after`, `ph_final` | Complete setup overview |
| 9 | Green Lights | `ph_lights`, `ph_led` | Active indicator lights |
| 10 | Signature | `ph_sign1`, `ph_sign2`, `ph_signature` | Customer signature |

**Note:** Steps 11 & 12 are scanned barcodes (ONT/UPS serial), not photos.

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

### QA Workflow

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/validate-prerequisites` | POST | Phase 1 validation |
| `/api/activate/extract-data` | POST | VLM data extraction (power, serials) |
| `/api/activate/validate-qa` | POST | Separate QA validation |
| `/api/activate/human-review` | POST | Human QA with corrections |
| `/api/activate/final-decision` | POST | Phase 4 final decision |
| `/api/activate/approve-categorization` | POST | Approve AI results |

### WhatsApp Integration

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/dr-acknowledgment` | POST | Get ack data for Go Bridge reply |
| `/api/activate/process-new-dr` | POST | Process new DR from WhatsApp |
| `/api/activate/send-feedback` | POST | Send WhatsApp feedback message |

### Reporting

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

## Trend Reports (Jan 2026)

The Trends report provides installation and activation velocity analysis with interactive toggles.

### Series Visibility Toggles

Users can show/hide individual metrics on the line chart:

| Series | Color | Hex Code | Compared With |
|--------|-------|----------|---------------|
| **Installed** | Blue | `#3B82F6` | Activated |
| **Activated** | Cyan | `#06B6D4` | Installed |
| **Reviewed** | Green | `#10B981` | Not Reviewed |
| **Not Reviewed** | Red | `#EF4444` | Reviewed |

**Color rationale:** Paired series (Installed/Activated and Reviewed/Not Reviewed) use contrasting colors for easy visual comparison.

### Project Visibility Toggles

When viewing "All Projects", users can toggle individual projects on/off:

| Project | Color | Hex Code |
|---------|-------|----------|
| Lawley | Blue | `#3B82F6` |
| Mohadin | Purple | `#8B5CF6` |
| Mamelodi | Green | `#10B981` |

**Excluded from toggles:** Test projects (Velo Test, test project) and Marketing Activations are automatically filtered out.

### Charts

1. **Installation & Activation Trends** (Line Chart)
   - Shows all 4 metrics over time
   - Project toggles filter which projects contribute to totals
   - Optional daily target reference line

2. **Daily Volume Distribution by Project** (Bar Chart)
   - Shows each project as a separate bar
   - Displays whichever metric is first selected in series toggles
   - Subtitle shows which metric is displayed (e.g., "Showing: Installed")

### API Response

`/api/activate/reporting/trends` returns per-project breakdown:

```typescript
interface TrendDataPoint {
  label: string;           // Date label
  installed: number;       // Total installed
  activated: number;       // Total activated
  reviewed: number;        // Total reviewed
  notReviewed: number;     // Total not reviewed
  by_project?: Record<string, {  // Per-project breakdown
    installed: number;
    activated: number;
    reviewed: number;
    notReviewed: number;
  }>;
}

interface TrendAnalysisResponse {
  data: TrendDataPoint[];
  velocity: { ... };
  available_projects: string[];  // For toggle UI
}
```

### System

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/health-check` | GET | 5-service health status |
| `/api/activate/activity-log` | GET | DR lifecycle events |
| `/api/activate/admin/retry-failed` | GET/POST | Manage retry queue |
| `/api/activate/import-oes` | POST | Import OES Excel |

## Database Tables

### Project Mapping (Source of Truth)

The `project` field in `dr_photo_unified_reviews` is determined by looking up the DR in the **`drops` table** (from SOW imports) joined with `projects`:

```sql
SELECT p.project_name FROM drops d
JOIN projects p ON d.project_id = p.id
WHERE d.drop_number = $1
```

- **WA submissions:** `process-new-dr.ts` validates and sets project from drops table
- **OES imports:** `import-oes.ts` looks up project before inserting (Jan 2026 fix)
- **Unknown DRs:** DRs not in drops table will have `project = null`

### `dr_photo_unified_reviews` (Main Table)

**Core Fields:**
- `id` (UUID), `drop_number`, `project`, `photo_source`, `photo_count`, `photos_metadata`

**Manual QA (10 steps):**
- `step_01_house_photo` through `step_10_signature` (boolean)
- `incorrect_steps` (text[]), `incorrect_comments` (JSONB)

**VLM Categorization:**
- `vlm_categorization_status` ('pending' | 'categorized' | 'approved')
- `vlm_categorization_results` (JSONB), `vlm_categorization_at`

**VLM QA Validation (Separate):**
- `vlm_qa_status` ('pending' | 'processing' | 'validated' | 'failed')
- `vlm_qa_results` (JSONB), `vlm_qa_validated_at`, `vlm_qa_summary`

**Human Review:**
- `human_qa_overrides` (JSONB), `human_review_status`, `human_review_completed_at`, `human_reviewer_id`

**QA Decision:**
- `qa_decision` ('PASS' | 'FAIL' | 'REWORK_NEEDED')
- `qa_decision_reasons` (JSONB), `qa_decision_at`, `qa_decision_by`, `qa_decision_notes`

**Data Extraction:**
- `vlm_power_meter_dbm`, `vlm_power_meter_status`
- `vlm_ont_serial_step6`, `vlm_ont_serial_step9`, `vlm_dr_number_step9`
- `serial_validation_status`, `serial_validation_details`
- `onemap_ont_serial`, `onemap_ups_serial`

**QA Phases:**
- `qa_phase` ('prerequisites' | 'photo_review' | 'data_validation' | 'final_decision' | 'feedback' | 'completed')
- `prerequisites_passed`, `prerequisites_checked_at`
- `photo_review_completed`, `photo_review_completed_at`
- `data_validation_completed`, `data_validation_completed_at`

**Lifecycle:**
- `whatsapp_submitted_at`, `acknowledged_at`, `photos_fetched_at`
- `feedback_sent`, `feedback_message`, `feedback_sent_at`

### `dr_activity_log`

Event tracking for full DR lifecycle:
- Event types: `whatsapp_submitted`, `acknowledged`, `photos_fetched`, `categorization_started/complete`, `qa_started/complete`, `human_review_started/complete`, `feedback_generated/sent`, `resubmission`
- Fields: `drop_number`, `event_type`, `event_data` (JSONB), `actor`, `created_at`

### `qa_correction_examples`

Human corrections for few-shot learning:
- `workflow_type` ('dr_photo' | 'civil_works' | 'optical_works')
- `vlm_predicted_step`, `vlm_predicted_category`, `vlm_confidence`
- `correct_step`, `correct_category`, `correction_reason`
- `is_canonical` (curated examples), `reviewed_count`

### Related Tables
- `qa_photo_reviews` - WhatsApp submissions (source data)
- `oes_activations` - OES report data (activation status)
- `drops` - SOW data (zone_no, pon_no for breakdown)

## Module Structure

```
src/modules/activate/
├── components/
│   ├── DrListPage.tsx              # Main page with tabs
│   ├── DrSummaryPage.tsx           # DR Summary landing tab
│   ├── QaCentrePage.tsx            # QA Centre tab
│   ├── UnifiedReviewCard.tsx       # DR card in list
│   ├── ManualDREntry.tsx           # Manual DR form
│   ├── OESImportTab.tsx            # OES import UI
│   ├── SystemHealthDashboard.tsx   # Health monitoring
│   ├── RolloutMonitoringDashboard.tsx
│   ├── PhotoGalleryUnified.tsx     # Photo display
│   ├── ReviewTab.tsx               # Manual review tab
│   ├── ActivityTab.tsx             # Activity log tab
│   ├── AICategorizationTab.tsx     # AI results display
│   ├── ComparisonTable.tsx         # Data comparison
│   ├── wizard/
│   │   ├── QaWizardContainer.tsx   # Wizard orchestrator
│   │   ├── PrerequisitesPhase.tsx  # Phase 1
│   │   ├── PhotoReviewPhase.tsx    # Phase 2
│   │   ├── DataValidationPhase.tsx # Phase 3
│   │   ├── FinalDecisionPhase.tsx  # Phase 4
│   │   ├── FeedbackPhase.tsx       # Phase 5
│   │   └── WizardProgressOverlay.tsx # Progress spinner for 1Map sync & AI categorization
│   ├── ImportProgressOverlay.tsx   # Progress spinner for OES/ARCH imports
│   └── reporting/
│       ├── ReportsDashboard.tsx    # Reports container
│       ├── ReportsTab.tsx          # Reports tab
│       ├── AnomalyReports.tsx      # WA-only/OES-only
│       ├── TrendReports.tsx        # Velocity trends
│       ├── FunnelReports.tsx       # Workflow funnel
│       ├── TeamReports.tsx         # Team leaderboard
│       └── shared/
│           ├── ReportCard.tsx
│           └── TrendChart.tsx
├── services/
│   ├── activateDataService.ts      # Main data fetching
│   ├── reportingService.ts         # Report queries
│   ├── unifiedDbService.ts         # DB operations
│   ├── unifiedVlmService.ts        # AI evaluation
│   ├── categorizationVlmService.ts # Photo categorization
│   ├── vlmExtractionService.ts     # Data extraction
│   ├── vlmQaValidationService.ts   # QA validation
│   ├── photoFetchService.ts        # Photo fetching
│   ├── unifiedPhotoService.ts      # Photo handling
│   ├── oneMapIntegrationService.ts # OneMap API
│   ├── activityLogService.ts       # Event logging
│   └── qaAutoFailService.ts        # Auto-fail rules
├── types/
│   ├── unified.types.ts            # Core types
│   ├── summary.types.ts            # Summary types
│   └── reporting.types.ts          # Report types
├── hooks/
│   ├── useUnifiedReview.ts         # Review data hook
│   └── useAutoRefresh.ts           # Auto-refresh hook
├── context/
│   └── ActivateDataContext.tsx     # Shared state
└── utils/
    └── stepMapper.ts               # Photo type mapping
```

## Progress Overlays (Jan 2026)

Visual feedback during async operations with animated step indicators.

### ImportProgressOverlay

Full-screen modal for OES/ARCH Excel imports in the Data Import tab.

**File:** `components/ImportProgressOverlay.tsx`

**Phases:**
| Phase | Icon | Message | Color |
|-------|------|---------|-------|
| `parsing` | FileText | "Parsing Excel file..." | Blue |
| `uploading` | Upload | "Uploading X records..." | Purple |
| `processing` | Database | "Processing records..." | Indigo |
| `syncing` | RefreshCw | "Syncing with database..." | Cyan |
| `complete` | CheckCircle | "Import complete!" | Green |

**Usage in OESImportTab/OfflineImportTab:**
```typescript
const [importPhase, setImportPhase] = useState<ImportPhase | null>(null);

// During import
setImportPhase('uploading');
// ... after API call
setImportPhase('processing');
setImportPhase('syncing');
setImportPhase('complete');
await new Promise(resolve => setTimeout(resolve, 800)); // Show success briefly
setImportPhase(null); // Hide overlay
```

### WizardProgressOverlay

Full-screen modal for QA Wizard async operations (1Map sync, AI categorization).

**File:** `components/wizard/WizardProgressOverlay.tsx`

**Operation Types:**

1. **`sync_1map`** - When loading DR data from 1Map
   | Phase | Icon | Message | Color |
   |-------|------|---------|-------|
   | `fetching` | MapPin | "Syncing from 1Map..." | Blue |
   | `loading_photos` | Camera | "Loading photos..." | Purple |
   | `checking` | Database | "Checking prerequisites..." | Indigo |
   | `complete` | CheckCircle | "Data loaded!" | Green |

2. **`categorization`** - When running AI photo categorization
   | Phase | Icon | Message | Color |
   |-------|------|---------|-------|
   | `analyzing` | Brain | "Analyzing photos with AI..." | Purple |
   | `processing` | Sparkles | "Categorizing photos..." | Indigo |
   | `saving` | Database | "Saving results..." | Blue |
   | `complete` | CheckCircle | "Categorization complete!" | Green |

**Usage in QaWizardContainer:**
```typescript
const [syncPhase, setSyncPhase] = useState<Sync1MapPhase | null>(null);

// During data loading
setSyncPhase('fetching');
// ... API calls
setSyncPhase('loading_photos');
setSyncPhase('checking');
setSyncPhase('complete');
await new Promise(resolve => setTimeout(resolve, 600));
setSyncPhase(null);
```

**Usage in PhotoReviewPhase:**
```typescript
const [categorizationPhase, setCategorizationPhase] = useState<CategorizationPhase | null>(null);

// During categorization
setCategorizationPhase('analyzing');
setTimeout(() => setCategorizationPhase('processing'), 800);
// ... API call
setCategorizationPhase('saving');
setCategorizationPhase('complete');
await new Promise(resolve => setTimeout(resolve, 600));
setCategorizationPhase(null);
```

### UI Features

Both overlays include:
- **Backdrop blur** - Semi-transparent dark background
- **Animated spinner** - Rotating ring around icon
- **Step progress** - Checkmarks for completed steps, spinner for active
- **Bouncing dots** - Three pulsing dots during processing
- **Drop context** - Shows DR number and photo count when applicable

## Services

### activateDataService
Main data fetching for DR list, stats, and pagination.

### reportingService
Database queries for all 8 report types.

### categorizationVlmService
VLM categorization with batch processing, confidence scoring, retry logic.

### vlmExtractionService
Data extraction: power meter dBm, ONT serials, DR numbers.

### vlmQaValidationService
Separate QA validation per photo against FiberTime spec.

### activityLogService
Event logging for full DR lifecycle tracking.

## Context & Hooks

### ActivateDataContext
- Shared state across all tabs
- Auto-refresh (30s interval, pauses when hidden)
- Filtering, pagination, loading states
- **Server-side search** - searches all records, not just current page

### QA Centre Filters
| Filter | Behavior |
|--------|----------|
| **Search** | Server-side ILIKE on `drop_number` and `project` |
| **Date Range** | Filters by `submitted_date` or `created_at` |
| **Status** | installed / activated / not_reviewed / reviewed |
| **Project** | Dropdown from active projects |

**Important:** Search is server-side (queries all 6000+ drops), not client-side pagination filtering.

### useUnifiedReview
- Fetch/update single DR
- Step updates, AI evaluation, feedback
- Lock/unlock for concurrency

## WhatsApp Integration

### Go Bridge (`/home/louis/whatsapp-bridge-go/`)
- Detects DR pattern in messages
- Calls `/api/activate/dr-acknowledgment` for photo/serial data
- Sends threaded reply with:
  - Photo count
  - ONT serial (or "Not scanned" warning)
  - UPS serial (or "Not scanned" warning)
  - **🔴 SWAPPED SERIALS alert** if ONT/UPS appear to be in wrong fields

### WA Feedback Service (Port 8092)
- Sends QA feedback messages
- Health: `curl http://100.96.203.105:8092/health`

### Group Mapping
| Project | Group JID |
|---------|-----------|
| Lawley | `120363418298130331@g.us` |
| Mohadin | `120363421532174586@g.us` |
| Velo Test | `120363421664266245@g.us` |
| Mamelodi | `120363408849234743@g.us` |

## Health Monitoring

5-service health check at `/api/activate/health-check`:

1. **Database** - Neon PostgreSQL connectivity
2. **OneMap** - Photo storage API (100.96.203.105:8003)
3. **VLM** - Qwen3 server (100.96.203.105:8100)
4. **WA Bridge** - Inferred from recent DR activity
5. **WA Feedback** - Sender service (100.96.203.105:8092)

## Troubleshooting

### VLM Not Responding
```bash
ssh velo@100.96.203.105  # Password: $VELO_SSH_PASSWORD
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status vllm-qwen.service
/home/velo/scripts/vllm/startup.sh  # Restart
```

### WA Bridge Issues
```bash
ssh velo@100.96.203.105
tail -f /home/louis/whatsapp-bridge-go/bridge.log
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service
```

### WA Feedback Not Sending
```bash
curl http://100.96.203.105:8092/health
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart wa-feedback
```

### Photos Not Categorizing
1. Check health dashboard: `/activate/monitoring`
2. Review failed queue: `/api/activate/admin/retry-failed`
3. Check `vlm_error` in database

### DRs Showing "Project: Unknown"
OES-only imports (activations without WhatsApp submission) may show "Unknown" project because OES uses team names, not projects.

**Fix:** Run the OES project mapping migration:
```bash
psql $DATABASE_URL -f scripts/migrations/087_oes_project_mapping.sql
```

**Team to Project Mapping:**
| Team Prefix | Project |
|-------------|---------|
| `law*` | Lawley |
| `moa*` / `moh*` | Mohadin |
| `mam*` | Mamelodi |
| `etw*` | Etwatwa |

**Note:** "Agent: Unknown" is expected for OES imports (no WhatsApp sender phone).

## Migrations

| Migration | Purpose |
|-----------|---------|
| `create-foto-ai-reviews-table.sql` | Legacy AI evaluation |
| `061_qa_review_history.sql` | Historical QA imports |
| `083_activity_log_and_qa_validation.sql` | Activity log + VLM QA separation |
| `084_qa_correction_examples.sql` | Few-shot learning |
| `085_qa_wizard_final_decision.sql` | 5-phase wizard support |
| `087_oes_project_mapping.sql` | Assign project to OES imports from team |

## Related Skills

- `/activate-reporting` - Reporting terminology and queries
- `/photo-categorization` - Canonical photo type mappings
- `/whatsapp` - Full WhatsApp infrastructure
- `/oes` - OES import operations
