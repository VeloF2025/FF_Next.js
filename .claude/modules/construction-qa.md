# Construction QA Module

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Pre-activation quality assurance for civil, optical, and splicing disciplines |
| **Status** | Production |
| **Complexity** | High |
| **Category** | quality |
| **VLM** | Qwen3-VL-8B-Instruct for photo validation |

## Key Features
- **QA Centre Dashboard**: Project-level QA status with zone/PON drill-down
- **5-Phase Review Wizard**: Prerequisites → Photo Review → Data Validation → Final Decision → Feedback
- **VLM Photo Validation**: AI validates construction photos against standards
- **QField Photo Ingestion**: Auto-ingest from QFieldCloud via webhook
- **OTDR Testing**: EXFO test result integration
- **PON Features Panel**: Track fibre features per PON
- **Batch Approve**: Bulk approval for passing PONs
- **Field Ops Reports**: Analytics with Recharts charts
- **Global Search**: Cross-project photo/PON search

## Directory Structure
```
src/modules/construction-qa/
├── components/
│   ├── ConstructionQaCentrePage.tsx  # Main QA centre
│   ├── OtdrTestingPage.tsx           # OTDR test results
│   ├── dashboard/
│   │   ├── FieldOpsDashboardPage.tsx # Field ops overview
│   │   ├── ProjectQaCard.tsx         # Project QA summary card
│   │   └── ProjectQaTable.tsx        # Project QA table view
│   ├── project/
│   │   ├── ProjectDetailPage.tsx     # Project drill-down
│   │   ├── PonRow.tsx                # PON-level row
│   │   ├── PonFeaturesPanel.tsx      # Feature tracking
│   │   └── ZoneAccordionHeader.tsx   # Zone grouping
│   ├── wizard/
│   │   ├── ReviewWizard.tsx          # 5-phase wizard container
│   │   ├── PhasePrerequisites.tsx    # Phase 1
│   │   ├── PhasePhotoReview.tsx      # Phase 2
│   │   ├── PhaseDataValidation.tsx   # Phase 3
│   │   ├── PhaseFinalDecision.tsx    # Phase 4
│   │   ├── PhaseFeedback.tsx         # Phase 5
│   │   └── PhotoLightbox.tsx         # Photo viewer
│   ├── reports/
│   │   └── FieldOpsReportsPage.tsx   # Analytics reports
│   └── shared/
│       └── GlobalSearchBar.tsx       # Cross-project search
├── services/
│   ├── qfieldIngestionService.ts     # QField photo pipeline
│   └── vlmConstructionService.ts     # VLM validation service
└── types/
    └── construction.types.ts         # Type definitions (1,103 lines)
```

## API Routes
```
pages/api/construction-qa/
├── batch-approve.ts        # Bulk PON approval
├── export.ts               # Excel export
├── features.ts             # PON feature CRUD
├── final-decision.ts       # QA decision endpoint
├── ingest-qfield.ts        # QField photo ingestion (cron)
├── photo-proxy.ts          # Photo proxy for VF Storage
├── photo-step.ts           # Photo step assignment
├── pon-features.ts         # PON feature queries
├── project-dashboard.ts    # Project QA dashboard data
└── push-qfield-comment.ts  # Push comments to QFieldCloud
```

## Database Tables
- `qa_photo_reviews` — Photo review records with VLM results
- `qa_pon_features` — PON-level feature tracking
- `construction_qa_decisions` — Final QA decisions
- `exfo_tests` — OTDR test results

## Dependencies
- VLM service (Qwen3 on :8100) for photo validation
- QFieldCloud API for photo ingestion
- VF Storage for photo files
- Activate module (shared photo review patterns)
