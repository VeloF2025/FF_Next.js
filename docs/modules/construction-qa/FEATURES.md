# AI vs Human Review Attribution — Feature Documentation

**Feature**: Construction QA > Show AI (VLM) vs Human review attribution
**Commit**: 41de55cb3c40ff33fca3bd246f871383118fb4ff
**Status**: Released (2026-03-15)
**Priority**: P2 (UX enhancement + data visibility)
**Module**: construction-qa
**Last Updated**: 2026-03-16

---

## Problem Statement

Construction QA dashboards showed "Approved: 250 photos" but did NOT distinguish between:
- **VLM Auto-Approved** (bot) — 200 photos, 0 seconds review time
- **Human-Reviewed & Approved** (person) — 50 photos, avg 3 min review each

**Without this distinction**, QA metrics were misleading:
- Appeared that team approved 250 photos = 750 min work
- Actually: bot approved 200 (0 min) + team approved 50 (150 min)
- **30x overestimate of human effort**

**User Impact**:
- Project managers couldn't see workload distribution
- Can't plan next sprint (is team overwhelmed or not?)
- Can't credit VLM labor savings
- No visibility into which features rely on manual review

## Solution

**Review Attribution** — Attach a `qa_decision_by` field to every approval:
- `qa_decision_by = 'VLM Auto-Approve'` → bot approved
- `qa_decision_by = <user_name>` → person approved
- **Dashboard cards** show icons: 🤖 Bot / 👤 User
- **Features list** shows who approved each feature

### Design Principles

1. **Transparent** — Show real workload (bot vs human)
2. **Frictionless** — No manual labeling; auto-infer from existing data
3. **Backward Compatible** — Existing approvals labeled consistently
4. **Queryable** — Easy to filter "VLM only" vs "human reviewed"

---

## Feature Specifications

### 1. Database Schema

#### New Column: `qa_decision_by`

```sql
ALTER TABLE qfield_photos ADD COLUMN qa_decision_by VARCHAR(100);
-- Values: 'VLM Auto-Approve' or <username>, e.g., 'Johan Pieterse'

CREATE INDEX idx_qfield_photos_qa_decision_by ON qfield_photos(qa_decision_by);
CREATE INDEX idx_qfield_photos_qa_decision ON qfield_photos(qa_decision, qa_decision_by);
```

### 2. Backfill Existing Records

**Normalize historical auto-approve labels**:

```sql
UPDATE qfield_photos 
SET qa_decision_by = 'VLM Auto-Approve' 
WHERE qa_decision = 'PASS' 
  AND qa_decision_by IS NULL 
  AND classified_by_vlm = TRUE
  AND user_id IS NULL;

UPDATE qfield_photos 
SET qa_decision_by = <username> 
WHERE qa_decision = 'PASS' 
  AND qa_decision_by IS NULL 
  AND user_id IS NOT NULL;
```

### 3. API Endpoints Updated

#### GET `/api/construction-qa/project-dashboard`

**New Response Fields**:

```json
{
  "success": true,
  "data": {
    "project": { "id": 1, "name": "VF_JHB_North" },
    "summary": {
      "total_photos_reviewed": 1250,
      "ai_approved": 1000,        // NEW
      "human_approved": 200,      // NEW
      "flagged_for_review": 50
    },
    "by_zone": [
      {
        "zone_name": "Sandton",
        "total_reviewed": 250,
        "ai_approved": 200,       // NEW
        "human_approved": 50,     // NEW
        "flagged": 0
      }
    ]
  }
}
```

**Query Implementation** (parallel attribution):

```sql
SELECT 
  COUNT(CASE WHEN qa_decision = 'PASS' AND qa_decision_by = 'VLM Auto-Approve' THEN 1 END) as ai_approved,
  COUNT(CASE WHEN qa_decision = 'PASS' AND qa_decision_by != 'VLM Auto-Approve' THEN 1 END) as human_approved,
  COUNT(CASE WHEN qa_decision = 'REVIEW' THEN 1 END) as flagged_for_review
FROM qfield_photos
WHERE project_id = $1 AND qa_decision IS NOT NULL;
```

#### GET `/api/construction-qa/pon-features`

**Include `qa_decision_by` in SELECT**:

```sql
SELECT 
  id, pon_id, feature_type, qa_decision, 
  qa_decision_by,     -- NEW
  created_at
FROM qfield_photos
WHERE pon_id = $1
ORDER BY created_at DESC;
```

**Response**:

```json
{
  "success": true,
  "features": [
    {
      "id": 12345,
      "pon_id": 101,
      "feature_type": "pole_plant",
      "qa_decision": "PASS",
      "qa_decision_by": "VLM Auto-Approve",  // NEW
      "created_at": "2026-03-16T10:30:00Z"
    },
    {
      "id": 12346,
      "pon_id": 101,
      "feature_type": "cable_lash",
      "qa_decision": "PASS",
      "qa_decision_by": "Johan Pieterse",    // NEW
      "created_at": "2026-03-16T10:45:00Z"
    }
  ]
}
```

