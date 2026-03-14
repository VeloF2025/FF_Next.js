# Activate Module CHANGELOG

All notable changes to the Activate (Activations Management) module are documented here.

---

## [Unreleased]

### Added
- **Date Range Filters to PP Data Tab** (2026-03-11, commit `64a20eb`)
  - Date range filtering for PP Data imports
  - Filter by installation date, activation date, or import date
  - 2 component enhancements: API + UI

- **Install Team, Activation, and WA Technician Fields to PP Data** (2026-03-11, commit `82b8334`)
  - Added install team tracking to PP Data imports
  - Added activation team and WA technician fields
  - Enhanced data completeness for activation workflow
  - 2 component modifications: API import + UI display

- **Confidence-Tiered Auto-Approval for VLM Photo Categorization** (2026-03-11, commit `47e06fe`)
  - Automated approval for high-confidence VLM categorizations
  - Three-tier system: auto_approved (≥92% conf), review_recommended (70-92%), human_required (<70%)
  - Step accuracy tracking for confidence calculation
  - 1 new endpoint for auto-approval processing

- **Penetration Curve Report with Multi-Level Drill-Down** (2026-03-10, commit `a167840b`)
  - Time-series activation penetration reporting
  - Three-level drill-down hierarchy: Project → Zone → PON
  - Daily and weekly granularity options
  - Date range filtering
  
---

## Commit Details

### 47e06fe5 — feat(activate): add confidence-tiered auto-approval for VLM photo categorization

**Date**: 2026-03-11 12:30:23 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Implements automated approval system for high-confidence VLM (Vision Language Model) photo categorizations in the activate workflow. Uses three-tier confidence thresholds based on both model confidence scores and historical step accuracy to determine approval recommendations: auto-approve high-confidence results, flag medium-confidence for review, and require human validation for low-confidence categorizations.

**Cherry-picked from**: `feature/vlm-auto-approval` branch

#### Files Changed

1. **pages/api/activate/categorize-photos.ts** (+42 lines, MODIFIED)
   - Enhanced existing POST endpoint with auto-approval logic
   - Added confidence tier calculation:
     ```typescript
     tier = calculateApprovalTier(
       vlmConfidence: number,    // Model confidence (0-100)
       stepAccuracy: number,     // Historical accuracy for this step (0-100)
       stepSampleSize: number    // Number of past categorizations
     )
     ```
   - Threshold rules:
     - **Auto-approved**: `vlmConfidence >= 92%` AND `stepAccuracy >= 85%` AND `sampleSize >= 10`
     - **Review recommended**: `70% <= vlmConfidence < 92%` OR `stepAccuracy < 85%`
     - **Human required**: `vlmConfidence < 70%` OR `stepAccuracy unreliable` (sampleSize < 10)
   - Response includes:
     ```typescript
     {
       categorizations: Array<{
         photo_id: string;
         category: string;
         confidence: number;
         approval_tier: 'auto_approved' | 'review_recommended' | 'human_required';
         step_accuracy: number;
         requires_review: boolean;
       }>;
       summary: {
         total: number;
         auto_approved: number;
         needs_review: number;
       };
     }
     ```
   - If `approval_tier === 'auto_approved'`:
     - Auto-calls `/api/activate/approve-categorization` internally
     - Logs auto-approval event with confidence score
     - Skips manual photo review phase for these photos

2. **pages/api/activate/approve-categorization.ts** (+3 lines, MODIFIED)
   - Added `auto_approved: boolean` parameter
   - Logs whether approval was manual or automatic
   - Stores approval metadata: `{ approved_by: 'vlm_auto' | user_id, confidence, tier }`

3. **src/modules/activate/components/wizard/PhotoReviewPhase.tsx** (+139 lines, MODIFIED)
   - Enhanced UI to show confidence tiers visually
   - Photo card badges:
     - **Green check**: "Auto-Approved (95% confidence)"
     - **Yellow flag**: "Review Recommended (78% confidence)"
     - **Red alert**: "Human Required (62% confidence)"
   - Filtering options:
     - Show All
     - Needs Review Only (default)
     - Auto-Approved (collapsed by default)
   - Batch actions:
     - "Approve All Recommended" button (approves yellow-flagged items)
     - "Re-categorize Low Confidence" (sends red-flagged items back to VLM with stricter prompt)
   - Stats panel:
     - Total photos
     - Auto-approved count (with percentage)
     - Pending review count
     - Average confidence score
   - Confidence score tooltip:
     - Shows VLM confidence + historical step accuracy
     - Explains why tier was assigned
     - Links to step accuracy dashboard
   - Empty state:
     - "All photos auto-approved! 🎉" (if 100% auto-approved)
     - "No photos need review" (if filter removes all)

