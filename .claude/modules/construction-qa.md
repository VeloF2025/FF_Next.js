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
- **QA Centre Zone Register**: Operational one-row-per-zone delivery status with server-authored gates, blockers, QA, and handover state
- **Zone Delivery Workspace**: Stable `/field-ops/zone?project_id=…&zone_no=…` route for audited PON milestones, discipline QA, evidence, snags, and activity
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
│   ├── ConstructionQaCentrePage.tsx  # Legacy feature-review surface
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
├── zone-delivery/                    # Register, workspace, lifecycle service
│   ├── components/                   # Register/workspace UI
│   ├── hooks/                        # Typed API clients
│   ├── repositories/                 # Transaction-scoped reads/writes
│   ├── services/                     # Gates, audit, handover, storage
│   └── types/                        # Zone Delivery contracts
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

Zone Delivery uses seven flat routes under `pages/api/zone-delivery/`:
`register`, `zone`, `scope`, `pon-milestone`, `zone-qa`, `document`, and
`activity`. Reads use `construction-qa.qa-centre:view`; six action permissions
separately gate scope, construction, testing, operations, Zone QA, and document
management.

## Database Tables
- `qa_photo_reviews` — Photo review records with VLM results
- `qa_pon_features` — PON-level feature tracking
- `construction_qa_decisions` — Final QA decisions
- `exfo_test_results` — OTDR test results
- Migration 470 adds `pon_delivery_state`, `zone_delivery_state`,
  `zone_delivery_documents`, `zone_delivery_snag_links`, and
  `zone_delivery_activity`; its rollback removes them in dependency order.

## Zone Delivery safety
- PON gates and automatic handover are calculated on the server, never inferred
  from Works QA or OTDR evidence in the browser.
- Test packs, FACs, and CACs are stored in VF Storage with active metadata and
  SHA-256 checksums.
- The database is shared by dev and production. Applying migration 470 requires
  Hein's explicit approval; verification must use the isolated Docker fixture.

## Dependencies
- VLM service (Qwen3 on :8100) for photo validation
- QFieldCloud API for photo ingestion
- VF Storage for photo files
- Activate module (shared photo review patterns)
