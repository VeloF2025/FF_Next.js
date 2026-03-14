# Activate Module

**Activation Management for Fibre Network Deployments**

The Activate module handles the complete activation workflow for fibre network installations—from photo verification and equipment inspection to staff acknowledgment and deployment sign-off. It automates photo categorization with Vision Language Models (VLM), tracks activation progress through multi-level drill-down analytics, and ensures quality compliance before final handoff.

---

## Purpose

The Activate module solves three critical problems in fibre network operations:

1. **Manual Photo Review Bottleneck** — Activation teams must review hundreds of installation photos per project. The module uses intelligent VLM-powered photo categorization with confidence-tiered auto-approval to reduce manual effort by 40-60%.

2. **Visibility & Progress Tracking** — Project managers need real-time visibility into activation progress across projects, zones, and network segments (PONs). The module provides hierarchical penetration reporting with drill-down analytics.

3. **Quality & Compliance** — Every activation must meet safety standards and be properly verified before sign-off. The module enforces a structured activation workflow with documented approval gates and audit trails.

---

## Key Features

- **Confidence-Tiered Auto-Approval for VLM Photo Categorization** — Automated approval system combining model confidence (92%+) with historical step accuracy (85%+) to determine whether photos should auto-approve, need review, or require human intervention. Includes visual badges and filtering options.

- **Penetration Curve Reporting with Multi-Level Drill-Down** — Time-series activation metrics showing penetration percentages over time. Drill down from Project → Zone → PON with daily/weekly granularity options and date range filtering.

- **Photo Review Workflow** — Streamlined UI for manual photo categorization review. Batch actions for approving multiple photos and re-categorizing low-confidence items.

- **Activity Log & Audit Trail** — Full audit history of all activation decisions, approvals, and rejections with timestamps and user attribution.

- **Staff Acknowledgment & Sign-Off** — Collect field staff signatures and acknowledgments for deployment completion.

- **Integration with WhatsApp & Document Platform** — Fetch photos directly from WhatsApp messages and import deployment records from OES/PP systems.

---

## Module Structure

```
src/modules/activate/
├── components/
│   ├── reporting/
│   │   ├── PenetrationCurveReport.tsx      # Multi-series chart with drill-down navigation
│   │   ├── ReportsDashboard.tsx            # Reports tab container
│   │   └── ...
│   └── wizard/
│       ├── PhotoReviewPhase.tsx            # Auto-approval UI with confidence tiers
│       ├── ActivationWizard.tsx            # Main wizard flow orchestrator
│       └── ...
├── context/
│   └── ActivationContext.tsx               # Shared state for activation workflow
├── hooks/
│   ├── useActivationWorkflow.ts            # Workflow state management
│   ├── usePenetrationReporting.ts          # Reporting data fetching
│   └── ...
├── services/
│   ├── reporting/
│   │   └── penetrationService.ts           # Penetration curve queries
│   ├── activity-log/
│   │   └── activityLogService.ts           # Audit trail operations
│   ├── autoApprovalService.ts              # Confidence-tier logic
│   └── ...
├── types/
│   ├── unified.types.ts                    # Approval tier types, photo categorization
│   ├── reporting.types.ts                  # Penetration curve types
│   └── ...
└── utils/
    ├── photoValidation.ts                  # Photo quality checks
    ├── activationStates.ts                 # Workflow state constants
    └── ...

pages/api/activate/
├── categorize-photos.ts                    # POST: VLM categorization with auto-approval
├── approve-categorization.ts               # POST: Manual photo approval
├── reporting/
│   └── penetration-curve.ts                # GET: Penetration metrics with drill-down
├── activity-log.ts                         # GET: Audit trail
├── fetch-photos.ts                         # GET: WhatsApp/document photos
├── validate-prerequisites.ts               # GET: Workflow prerequisites
├── summary.ts                              # GET: Activation status summary
├── dr-acknowledgment.ts                    # POST: Staff sign-off
└── ...
```

### Directory Purposes

