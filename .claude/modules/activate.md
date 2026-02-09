# Activate Module

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Unified DR photo review with VLM AI categorization and 5-phase QA Wizard |
| **Status** | Production |
| **Complexity** | High |
| **Category** | monitoring |
| **VLM** | Qwen3-VL-8B-Instruct on 100.96.203.105:8100 |

## Key Features
- **5-Phase QA Wizard**: Prerequisites → Photo Review → Data Validation → Final Decision → Feedback
- **AI Categorization**: VLM categorizes photos to 10-step checklist
- **Data Extraction**: VLM extracts power meter dBm, ONT serials, DR numbers
- **8 Report Types**: Trends, Funnel, Team, Serial Validation, etc.
- **WhatsApp Integration**: Threaded acknowledgments + QA feedback
- **HITL Learning**: Human corrections stored for few-shot prompting

## Directory Structure
```
src/modules/activate/
├── components/
│   ├── QaCentrePage.tsx            # Main QA Centre page
│   ├── ActivateReviewPage.tsx      # DR review page
│   ├── ReportsTab.tsx              # Reporting dashboard
│   ├── ImportProgressOverlay.tsx   # Import progress UI
│   └── wizard/
│       ├── QaWizardContainer.tsx   # 5-phase wizard container
│       ├── PrerequisitePhase.tsx   # Phase 1
│       ├── PhotoReviewPhase.tsx    # Phase 2
│       ├── DataValidationPhase.tsx # Phase 3
│       ├── FinalDecisionPhase.tsx  # Phase 4
│       ├── FeedbackPhase.tsx       # Phase 5
│       └── WizardProgressOverlay.tsx # Progress UI
├── context/
│   └── ActivateDataContext.tsx     # Data management context
├── services/
│   ├── activateDataService.ts      # Core data operations
│   ├── vlmExtractionService.ts     # VLM integration
│   ├── qaAutoFailService.ts        # Auto-fail detection
│   ├── photoFetchService.ts        # OneMap photo fetching
│   └── reportingService.ts         # Report generation
└── types/
    └── unified.types.ts            # TypeScript definitions
```

## Database Tables
| Table | Purpose |
|-------|---------|
| `dr_photo_unified_reviews` | Main review table with QA wizard fields |
| `dr_activity_log` | Event tracking for full lifecycle |
| `qa_review_history` | Historic QA reviews (Excel imports) |
| `qa_correction_examples` | Human corrections for few-shot learning |
| `oes_activations` | OES activation data |
| `qa_photo_reviews` | WhatsApp submissions (source) |

## 5-Phase QA Wizard
| Phase | Name | Purpose |
|-------|------|---------|
| 1 | Prerequisites | Validate photos, categorization, step coverage |
| 2 | Photo Review | Review and approve photo assignments |
| 3 | Data Validation | Validate power (-18 to -24 dBm), serial matches |
| 4 | Final Decision | PASS / FAIL / REWORK_NEEDED with reason codes |
| 5 | Feedback | Generate and send WhatsApp feedback |

## 10-Step Photo Checklist
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

## API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/drops` | GET | Paginated DR list with stats |
| `/api/activate/summary` | GET | DR summary for detail view |
| `/api/activate/fetch-photos` | POST | Fetch from OneMap/BOSS |
| `/api/activate/categorize-photos` | POST | VLM categorization |
| `/api/activate/extract-data` | POST | VLM data extraction |
| `/api/activate/validate-prerequisites` | POST | Phase 1 validation |
| `/api/activate/human-review` | POST | Human corrections |
| `/api/activate/final-decision` | POST | Phase 4 decision |
| `/api/activate/send-feedback` | POST | WhatsApp feedback |
| `/api/activate/dr-acknowledgment` | POST | First WA response |
| `/api/activate/reporting/*` | GET | 8 report endpoints |
| `/api/activate/refresh` | POST | Manual data refresh from BOSS API |
| `/api/activate/health-check` | GET | 5-service health |

## Serial Tracking & Swap Detection

### Serial Data Sources
| Column | Source | Meaning |
|--------|--------|---------|
| `ont_serial_scanned` | 1Map / WA photos | Physical scan at install (NEVER overwrite with OES) |
| `oes_serial` | OES Nokia import | Active on network (SOURCE OF TRUTH) |
| `vlm_ont_serial_step6/9` | VLM AI | Extracted from photos (supplementary) |

### Device Patterns
| Device | Pattern | Example |
|--------|---------|---------|
| Nokia ONT | `ALCL*` or `ALCB*` | `ALCLB48CC3CA` |
| Gizzu UPS | `GU18W*` | `GU18W12V2508057584` |