### 4. Frontend Components Updated

#### `ProjectQaCard.tsx` (Dashboard Summary)

**Before**:
```
✅ Approved: 250 photos
```

**After**:
```
✅ Approved: 250 photos
  🤖 VLM: 200
  👤 Human: 50
```

**Implementation**:

```typescript
export function ProjectQaCard({ projectId }) {
  const { data } = useQuery(`/api/construction-qa/project-dashboard?projectId=${projectId}`);
  
  const { ai_approved = 0, human_approved = 0 } = data?.summary || {};
  const total = ai_approved + human_approved;
  
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div>
          <p className="text-lg font-bold">✅ Approved: {total}</p>
          <p className="text-sm text-gray-600 flex gap-2">
            <span className="flex items-center gap-1">
              <Bot size={16} /> VLM: {ai_approved}
            </span>
            <span className="flex items-center gap-1">
              <User size={16} /> Human: {human_approved}
            </span>
          </p>
        </div>
      </div>
    </Card>
  );
}
```

#### `PonFeaturesPanel.tsx` (Feature Attribution)

**Feature List Entry**:

```typescript
features.map(feature => (
  <div key={feature.id} className="p-3 border-l-4 border-green-500">
    <div className="flex items-center justify-between">
      <p className="font-semibold">{feature.feature_type}</p>
      <span className="text-green-600">✓ PASS</span>
    </div>
    
    {/* NEW: Show reviewer attribution */}
    {feature.qa_decision === 'PASS' && (
      <div className="text-sm text-gray-600 mt-1 flex items-center gap-1">
        {feature.qa_decision_by === 'VLM Auto-Approve' ? (
          <>
            <Bot size={14} className="text-purple-500" />
            <span>VLM Auto-Approved</span>
          </>
        ) : (
          <>
            <User size={14} className="text-blue-500" />
            <span>Approved by {feature.qa_decision_by}</span>
          </>
        )}
      </div>
    )}
  </div>
))
```

---

## Scripts Updated

### 1. `classify-qa-photos-vlm.py`

**Change**: Set `qa_decision_by` on auto-approve decisions

```python
def classify_photo_batch(photos):
    results = vlm_api.classify(photos)  # VLM returns decisions
    
    for photo, decision in results:
        if decision['qa_decision'] == 'PASS':
            # NEW: Tag as VLM approved
            db.update('qfield_photos', photo.id, {
                'qa_decision': 'PASS',
                'qa_decision_by': 'VLM Auto-Approve',  # ← NEW
                'classified_at': now()
            })
        else:
            # Flagged for review (no qa_decision_by; user will set it)
            db.update('qfield_photos', photo.id, {
                'qa_decision': 'REVIEW',
                'classified_at': now()
            })
```

### 2. `reclassify-fewshot.py`

**Change**: When reclassifying, preserve or set `qa_decision_by`

```python
def reclassify_with_fewshot(photo_id, human_label):
    """
    Human reviews a flagged photo and provides feedback.
    """
    db.update('qfield_photos', photo_id, {
        'qa_decision': human_label,  # 'PASS', 'REJECT', etc.
        'qa_decision_by': get_current_user(),  # ← NEW: who made this decision?
        'reclassified_at': now()
    })
```

---

## Metrics & Reporting

### New Dashboard Metrics

**Available Dimensions**:

```sql
-- AI vs Human breakdown by project
SELECT 
  project_id, project_name,
  SUM(CASE WHEN qa_decision = 'PASS' AND qa_decision_by = 'VLM Auto-Approve' THEN 1 ELSE 0 END) as vlm_approved,
  SUM(CASE WHEN qa_decision = 'PASS' AND qa_decision_by != 'VLM Auto-Approve' THEN 1 ELSE 0 END) as human_approved,
  SUM(CASE WHEN qa_decision = 'REVIEW' THEN 1 ELSE 0 END) as flagged
FROM qfield_photos
GROUP BY project_id, project_name
ORDER BY vlm_approved DESC;

-- Top reviewers by count
SELECT 
  qa_decision_by, 
  COUNT(*) as count
FROM qfield_photos
WHERE qa_decision = 'PASS' AND qa_decision_by != 'VLM Auto-Approve'
GROUP BY qa_decision_by
ORDER BY count DESC;

-- VLM accuracy: auto-approved photos later flagged by human
SELECT 
  COUNT(CASE WHEN qa_decision = 'REVIEW' THEN 1 END) as false_positives,
  COUNT(CASE WHEN qa_decision = 'PASS' THEN 1 END) as correct,
  ROUND(100.0 * COUNT(CASE WHEN qa_decision = 'PASS' THEN 1 END) / 
        COUNT(*), 2) as accuracy_pct
FROM qfield_photos
WHERE qa_decision_by = 'VLM Auto-Approve';
```

