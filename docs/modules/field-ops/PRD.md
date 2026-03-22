# Field Operations: Pole Plant Date Integration — PRD

**Feature**: Field Ops > Step 7 pole plant date tracking
**Commit**: 58b026d (field-ops changes)
**Status**: Released (2026-03-14)
**Priority**: P2 (Data accuracy improvement)
**Module**: field-ops
**Related**: build, construction-qa, qfield
**Last Updated**: 2026-03-16

---

## Problem Statement

QField captures 7-step photographic evidence during pole planting:
- **Step 1** — Before photo (ground level, no pole)
- **Step 7** — After photo (pole standing, cables lashed)

Previously, the **pole plant date** was calculated from **Step 1** (Before Photo), which captured the date the *site was visited*, not when the *pole was actually standing*.

### The Timing Issue

```
T=08:00 AM  — Technician arrives at site, takes Step 1 (Before Photo)
T=10:00 AM  — Pole installation complete, Step 7 (After Photo) taken
T=02:00 PM  — QField syncs to server; Step 1 date recorded as "pole plant date"

Reality: Pole planted at 10:00 AM
Record: Pole plant date = 08:00 AM (2 hours early!)
```

### Impact

- **Build Progress Tracking** — PON progress shows poles planted before they actually were
- **Activation Schedule** — NOC thinks activation can start 2+ hours earlier than reality
- **SLA Tracking** — Historical timeline incorrect (hard to debug issues)
- **Data Quality** — Metrics report 08:00 completion but technician notes say 10:00

## Solution

**Use Step 7 After Photo timestamp** as the pole plant date instead of Step 1.

**Rationale**:
- Step 7 = actual pole standing (objective evidence in photo)
- Step 1 = site visit start (before any work)
- **Step 7 is the ground truth**

**Fallback**: If Step 7 not yet submitted, use earliest photo timestamp (conservative estimate).

---

## Feature Specifications

### 1. Data Source Change

#### Old Logic
```
pole_plant_date = MIN(all_photo_captured_at)
                = Step 1 Before Photo captured_at
```

#### New Logic
```
pole_plant_date = Step 7 After Photo captured_at
IF Step 7 not submitted:
  pole_plant_date = MIN(all_photo_captured_at)  [fallback]
ELSE IF Step 7 missing (corrupted file):
  pole_plant_date = Step 6 (Pole Lashing Photo) captured_at  [alternative]
```

### 2. Implementation

#### A. Data Model

**QField captures these step timestamps**:
```json
{
  "step_1_before_photo": {
    "file_name": "IMG_20260314_080000.JPG",
    "captured_at": "2026-03-14T08:00:00Z"
  },
  "step_7_after_photo": {
    "file_name": "IMG_20260314_100000.JPG",
    "captured_at": "2026-03-14T10:00:00Z"
  }
}
```

#### B. Database Schema

**Table: `pon_stages` (existing)**

```sql
ALTER TABLE pon_stages ADD COLUMN step7_photo_date TIMESTAMP;
-- Denormalized field: when Step 7 After Photo was captured
-- Used for faster lookups in build progress queries

CREATE INDEX idx_pon_stages_step7_photo_date ON pon_stages(step7_photo_date);
```

#### C. Script: `sync-qa-to-qfield.py` (Updated)

**Purpose**: Export QA review results back to QFieldCloud for field synchronization.

**Change** (lines ~45-65):

```python
def calculate_pole_plant_date(pon_id: int) -> datetime:
    """
    Get the actual pole plant date from Step 7 After Photo.
    Fallback to earliest photo if Step 7 not yet available.
    """
    # Query: step_7_after_photo captured_at
    step7_photo = db.query("""
        SELECT captured_at
        FROM qfield_photos
        WHERE pon_id = %s AND step_number = 7
        ORDER BY captured_at DESC
        LIMIT 1
    """, (pon_id,))
    
    if step7_photo and step7_photo.captured_at:
        return step7_photo.captured_at  # Use Step 7 (ground truth)
    
    # Fallback: earliest photo if Step 7 not submitted
    earliest = db.query("""
        SELECT MIN(captured_at) as earliest_date
        FROM qfield_photos
        WHERE pon_id = %s
    """, (pon_id,))
    
    return earliest.earliest_date if earliest else None

def sync_pon_to_qfield(pon_id: int):
    """Sync QA review results + pole plant date back to QFieldCloud."""
    
    # Get all QA decisions for this PON
    qa_decisions = db.query("SELECT * FROM qfield_photos WHERE pon_id = %s", (pon_id,))
    
    # Calculate plant date using new logic
    plant_date = calculate_pole_plant_date(pon_id)  # ← NEW
    
    # Update QField with results
    qfield_api.update_submission(pon_id, {
        'qa_review': [
            {'feature_id': d.feature_id, 'decision': d.qa_decision, 'reviewer': d.qa_decision_by}
            for d in qa_decisions
        ],
        'plant_date': plant_date.isoformat(),  # ← NEW: use Step 7 timestamp
        'sync_timestamp': now().isoformat()
    })
```