### OES Import Swap Detection (2026-01-29)
OES import (`import-oes.ts` Step 7) always updates `oes_serial` and detects:
- **OES_SERIAL_CHANGED**: OES serial differs from previous import (ONT replacement on network)
- **SERIAL_MISMATCH_DETECTED**: OES serial differs from `ont_serial_scanned` (swap or scan error)

Sets `serial_swap_detected`, `serial_swap_detected_at`, `serial_swap_details` on DR record.
All events logged to `dr_activity_log` for forensic searching.

**Flow**: 1Map scan → OES import detects mismatch → Activity log → QA Wizard Phase 4 warning

**Deep reference:** `.claude/knowledge-base/activate/serial-audit-tracking.md`

## Pages
| Page | Path | Purpose |
|------|------|---------|
| Dashboard | `/activate` | DR Summary landing tab |
| QA Centre | `/activate/qa-centre` | DR list with filters |
| Review | `/activate/[dropNumber]` | 5-phase wizard |
| Monitoring | `/activate/monitoring` | Service health |

## Progress Overlays
Visual feedback for async operations:
- **ImportProgressOverlay**: OES/ARCH Excel imports
- **WizardProgressOverlay**: 1Map sync + AI categorization

## Enhanced Barcode Service (2026-01-28)

Server-side barcode scanning with 2D support for Nokia ONT labels.

**Libraries:**
- `zxing-wasm` - 2D barcodes (Data Matrix, QR codes)
- `Quagga2` - 1D barcode fallback (Code 128, Code 39)

**Supported Formats:**
| Format | Type | Use Case |
|--------|------|----------|
| DATA_MATRIX | 2D | Nokia ONT labels (primary) |
| CODE_128 | 1D | ONT serial below Data Matrix |
| QR_CODE | 2D | Future equipment labels |

**Usage:**
```typescript
import { extractOntSerialEnhanced } from './enhancedBarcodeService';

const result = await extractOntSerialEnhanced(base64Image);
// { success: true, serial: 'ALCLB48AD090', format: 'DATA_MATRIX', confidence: 0.95 }
```

**Performance:**
- Quick scan: ~150-250ms (usually sufficient)
- Full multi-pass: ~1.5-2.5s (14 preprocessing strategies)

**Files:**
- `src/modules/activate/services/enhancedBarcodeService.ts`
- `src/modules/activate/services/barcodeExtractionService.ts`

## Technician Directory & Performance (Feb 2026)

### Overview
Technicians are field workers who either submit DR photos (activators) or perform installations (installers). They are stored in `wa_contacts` with `role` = 'activator' or 'installer'.

### Data Sources by Role
| Role | Primary Table | Identifier | Quality Source |
|------|---------------|------------|----------------|
| **Activator** | `qa_photo_reviews` | `user_name` (phone) | `dr_photo_unified_reviews` |
| **Installer** | `drops` | `installed_by_name` | `dr_photo_unified_reviews` |

### Activator Metrics
| Metric | Source | Formula |
|--------|--------|---------|
| Total Submissions | `qa_photo_reviews` | `COUNT(DISTINCT drop_number)` |
| First Pass Rate | `submission_count = 1` | `first_pass / total * 100` |
| Serial Compliance | `ont_serial_scanned IS NOT NULL` | `ont_scanned / total * 100` |
| Resubmission Rate | `submission_count > 1` | `resubmissions / total * 100` |

### Installer Metrics
| Metric | Source | Formula |
|--------|--------|---------|
| Total Installations | `drops` | `COUNT(DISTINCT drop_number)` |
| QA Pass Rate | `qa_decision = 'PASS'` | `passed / total * 100` |
| Rework Rate | `qa_decision = 'REWORK_NEEDED'` | `rework / total * 100` |
| Steps Compliance | 10-step checklist | `AVG(steps_passed) / 10 * 100` |
| Signal Quality | `vlm_power_meter_dbm` | `AVG(dbm)`, valid range: -18 to -24 |
| Signal In Range | `dbm BETWEEN -24 AND -18` | `in_range / total * 100` |

### 10-Step Checklist Columns
```sql
step_01_house_photo, step_02_cable_from_pole, step_03_entry_outside,
step_04_entry_inside, step_05_wall, step_06_ont_back,
step_07_power_meter, step_08_final_installation, step_09_green_lights,
step_10_signature
```

### API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/api/technicians` | GET paginated list with summary stats |
| `/api/technicians/[id]` | GET technician details |
| `/api/technicians/[id]/performance` | GET performance metrics with date range |

### Pages
| Page | Path | Purpose |
|------|------|---------|
| Directory | `/activate/technicians` | Technician list with filters |
| Detail | `/activate/technicians/[id]` | Performance dashboard with Recent DRs |