### Sample Metrics

| Metric | Value |
|--------|-------|
| **Total Approved** | 1,250 |
| **VLM Auto-Approved** | 1,000 (80%) |
| **Human-Reviewed & Approved** | 250 (20%) |
| **VLM Accuracy** | 98.5% (15 false positives in 1,000 auto-approvals) |
| **Avg Review Time (Human)** | 3.2 min per photo |
| **Labor Savings (VLM)** | ~1,000 photos × 3.2 min = 3,200 min (~53 hours) |

---

## Rollout Plan

### 1. Backfill Existing Data (2026-03-15)

```bash
# Step 1: Add column
psql -U velo fibreflow -c "ALTER TABLE qfield_photos ADD COLUMN qa_decision_by VARCHAR(100);"

# Step 2: Index it
psql -U velo fibreflow -c "CREATE INDEX idx_qfield_photos_qa_decision_by ON qfield_photos(qa_decision_by);"

# Step 3: Backfill VLM approvals
psql -U velo fibreflow -c "
  UPDATE qfield_photos 
  SET qa_decision_by = 'VLM Auto-Approve' 
  WHERE qa_decision = 'PASS' AND classified_by_vlm = TRUE AND qa_decision_by IS NULL;"

# Step 4: Backfill human approvals (need users table mapping)
psql -U velo fibreflow -c "
  UPDATE qfield_photos 
  SET qa_decision_by = (SELECT username FROM users WHERE users.id = qfield_photos.user_id) 
  WHERE qa_decision = 'PASS' AND user_id IS NOT NULL AND qa_decision_by IS NULL;"
```

### 2. Deploy Scripts (2026-03-15)

- `classify-qa-photos-vlm.py` → add `qa_decision_by = 'VLM Auto-Approve'` on auto-approve
- `reclassify-fewshot.py` → capture `qa_decision_by = <user>` on human review

### 3. Deploy Frontend (2026-03-16)

- Update ProjectQaCard.tsx (show VLM + Human split)
- Update PonFeaturesPanel.tsx (show reviewer attribution icons)
- Deploy to staging, test with real data

### 4. Production Rollout (2026-03-16)

- Push code
- Verify: Dashboard shows correct VLM/Human split
- User feedback: 1-week observation period

---

## Testing

### Unit Tests

1. **test_qa_decision_by_attribution.py**
   - Backfill 1,000 VLM-approved photos with `qa_decision_by = 'VLM Auto-Approve'`
   - Verify: 1,000 records updated
   - Query dashboard API
   - Verify: `ai_approved = 1000, human_approved = 0`

2. **test_human_review_attribution.py**
   - Create 50 human-reviewed photos with `qa_decision_by = 'Johan Pieterse'`
   - Query dashboard API
   - Verify: `human_approved = 50`

3. **test_icon_rendering.tsx**
   - ProjectQaCard: render with ai_approved=200, human_approved=50
   - Verify: Shows "🤖 VLM: 200" and "👤 Human: 50"
   - PonFeaturesPanel: render features with different qa_decision_by values
   - Verify: Icons match (Bot for VLM, User for human)

### Integration Test

1. Run classify-qa-photos-vlm.py on batch of 100 new photos
2. Verify: All 100 have `qa_decision_by = 'VLM Auto-Approve'`
3. Manually flag one photo for review
4. Run reclassify-fewshot.py with human approval
5. Verify: Photo now has `qa_decision_by = <reviewer_name>`
6. Check dashboard: counts updated correctly

---

## Success Metrics

1. **Visibility**: 100% of approved photos have `qa_decision_by` field populated
2. **Accuracy**: VLM auto-approve matches bot classification (0 misattribution)
3. **Adoption**: 100% of human reviews tagged with reviewer name within 48 hours
4. **Labor Metrics**: Accurate VLM labor savings calculation (baseline: 3.2 min/photo)
5. **User Feedback**: QA team confirms metrics reflect reality (no surprises)

---

## Future Enhancements

1. **Individual VLM Model Attribution** — Track which VLM version approved (v1.0, v1.1, etc.)
2. **Decision Timestamps** — Log decision time separately from photo timestamp
3. **Review Comments** — Capture why human changed VLM decision (bug report)
4. **Approval Workflows** — Multi-level review (bot → reviewer 1 → reviewer 2)
5. **QA Performance Dashboard** — Track reviewer accuracy, speed, consistency

---

## Related Features

- **construction-qa**: Core QA module (photo classification)
- **qfield**: Photo upload status tracking
- **noc**: Feature handover visibility
- **analytics**: Labor cost attribution (future integration)

---

## References

- **Related Commits**:
  - 41de55cb — AI vs human review attribution
- **Related Modules**: construction-qa, qfield, analytics (future)
- **User Documentation**: (TBD) `/help/construction-qa/review-attribution.md`

**Last Updated**: 2026-03-16 | **Owner**: Elon (CTO) | **Status**: Released