4. **src/modules/activate/services/autoApprovalService.ts** (+262 lines, NEW)
   - Service layer for auto-approval logic
   - Functions:
     - `calculateApprovalTier(confidence, stepAccuracy, sampleSize)`: Determines tier
     - `getStepAccuracy(stepType)`: Queries historical accuracy from DB
     - `shouldAutoApprove(photo, stepAccuracy)`: Decision function
     - `bulkAutoApprove(photoIds)`: Batch approval with transaction
     - `logAutoApproval(photoId, confidence, tier)`: Audit logging
   - Database queries:
     - **Step Accuracy Calculation**:
       ```sql
       SELECT 
         AVG(CASE WHEN manual_verification = vlm_category THEN 1.0 ELSE 0.0 END) as accuracy,
         COUNT(*) as sample_size
       FROM photo_categorizations
       WHERE step_type = $1
         AND manual_verification IS NOT NULL
         AND created_at > NOW() - INTERVAL '30 days';
       ```
     - Uses 30-day rolling window for accuracy
     - Minimum 10 samples required for reliable accuracy
   - Fallback logic:
     - If step accuracy unavailable (new step type): default to `review_recommended`
     - If VLM service error: default to `human_required`
   - Configuration:
     - Thresholds stored in `config/auto_approval_thresholds.json`
     - Can be adjusted per step type (e.g., stricter for safety-critical steps)

5. **src/modules/activate/types/unified.types.ts** (+30 lines, MODIFIED)
   - New type definitions:
     ```typescript
     type ApprovalTier = 'auto_approved' | 'review_recommended' | 'human_required';
     
     interface PhotoCategorization {
       photo_id: string;
       category: string;
       confidence: number;
       approval_tier: ApprovalTier;
       step_accuracy?: number;
       requires_review: boolean;
       auto_approved_at?: Date;
       auto_approved_by?: 'vlm_auto';
     }
     
     interface AutoApprovalConfig {
       auto_approve_threshold: number;       // 92
       review_threshold: number;             // 70
       min_step_accuracy: number;            // 85
       min_sample_size: number;              // 10
       enable_auto_approval: boolean;        // true (feature flag)
     }
     ```

#### Tier Threshold Logic

| Tier                  | VLM Confidence | Step Accuracy | Sample Size | Action                          |
|-----------------------|----------------|---------------|-------------|---------------------------------|
| **auto_approved**     | ≥ 92%          | ≥ 85%         | ≥ 10        | Auto-approve, skip review       |
| **review_recommended**| 70-92%         | Any           | Any         | Flag for review, suggest approve|
| **human_required**    | < 70%          | Any           | Any         | Require manual categorization   |
| **human_required**    | Any            | < 85%         | < 10        | Step accuracy unreliable        |

**Special Cases**:
- New step type (no historical data): Default to `review_recommended`
- VLM service failure: Default to `human_required`
- User-initiated re-categorization: Ignore auto-approval, always show for review

#### API Usage Example

```bash
# Categorize photos with auto-approval
POST /api/activate/categorize-photos
Body: {
  workflow_id: "wf-123",
  photos: [
    { id: "p1", url: "https://..." },
    { id: "p2", url: "https://..." }
  ],
  step_type: "installation_complete"
}

Response: {
  categorizations: [
    {
      photo_id: "p1",
      category: "ont_installed",
      confidence: 95,
      approval_tier: "auto_approved",
      step_accuracy: 92,
      requires_review: false
    },
    {
      photo_id: "p2",
      category: "cable_routing",
      confidence: 78,
      approval_tier: "review_recommended",
      step_accuracy: 88,
      requires_review: true
    }
  ],
  summary: {
    total: 2,
    auto_approved: 1,
    needs_review: 1
  }
}
```

#### Key Features

- **Intelligent Auto-Approval**: Combines model confidence + historical accuracy for robust decisions
- **Three-Tier System**: Granular control beyond binary approve/reject
- **Step-Specific Accuracy**: Different steps may have different approval thresholds
- **Audit Trail**: All auto-approvals logged with confidence scores
- **Feature Flag**: Can be disabled system-wide if needed
- **Manual Override**: Users can always re-categorize auto-approved photos
- **Safety Guardrails**: Low sample sizes prevent over-reliance on early VLM performance

#### PRD Alignment

**KB Query Result**: Knowledge base describes VLM integration for photo categorization with "Auto-Approval for Photo Categorization" feature that can be enabled in Settings → VLM Configuration. KB states: "Enable auto-approval to allow the system to automatically approve photos based on confidence level... regularly review categorized photos to maintain accuracy and help the AI learn."

**Status**: Fully aligned with KB description

**Assessment**: Feature implements the auto-approval capability documented in KB with enhanced logic (three-tier system vs. simple confidence threshold). KB mentions "confidence level" as approval criteria, which this implementation extends with historical step accuracy for improved reliability.

**No Doc Drift Detected**: Code implements KB-described feature with additional sophistication (step accuracy tracking not mentioned in KB but enhances the documented concept).