### Recent DRs Feature
Both activator and installer detail pages show a "Recent DRs" table with:
- DR Number, Project, Date, QA Status
- Activators: Submissions count column (green=1, orange>1)
- "View DR" link to `/activate/qa-centre/[dropNumber]`

### Time Range Filters
Preset options: 7D, 30D, 90D, All, Custom (date pickers)

### Files
```
pages/activate/technicians/index.tsx    # Directory page
pages/activate/technicians/[id].tsx     # Detail page with performance
pages/api/technicians/index.ts          # List API
pages/api/technicians/[id]/index.ts     # Detail API
pages/api/technicians/[id]/performance.ts # Performance metrics API
src/types/technician.types.ts           # TypeScript types
```

## UPS Serial Data Gap Analysis (Feb 2026)

### Data Flow
UPS serials (`GU18W*` Gizzu) exist in multiple locations:
| Location | Column | Source |
|----------|--------|--------|
| `dr_photo_unified_reviews` | `ups_serial_scanned` | Activation wizard scan |
| `onemap_properties` | `ups_serial` | Local cache (stale!) |
| 1Map API | `br_ser` | Live GIS system |
| `wa_photos` | `vlm_ups_serial` | VLM extraction from WA photos |
| `drops` | `mini_ups_serial` | SOW stock tracking |

### Key Finding: `onemap_properties` is NOT reliable
The local `onemap_properties` table is a **stale cache** (last synced ~Jan 2026). It does NOT reflect live 1Map data. Always query the 1Map API directly via `oneMapApiService.searchDR()` to check `br_ser` values.

### Coverage (30-day snapshot, Feb 2026)
| System | Coverage | Notes |
|--------|----------|-------|
| **FibreFlow** (`ups_serial_scanned`) | ~88% | From activation wizard |
| **1Map** (`br_ser`) | ~88% | Populated during activation |
| **WA Photos** (`vlm_ups_serial`) | ~2% | Technicians rarely send step 9 |

### Gap Sources
- **Truly missing**: Technicians not scanning UPS during activation (~265 DRs/month)
- **Step 9 never submitted**: 0 of 283 missing DRs had WA UPS photo
- **VLM fallback**: Only 11 DRs recoverable from WA photo VLM extraction

### Backfill Procedure
```bash
# 1. Pull from 1Map live API (oneMapApiService.searchDR → br_ser)
# 2. Pull from wa_photos VLM (vlm_ups_serial where confidence > 0.65)
# 3. Update dr_photo_unified_reviews.ups_serial_scanned
```

### Multi-Property DRs
Some DRs have multiple `prop_id` entries in 1Map. When checking `br_ser`:
- Query ALL properties for the DR: `records.find(r => r.br_ser && r.br_ser.trim() !== '')`
- One prop may have `br_ser` while others are empty — this is normal

## Recent Changes (Feb 2026)
- **UPS Backfill from 1Map** (2026-02-08) - Systematic check of 283 DRs missing UPS. Filled 7 from 1Map API + 11 from WA photo VLM data. 265 truly missing (never captured).
- **Technician Recent DRs** (2026-02-07) - Added Recent DRs list to activator/installer detail pages with "View DR" links to QA Centre. Activators show submission count column, installers show QA decision status.
- **Installer Signal Quality** (2026-02-07) - Added dB signal quality metrics (avg dBm, % in valid range -18 to -24) for installers using `vlm_power_meter_dbm` from unified reviews.
- **Time Range Filters** (2026-02-07) - Added 7D/30D/90D/All/Custom date range filters to technician detail pages.
- **Navigation Tab Fix** (2026-02-07) - Fixed tab highlighting for nested routes by sorting tabs by path length (longest first) before matching.
- **Zone/PON Stats Alignment** (2026-02-05) - Fixed zone/PON totals not matching project totals. Root cause: `drops.ts` and `reportingService.ts` used different date filters and missing `is_oes_only` filter. Fix: aligned `getDailyCountsWithBreakdown()` to use `submitted_date` (no COALESCE) and added `is_oes_only` filter. **CRITICAL**: Multiple APIs showing same data MUST use identical query logic.

