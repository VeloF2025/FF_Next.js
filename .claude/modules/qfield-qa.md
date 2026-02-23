# Module: qfield-qa

> **Last updated:** 2026-02-23  
> **Path:** `src/modules/qfield-qa/`  
> **Status:** Active  
> **Complexity:** High

## Overview

QField integration and QA workflow management. Field teams submit photos via QField mobile app; system ingests, validates, and routes for human QA review. VLM categorization supports automated photo validation.

| Property | Value |
|----------|-------|
| **Purpose** | Manage QA reviews from QField photo submissions with VLM pre-categorization |
| **Primary use** | Field photo validation, QA review workflow, VLM confidence scoring |
| **Status** | Active (integrated with VLM pipeline) |
| **Category** | field/qa |

## Workflow

```
QField Photo Upload (on-device)
         │
         ▼
Sync to server via QField Sync service
         │
         ▼
qfield-qa ingestion: parse metadata, store in database
         │
         ▼
VLM Pre-Categorization (async): extract feature type, condition, confidence
         │
         ▼
QA Review Queue: human reviewer validates VLM output
         │
         ├── PASS: VLM correct, mark complete
         ├── REWORK: incorrect categorization, send back to field
         └── REJECT: photo invalid, exclude from review
```

## GeoPackage Import Pipeline

QField uses GeoPackage (`.gpkg`) format for offline map data and geometry:
- Import GPK files containing infrastructure geometries
- Parse layers: poles, cable routes, building footprints
- Link photos to geometries via GPS coordinates + proximity matching
- Enable offline field work without internet connectivity

**Components:**
- GeoPackage import endpoint
- Layer parser (poles, cables, structures)
- Geometry-photo matching algorithm
- Offline sync coordination with QField app

## VLM Integration

VLM analyzes QField photos for:
- Feature type (pole, cable span, joint, building)
- Condition assessment (good, damaged, non-compliant)
- Confidence score per photo
- Severity classification (safe, warning, critical)

Pre-categorization reduces human reviewer cognitive load — VLM flags high-confidence items for fast approval, medium-confidence for review, low-confidence for escalation.

## Database

### Tables
- `qfield_qa_reviews` — QA review records (photo_id, status, vlm_confidence, reviewer, created_at)
- `qfield_qa_photos` — Uploaded photos with metadata (gps, timestamp, feature_type, image_path)
- `qfield_qa_categorization` — VLM output (feature_type, condition, confidence_scores)
- `qfield_qa_comments` — Reviewer notes and corrections

### Key Queries
- Get pending reviews (status='pending', ordered by vlm_confidence ascending)
- Get high-confidence auto-approve candidates (vlm_confidence > 0.95)
- Get by project/location (spatial queries)
- Track reviewer productivity (reviews per user per day)

## Components

| Component | Purpose |
|-----------|---------|
| QA Review Wizard | Multi-step review workflow with photo viewer |
| VLM Pre-categorization Card | Shows VLM output, confidence, allows override |
| Photo Metadata Panel | GPS, timestamp, field agent, equipment details |
| Geometry Overlay | Shows nearby poles/cables for context |
| Reviewer Dashboard | Queue of pending reviews, filters by confidence |

## Hooks

- `useQFieldPhotos()` — Fetch photos for QA review
- `useVLMCategorization()` — Get VLM pre-categorization for photo
- `useQAReviewQueue()` — Get pending reviews with filters
- `useQAComments()` — Fetch/add reviewer notes

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/qfield-qa/ingest` | Ingest QField photo submission |
| GET | `/api/qfield-qa/queue` | Get pending QA reviews |
| GET | `/api/qfield-qa/[photoId]/vlm` | Get VLM categorization |
| PATCH | `/api/qfield-qa/[photoId]/review` | Submit QA decision (PASS/REWORK/REJECT) |
| POST | `/api/qfield-qa/gpk/import` | Import GeoPackage file |
| GET | `/api/qfield-qa/geometries` | Get nearby geometries by location |

## QA Review Decisions

| Decision | Outcome | Next Step |
|----------|---------|-----------|
| **PASS** | Review approved, data marked valid | Proceed to downstream (Civil QA or activation) |
| **REWORK** | Photo rejected, field agent resubmits | Re-triggers VLM categorization |
| **REJECT** | Invalid photo, excluded from analysis | Manual investigation required |

## Notifications (UNS Integration)

Events:
- `qfield.photo_rejected` — Field agent notified to resubmit
- `qfield.photo_escalated` — Escalated to supervisor for complex case
- `qfield.qa_complete` — Notification when batch processing complete

## Reviewer Efficiency

**VLM Confidence-based workflow:**
- **>95% confidence:** Auto-approve fast-track (manual spot-check)
- **70–95% confidence:** Standard review (full checklist)
- **<70% confidence:** Escalate to supervisor (complex case)

This reduces review time by ~60% on high-confidence batches.

## Related

- `/qfield-sync` — QField data synchronization
- `/vlm` — VLM infrastructure and configuration
- `/civil-qa` — Civil QA module (downstream of QField validation)
- `/activate` — Activation workflow (consumes validated QField data)
- `knowledge-base/qfield/` — Full QField system documentation