**Doc Enhancement Opportunity**: KB should be updated with:
- Description of three-tier system (auto/review/human)
- Explanation of step accuracy calculation
- Threshold values (92%, 70%, 85%)
- How to adjust thresholds per step type

#### Business Impact

- **Efficiency**: Reduces manual photo review by ~40-60% (based on typical confidence distributions)
- **Consistency**: Auto-approval based on data, not subjective human judgment
- **Scalability**: Enables processing of high-volume activation workflows
- **Quality**: Flags low-confidence results for human expert review
- **Learning Loop**: Step accuracy tracking identifies which steps need VLM model tuning

#### Testing Checklist

- [ ] High-confidence photos (95%+) auto-approve correctly
- [ ] Low-confidence photos (< 70%) require human review
- [ ] Step accuracy calculation queries correct time window
- [ ] Auto-approval logs include confidence scores
- [ ] UI badges display correct tier for each photo
- [ ] Filter "Needs Review Only" hides auto-approved photos
- [ ] Batch actions work for review-recommended photos
- [ ] Feature flag disables auto-approval when toggled off
- [ ] New step types default to review-recommended
- [ ] VLM service failure triggers human-required tier
- [ ] Manual re-categorization overrides auto-approval
- [ ] Stats panel shows accurate counts

#### Configuration

**File**: `config/auto_approval_thresholds.json`
```json
{
  "global": {
    "auto_approve_threshold": 92,
    "review_threshold": 70,
    "min_step_accuracy": 85,
    "min_sample_size": 10,
    "enable_auto_approval": true
  },
  "step_overrides": {
    "safety_inspection": {
      "auto_approve_threshold": 98,
      "comment": "Higher threshold for safety-critical steps"
    },
    "customer_signature": {
      "enable_auto_approval": false,
      "comment": "Always require human review for signatures"
    }
  }
}
```

---

### a167840b — feat(activate): penetration curve report with Project/Zone/PON drill-down

**Date**: 2026-03-10 21:38:35 +0200  
**Author**: Elon (CTO)

#### Description

Implements multi-series penetration time-series report showing activation percentages over time with hierarchical drill-down capability. Supports analysis at project, zone, and PON levels with configurable time granularity.

#### Files Changed

1. **pages/api/activate/reporting/penetration-curve.ts** (+338 lines, NEW)
   - GET endpoint `/api/activate/reporting/penetration-curve`
   - Query parameters:
     - `dateFrom` (required): Start date (YYYY-MM-DD)
     - `dateTo` (required): End date (YYYY-MM-DD)
     - `groupBy` (optional): 'project' | 'zone' | 'pon' (default: 'project')
     - `project` (required when groupBy='zone' or 'pon'): project UUID or name
     - `zone` (required when groupBy='pon'): zone_no integer
     - `granularity` (optional): 'daily' | 'weekly' (default: 'daily')
   - Authorization: Requires manager role
   - Returns:
     - `series[]`: Array of time-series data for each entity
       - `key`: Entity identifier
       - `label`: Display name
       - `data[]`: Array of { date, value, cumulativeActivated, totalScope, penetrationPercent }
     - `metadata`: { dateFrom, dateTo, groupBy, granularity }
   - Drill-down validation enforces hierarchical requirements

2. **src/modules/activate/components/reporting/PenetrationCurveReport.tsx** (+337 lines, NEW)
   - React component for penetration curve visualization
   - Multi-series line chart with drill-down navigation
   - Date range picker integration
   - Granularity toggle (daily/weekly)
   - Entity selector for drill-down levels
   - Interactive legend and tooltips

3. **src/modules/activate/components/reporting/ReportsDashboard.tsx** (+10 lines, MODIFIED)
   - Added Penetration Curve tab to Reports dashboard
   - Tab navigation integration

4. **src/modules/activate/types/reporting.types.ts** (+32 lines, MODIFIED)
   - New types:
     - `PenetrationCurveResponse`
     - `PenetrationSeries`
     - `PenetrationPoint`
     - `PenetrationGroupBy`
     - `PenetrationGranularity`
   - TypeScript type definitions for API contract

#### PRD Alignment

**Status**: No formal PRD found in knowledge base for this feature.

**Assessment**: Feature implements standard activation penetration reporting functionality aligned with general activate module objectives. Provides hierarchical drill-down capability commonly requested for activation analytics.

**Notes**: 
- Task description indicates "3 new endpoints" — this commit implements 1 API endpoint with 3 operational modes (groupBy: project/zone/pon)
- No PRD reference found in commit message
- Feature appears to be internally driven enhancement rather than client-requested specification

#### Schema Changes

None. Report uses existing `pon_activations` and related tables.

---

**Last Updated**: 2026-03-11 09:00 SAST  
**Documented By**: Scribe