## Recent Changes (Jan 2026)
- **Typo DR Filtering** (2026-01-30) - `drops.ts` filters out invalid/typo DRs using `EXISTS (SELECT 1 FROM drops d WHERE d.drop_number = u.drop_number)` in **4 query locations**: `getPaginatedDrops`, `calculateSummary`, `getProjectStats`, `processOrphanedRecordsInBackground`. The `drops` table (SOW imports) is the canonical source of valid DRs. All 4 must stay in sync.
- **Self-Healing Photo Fetch** (2026-01-30) - `processOrphanedRecordsInBackground()` in `drops.ts` detects orphaned DRs (photo_count=0, no wa_message_id, <48h old, in drops table) and fetches photos from BOSS API on each page load (max 5). Fixes Go Bridge dropping ~20% of `process-new-dr` calls.
- **DR Acknowledgment Race Condition Fix** (2026-01-30) - Three code paths in process-new-dr.ts: idempotency guard (<60s), first WA submission (no WA context), genuine resubmission (has WA context). Post-deploy straggler DR1735961 required manual backfill (processed during deployment window). After deploying race condition fixes, always check for DRs processed in the deployment window. See KB: `dr-acknowledgment-race-condition.md`.
- **LATERAL JOIN Fix** (2026-01-30) - drops.ts uses `LEFT JOIN LATERAL ... LIMIT 1` for `drops` and `maintenance_tickets` to prevent row multiplication. `oes_activations` safe with regular JOIN.
- **Serial Audit System** (2026-01-29) - Comprehensive backfill from 1Map, OES swap detection, activity logging
- **Enhanced Barcode Service** - zxing-wasm 2D barcode support for Nokia ONT labels
- Added progress overlays for visual feedback
- Enhanced VLM extraction with blur detection
- Integrated NAFNet deblurring service
- Added draft state support for QA Wizard
- Improved serial swap detection with auto-ticketing
- **UNIFIED ARCHITECTURE** - All data from database, no live API calls on page views

## UNIFIED ARCHITECTURE (Critical)

**Principle**: ALL DR data stored in `dr_photo_unified_reviews` during processing. Page views read from database ONLY.

**Data Sources (stored during `process-new-dr.ts`):**
- Photos metadata, serials, QA status
- Subscriber contact (subscriber_name, subscriber_phone, subscriber_email)
- QContact info (qcontact_name, qcontact_phone)
- Installer/signup agent info
- Project name (from drops table via `expectedProject`)
- Sender phone (from wa_monitor_drops)

**process-new-dr.ts — Three Code Paths for Existing Records:**
| Path | Condition | Action |
|------|-----------|--------|
| Idempotency guard | Record < 60s old | Update fields, keep count |
| First WA submission | No `wa_message_id` / `wa_received_at` | Update fields, keep count |
| Genuine resubmission | Has WA context | Increment count, save snapshot |

**Multiple Record Creators (all must handle pre-existing records):**
- `process-new-dr.ts` (WA submission)
- `dr-acknowledgment.ts` (Go Bridge)
- `ensure-data.ts` (QA Wizard open)
- `import-oes.ts` (OES Excel import)
- `drops.ts:syncMissingFromQaPhotoReviews()` (legacy backfill)

**BOSS API (port 8003) Usage:**
| When | Allowed? |
|------|----------|
| Page view / data display | ❌ NO - use unified table |
| `process-new-dr.ts` | ✅ YES - initial processing |
| `ensure-data.ts` | ✅ YES - once when opening QA Wizard |
| `dr-acknowledgment.ts` | ✅ YES - DR submission (before record exists) |
| `refresh.ts` POST | ✅ YES - user-initiated manual refresh |
| `processOrphanedRecordsInBackground()` | ✅ YES - self-healing for orphaned DRs |

**Typo DR Filtering (CRITICAL — 4 locations must stay in sync):**
All queries that count or list DRs for the QA Centre MUST include:
```sql
EXISTS (SELECT 1 FROM drops d WHERE d.drop_number = u.drop_number)
```
Locations in `pages/api/activate/drops.ts`:
1. `getPaginatedDrops()` base conditions
2. `calculateSummary()` installed count
3. `getProjectStats()` per-project counts
4. `processOrphanedRecordsInBackground()` orphan detection

**Query Alignment (CRITICAL — drops.ts ↔ reportingService.ts):**
The zone/PON breakdown (`reportingService.getDailyCountsWithBreakdown`) MUST match `drops.ts` `getProjectStats`:
| Filter | Required Value |
|--------|----------------|
| Date field | `submitted_date` (NOT `COALESCE(submitted_date, created_at)`) |
| OES filter | `(is_oes_only = FALSE OR is_oes_only IS NULL)` |
| Valid DRs | `INNER JOIN drops` or `EXISTS (SELECT 1 FROM drops)` |
| Project | Use `COALESCE(upr.project, p.project_name)` for OES-only records |

**Self-Healing Pipeline:**
`processOrphanedRecordsInBackground()` runs on each page load (fire-and-forget):
- Detects: `photo_count=0 AND wa_message_id IS NULL AND created_at > NOW()-48h AND EXISTS in drops`
- Fetches photos from BOSS API, triggers VLM categorization
- Max 5 per load to avoid blocking
- Fixes Go Bridge dropping ~20% of `process-new-dr` calls
| `photo/[...path].ts` | ✅ YES - photo serving (proxy) |

**Manual Refresh:**
```bash
POST /api/activate/refresh?dropNumber=DR1234567
```
