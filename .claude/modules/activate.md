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

## Recent Changes (Jan 2026)
- **DR Acknowledgment Race Condition Fix** (2026-01-30) - Three code paths in process-new-dr.ts: idempotency guard (<60s), first WA submission (no WA context), genuine resubmission (has WA context). See learnings.md.
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
| `photo/[...path].ts` | ✅ YES - photo serving (proxy) |

**Manual Refresh:**
```bash
POST /api/activate/refresh?dropNumber=DR1234567
```
