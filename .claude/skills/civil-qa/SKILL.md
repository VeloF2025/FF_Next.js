---
name: civil-qa
description: Civil QA (Construction QA) module reference. Pre-activation quality assurance for civil, optical, and activation disciplines with VLM validation and human QA review. USE WHEN working on construction QA features or civil quality assurance.
user-invocable: false
---

# Civil QA Module

> **Last updated:** 2026-02-21  
> **Also known as:** Construction QA (original name — module dir is `construction-qa`)  
> **Status:** Active

## Overview

Pre-activation quality assurance for three physical infrastructure disciplines. Field teams submit photos via QField; the system runs VLM validation and routes for human QA review before a connection is activated.

## Three Disciplines

| Discipline | Feature | What's Reviewed |
|-----------|---------|----------------|
| **Civil** | Pole (`pole`) | Pole planting — depth, alignment, concrete |
| **Optical** | Cable span (`cable_span`) | Cable stringing — tension, sag, lashing |
| **Splicing** | Dome joint (`joint`) | Dome joint installation — closure, seal, labelling |

## Workflow

```
QField Photo Upload
        │
        ▼
ingest-qfield.ts  →  construction_qa_reviews created (status: pending)
        │
        ▼
VLM Validation  →  vlm_status: pending → processing → completed/failed
        │
        ▼
Human QA Review  →  wizard UI, step-by-step checklist per discipline
        │
        ├── PASS         →  feature approved, cleared for activation
        ├── FAIL         →  permanently failed
        └── REWORK_NEEDED →  sent back to field, resubmission expected
```

## Workflow Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting VLM or review assignment |
| `in_review` | QA reviewer has opened the wizard |
| `approved` | QA PASS decision made |
| `rejected` | QA FAIL decision made |
| `rework_needed` | Sent back to field for rework |
| `escalated` | Escalated to senior reviewer |
| `unidentified` | Feature ID not found / non-standard |

## Database Tables (Migrations 200–203)

| Table | Purpose |
|-------|---------|
| `construction_qa_reviews` | Main review record per feature |
| `construction_qa_photos` | Photos attached to a review |
| `construction_qa_activity` | Full audit trail (every state change) |
| `construction_qa_assignments` | Reviewer assignments |

## Key Types

```typescript
type Discipline = 'civil' | 'optical' | 'splicing'
type FeatureType = 'pole' | 'cable_span' | 'joint'
type WorkflowStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'rework_needed' | 'escalated' | 'unidentified'
type QaDecision = 'PASS' | 'FAIL' | 'REWORK_NEEDED'
type VlmStatus = 'pending' | 'processing' | 'completed' | 'failed'
type PhotoSource = 'qfield' | 'sharepoint' | 'whatsapp' | 'upload'
```

## API Routes (`/api/construction-qa/`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/features` | GET | List features for review queue |
| `/review` | GET/POST | Get/update a review |
| `/final-decision` | POST | Submit QA decision (PASS/FAIL/REWORK_NEEDED) |
| `/ingest-qfield` | POST | Ingest photos from QField |
| `/photo-proxy` | GET | Proxy photo from QField/SharePoint |
| `/vlm-validate` | POST | Trigger VLM validation for a review |
| `/reporting/*` | GET | Reporting endpoints |

## Module Source

```
src/modules/construction-qa/
├── components/     # Review wizard, photo viewer, decision UI
├── context/        # React context for review state
├── hooks/          # Data fetching hooks
├── services/       # Business logic
└── types/          # TypeScript types (construction.types.ts)
```

## VLM Integration

VLM validates photos against discipline-specific checklists:
- **Civil:** pole depth marker visible, no lean, concrete poured correctly
- **Optical:** cable tension, sag within tolerance, correct lashing
- **Splicing:** dome closed, splice trays labelled, cable entry sealed

VLM result populates checklist steps; QA reviewer can override any step.

## QField Integration

Photos ingested via `/api/construction-qa/ingest-qfield`:
- Accepts QField project mapping (not 1:1 with FibreFlow project names)
- Creates `construction_qa_reviews` + `construction_qa_photos` records
- Triggers VLM validation pipeline immediately

## WhatsApp Photo Integration (Added Mar 2026)

Civil group photos flow into QA reviews via the **Pole Install ACK Pipeline**:

```
WhatsApp civil group → Bridge (inline photo) → /api/field-ops/wa-message
    → poleInstallAckService.ts (VLM classify + session tracking)
    → On session complete → poleInstallCompletionService.ts
        → Creates construction_qa_reviews record
        → Sets civil step flags from classified photos
        → Links field_ops_wa_photos → construction_qa_photos
```

**Key services:**
| Service | File | Purpose |
|---------|------|---------|
| Classifier | `src/modules/field-ops/services/poleInstallClassifier.ts` | VLM step classification (9 steps) |
| ACK Service | `src/modules/field-ops/services/poleInstallAckService.ts` | Session tracking + real-time ACK |
| Completion | `src/modules/field-ops/services/poleInstallCompletionService.ts` | Session → QA review link |

**PhotoSource**: `'whatsapp'` — photos from this pipeline use the `whatsapp` source type in `construction_qa_photos`.

## Recent Changes

| Date | Change |
|------|--------|
| Mar 02, 2026 | Added WhatsApp photo integration via pole install ACK pipeline |
| Feb 20, 2026 | Added photo lightbox with zoom/pan |
| Feb 20, 2026 | Added `unidentified` workflow status for non-standard feature IDs |
| Feb 20, 2026 | Renamed from "Construction QA" → "Civil QA" in all user-facing labels |
| Feb 2026 | Dark theme dropdowns, security hardening |

## Related

- `/qfield-sync` — QField data synchronisation
- `/activate` — Downstream activation (Civil QA clears features for activation)
- `/vlm` — VLM infrastructure
- `/skills/vlm-ops.md` — VLM operations and cron
- `/skills/infrastructure/whatsapp.md` — WhatsApp bridge + pole install ACK pipeline
- `/skills/modules/wa-monitor.md` — WA Monitor triggers for pole sessions