#### D. Component: `ReviewWizard.tsx` (Updated)

**Purpose**: Show field technicians the pole plant date during review.

**Change** (display of "Planted" date):

```typescript
// Before: Uses Step 1 photo date
const plantedDate = photos.find(p => p.step === 1)?.captured_at;

// After: Uses Step 7 photo date, with fallback
const plantedDate = (() => {
  const step7 = photos.find(p => p.step === 7);
  if (step7?.captured_at) return step7.captured_at;  // ← NEW: prefer Step 7
  return Math.min(...photos.map(p => p.captured_at));  // Fallback: earliest
})();

return (
  <div className="space-y-4">
    <div className="p-3 bg-blue-50 rounded">
      <p className="text-sm text-gray-600">Pole Planted</p>
      <p className="text-lg font-bold">{format(plantedDate, 'HH:mm')}</p>
      {!photos.find(p => p.step === 7) && (
        <p className="text-xs text-amber-600">
          📋 Using earliest photo (Step 7 After Photo pending)
        </p>
      )}
    </div>
  </div>
);
```

### 3. API Endpoints Updated

#### GET `/api/projects/[projectId]/pon-progress`

**Response now includes Step 7 date**:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "pon_id": 101,
        "pon_name": "PON_SJ_001",
        "target_cwc_date": "2026-03-10",
        "milestone_cwc_date": "2026-03-09",
        "step7_photo_date": "2026-03-14T10:00:00Z",  // ← NEW: actual plant timestamp
        "pole_plant_date": "2026-03-14T10:00:00Z"    // ← NEW: calculated from Step 7
      }
    ]
  }
}
```

### 4. Migration & Backfill

**Migration 234: `add_step7_photo_date`**

```sql
ALTER TABLE pon_stages ADD COLUMN step7_photo_date TIMESTAMP;

-- Backfill: Set Step 7 photo date for all existing PONs
UPDATE pon_stages ps
SET step7_photo_date = (
  SELECT captured_at
  FROM qfield_photos
  WHERE pon_id = ps.pon_id AND step_number = 7
  ORDER BY captured_at DESC
  LIMIT 1
)
WHERE step7_photo_date IS NULL
  AND EXISTS (
    SELECT 1 FROM qfield_photos 
    WHERE pon_id = ps.pon_id AND step_number = 7
  );

-- Index for fast lookups
CREATE INDEX idx_pon_stages_step7_photo_date ON pon_stages(step7_photo_date);
```

---

## Success Criteria

1. **Data Accuracy**: All new pole plant dates ≥ Step 1 (should be equal or later)
2. **Fallback Logic**: If Step 7 missing, uses earliest photo (no NULL values)
3. **No Regressions**: Existing PON progress queries still work (accept both old & new format)
4. **Field Validation**: Technicians confirm Step 7 date matches physical site time
5. **NOC Handover**: NOC activation schedule uses corrected plant dates

---

## Rollout Plan

### 1. Deploy Schema Change (2026-03-14)

```bash
psql -U velo fibreflow < migrations/234_add_step7_photo_date.sql
```

### 2. Backfill Existing Data (2026-03-14)

The migration above includes backfill logic.

### 3. Deploy Scripts (2026-03-14)

- Update `sync-qa-to-qfield.py` with new `calculate_pole_plant_date()` function
- Deploy new function, toggle off in config (for validation before go-live)

### 4. Deploy Frontend (2026-03-14)

- Update `ReviewWizard.tsx` to show Step 7 date preference
- Update PON progress table to display `pole_plant_date` (sourced from Step 7)

### 5. Enable in Production (2026-03-15)

- Toggle config: `USE_STEP7_PLANT_DATE=true`
- Monitor: Verify all new PONs use Step 7 date
- Manual spot-check: Compare 10 PONs (QField timestamps vs DB records)

### 6. Validation (2026-03-15)

- QA team reviews 20 random PONs
- Confirm: Pole plant date in system matches field notes
- Sign-off: "Data now matches site reality"

---

## Monitoring & Alerts

### CloudWatch Metrics

```python
# In calculate_pole_plant_date()
if step7_photo:
    cloudwatch.put_metric_data('FieldOps', 'PolesUsedStep7', 1)