- **components/** — React UI components for activation workflows, reporting, and photo review
- **context/** — Shared React Context for activation state across components
- **hooks/** — Custom React hooks for workflow management and data fetching
- **services/** — Business logic layer: approval tier calculation, penetration queries, audit logging
- **types/** — TypeScript type definitions for all activation data structures
- **utils/** — Helper functions for validation, state constants, and calculations
- **pages/api/activate/** — Next.js API endpoints for all activation operations

---

## Key Concepts

### Approval Tiers

Photos are categorized into three approval tiers based on VLM confidence and historical step accuracy:

| Tier | Condition | Action |
|------|-----------|--------|
| **auto_approved** | VLM ≥92% AND Step Accuracy ≥85% AND Sample Size ≥10 | Skip manual review, auto-approve |
| **review_recommended** | 70% ≤ VLM < 92% OR Step Accuracy < 85% | Flag for review, suggest approve |
| **human_required** | VLM < 70% OR Step Accuracy unreliable | Require manual categorization |

### Penetration Metrics

**Penetration** measures the percentage of network scope that has been successfully activated:

```
Penetration % = (Cumulative Activated / Total Scope) × 100
```

Tracked at three hierarchy levels:
- **Project Level** — Aggregate across all zones
- **Zone Level** — Aggregate across all PONs (network segments)
- **PON Level** — Individual network segment activation

### Activation Workflow States

- **Not Started** — Deployment not yet initiated
- **In Progress** — Photo review and staff verification underway
- **Awaiting Approval** — Ready for manager sign-off
- **Completed** — All verification steps finished, final sign-off recorded
- **On Hold** — Waiting for issue resolution before proceeding

---

## Important Files

### API Entry Points

- **categorize-photos.ts** — POST /api/activate/categorize-photos
  - Sends photos to VLM service
  - Calculates approval tiers
  - Returns auto-approved photos summary
  - Auto-approves high-confidence photos internally

- **penetration-curve.ts** — GET /api/activate/reporting/penetration-curve
  - Query params: `dateFrom`, `dateTo`, `groupBy` (project|zone|pon), `granularity` (daily|weekly)
  - Returns time-series penetration data with drill-down capability

- **activity-log.ts** — GET /api/activate/activity-log
  - Audit trail of all activation decisions
  - Filters by workflow, photo, user, date range

### Key Components

- **PenetrationCurveReport.tsx** — Multi-series line chart visualization
- **PhotoReviewPhase.tsx** — Photo card UI with confidence badges and batch actions
- **ActivationWizard.tsx** — Step-by-step workflow orchestrator

### Key Services

- **autoApprovalService.ts** — Tier calculation, step accuracy queries, bulk approval
- **penetrationService.ts** — Time-series aggregation, drill-down navigation
- **activityLogService.ts** — Audit event logging and retrieval

### Type Definitions

- **ApprovalTier** — 'auto_approved' | 'review_recommended' | 'human_required'
- **PhotoCategorization** — photo_id, category, confidence, approval_tier, step_accuracy
- **PenetrationPoint** — date, penetration_percent, cumulative_activated, total_scope
- **ActivationSummary** — project status, progress, completion percentage

---

## Known Issues

### ⚠️ Auto-Ack Trigger Pipeline Broken (Since 2026-03-09)

**Issue:** The automatic staff acknowledgment (auto-ack) trigger in the DR photo submission → ack flow is currently non-functional due to an upstream pipeline issue.

**Impact:** 
- Photos submitted via WhatsApp do not automatically trigger staff ack generation
- This requires manual acknowledgment batch processing 3–4 times daily to keep workflows moving
- Photo review workflow and categorization remain unaffected; only the final ack step is impacted

**Current Workaround:** Manual ack batches are run by ops team to cover the gap until the pipeline is repaired.

**Status:** Pending root cause analysis and fix in the photo-pipeline service.

**Action for Developers:** If you're working on the DR photo flow or ack generation, check with Jarvis or Hein for the latest status. Do not assume auto-ack will fire; design for manual fallback.

---

## Getting Started

### Understanding the Photo Approval Workflow

1. **Read** `CHANGELOG.md` to understand recent features (confidence-tiered auto-approval, penetration reporting)
2. **Explore** `src/modules/activate/components/wizard/PhotoReviewPhase.tsx` to see the UI for photo approval
3. **Review** `src/modules/activate/services/autoApprovalService.ts` to understand tier calculation logic
4. **Check** `pages/api/activate/categorize-photos.ts` to see how photos flow through the system

### Understanding Penetration Reporting

1. **Navigate to** `src/modules/activate/components/reporting/PenetrationCurveReport.tsx` for the chart component
2. **Review** `pages/api/activate/reporting/penetration-curve.ts` for API contract and drill-down query logic
3. **Examine** `src/modules/activate/services/reporting/penetrationService.ts` for SQL aggregation patterns
4. **Check** `types/reporting.types.ts` for data structure definitions

### Adding a New Activation Step

1. Create a new component in `src/modules/activate/components/wizard/Step[N][Name].tsx`
2. Add step state to `useActivationWorkflow.ts` hook
3. Register step in `ActivationWizard.tsx` navigation
4. Create API endpoint in `pages/api/activate/` if data persistence is needed
5. Update workflow constants in `utils/activationStates.ts`

### Debugging Auto-Approval Decisions

1. Check confidence scores in `PhotoReviewPhase.tsx` UI badges
2. Query step accuracy: `SELECT AVG(accuracy), COUNT(*) FROM photo_categorizations WHERE step_type = $1 AND created_at > NOW() - INTERVAL '30 days'`
3. Review config thresholds in `config/auto_approval_thresholds.json`
4. Check audit trail in `activity-log.ts` for approval reasons

---

## See Also

- **CHANGELOG.md** — Recent features and detailed commit history
- **pages/api/activate/** — All API endpoints with request/response examples
- **src/modules/activate/types/unified.types.ts** — Complete type definitions
- **Architecture** — See main FibreFlow architecture docs for module integration patterns
- **Database Schema** — Contact the DBA for `photo_categorizations`, `pon_activations`, and related tables

---

**Last Updated**: 2026-03-11  
**Module Owner**: Hein  
**Maintainer**: Claude Sonnet 4.5
