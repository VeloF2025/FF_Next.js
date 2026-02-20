# PRD: Civil QA Module

**Document Version:** 1.0
**Status:** Draft — Ready for Implementation
**Date:** 2026-02-18
**Author:** FibreFlow Engineering
**Reviewers:** Operations, Field Engineering

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals and Success Metrics](#3-goals-and-success-metrics)
4. [User Personas](#4-user-personas)
5. [System Architecture](#5-system-architecture)
6. [Data Model](#6-data-model)
7. [Feature Specifications per Discipline](#7-feature-specifications-per-discipline)
8. [Photo Ingestion Pipeline](#8-photo-ingestion-pipeline)
9. [VLM Validation Specifications](#9-vlm-validation-specifications)
10. [QA Workflow — 5-Phase Wizard](#10-qa-workflow--5-phase-wizard)
11. [WhatsApp Integration](#11-whatsapp-integration)
12. [Reporting and Analytics](#12-reporting-and-analytics)
13. [UI/UX Specifications](#13-uiux-specifications)
14. [API Endpoints](#14-api-endpoints)
15. [Phased Delivery Plan](#15-phased-delivery-plan)
16. [Technical Dependencies and Risks](#16-technical-dependencies-and-risks)
17. [Migration Strategy](#17-migration-strategy)

---

## 1. Executive Summary

FibreFlow currently has a mature QA system for the final stage of fiber deployment — home drop activations — through the Activate QA Center. This system uses AI-powered photo categorization, a 5-phase review wizard, WhatsApp feedback loops, and a human-in-the-loop (HITL) learning system that has processed thousands of drop records (DRs) in production.

The upstream construction phases — pole planting (civil), cable stringing (optical), and dome joint splicing — have no equivalent system. Photos are captured in QField, synced to MinIO, and undergo only an automated confidence-threshold check with no structured review workflow, no checklist enforcement, no field technician feedback loop, and no management reporting.

This PRD specifies the **Civil QA Module**: a production-quality quality assurance system for the three pre-activation construction disciplines. It replicates the architecture and UX sophistication of the Activate QA Center, adapted for civil and optical construction work. It introduces multi-source photo ingestion (QField, SharePoint, WhatsApp, manual upload), discipline-specific photo checklists, VLM prompts tuned to FiberTime construction standards, and a fully reportable workflow from field capture to formal acceptance.

The module is designed to ship in three phases. Phase 1 (MVP) delivers civil QA for pole planting. Phase 2 adds optical and SharePoint sync. Phase 3 adds splicing QA, WhatsApp ingestion, and full reporting parity with the Activate QA Center.

---

## 2. Problem Statement

### 2.1 Current State

FibreFlow's quality process has a significant gap upstream of home drop activation:

| Stage | QA Coverage | System |
|-------|-------------|--------|
| Pole Planting | Minimal — VLM confidence check only | `qfield_photo_validations` (no structured review) |
| Cable Stringing | Minimal — VLM confidence check only | `qfield_photo_validations` (no structured review) |
| Dome Joints / Splicing | Minimal — VLM confidence check only | `qfield_photo_validations` (no structured review) |
| Home Drop Activation | Full — 5-phase wizard, 10-step checklist, reports | Activate QA Center |

### 2.2 Business Impact of the Gap

- **Rework at scale.** Defective civil work discovered late in the build cycle (during activation or customer complaints) requires expensive rework — mobilizing teams back to sites already in a later build phase.
- **No accountability trail.** Without formal acceptance per pole/span/joint, there is no contractual evidence that work met FiberTime standards at the time of completion.
- **Contractor payment disputes.** Payments are linked to completed milestones. Without QA signoff, milestone completeness is ambiguous.
- **No performance visibility.** Field supervisors have no real-time view of which PONs are fully QA'd, which are blocked by rework, or which contractors are producing substandard work.
- **WhatsApp feedback is manual.** When photos are rejected, supervisors manually copy-paste feedback to WhatsApp groups. There is no audit trail and no guarantee of delivery.

### 2.3 What Success Looks Like

A fiber network PON should have a clear, auditable QA trail from first pole planted to last activation. Every pole has a signed-off photo set. Every cable span has a confirmed attachment record. Every dome joint has a documented splice acceptance. The Civil QA Module makes this possible.

---

## 3. Goals and Success Metrics

### 3.1 Primary Goals

1. **Structured photo review** for all three construction disciplines with enforced checklists.
2. **VLM-first automation** — AI categorizes and validates photos before any human touches them.
3. **Immediate field feedback** via WhatsApp when photos are rejected, with specific actionable reasons.
4. **Management reporting** with KPIs at project, zone, PON, contractor, and technician level.
5. **HITL learning** — human corrections feed back into VLM prompts over time.
6. **Multi-source ingestion** — QField, SharePoint, WhatsApp, and manual upload all feed the same review pipeline.

### 3.2 Success Metrics

| Metric | Target (6 months post-launch) |
|--------|-------------------------------|
| Photo coverage per PON | 95% of poles with at least one valid photo |
| First-pass QA rate (civil) | 70%+ photos passing AI check on first submission |
| QA cycle time | Mean time from photo capture to QA decision < 24 hours |
| Rework reduction | 30% reduction in civil rework events vs. prior quarter |
| Contractor compliance | 100% of active contractors with QA data visible in reports |
| WhatsApp feedback delivery | 99% of rejections with WhatsApp notification sent within 5 minutes |
| VLM accuracy | 85%+ agreement between VLM recommendation and human decision |

### 3.3 Non-Goals (Out of Scope)

- Real-time QField app integration (photos push from device, not pull from cloud).
- GPS deviation enforcement during photo capture (handled by QField app).
- Material tracking or BOQ reconciliation (handled by Procurement module).
- Customer-facing portal (internal operations tool only).

---

## 4. User Personas

### 4.1 Field Technician (QField User)

- **Description:** Civil or optical construction worker on site. Plants poles, strings cable, splices joints. Takes photos via QField on a mobile device.
- **Interaction with module:** Receives WhatsApp notifications when photos are rejected. Retakes and resubmits. No direct access to the web UI.
- **Pain points:** Unclear rejection reasons. No confirmation that approved photos have been received.

### 4.2 Field Supervisor

- **Description:** Manages a crew of 5–20 technicians across one or more PONs. On-site part of the day, reviewing progress on a mobile browser or laptop.
- **Interaction with module:** Reviews pending photos in the QA dashboard. Approves, rejects, or escalates. Sends WhatsApp feedback. Views per-PON progress.
- **Pain points:** Too many photos to review manually. No triage tools. Cannot easily see which PONs are fully QA'd vs. still open.

### 4.3 QA Manager

- **Description:** Senior role responsible for quality across all active projects. Office-based. Reviews reports, manages escalations, tracks contractor performance.
- **Interaction with module:** Uses the reporting dashboard. Reviews escalated items. Configures VLM thresholds. Manages contractor scorecards.
- **Pain points:** No aggregated data. Cannot compare contractors. No trend visibility across projects.

### 4.4 Project Manager

- **Description:** Oversees one or more projects from planning to activation. Uses pipeline and reporting views.
- **Interaction with module:** Views per-PON stage tracking. Monitors QA bottlenecks. Uses Civil QA data to validate milestone completion for billing.

### 4.5 QA Reviewer (Administrative)

- **Description:** Office-based staff assigned to process queued QA reviews. Works through a review queue in the web UI.
- **Interaction with module:** Daily queue of photos to review. Uses the 5-phase wizard. Submits decisions and feedback.
- **Pain points:** Photos without context (which pole? which PON?). Inconsistent standards between reviewers.

---

## 5. System Architecture

### 5.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PHOTO SOURCES (Field)                                │
├──────────────┬──────────────┬─────────────────┬──────────────────────────  │
│  QField App  │  SharePoint  │  WhatsApp Groups │  Web Upload (manual)       │
│  (primary)   │  (contractor)│  (legacy bridge) │  (supervisor)              │
└──────┬───────┴──────┬───────┴────────┬─────────┴──────────┬────────────────┘
       │              │                │                     │
       ▼              ▼                ▼                     ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐    ┌──────────────────────┐
│  MinIO       │ │ Microsoft│ │ WA Bridge    │    │ Next.js Upload API   │
│  QFieldCloud │ │ Graph API│ │ :8083 (VPS)  │    │ → Firebase Storage   │
└──────┬───────┘ └────┬─────┘ └──────┬───────┘    └──────────┬───────────┘
       │              │              │                        │
       └──────────────┴──────────────┴────────────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  INGESTION LAYER     │
                          │  (normalisation)     │
                          │  construction_photos  │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼──────────┐
                          │   VLM PROCESSING     │
                          │   Qwen3-VL:8100      │
                          │   Velocity Server    │
                          │   (discipline prompts)│
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  REVIEW RECORDS      │
                          │  construction_qa_     │
                          │  reviews table        │
                          └──────────┬───────────┘
                                     │
               ┌─────────────────────┴─────────────────────┐
               │                                           │
    ┌──────────▼──────────┐                   ┌────────────▼─────────┐
    │  5-PHASE QA WIZARD   │                   │  REPORTING ENGINE    │
    │  (web UI)            │                   │  (8 report types)    │
    └──────────┬──────────┘                   └──────────────────────┘
               │
    ┌──────────▼──────────┐
    │  WHATSAPP FEEDBACK   │
    │  Bridge:8083 (VPS)   │
    └─────────────────────┘
```

### 5.2 Technology Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Framework | Next.js 14 App Router | Consistent with Activate module |
| Database | Neon PostgreSQL | Production: `ep-dry-night-a9qyh4sj` |
| VLM | Qwen3-VL-8B-Instruct on Velocity:8100 | Shared with Activate module |
| QField Storage | MinIO (QFieldCloud, Velocity) | Erasure-coded, access via `docker exec qfieldcloud-minio-1 mc cat` |
| SharePoint | Microsoft Graph API (OAuth client credentials) | `sharepointDrSyncService.ts` pattern |
| WhatsApp | Bridge at 72.61.197.178:8083 | Shared with Activate module |
| Auth | PostgreSQL role-based (existing RBAC) | |
| File Upload | Firebase Storage | Consistent with project |
| Photo Proxy | Next.js API route | Abstracts MinIO/SharePoint/Firebase paths |

### 5.3 Module Directory Structure

```
src/modules/construction-qa/
├── components/
│   ├── ConstructionQaCentrePage.tsx      # Main QA Centre page
│   ├── ConstructionReviewPage.tsx        # Feature review page
│   ├── ReportsTab.tsx                    # Reporting dashboard
│   ├── IngestionStatusOverlay.tsx        # Photo sync progress
│   └── wizard/
│       ├── QaWizardContainer.tsx         # 5-phase wizard container
│       ├── PrerequisitesPhase.tsx        # Phase 1: photo coverage check
│       ├── PhotoReviewPhase.tsx          # Phase 2: photo review
│       ├── DataValidationPhase.tsx       # Phase 3: field data validation
│       ├── FinalDecisionPhase.tsx        # Phase 4: PASS/FAIL/REWORK
│       ├── FeedbackPhase.tsx             # Phase 5: WA feedback
│       └── WizardProgressOverlay.tsx     # Async operation UI
├── context/
│   └── ConstructionQaDataContext.tsx     # Data management context
├── services/
│   ├── constructionQaService.ts          # Core data operations
│   ├── vlmConstructionService.ts         # VLM integration (discipline prompts)
│   ├── photoIngestionService.ts          # Multi-source normalisation
│   ├── sharepointConstructionService.ts  # SharePoint adapter
│   ├── qfieldPhotoService.ts             # MinIO photo fetcher
│   ├── constructionFeedbackService.ts    # WhatsApp feedback
│   └── constructionReportingService.ts   # Report generation
└── types/
    └── construction.types.ts             # TypeScript definitions

pages/construction-qa/
├── index.tsx                             # QA Centre landing
├── [featureId].tsx                       # Feature review wizard
└── reports.tsx                           # Reports dashboard

pages/api/construction-qa/
├── features.ts                           # GET feature list
├── photos.ts                             # GET/POST photos for a feature
├── vlm-validate.ts                       # POST VLM validation trigger
├── review.ts                             # POST review action
├── final-decision.ts                     # POST Phase 4 decision
├── send-feedback.ts                      # POST WhatsApp feedback
├── ingest-qfield.ts                      # POST trigger QField ingestion
├── ingest-sharepoint.ts                  # POST trigger SharePoint sync
├── photo-proxy.ts                        # GET photo proxy (MinIO/SP/Firebase)
├── health-check.ts                       # GET service health
└── reporting/
    ├── overview.ts
    ├── by-discipline.ts
    ├── by-contractor.ts
    ├── by-technician.ts
    ├── by-zone-pon.ts
    ├── first-pass-rate.ts
    ├── rework-funnel.ts
    └── vlm-accuracy.ts
```

---

## 6. Data Model

### 6.1 Core Review Table

This table is the single source of truth for all construction QA review state, analogous to `dr_photo_unified_reviews` in the Activate module.

```sql
-- Migration: 200_construction_qa_reviews.sql

CREATE TABLE IF NOT EXISTS construction_qa_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Feature identification (what is being QA'd)
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    discipline    TEXT NOT NULL CHECK (discipline IN ('civil', 'optical', 'splicing')),
    feature_type  TEXT NOT NULL CHECK (feature_type IN ('pole', 'cable_span', 'joint')),
    feature_id    TEXT NOT NULL,       -- pole_number, span_label, joint_label
    zone_no       INTEGER,
    pon_no        INTEGER,

    -- Photo state
    photo_count         INTEGER DEFAULT 0,
    photos_json         JSONB DEFAULT '[]',   -- Array of {url, source, step, filename, size, captured_at}
    photo_sources       TEXT[] DEFAULT '{}',  -- ['qfield', 'sharepoint', 'whatsapp', 'upload']
    last_photo_at       TIMESTAMPTZ,

    -- Checklist steps (booleans per discipline — see Section 7)
    -- Civil (pole planting)
    civil_step_01_foundation    BOOLEAN DEFAULT FALSE,
    civil_step_02_full_pole     BOOLEAN DEFAULT FALSE,
    civil_step_03_pole_label    BOOLEAN DEFAULT FALSE,
    civil_step_04_cca_tag       BOOLEAN DEFAULT FALSE,
    civil_step_05_vertical      BOOLEAN DEFAULT FALSE,
    civil_step_06_guy_wires     BOOLEAN DEFAULT FALSE,
    civil_step_07_slack_bracket BOOLEAN DEFAULT FALSE,

    -- Optical (cable stringing)
    optical_step_01_cable_route     BOOLEAN DEFAULT FALSE,
    optical_step_02_attachment      BOOLEAN DEFAULT FALSE,
    optical_step_03_slack_coil      BOOLEAN DEFAULT FALSE,
    optical_step_04_cable_label     BOOLEAN DEFAULT FALSE,
    optical_step_05_no_backfeed     BOOLEAN DEFAULT FALSE,
    optical_step_06_sag_ok          BOOLEAN DEFAULT FALSE,

    -- Splicing (dome joints)
    splicing_step_01_dome_closed    BOOLEAN DEFAULT FALSE,
    splicing_step_02_slack_bracket  BOOLEAN DEFAULT FALSE,
    splicing_step_03_emergency_loop BOOLEAN DEFAULT FALSE,
    splicing_step_04_backhaul_sep   BOOLEAN DEFAULT FALSE,
    splicing_step_05_tray_org       BOOLEAN DEFAULT FALSE,
    splicing_step_06_heat_shrinks   BOOLEAN DEFAULT FALSE,
    splicing_step_07_dome_label     BOOLEAN DEFAULT FALSE,

    -- VLM processing
    vlm_status           TEXT DEFAULT 'pending' CHECK (vlm_status IN ('pending', 'processing', 'completed', 'failed')),
    vlm_confidence       NUMERIC(3,2),              -- 0.00 to 1.00 overall score
    vlm_step_scores      JSONB DEFAULT '{}',        -- {step_01: 0.91, step_02: 0.55, ...}
    vlm_issues           TEXT[] DEFAULT '{}',       -- Human-readable issue list
    vlm_feedback         TEXT,                      -- Detailed feedback text
    vlm_raw_response     JSONB,                     -- Full VLM JSON response
    vlm_processed_at     TIMESTAMPTZ,
    vlm_model_version    TEXT,                      -- Which model/prompt version was used
    vlm_retry_count      INTEGER DEFAULT 0,

    -- Extracted data (VLM or manual)
    extracted_pole_number    TEXT,    -- VLM read from pole label photo
    extracted_pole_height    TEXT,    -- VLM estimated from context
    extracted_cable_type     TEXT,    -- VLM read from cable label
    extracted_joint_type     TEXT,    -- VLM identified (dome type)
    extracted_splice_count   INTEGER, -- VLM counted splice trays
    extracted_notes          JSONB DEFAULT '{}',    -- Freeform VLM observations

    -- QA Workflow
    workflow_status     TEXT DEFAULT 'pending' CHECK (
        workflow_status IN ('pending', 'in_review', 'approved', 'rejected', 'rework_needed', 'escalated')
    ),
    manual_status       TEXT CHECK (manual_status IN ('approved', 'rejected', 'rework_needed', NULL)),
    qa_decision         TEXT CHECK (qa_decision IN ('PASS', 'FAIL', 'REWORK_NEEDED', NULL)),
    qa_decision_at      TIMESTAMPTZ,
    qa_decision_by      TEXT,                      -- User who made decision
    qa_reason_code      TEXT,                      -- Standardised reason (see Section 7)
    qa_notes            TEXT,                      -- Free-text notes
    rework_count        INTEGER DEFAULT 0,         -- Number of times sent back for rework

    -- Assignment
    assigned_to     TEXT,
    assigned_at     TIMESTAMPTZ,
    assigned_by     TEXT,
    due_date        TIMESTAMPTZ,
    priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

    -- Escalation
    escalation_level    INTEGER DEFAULT 0,
    escalated_at        TIMESTAMPTZ,
    escalation_reason   TEXT,

    -- WhatsApp feedback
    wa_feedback_sent_at  TIMESTAMPTZ,
    wa_feedback_message  TEXT,
    wa_group_jid         TEXT,
    wa_technician_phone  TEXT,

    -- Submission tracking (resubmissions)
    submission_count     INTEGER DEFAULT 1,
    first_submitted_at   TIMESTAMPTZ,
    last_submitted_at    TIMESTAMPTZ,
    resubmission_snapshots JSONB DEFAULT '[]',      -- Array of previous submission states

    -- Linked feature data (denormalized for performance)
    pole_latitude     NUMERIC,
    pole_longitude    NUMERIC,
    pole_material     TEXT,
    pole_height_m     NUMERIC,
    span_from_pole    TEXT,
    span_to_pole      TEXT,
    span_length_m     NUMERIC,
    span_cable_size   TEXT,
    joint_cable_cap   TEXT,

    -- Metadata
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(project_id, feature_type, feature_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cqa_project_discipline
    ON construction_qa_reviews(project_id, discipline);
CREATE INDEX IF NOT EXISTS idx_cqa_zone_pon
    ON construction_qa_reviews(zone_no, pon_no);
CREATE INDEX IF NOT EXISTS idx_cqa_workflow_status
    ON construction_qa_reviews(workflow_status, assigned_to);
CREATE INDEX IF NOT EXISTS idx_cqa_vlm_status
    ON construction_qa_reviews(vlm_status) WHERE vlm_status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_cqa_feature
    ON construction_qa_reviews(feature_type, feature_id);
CREATE INDEX IF NOT EXISTS idx_cqa_priority
    ON construction_qa_reviews(priority, workflow_status);
```

### 6.2 Photo Records Table

Individual photo metadata is stored separately to support per-photo workflow (approve individual photos, track retakes).

```sql
-- Migration: 201_construction_qa_photos.sql

CREATE TABLE IF NOT EXISTS construction_qa_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id  UUID NOT NULL REFERENCES construction_qa_reviews(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Storage reference
    source       TEXT NOT NULL CHECK (source IN ('qfield', 'sharepoint', 'whatsapp', 'upload')),
    storage_key  TEXT NOT NULL,    -- MinIO path, SharePoint item ID, Firebase path, or WA message ID
    storage_url  TEXT,             -- Resolved URL (may expire; regenerate via proxy)
    filename     TEXT,
    file_size_bytes BIGINT,
    mime_type    TEXT DEFAULT 'image/jpeg',

    -- Checklist assignment
    checklist_step  INTEGER,       -- 1-7 (civil), 1-6 (optical), 1-7 (splicing), NULL if uncategorised
    step_label      TEXT,

    -- VLM per-photo results
    vlm_valid       BOOLEAN,
    vlm_confidence  NUMERIC(3,2),
    vlm_issues      TEXT[] DEFAULT '{}',
    vlm_feedback    TEXT,
    vlm_raw         JSONB,
    vlm_processed_at TIMESTAMPTZ,

    -- Manual review
    manual_status       TEXT CHECK (manual_status IN ('approved', 'rejected', 'pending', NULL)),
    manual_reviewed_by  TEXT,
    manual_reviewed_at  TIMESTAMPTZ,
    manual_notes        TEXT,

    -- Retake tracking
    needs_retake        BOOLEAN DEFAULT FALSE,
    retake_notified_at  TIMESTAMPTZ,
    retake_completed_at TIMESTAMPTZ,
    retake_for_photo_id UUID REFERENCES construction_qa_photos(id),

    -- Capture metadata
    captured_at         TIMESTAMPTZ,    -- EXIF timestamp if available
    gps_lat             NUMERIC,        -- EXIF GPS if available
    gps_lon             NUMERIC,
    captured_by         TEXT,           -- Technician identifier (phone / QField username)

    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cqa_photos_review
    ON construction_qa_photos(review_id);
CREATE INDEX IF NOT EXISTS idx_cqa_photos_source
    ON construction_qa_photos(source, project_id);
CREATE INDEX IF NOT EXISTS idx_cqa_photos_step
    ON construction_qa_photos(review_id, checklist_step);
CREATE INDEX IF NOT EXISTS idx_cqa_photos_retake
    ON construction_qa_photos(needs_retake, retake_notified_at)
    WHERE needs_retake = TRUE;
```

### 6.3 Activity Log Table

```sql
-- Migration: 202_construction_qa_activity.sql

CREATE TABLE IF NOT EXISTS construction_qa_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id    UUID NOT NULL REFERENCES construction_qa_reviews(id) ON DELETE CASCADE,
    photo_id     UUID REFERENCES construction_qa_photos(id),

    event_type   TEXT NOT NULL,
    -- Values: photo_ingested, vlm_started, vlm_completed, vlm_failed,
    --         review_opened, step_checked, step_unchecked, decision_made,
    --         feedback_sent, rework_requested, resubmission_received,
    --         assigned, escalated, comment_added

    actor        TEXT,              -- User ID or 'system' or 'vlm'
    actor_name   TEXT,
    payload      JSONB DEFAULT '{}',
    notes        TEXT,

    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cqa_activity_review
    ON construction_qa_activity(review_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cqa_activity_type
    ON construction_qa_activity(event_type, created_at DESC);
```

### 6.4 VLM Corrections Table (HITL Learning)

Reuses the existing `vlm_corrections` table (migration 160) with `module = 'construction_qa'` and discipline-specific `analysis_type` values:

| `module` | `analysis_type` |
|----------|-----------------|
| `construction_qa` | `civil_pole_foundation` |
| `construction_qa` | `civil_pole_label` |
| `construction_qa` | `civil_cca_tag` |
| `construction_qa` | `optical_slack_coil` |
| `construction_qa` | `optical_cable_label` |
| `construction_qa` | `splicing_dome_sealed` |
| `construction_qa` | `splicing_tray_organized` |

### 6.5 QA Assignments Table

```sql
-- Migration: 203_construction_qa_assignments.sql

CREATE TABLE IF NOT EXISTS construction_qa_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id    UUID NOT NULL REFERENCES construction_qa_reviews(id) ON DELETE CASCADE,
    assigned_to  TEXT NOT NULL,
    assigned_by  TEXT NOT NULL,
    assigned_at  TIMESTAMPTZ DEFAULT NOW(),
    due_date     TIMESTAMPTZ,
    priority     TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    notes        TEXT,
    completed_at TIMESTAMPTZ,

    CONSTRAINT cqa_assignment_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);
```

### 6.6 Database Views

```sql
-- View: v_construction_qa_reviews
-- Joins review records with feature context from poles, cable_spans, joints
CREATE OR REPLACE VIEW v_construction_qa_reviews AS
SELECT
    r.*,
    p.name         AS project_name,
    p.client_id    AS client_id,
    -- Pole context (when feature_type = 'pole')
    po.type        AS pole_type_live,
    po.height      AS pole_height_live,
    po.material    AS pole_material_live,
    po.status      AS pole_status_live,
    po.latitude    AS pole_lat_live,
    po.longitude   AS pole_lon_live,
    -- Cable span context (when feature_type = 'cable_span')
    cs.span_type   AS span_type_live,
    cs.cable_size  AS cable_size_live,
    cs.length_meters AS span_length_live,
    -- Joint context (when feature_type = 'joint')
    j.joint_type   AS joint_type_live,
    j.cable_capacity AS joint_cable_cap_live,
    -- Computed
    (
        SELECT COUNT(*) FROM construction_qa_photos ph
        WHERE ph.review_id = r.id AND ph.manual_status = 'approved'
    ) AS approved_photo_count,
    (
        SELECT COUNT(*) FROM construction_qa_photos ph
        WHERE ph.review_id = r.id AND ph.needs_retake = TRUE AND ph.retake_completed_at IS NULL
    ) AS pending_retake_count
FROM construction_qa_reviews r
JOIN  projects p  ON p.id = r.project_id
LEFT JOIN poles po ON r.feature_type = 'pole'       AND po.pole_number = r.feature_id
LEFT JOIN cable_spans cs ON r.feature_type = 'cable_span' AND cs.span_label = r.feature_id
                        AND cs.project_id = r.project_id
LEFT JOIN joints j  ON r.feature_type = 'joint'     AND j.joint_label = r.feature_id
                   AND j.project_id = r.project_id;
```

---

## 7. Feature Specifications per Discipline

### 7.1 Civil — Pole Planting

#### Photo Checklist (7 Steps)

| Step | Label | Required | VLM Check | Notes |
|------|-------|----------|-----------|-------|
| 1 | Foundation / Base | Always | Foundation concrete/backfill visible at pole base | CCA H4 SANS 754 compliance |
| 2 | Full Pole Visible | Always | Pole visible from base to top in one frame | No obstructions |
| 3 | Pole Label | Always | Pole number tag readable | AI reads label, cross-refs QField |
| 4 | CCA H4 Tag | Always | Copper/chrome/arsenic treatment tag present | SANS 754 compliance |
| 5 | Vertical Alignment | Always | Pole is plumb (within tolerance) | AI estimates deviation |
| 6 | Guy Wires / Stays | Conditional | If pole height > 9m or on corner, stay wires shown | Skip if single-line straight run < 9m |
| 7 | Slack Bracket | If breakout | Slack bracket mounted if pole is a breakout point | Cross-ref QField `dome_joint` field |

#### Data to Capture / Validate

| Field | Source | Validation Rule |
|-------|--------|----------------|
| Pole number | VLM OCR from step 3 photo | Must match `poles.pole_number` for project |
| GPS coordinates | QField sync | Flag if >30m from planned GPS |
| Pole height | QField or VLM estimate | Must be within project BOM specification |
| Material | QField | CCA H4 wood / steel / fibreglass |
| Zone / PON | QField | Cross-referenced to `zone_boundaries`, `pon_boundaries` |
| CCA tag number | VLM OCR (future) | Audit trail |

#### Reason Codes for Rejection

```
CIVIL_FOUNDATION_NOT_VISIBLE
CIVIL_LABEL_UNREADABLE
CIVIL_CCA_TAG_MISSING
CIVIL_POLE_NOT_PLUMB
CIVIL_GUY_WIRE_MISSING
CIVIL_SLACK_BRACKET_MISSING
CIVIL_PHOTO_BLURRY
CIVIL_WRONG_POLE
CIVIL_INCOMPLETE_CHECKLIST
```

### 7.2 Optical — Cable Stringing

#### Photo Checklist (6 Steps)

| Step | Label | Required | VLM Check | Notes |
|------|-------|----------|-----------|-------|
| 1 | Cable Route | Always | Full cable run between poles visible | Shows span from departure to arrival pole |
| 2 | Attachment Points | Always | Cable attached to messenger wire or lashing hardware | No bare resting on pole |
| 3 | Slack Coil | Always | Slack coil at departure pole (max 300mm diameter) | FiberTime cable standard |
| 4 | Cable Label | Always | Cable type / size label readable | AI reads: 24F, 96F, etc. |
| 5 | No Back-feeding | Always | Cable direction visible, no reverse runs | Checked by supervisor in context |
| 6 | Sag Assessment | Always | Cable sag within tolerance (no loops touching obstacles) | AI estimates clearance |

#### Data to Capture / Validate

| Field | Source | Validation Rule |
|-------|--------|----------------|
| Span label | VLM or QField | Must match `cable_spans.span_label` |
| From pole / To pole | QField `cable_spans` | Both poles must have `qa_decision = 'PASS'` in civil QA |
| Cable type | VLM OCR from step 4 | Must match project BOM |
| Length | QField | Flag if >25% deviation from `cable_spans.length_meters` |
| Zone / PON | QField | |

#### Reason Codes for Rejection

```
OPTICAL_ROUTE_OBSCURED
OPTICAL_CABLE_NOT_ATTACHED
OPTICAL_NO_SLACK_COIL
OPTICAL_SLACK_COIL_OVERSIZED
OPTICAL_CABLE_TYPE_MISMATCH
OPTICAL_SAG_EXCESSIVE
OPTICAL_PHOTO_BLURRY
OPTICAL_INCOMPLETE_CHECKLIST
```

### 7.3 Splicing — Dome Joints

#### Photo Checklist (7 Steps)

| Step | Label | Required | VLM Check | Notes |
|------|-------|----------|-----------|-------|
| 1 | Dome Enclosure Closed | Always | Dome body and lid both visible, fully sealed | No open/cracked domes |
| 2 | Slack Bracket Mounted | Always | Dome mounted on slack bracket at pole | Not dangling from cable |
| 3 | Emergency Loop | Always | Emergency fiber loop visible below dome | Min 1m loop |
| 4 | Backhaul Fiber Separated | Always | Backhaul/feeder cable enters separately from distribution | Labelled or colour-coded |
| 5 | Splice Tray Organized | Always | Splice tray(s) visible and organized | Taken before dome is closed |
| 6 | Heat Shrinks Visible | Always | All splices have heat shrink protection | Taken before dome is closed |
| 7 | Dome Label | Always | Dome label readable with joint ID | Must match QField joint_label |

#### Data to Capture / Validate

| Field | Source | Validation Rule |
|-------|--------|----------------|
| Joint label | VLM OCR from step 7 | Must match `joints.joint_label` |
| Joint type | VLM or QField | Enclosure / Splitter |
| Cable capacity | QField or VLM | 1:8F, 1:16F, 144F, 72F |
| Splice count | VLM count from step 6 photo | Flag if count > cable capacity |
| Zone / PON | QField | |

#### Reason Codes for Rejection

```
SPLICING_DOME_NOT_SEALED
SPLICING_NOT_ON_BRACKET
SPLICING_EMERGENCY_LOOP_MISSING
SPLICING_BACKHAUL_NOT_SEPARATED
SPLICING_TRAY_DISORGANIZED
SPLICING_HEAT_SHRINKS_MISSING
SPLICING_LABEL_UNREADABLE
SPLICING_PHOTO_BLURRY
SPLICING_INCOMPLETE_CHECKLIST
```

---

## 8. Photo Ingestion Pipeline

### 8.1 Overview

All photo sources are normalised into a single pipeline that produces records in `construction_qa_photos` and updates `construction_qa_reviews`.

```
┌────────────────────────────────────────────────────────┐
│                  INGESTION PIPELINE                     │
│                                                         │
│  Source → Adapter → Normalise → VLM Validate → Store   │
│                                                         │
│  Each source adapter outputs:                           │
│  {                                                      │
│    source: 'qfield' | 'sharepoint' | 'whatsapp' | 'upload' │
│    storage_key: string       // storage-specific ref   │
│    filename: string                                      │
│    feature_id: string | null // linked pole/span/joint │
│    feature_type: string | null                          │
│    project_id: string                                   │
│    captured_at: Date | null                             │
│    captured_by: string | null                           │
│    raw_url: string           // temporary download URL  │
│  }                                                      │
└────────────────────────────────────────────────────────┘
```

### 8.2 Source 1: QField Sync (Primary)

Photos captured in QField are stored in QFieldCloud's MinIO instance. The existing `qfield_photo_validations` system already imports these. The Civil QA module reads from `qfield_photo_validations` for photos with `work_type IN ('pole_installation', 'cable_stringing', 'dome_joint')` and creates/updates corresponding `construction_qa_reviews` records.

**Photo access via MinIO proxy:**

```typescript
// Photo proxy pattern (consistent with existing qfield/photo-proxy.ts)
const command = `docker exec qfieldcloud-minio-1 mc cat 'local/${MINIO_BUCKET}/${objectPath}' 2>&1`;
// Path format: projects/{project_uuid}/files/DCIM/{filename}/v{YYYYMMDDHHMMSS}-{uuid_prefix8}
```

**Ingestion trigger:**
- On-demand via `POST /api/construction-qa/ingest-qfield`
- Automated cron: every 2 hours (piggybacked on photo-resize cron on Velocity)

**Feature ID resolution:**

QField photos contain feature context in the QFieldCloud file path or metadata. The ingestion adapter:
1. Reads `feature_id` and `feature_type` from `qfield_photo_validations.feature_id` and `feature_type`
2. Looks up `poles.pole_number`, `cable_spans.span_label`, or `joints.joint_label` to confirm the feature exists in FibreFlow
3. Creates or upserts a `construction_qa_reviews` record for the feature
4. Creates a `construction_qa_photos` record linking photo to review

### 8.3 Source 2: SharePoint Sync

The existing `sharepointDrSyncService.ts` uses Microsoft Graph API with OAuth client credentials. The Civil QA module follows the same pattern with a different folder hierarchy.

**SharePoint folder hierarchy for construction:**

```
Projects/
└── {Project Name}/
    └── {Zone}/
        └── {PON}/
            ├── Poles/
            │   └── {Pole Number}/
            │       └── photos/
            │           ├── 01_foundation.jpg
            │           ├── 02_full_pole.jpg
            │           └── ...
            ├── CableSpans/
            │   └── {Span Label}/
            │       └── photos/
            └── DomeJoints/
                └── {Joint Label}/
                    └── photos/
```

**Ingestion trigger:**
- On-demand via `POST /api/construction-qa/ingest-sharepoint`
- Webhook from SharePoint (future — requires Graph API subscription)

**Service: `sharepointConstructionService.ts`**

Follows the same rate-limiting, retry, and OAuth token refresh pattern as `sharepointDrSyncService.ts`. Key differences:
- Different root folder ID (`SHAREPOINT_CONSTRUCTION_ROOT_FOLDER_ID` env var)
- Feature ID extracted from folder path segments
- Discipline inferred from parent folder name (`Poles/`, `CableSpans/`, `DomeJoints/`)

**Environment variables required:**

```bash
SHAREPOINT_TENANT_ID=...              # Shared with DR sync
SHAREPOINT_CLIENT_ID=...              # Shared with DR sync
SHAREPOINT_CLIENT_SECRET=...          # Shared with DR sync
SHAREPOINT_SITE_ID=...                # Shared with DR sync
SHAREPOINT_DRIVE_ID=...               # Shared with DR sync
SHAREPOINT_CONSTRUCTION_ROOT_FOLDER_ID=...  # NEW — points to Civil QA root
```

### 8.4 Source 3: WhatsApp (Phase 3)

Photos submitted via WhatsApp groups are handled by the existing WA Bridge (VPS 72.61.197.178:8083). The Civil QA module adds a new message processor alongside the existing `process-new-dr.ts`.

Construction photos arrive in designated WA groups (separate from activation groups). The processor:
1. Extracts the feature ID from the caption text using regex patterns (e.g., `POLE: LAW001`, `SPAN: S-001-002`, `JOINT: FTS-01`)
2. Validates the feature ID against the database
3. Creates ingestion records with `source = 'whatsapp'`

**Regex patterns for caption parsing:**
```
POLE:\s*([A-Z]{2,4}[-\s]?\d{3,6})
SPAN:\s*([\w-]+)
JOINT:\s*([\w-]+)
FTS:\s*([\w-]+)
STS:\s*([\w-]+)
```

**Fallback:** If no feature ID detected, photo enters a triage queue (`workflow_status = 'pending'`, no feature linked) for manual assignment by a supervisor.

### 8.5 Source 4: Manual Upload (Web UI)

QA reviewers or supervisors can directly upload photos for a specific feature through the web UI. The upload flow:

1. User navigates to feature review page
2. Selects discipline step from dropdown
3. Uploads image(s) via drag-and-drop or file picker
4. Files upload to Firebase Storage at path: `construction-qa/{project_id}/{discipline}/{feature_id}/{uuid}.jpg`
5. `POST /api/construction-qa/photos` creates `construction_qa_photos` record with `source = 'upload'`
6. VLM validation triggered automatically

### 8.6 Ingestion Deduplication

Photos are deduplicated using `storage_key` which is unique per source:

```sql
-- Prevent duplicate ingestion
CREATE UNIQUE INDEX IF NOT EXISTS idx_cqa_photos_dedup
    ON construction_qa_photos(source, storage_key);
```

### 8.7 Photo Resizing for VLM

The VLM (Qwen3-VL) accepts images up to 1024x768. Large photos from QField (post-resize cron) and SharePoint are resized in-memory before VLM submission.

```typescript
// In vlmConstructionService.ts
async function resizeForVlm(buffer: Buffer): Promise<Buffer> {
  // Uses sharp (already in project dependencies) or canvas
  // Target: max 1024x768, JPEG 85%
  // This matches the existing pattern in src/modules/activate/services/vlmExtractionService.ts
}
```

---

## 9. VLM Validation Specifications

### 9.1 VLM Infrastructure

| Property | Value |
|----------|-------|
| Model | Qwen3-VL-8B-Instruct |
| Endpoint | `http://100.96.203.105:8100/api/vlm` |
| Max image | 1024x768 pixels |
| Timeout | 45 seconds |
| Retry | 3 attempts, exponential backoff |

The VLM endpoint is shared with the Activate module. Civil QA requests should include a discipline-specific system prompt prefix to ensure model context is correctly framed.

### 9.2 Response Schema

All VLM calls for construction QA use a consistent JSON response schema:

```json
{
  "valid": true,
  "confidence": 0.87,
  "step": 2,
  "step_label": "Full Pole Visible",
  "issues": [],
  "feedback": "Pole is fully visible from base to top. Foundation concrete backfill is partially visible at base.",
  "extracted_data": {
    "pole_number": "LAW-001",
    "pole_height_estimate": "9m",
    "is_plumb": true,
    "deviation_degrees": 1.5
  }
}
```

### 9.3 Civil Prompts (Pole Planting)

**Step 1 — Foundation / Base:**

```
You are a quality inspector for fiber network civil construction in South Africa.
Validate this pole installation photo for STEP 1: Foundation / Base.

Required elements:
1. Pole base must be visible in the frame
2. Foundation material (concrete, compacted backfill, or rock anchor) must be visible
3. No excessive soil disturbance or erosion around base

FiberTime Civil Standard: CCA H4 SANS 754 treated wood poles require tamped
backfill compaction or concrete collar at base. Foundation must be clearly
photographed before backfill is complete.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 1,
  "step_label": "Foundation / Base",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "foundation_type": "<concrete|backfill|rock_anchor|unknown>",
    "foundation_visible": <boolean>
  }
}
```

**Step 2 — Full Pole Visible:**

```
You are a quality inspector for fiber network civil construction in South Africa.
Validate this pole installation photo for STEP 2: Full Pole Visible.

Required elements:
1. Entire pole must be visible from base to tip in a single frame
2. No obstructions blocking more than 20% of the pole height
3. Background must allow pole to be clearly distinguished

FiberTime Civil Standard: A single photo must capture the entire pole including
the base at ground level and the tip including any crossarms or hardware.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 2,
  "step_label": "Full Pole Visible",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "pole_fully_visible": <boolean>,
    "pole_height_estimate": "<estimated height in meters or 'unknown'>",
    "obstructions": [<list of obstructions if any>]
  }
}
```

**Step 3 — Pole Label:**

```
You are a quality inspector for fiber network civil construction in South Africa.
Validate this pole installation photo for STEP 3: Pole Label.

Required elements:
1. Pole identification tag/label must be clearly visible
2. Text on the label must be readable (pole number, project code)
3. Label must be physically attached to the pole (not held in hand)

FiberTime Civil Standard: Every pole must have a stamped aluminium or durable
plastic identification tag affixed between 1.5m and 2.5m above ground.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 3,
  "step_label": "Pole Label",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "label_visible": <boolean>,
    "label_readable": <boolean>,
    "pole_number_extracted": "<extracted pole number or null if unreadable>"
  }
}
```

**Step 4 — CCA H4 Tag:**

```
You are a quality inspector for fiber network civil construction in South Africa.
Validate this pole installation photo for STEP 4: CCA H4 Treatment Tag.

Required elements:
1. CCA (Copper Chrome Arsenic) treatment certificate tag must be visible
2. Tag is typically a small metal or plastic plate stamped with "CCA H4" and SANS 754
3. Tag is usually found at the base of the pole or near the pole label

FiberTime Civil Standard: SANS 754 requires all wooden poles to display proof
of CCA H4 pressure treatment for below-ground contact.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 4,
  "step_label": "CCA H4 Tag",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "tag_visible": <boolean>,
    "tag_readable": <boolean>,
    "tag_text": "<extracted tag text or null>"
  }
}
```

**Step 5 — Vertical Alignment:**

```
You are a quality inspector for fiber network civil construction in South Africa.
Validate this pole installation photo for STEP 5: Vertical Alignment.

Required elements:
1. Pole must appear plumb (vertical) when viewed from the camera
2. Maximum acceptable lean is 2 degrees from true vertical
3. Photo must be taken from at least 10m distance to assess alignment

FiberTime Civil Standard: Poles must be installed within 2 degrees of vertical.
Visible lean toward the cable run direction is acceptable to a maximum of 5 degrees
for corner poles under tension.

Note: Use vertical elements in the background (buildings, walls) as reference.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 5,
  "step_label": "Vertical Alignment",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "appears_plumb": <boolean>,
    "estimated_lean_degrees": <number or null>,
    "lean_direction": "<forward|backward|left|right|none|unknown>"
  }
}
```

**Step 6 — Guy Wires / Stays:**

```
You are a quality inspector for fiber network civil construction in South Africa.
Validate this pole installation photo for STEP 6: Guy Wires / Stays (if applicable).

This step is CONDITIONAL: required when the pole is on a corner, at a cable termination
point, or when pole height exceeds 9m.

Required elements (when applicable):
1. Guy wire(s) visible and attached at the upper third of the pole
2. Ground anchor plate or screw anchor visible at base of guy wire
3. Guy wire tensioned (no sag)
4. Correct direction opposing cable tension

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 6,
  "step_label": "Guy Wires",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "guy_wires_present": <boolean>,
    "anchor_visible": <boolean>,
    "wire_tensioned": <boolean>
  }
}
```

**Step 7 — Slack Bracket:**

```
You are a quality inspector for fiber network civil construction in South Africa.
Validate this pole installation photo for STEP 7: Slack Bracket (if breakout pole).

This step is CONDITIONAL: required when this pole is a breakout point where a
distribution cable leaves the feeder route.

Required elements (when applicable):
1. Slack bracket (J-hook or similar hardware) must be mounted on the pole
2. Bracket must be at the correct height (1.5m to 3m above ground)
3. Bracket must be oriented toward the cable departure direction

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 7,
  "step_label": "Slack Bracket",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "bracket_present": <boolean>,
    "bracket_type": "<j_hook|flat_bracket|clamp|unknown|none>",
    "bracket_height_estimate": "<height in meters or unknown>"
  }
}
```

### 9.4 Optical Prompts (Cable Stringing)

**Step 1 — Cable Route:**

```
You are a quality inspector for fiber network optical construction in South Africa.
Validate this cable stringing photo for STEP 1: Cable Route.

Required elements:
1. Cable span between at least two poles must be visible in the frame
2. The full length of the span must be traceable from departure to arrival pole
3. No gaps, broken sections, or missing cable sections visible

FiberTime Optical Standard: A complete route photo must show the cable continuous
from one attachment point to the next. No obstacles should contact the cable.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 1,
  "step_label": "Cable Route",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "route_continuous": <boolean>,
    "poles_visible_count": <integer>,
    "cable_type_estimate": "<fibre_drop|distribution|feeder|unknown>"
  }
}
```

**Step 2 — Attachment Points:**

```
You are a quality inspector for fiber network optical construction in South Africa.
Validate this cable stringing photo for STEP 2: Attachment Points.

Required elements:
1. Cable attachment hardware visible (cable clips, lashing wire, or messenger clamp)
2. Cable must be secured to messenger wire or directly to bracket hardware
3. Cable must not be resting unsupported on pole crossarm or bracket

FiberTime Optical Standard: Distribution cable must be attached every 500mm
along messenger wire using approved cable clips. Feeder cable uses approved
lashing wire with 100mm pitch.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 2,
  "step_label": "Attachment Points",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "attachment_type": "<cable_clips|lashing_wire|messenger_clamp|unknown>",
    "properly_secured": <boolean>
  }
}
```

**Step 3 — Slack Coil:**

```
You are a quality inspector for fiber network optical construction in South Africa.
Validate this cable stringing photo for STEP 3: Slack Coil.

Required elements:
1. Slack coil must be visible at the departure pole
2. Coil diameter must not exceed 300mm
3. Coil must be tied to the slack bracket (not hanging loose)
4. Minimum 2m of slack in the coil

FiberTime Optical Standard: All cable spans require a service loop (slack coil)
at the departure pole to allow for future splicing. Maximum coil diameter: 300mm.
Coil must be secured with cable ties to the slack bracket hardware.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 3,
  "step_label": "Slack Coil",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "coil_present": <boolean>,
    "coil_secured": <boolean>,
    "coil_diameter_estimate": "<small_ok|large_over300mm|unknown>"
  }
}
```

**Step 4 — Cable Label:**

```
You are a quality inspector for fiber network optical construction in South Africa.
Validate this cable stringing photo for STEP 4: Cable Label.

Required elements:
1. Cable identification label must be readable in this photo
2. Label must indicate cable type and fibre count (e.g., 24F, 96F, 144F)
3. Label must be physically attached to the cable at the departure pole

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 4,
  "step_label": "Cable Label",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "label_readable": <boolean>,
    "cable_type_extracted": "<extracted cable type or null>",
    "fibre_count_extracted": "<fibre count as integer or null>"
  }
}
```

**Step 5 — No Back-feeding:**

```
You are a quality inspector for fiber network optical construction in South Africa.
Validate this cable stringing photo for STEP 5: No Back-feeding.

Required elements:
1. Cable must run in the correct direction (from POP toward distribution)
2. No cable runs can double-back against the network topology
3. Photo context must make cable direction discernible

Back-feeding definition: A cable that routes away from the POP and then back
toward it on the same span creates a loop that causes confusion and potential
optical signal issues.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 5,
  "step_label": "No Back-feeding",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "direction_discernible": <boolean>,
    "back_feed_detected": <boolean>
  }
}
```

**Step 6 — Sag Assessment:**

```
You are a quality inspector for fiber network optical construction in South Africa.
Validate this cable stringing photo for STEP 6: Sag Assessment.

Required elements:
1. Cable sag must be within acceptable limits — maximum 2% of span length
2. No loops or contact points with obstacles (trees, structures)
3. Cable must not contact ground, roofs, or other infrastructure

FiberTime Optical Standard: Maximum cable sag for distribution spans is 2% of
span length. For a 40m span, maximum sag is 800mm. Excessive sag is a safety
hazard and degrades signal quality.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 6,
  "step_label": "Sag Assessment",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "sag_within_tolerance": <boolean>,
    "obstacles_detected": <boolean>,
    "obstacle_types": [<string array>]
  }
}
```

### 9.5 Splicing Prompts (Dome Joints)

**Step 1 — Dome Enclosure Closed:**

```
You are a quality inspector for fiber network splicing work in South Africa.
Validate this dome joint photo for STEP 1: Dome Enclosure Closed.

Required elements:
1. Dome enclosure body and lid must both be visible
2. Dome must be fully sealed — no gaps between body and lid
3. Entry ports must be sealed (no open cable entry holes)

FiberTime Splicing Standard: All dome enclosures must be sealed with the
manufacturer-specified closure procedure including heat shrink entry seals
on all cable entry ports.

Respond ONLY with valid JSON matching this schema:
{
  "valid": <boolean>,
  "confidence": <0.0 to 1.0>,
  "step": 1,
  "step_label": "Dome Enclosure Closed",
  "issues": [<string array, empty if none>],
  "feedback": "<specific actionable feedback in one sentence>",
  "extracted_data": {
    "dome_sealed": <boolean>,
    "entry_ports_sealed": <boolean>,
    "dome_type": "<fosc400|commscope|generic|unknown>"
  }
}
```

**Steps 2–7 follow the same structure with discipline-appropriate validation criteria as documented in Section 7.3.**

### 9.6 HITL Learning Integration

When a reviewer overrides a VLM decision (approves a rejected photo or rejects an approved photo), the system logs the correction to `vlm_corrections`:

```typescript
// In vlmConstructionService.ts
async function logHitlCorrection(params: {
  reviewId: string;
  photoId: string;
  photoUrl: string;
  step: number;
  discipline: 'civil' | 'optical' | 'splicing';
  vlmDecision: boolean;
  humanDecision: boolean;
  vlmConfidence: number;
  correctionReason: string;
  notes: string;
  reviewerName: string;
}): Promise<void> {
  const analysisType = `${params.discipline}_step_${String(params.step).padStart(2, '0')}`;
  // Insert into vlm_corrections with module='construction_qa', analysis_type=analysisType
}
```

Few-shot examples from `vlm_corrections` are prepended to prompts for photos with low confidence:

```typescript
// Fetch up to 3 canonical corrections for this discipline+step
const examples = await getCanonicalCorrections('construction_qa', analysisType, 3);
const fewShotPrefix = examples.map(ex => `
EXAMPLE ${ex.n}: Photo URL: ${ex.photo_url}
VLM said: ${ex.vlm_extracted_value}
Correct answer: ${ex.corrected_value}
Reason: ${ex.correction_notes}
`).join('\n');
```

---

## 10. QA Workflow — 5-Phase Wizard

The Civil QA wizard adapts the 5-phase pattern from the Activate QA Center (`QaWizardContainer.tsx`) to construction disciplines.

### 10.1 Wizard Entry Points

The wizard opens when a reviewer clicks on a feature (pole, span, joint) from the QA Centre list. The URL pattern is:

```
/construction-qa/{featureId}?type={pole|cable_span|joint}&project={projectId}
```

### 10.2 Phase 1 — Prerequisites

**Purpose:** Validate that the feature has sufficient photos to proceed with review.

**Checks performed:**

| Check | Pass Condition | Fail Action |
|-------|---------------|-------------|
| Photo count | At least 1 photo per required step | Warn; allow proceeding with caveat |
| VLM processing | All photos have VLM results | Trigger VLM if pending; block if processing |
| Feature linked | Feature ID confirmed in database | Block if unknown feature |
| Duplicate submission | No identical storage_key already approved | Warn if detected |

**UI elements:**
- Step coverage grid (coloured indicator per checklist step)
- "Trigger VLM" button if photos exist but VLM not run
- "Proceed anyway" option for supervisors with `qa:override` permission

### 10.3 Phase 2 — Photo Review

**Purpose:** Reviewer examines each photo in the context of its assigned checklist step.

**Layout:**
- Left panel: Checklist tree (steps 1–7, colour-coded by VLM confidence)
- Right panel: Photo viewer with fullscreen capability
- Per-photo actions: Approve, Reject (with reason selector), Reassign to different step
- VLM confidence badge on each photo
- VLM feedback text shown below photo

**Key interactions:**
- Reviewer can drag a photo to a different checklist step (reassigns checklist_step in DB — logged as HITL correction)
- Reject button opens reason code dropdown (from Section 7 reason codes)
- Approve/reject logged to `construction_qa_activity`

### 10.4 Phase 3 — Data Validation

**Purpose:** Validate the extracted/captured data against QField source records.

**Validation panel shows:**

**For Civil (poles):**
- VLM-extracted pole number vs. QField pole number (colour-coded match/mismatch)
- GPS: QField GPS vs. planned GPS from `poles` table (distance in metres)
- Pole height: QField value vs. BOM specification
- Zone/PON: Confirmed from QField, shown as info only

**For Optical (cable spans):**
- VLM-extracted cable type vs. `cable_spans.span_type`
- Span from-pole QA status (civil PASS required — shown as dependency warning if not passed)
- Span to-pole QA status (same)
- Length: QField vs. `cable_spans.length_meters`

**For Splicing (dome joints):**
- VLM-extracted joint label vs. `joints.joint_label`
- VLM splice count vs. `joints.cable_capacity`
- Zone/PON from `joints` table

**Manual override:** All extracted data fields are editable. Changes logged to activity.

### 10.5 Phase 4 — Final Decision

**Purpose:** Formal QA decision on the feature.

**Decision options:**

| Decision | Code | Meaning |
|----------|------|---------|
| Pass | `PASS` | Feature fully QA'd, photos acceptable, data confirmed |
| Fail | `FAIL` | Feature has fundamental issues requiring demolition/redo |
| Rework Needed | `REWORK_NEEDED` | Specific issues must be fixed and resubmitted |

**Required fields for each decision:**
- `PASS`: Optional notes
- `FAIL`: Mandatory reason code + mandatory notes
- `REWORK_NEEDED`: Mandatory reason code(s) + mandatory notes + expected resubmission date

**Auto-fail detection:**
- Missing required checklist steps (no photo for a mandatory step) → auto-suggest `REWORK_NEEDED`
- All photos VLM-rejected with confidence < 0.40 → auto-suggest `FAIL`
- Critical step (e.g., CCA tag for civil) rejected → auto-flag `REWORK_NEEDED` with pre-populated reason

**UI elements:**
- Decision radio buttons (large, colour-coded)
- Reason code multi-select (filterable dropdown)
- Notes textarea
- "Send feedback immediately after deciding" checkbox (pre-ticked)
- Summary card: photo coverage, VLM confidence distribution, previous rework count

### 10.6 Phase 5 — Feedback

**Purpose:** Send WhatsApp feedback to the field technician.

**Feedback generation:**
- Automatic: System generates a feedback message based on the decision, reason codes, and notes
- Manual override: Reviewer can edit the message before sending
- Language: Plain South African English, concise, actionable

**For `PASS`:**
```
Good work! [Feature ID] has passed QA inspection.
Photos have been accepted for [Discipline].
Thank you, [Project Name] team.
```

**For `REWORK_NEEDED`:**
```
Photo rework required for [Feature ID].
Issues found:
• [Reason 1 plain-language description]
• [Reason 2 plain-language description]

Please fix the following and resubmit photos:
[Notes from reviewer]

Target resubmission: [date]
```

**For `FAIL`:**
```
QA FAIL: [Feature ID] did not pass inspection.
Issue: [Reason + Notes]
Please contact your supervisor for further instructions.
```

**Delivery:**
- `POST /api/construction-qa/send-feedback` calls WA Bridge at `72.61.197.178:8083/send-message`
- Target: `wa_group_jid` from `qfield_validation_config` OR `wa_technician_phone` if direct-message
- Logged to `construction_qa_reviews.wa_feedback_sent_at` and `wa_feedback_message`
- Activity log event: `feedback_sent`

**Resubmission tracking:**
- When a `REWORK_NEEDED` decision is made, `rework_count` incremented
- Current state snapshot saved to `resubmission_snapshots` JSONB column
- Next ingestion for the same feature increments `submission_count`

---

## 11. WhatsApp Integration

### 11.1 WA Bridge Endpoint

```
POST http://72.61.197.178:8083/send-message
Content-Type: application/json
{
  "group_jid": "120363418298130331@g.us",
  "mention_jid": "27821234567@s.whatsapp.net",
  "message": "Good work! LAW-001 has passed QA inspection..."
}
```

The bridge is shared with the Activate module. No new bridge infrastructure is needed.

### 11.2 Group JID Configuration

Construction projects use the same WhatsApp groups as their activation counterparts, unless dedicated construction groups are configured.

Per-project WA group configuration is stored in `qfield_validation_config.notification_group_jid`. Civil QA adds a separate column for construction-specific groups:

```sql
-- Add to qfield_validation_config (or store in project settings):
ALTER TABLE qfield_validation_config
    ADD COLUMN IF NOT EXISTS construction_wa_group_jid TEXT;
```

### 11.3 Notification Types

| Event | Trigger | Content |
|-------|---------|---------|
| Photo rejected (VLM) | Automatic, on VLM fail | Immediate rejection with specific issue list |
| Rework required (human) | Phase 5 feedback | Full rework instructions with deadline |
| QA passed | Phase 5 feedback | Brief pass confirmation |
| QA failed | Phase 5 feedback | Fail notice with supervisor instruction |
| Resubmission received | Ingestion pipeline | Acknowledgment that new photos are under review |

### 11.4 WhatsApp Photo Ingestion (Phase 3)

When construction photos are submitted directly to a monitored WA group:

1. WA Bridge forwards message to `POST /api/construction-qa/wa-ingest`
2. The handler parses the caption for feature ID (regex patterns from Section 8.4)
3. Photos are downloaded from the WA media URL (temporary, 30-day expiry)
4. Photos are uploaded to Firebase Storage at `wa-construction/{project_id}/{feature_id}/{timestamp}.jpg`
5. `construction_qa_photos` record created with `source = 'whatsapp'`
6. Acknowledgment sent back to the WA group: "Photos received for [Feature ID]. Under review."

---

## 12. Reporting and Analytics

### 12.1 Report Types

The Civil QA module ships 8 report types, mirroring the Activate QA Center's reporting structure.

| Report | Endpoint | Description |
|--------|----------|-------------|
| Overview | `/api/construction-qa/reporting/overview` | Project-level KPI summary |
| By Discipline | `/api/construction-qa/reporting/by-discipline` | Civil/Optical/Splicing breakdown |
| By Zone/PON | `/api/construction-qa/reporting/by-zone-pon` | Spatial progress view |
| By Contractor | `/api/construction-qa/reporting/by-contractor` | Contractor scorecard |
| By Technician | `/api/construction-qa/reporting/by-technician` | Individual technician performance |
| First-Pass Rate | `/api/construction-qa/reporting/first-pass-rate` | % passing QA on first submission |
| Rework Funnel | `/api/construction-qa/reporting/rework-funnel` | Rework volume and resolution time |
| VLM Accuracy | `/api/construction-qa/reporting/vlm-accuracy` | VLM vs human decision agreement |

### 12.2 Key KPIs

**Project-Level KPIs:**
- Total features registered (poles, spans, joints)
- Total features QA'd (decision made)
- Overall pass rate
- Average photos per feature
- Average VLM confidence
- Features pending review (no decision yet)
- Features requiring rework

**Discipline-Specific KPIs:**

| KPI | Civil | Optical | Splicing |
|-----|-------|---------|---------|
| Step coverage | % poles with all 7 steps photographed | % spans with all 6 steps | % joints with all 7 steps |
| First-pass rate | % poles passing on first submission | Same | Same |
| Most common rejection | Top reason code by count | Same | Same |
| Rework rate | % requiring rework | Same | Same |
| Mean time to QA decision | Hours from last photo to decision | Same | Same |

**Zone/PON Progress View:**

```
Zone 1:
  PON 1: Civil 100% ✓ | Optical 80% | Splicing 60%
  PON 2: Civil  95%   | Optical 45% | Splicing  0%
Zone 2:
  PON 3: Civil  72%   | Optical  0% | Splicing  0%
```

**Contractor Scorecard:**
- First-pass rate by contractor
- Rework rate by contractor
- Most common rejection reason
- Photos per approved feature (efficiency metric)
- Trend over time (30-day rolling)

### 12.3 PON Stage Tracking Integration

The `pon_stage_tracking` table (migration 179) tracks build pipeline stages. Civil QA data feeds into this:

- `poles_planted` count updates when a pole has `qa_decision = 'PASS'` in civil QA
- `optical_complete` updates when all cable spans in a PON have optical QA `PASS`
- A new `cwc_qa_complete` derived metric: % of PON features with construction QA `PASS`

This integration means the Pipeline view automatically reflects QA-confirmed completions, not just raw QField data.

---

## 13. UI/UX Specifications

### 13.1 QA Centre — Main Page (`/construction-qa`)

**Layout:** Matches Activate QA Centre structure — tabs across the top, filter bar, sortable data grid below.

**Tabs:**
- Overview (default) — KPI cards + recent activity feed
- Poles — Civil QA list
- Cable Spans — Optical QA list
- Dome Joints — Splicing QA list
- Reports — Embedded reporting tab

**Filter Bar:**
- Project selector (dropdown)
- Zone / PON selectors (cascading dropdowns)
- Workflow status (All | Pending | In Review | Approved | Rejected | Rework)
- Discipline (All | Civil | Optical | Splicing)
- Priority (All | Low | Normal | High | Urgent)
- Search (feature ID, notes text)
- Date range (last photo date)
- Assignee

**Data Grid Columns (per discipline tab):**

| Column | Civil | Optical | Splicing |
|--------|-------|---------|---------|
| Feature ID | Pole number | Span label | Joint label |
| Zone/PON | Zone/PON | Zone/PON | Zone/PON |
| Photos | Photo count | Photo count | Photo count |
| Steps Covered | n/7 | n/6 | n/7 |
| VLM Score | % confidence | % confidence | % confidence |
| Status | Workflow badge | Workflow badge | Workflow badge |
| Priority | Priority badge | Priority badge | Priority badge |
| Last Photo | Relative date | Relative date | Relative date |
| Actions | Review button | Review button | Review button |

**Batch actions (checkbox + action dropdown):**
- Assign to reviewer
- Change priority
- Trigger VLM re-validation
- Export selected to CSV

### 13.2 Feature Review Page (`/construction-qa/[featureId]`)

**Header:**
- Feature ID, discipline badge, project name, zone/PON
- Status badge, priority badge, rework count badge
- Action buttons: Assign, Escalate, View History

**Wizard progress indicator:**
- 5 numbered phases in a horizontal stepper
- Current phase highlighted, completed phases checkmarked

**Phase navigation:**
- Back / Next buttons at bottom of each phase
- Phase is only marked complete when its required actions are done
- Jump to any phase via stepper (for reviewers who need to re-check)

**Photo viewer:**
- Responsive grid (3 columns on desktop, 1 on mobile)
- Click to expand to fullscreen lightbox
- Keyboard navigation (arrow keys) in lightbox
- Photo metadata shown: source badge, capture date, VLM confidence badge
- Per-photo approve/reject controls in lightbox mode

### 13.3 Mobile Responsiveness

Field supervisors often work on mobile browsers. The UI must be fully functional at 375px viewport width. The wizard layout collapses to single-column on mobile. Photo viewer uses swipe gestures for navigation.

### 13.4 Loading States

- Skeleton loaders on initial page load
- Inline spinners for per-feature actions (approve, reject)
- Full-page overlay (`WizardProgressOverlay`) for VLM processing (can take 10–45s per photo)
- Toast notifications for async completions (VLM done, WA feedback sent)

---

## 14. API Endpoints

### 14.1 Feature Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/construction-qa/features` | qa:read | Paginated feature list with filters |
| GET | `/api/construction-qa/features/[featureId]` | qa:read | Single feature detail + photos + activity |
| POST | `/api/construction-qa/features/[featureId]/assign` | qa:write | Assign to reviewer |
| POST | `/api/construction-qa/features/[featureId]/escalate` | qa:supervisor | Escalate |

**GET /api/construction-qa/features query params:**

```
projectId     UUID     required
discipline    string   optional: civil|optical|splicing
workflowStatus string  optional
zoneNo        integer  optional
ponNo         integer  optional
priority      string   optional
assignedTo    string   optional
page          integer  default 1
pageSize      integer  default 25
search        string   optional
sortBy        string   default 'last_photo_at'
sortDir       string   default 'desc'
```

**Response shape:**

```typescript
interface FeaturesResponse {
  success: boolean;
  data: ConstructionQaReview[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    rework_needed: number;
    escalated: number;
  };
}
```

### 14.2 Photo Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/construction-qa/photos` | qa:read | Photos for a feature (`?reviewId=`) |
| POST | `/api/construction-qa/photos` | qa:write | Upload photo (manual source) |
| POST | `/api/construction-qa/photos/[photoId]/approve` | qa:write | Approve single photo |
| POST | `/api/construction-qa/photos/[photoId]/reject` | qa:write | Reject single photo |
| PUT | `/api/construction-qa/photos/[photoId]/step` | qa:write | Reassign checklist step |
| GET | `/api/construction-qa/photo-proxy` | qa:read | Proxy photo from MinIO/SP/Firebase (`?key=&source=`) |

### 14.3 VLM Processing

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/construction-qa/vlm-validate` | qa:write | Trigger VLM for feature or single photo |
| POST | `/api/construction-qa/vlm-validate/retry-failed` | qa:admin | Retry all failed VLM validations |

**POST /api/construction-qa/vlm-validate body:**

```typescript
interface VlmValidateRequest {
  reviewId: string;           // Validate all photos for this review
  photoId?: string;           // Or validate just this one photo
  discipline: 'civil' | 'optical' | 'splicing';
  forceRerun?: boolean;       // Re-run even if already validated
}
```

### 14.4 QA Decisions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/construction-qa/review` | qa:write | Save phase 2/3 review state (partial) |
| POST | `/api/construction-qa/final-decision` | qa:write | Submit Phase 4 decision |
| POST | `/api/construction-qa/send-feedback` | qa:write | Send Phase 5 WhatsApp feedback |

**POST /api/construction-qa/final-decision body:**

```typescript
interface FinalDecisionRequest {
  reviewId: string;
  decision: 'PASS' | 'FAIL' | 'REWORK_NEEDED';
  reasonCodes: string[];       // From discipline-specific reason code list
  notes: string;
  resubmissionDate?: string;   // ISO date, required for REWORK_NEEDED
  sendFeedback: boolean;       // If true, also trigger WA feedback
  feedbackMessage?: string;    // Override auto-generated message
}
```

### 14.5 Photo Ingestion

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/construction-qa/ingest-qfield` | qa:admin | Trigger QField photo ingestion for project |
| POST | `/api/construction-qa/ingest-sharepoint` | qa:admin | Trigger SharePoint sync for project |
| POST | `/api/construction-qa/wa-ingest` | internal | WA Bridge webhook (construction photos) |

**POST /api/construction-qa/ingest-qfield body:**

```typescript
interface QFieldIngestRequest {
  projectId: string;
  qfieldProjectId?: string;   // Specific QFieldCloud project ID
  discipline?: 'civil' | 'optical' | 'splicing' | 'all';
  sinceDate?: string;         // Only ingest photos captured after this date
  dryRun?: boolean;
}
```

### 14.6 Reporting

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/construction-qa/reporting/overview` | qa:read | Project KPI summary |
| GET | `/api/construction-qa/reporting/by-discipline` | qa:read | Discipline breakdown |
| GET | `/api/construction-qa/reporting/by-zone-pon` | qa:read | Zone/PON progress grid |
| GET | `/api/construction-qa/reporting/by-contractor` | qa:read | Contractor scorecard |
| GET | `/api/construction-qa/reporting/by-technician` | qa:read | Technician performance |
| GET | `/api/construction-qa/reporting/first-pass-rate` | qa:read | First-pass rate trends |
| GET | `/api/construction-qa/reporting/rework-funnel` | qa:read | Rework volume and time |
| GET | `/api/construction-qa/reporting/vlm-accuracy` | qa:read | VLM vs human agreement |

All reporting endpoints accept `projectId` (required), `startDate`, `endDate`, and `zoneNo` / `ponNo` as optional filters.

### 14.7 Health Check

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/construction-qa/health-check` | qa:read | Service health: VLM, WA Bridge, MinIO, SharePoint |

**Response:**

```typescript
interface HealthCheckResponse {
  overall: 'healthy' | 'degraded' | 'down';
  services: {
    vlm:         { status: 'up' | 'down'; latencyMs: number };
    wa_bridge:   { status: 'up' | 'down'; latencyMs: number };
    minio:       { status: 'up' | 'down'; latencyMs: number };
    sharepoint:  { status: 'up' | 'down' | 'disabled'; latencyMs: number };
    database:    { status: 'up' | 'down'; latencyMs: number };
  };
  queue: {
    vlm_pending:   number;
    vlm_failed:    number;
    wa_pending:    number;
    review_pending: number;
  };
}
```

---

## 15. Phased Delivery Plan

### Phase 1 — MVP: Civil QA (Poles)

**Target:** 3 weeks from kick-off
**Scope:** Civil discipline only. Photo sources: QField + manual upload.

#### Deliverables

1. **Database migrations** (200, 201, 202, 203) — create all construction QA tables
2. **QField ingestion** — read from `qfield_photo_validations` where `work_type = 'pole_installation'`, create `construction_qa_reviews` and `construction_qa_photos` records
3. **Photo proxy API** — `GET /api/construction-qa/photo-proxy` serving MinIO photos via `mc cat`
4. **VLM validation** — `POST /api/construction-qa/vlm-validate` with all 7 civil prompts
5. **5-phase QA wizard** — adapted for civil discipline
6. **Final decision API** — `POST /api/construction-qa/final-decision`
7. **WhatsApp feedback** — `POST /api/construction-qa/send-feedback` with bridge integration
8. **QA Centre page** — `/construction-qa` with poles tab, filter bar, data grid
9. **Feature review page** — `/construction-qa/[featureId]` with wizard
10. **Manual upload** — Firebase Storage upload for poles
11. **Health check** — service status endpoint
12. **Basic reporting** — Overview and By Zone/PON reports

#### Success Criteria for Phase 1

- At least one active project (e.g., Lawley) has all poles ingested from QField into `construction_qa_reviews`
- VLM running on all 7 civil steps
- QA reviewers can complete a full 5-phase wizard for a pole
- WhatsApp feedback sent on first rejection
- Pass/fail decisions reflected in `pon_stage_tracking.poles_planted`

### Phase 2 — Optical QA + SharePoint Sync

**Target:** 6 weeks from kick-off
**Prerequisites:** Phase 1 delivered and validated in production

#### Additional Deliverables

1. **Optical QA discipline** — 6-step checklist, VLM prompts, reason codes
2. **SharePoint ingestion service** — `sharepointConstructionService.ts` with folder path parsing
3. **SharePoint sync API** — `POST /api/construction-qa/ingest-sharepoint`
4. **Cable spans tab** — `/construction-qa` optical tab with span-specific columns
5. **Dependency validation** — optical review warns if linked poles have not passed civil QA
6. **By Discipline report**
7. **By Contractor report** (requires contractor → technician mapping in `wa_contacts` or `staff`)
8. **SharePoint env config** — `SHAREPOINT_CONSTRUCTION_ROOT_FOLDER_ID`

### Phase 3 — Splicing QA + WhatsApp Ingestion + Full Reporting

**Target:** 10 weeks from kick-off
**Prerequisites:** Phase 2 delivered and validated in production

#### Additional Deliverables

1. **Splicing QA discipline** — 7-step checklist, VLM prompts, reason codes
2. **WhatsApp ingestion** — `POST /api/construction-qa/wa-ingest` with caption parsing
3. **WA-specific construction groups** — per-project group JID configuration
4. **Dome joints tab** — `/construction-qa` splicing tab
5. **Resubmission tracking** — snapshot system, rework count badges
6. **Full reporting suite** — all 8 report types
7. **HITL dashboard** — VLM accuracy report with correction logging
8. **PON stage tracking integration** — `optical_complete` and `cwc_qa_complete` updates
9. **Technician performance** — per-technician QA metrics

---

## 16. Technical Dependencies and Risks

### 16.1 Dependencies

| Dependency | Status | Risk |
|------------|--------|------|
| VLM (Qwen3-VL on Velocity:8100) | Active, shared with Activate | MEDIUM — single GPU, shared load |
| WA Bridge (VPS 72.61.197.178:8083) | Active | LOW — stable since 2026-02-18 direct-send |
| MinIO / QFieldCloud | Active | LOW — existing photo proxy pattern works |
| Microsoft Graph API / SharePoint | Implemented in `sharepointDrSyncService.ts` | LOW — needs env config for construction folder |
| QField `qfield_photo_validations` table | Active with 6,000+ photos | LOW — read-only for ingestion |
| `joints`, `cable_spans`, `poles` tables | Active (migration 109) | LOW — already in production |
| `pon_stage_tracking` table | Active (migration 179) | LOW — write integration needed |
| `vlm_corrections` table | Active (migration 160) | LOW — add new module entries |

### 16.2 Risks

**RISK: VLM capacity under construction load**

The Activate module already sends hundreds of photos per day to VLM. Adding construction volume (potentially thousands of pole photos) could saturate the Qwen3-VL service on Velocity (single RTX 5090).

*Mitigation:*
- Construction VLM jobs are lower priority (background queue) vs. Activate (near real-time)
- Photo resize to 1024x768 before VLM (already done)
- Rate limiting: max 10 concurrent construction VLM requests
- Monitor GPU utilisation; GPU upgrade path is available if needed

**RISK: QField feature_id extraction is unreliable**

The current `qfield_photo_validations` table stores `feature_id` as a text field extracted from QField metadata. Some photos have null or incorrect `feature_id` values.

*Mitigation:*
- Triage queue for unmatched photos (workflow_status = 'pending', no feature linked)
- Manual assignment UI in wizard — supervisor links unmatched photos to features
- Phase 1 uses only photos with confirmed feature IDs; unmatched goes to triage

**RISK: SharePoint folder hierarchy is inconsistent**

Contractors may not follow the expected folder naming convention, causing photo ingestion failures.

*Mitigation:*
- Ingestion adapter uses fuzzy matching for folder names (case-insensitive, whitespace-tolerant)
- Unmatched folders go to a SharePoint review queue (separate from main QA queue)
- Phase 2 starts with manual ingestion trigger (not automated cron) so mismatches are caught early

**RISK: Neon conditional SQL fragmentation**

As documented in `CLAUDE.md`: conditional SQL fragments (`${cond ? sql\`AND x\` : sql\`\`}`) break with Neon. All reporting queries must use explicit query branches.

*Mitigation:*
- All reporting service methods follow the pattern from `reportingService.ts` in the Activate module
- Code review checklist item: no conditional SQL fragments
- `npm run antihall` validation before deploy

**RISK: Nested dynamic routes fail in Vercel**

As documented in `CLAUDE.md`, nested dynamic routes cause 405 errors in Vercel. All API endpoints use flat naming (`/api/construction-qa/final-decision` not `/api/construction-qa/[featureId]/decision`).

*Mitigation:*
- All mutation endpoints are flat with request body carrying the IDs
- Only read endpoints use path parameters where unambiguous (e.g., `features/[featureId]` is a GET-only route with no dynamic children)

**RISK: WhatsApp caption parsing fails for non-standard submissions**

Technicians may not follow the `POLE: LAW-001` caption format consistently.

*Mitigation:*
- Training / onboarding message sent to WA groups when construction groups are configured
- Triage queue for unmatched captions (supervisor assigns manually)
- Phase 3 deployment is gradual — test with one project before enabling for all

---

## 17. Migration Strategy

### 17.1 Relationship to Existing QField QA Module

The existing QField QA module (`src/modules/qfield-qa/`) and its associated table `qfield_photo_validations` are **not replaced**. They remain in production for:
- The `/qfield/qa` dashboard (photo browsing and quick approve/reject)
- The automated validation pipeline (cron VLM on QField photos)
- WhatsApp rejection notifications from the automated pipeline

The Civil QA module **supplements** the existing module. It reads from `qfield_photo_validations` as an input source but creates its own review records in `construction_qa_reviews`.

**Data relationship:**

```
qfield_photo_validations (existing)
        │
        │ ingestion read (Phase 1)
        ▼
construction_qa_photos  ─── linked to ──► construction_qa_reviews
        │
        │ feature_id lookup
        ▼
poles / cable_spans / joints (existing tables from migration 109)
```

### 17.2 Existing Photos (6,000+ in qfield_photo_validations)

The 6,000+ photos already imported into `qfield_photo_validations` (LAW_Pole_Audit, MOA_Pole_Audit, etc.) are eligible for Civil QA ingestion. The initial ingest script:

```typescript
// One-time backfill: import existing qfield_photo_validations into construction_qa
// Filter: work_type IN ('pole_installation', 'cable_stringing', 'dome_joint')
// Create construction_qa_reviews records for each unique feature_id
// Create construction_qa_photos records for each photo
// Preserve existing vlm_confidence and vlm_feedback from qfield_photo_validations
// Set workflow_status = 'pending' for all (requires human review in new wizard)
```

This backfill runs as a one-time admin operation via `POST /api/construction-qa/ingest-qfield?backfill=true&projectId=...`.

### 17.3 Avoiding Duplicate Processing

Photos that already exist in `construction_qa_photos` (matched by `source = 'qfield'` and `storage_key = qfield_photo_validations.photo_key`) are skipped during subsequent ingestion runs (unique constraint on `source, storage_key`).

### 17.4 Permission / RBAC Integration

The Civil QA module uses the existing role-based access control system. New permissions to add:

```sql
-- Add to your permissions table / RBAC config:
INSERT INTO permissions (code, label, module) VALUES
    ('qa:construction:read',       'View construction QA',    'construction-qa'),
    ('qa:construction:write',      'Review construction QA',  'construction-qa'),
    ('qa:construction:admin',      'Admin construction QA',   'construction-qa'),
    ('qa:construction:supervisor', 'Supervisor actions',      'construction-qa');
```

Default role assignments:
- `QA Reviewer` → `qa:construction:read` + `qa:construction:write`
- `Project Manager` → `qa:construction:read`
- `QA Manager` → all four permissions
- `Admin` → all four permissions

### 17.5 Navigation Integration

Add Civil QA to the main application navigation under a "Quality" section, alongside the existing Activate QA Centre link. Update `AppLayout` navigation configuration.

```typescript
// In navigation config:
{
  label: 'Civil QA',
  href: '/construction-qa',
  icon: HardHat,
  permission: 'qa:construction:read',
}
```

### 17.6 Feature Flag

To allow incremental rollout, wrap Civil QA routes in a feature flag:

```bash
# .env.local
ENABLE_CONSTRUCTION_QA=true
```

```typescript
// In middleware or page-level auth check:
if (!process.env.ENABLE_CONSTRUCTION_QA) {
  return res.status(404).json({ error: 'Not found' });
}
```

Phase 1 deploys with the flag set only in dev and staging. Enable in production after Phase 1 validation is complete.

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| CCA H4 | Copper Chrome Arsenic pressure treatment for wooden poles, required by SANS 754 |
| Civil | Phase of fiber deployment covering pole planting and excavation |
| Dome Joint | Weatherproof enclosure for optical fiber splices (also: splice closure) |
| FiberTime | Network operator standard referenced for construction quality requirements |
| GPKG | GeoPackage format — SQLite-based geospatial data format used by QField |
| HITL | Human-in-the-loop — system where human corrections improve AI over time |
| MinIO | S3-compatible object storage used by QFieldCloud for photo storage |
| Optical | Phase of fiber deployment covering cable stringing between poles |
| PON | Passive Optical Network — a grouping of drops served by a single splitter |
| QField | Mobile GIS app used by field technicians for data capture |
| QFieldCloud | Cloud service synchronizing QField data between devices and server |
| Slack Bracket | Hardware mounted on pole to hold the emergency fiber service loop |
| Slack Coil | Coiled reserve length of cable at a departure pole for future splicing |
| SOW | Schedule of Works — the project plan defining drops, poles, and zones |
| VLM | Vision Language Model — multimodal AI that analyses images and text |
| WA Bridge | WhatsApp gateway service running on VPS 72.61.197.178:8083 |

## Appendix B: Environment Variables

```bash
# Shared with existing modules (no changes needed)
DATABASE_URL=...
NEON_DATABASE_URL=...
FIREBASE_STORAGE_BUCKET=...

# VLM (shared, no changes needed)
VLM_ENDPOINT=http://100.96.203.105:8100

# WhatsApp Bridge (shared, no changes needed)
WA_BRIDGE_URL=http://72.61.197.178:8083
WA_BRIDGE_SECRET=...

# SharePoint (shared auth, new folder config)
SHAREPOINT_TENANT_ID=...
SHAREPOINT_CLIENT_ID=...
SHAREPOINT_CLIENT_SECRET=...
SHAREPOINT_SITE_ID=...
SHAREPOINT_DRIVE_ID=...
SHAREPOINT_CONSTRUCTION_ROOT_FOLDER_ID=...  # NEW

# Feature flag
ENABLE_CONSTRUCTION_QA=true
```

## Appendix C: Database Migration Sequence

Apply in this order:

```bash
psql $NEON_DATABASE_URL -f scripts/migrations/200_construction_qa_reviews.sql
psql $NEON_DATABASE_URL -f scripts/migrations/201_construction_qa_photos.sql
psql $NEON_DATABASE_URL -f scripts/migrations/202_construction_qa_activity.sql
psql $NEON_DATABASE_URL -f scripts/migrations/203_construction_qa_assignments.sql
```

Then run the one-time backfill via API:

```bash
curl -X POST https://dev.fibreflow.app/api/construction-qa/ingest-qfield \
  -H "Content-Type: application/json" \
  -d '{"backfill": true, "discipline": "civil", "dryRun": true}'
# Review dry-run output, then run without dryRun
```