else:
    cloudwatch.put_metric_data('FieldOps', 'PolesUsedFallback', 1)
```

### Anomaly Detection

```sql
-- Flag any pole plant dates < Step 1 (data corruption)
SELECT pon_id, plant_date, min_photo_date
FROM (
  SELECT 
    ps.pon_id, 
    ps.step7_photo_date as plant_date,
    MIN(qp.captured_at) as min_photo_date
  FROM pon_stages ps
  JOIN qfield_photos qp ON qp.pon_id = ps.pon_id
  GROUP BY ps.pon_id, ps.step7_photo_date
)
WHERE plant_date < min_photo_date;
-- Expected: 0 rows (plant date should never be before any photo)
```

---

## Testing

### Unit Tests

1. **test_calculate_pole_plant_date.py**
   - Setup: PON with Step 1 at 08:00, Step 7 at 10:00
   - Call: `calculate_pole_plant_date(pon_id)`
   - Expected: 10:00 (Step 7)
   
2. **test_fallback_to_earliest.py**
   - Setup: PON with 5 photos, but no Step 7
   - Call: `calculate_pole_plant_date(pon_id)`
   - Expected: MIN(all photo dates)

3. **test_review_wizard_date_display.tsx**
   - Render: ReviewWizard with photos including Step 7
   - Verify: "Planted" shows Step 7 time
   - Render: ReviewWizard without Step 7
   - Verify: Shows fallback message "Using earliest photo"

### Integration Test

1. Create new PON in QField with all 7 steps
   - Step 1 captured: 2026-03-16 08:00:00
   - Step 7 captured: 2026-03-16 10:15:30
2. Sync QField GPKG to fibreflow
3. Run sync-qa-to-qfield.py
4. Query: `/api/projects/[id]/pon-progress`
5. Verify: Response shows `pole_plant_date = 2026-03-16 10:15:30` ✅

---

## Related Changes

This feature integrates with:
- **build module**: PON progress tracker uses pole plant date for CWC milestone
- **construction-qa**: Photo classification timestamps depend on Step 7 availability
- **qfield module**: Step 7 photo upload status (pending vs available)

---

## Success Metrics

1. **Accuracy**: 100% of new PON plant dates match field notes (manual spot-check)
2. **No Fallback Needed**: 95%+ of PONs have Step 7 photo within 24 hours
3. **Data Consistency**: No PON with plant date before Step 1 (data quality validation)
4. **Integration**: Build progress timeline now matches actual field completion
5. **User Confidence**: QA/NOC teams confirm plant dates are "now realistic"

---

## Future Enhancements

1. **Step 7 Quality Check** — Flag if Step 7 photo is blurry, incomplete, or after maintenance phase
2. **Time Zone Handling** — Ensure all photo timestamps are UTC (not device local time)
3. **GPS Correlation** — Compare Step 1 and Step 7 GPS coordinates (verify pole moved, not photo recycled)
4. **Automated Validation** — Run computer vision check on Step 7 (confirm pole is actually standing)

---

## References

- **Related Commits**:
  - 58b026d — Field ops Step 7 date integration + nav refactoring
  - Migration 234 — Schema changes
- **Related Modules**: build (PON progress), construction-qa (photo classification), qfield (photo sync)
- **User Documentation**: (TBD) `/help/field-ops/pole-plant-dates.md`

**Last Updated**: 2026-03-16 | **Owner**: Elon (CTO) | **Status**: Released
