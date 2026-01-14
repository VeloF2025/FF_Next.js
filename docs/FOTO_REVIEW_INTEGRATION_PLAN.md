# Foto-Review WA Monitor Integration Plan (Option A)

**Status:** ✅ APPROVED
**Date:** December 7, 2025
**Estimated Time:** 6-8 hours
**Priority:** High

---

## Goal

Merge foto-review with WA Monitor to create a unified AI-powered QA feedback system that:
- ✅ Shows real-time WhatsApp drops (auto-refresh every 30s)
- ✅ Displays actual installation photos from BOSS VPS
- ✅ Runs AI evaluation on photos
- ✅ Sends feedback to the agent who posted

---

## Architecture Overview

```
WhatsApp Groups → VPS Drop Monitor → qa_photo_reviews table
                                            ↓
                                    Foto-Review Page
                                            ↓
                            ┌───────────────┴───────────────┐
                            ↓                               ↓
                    BOSS VPS Photos API            AI Evaluation Service
                    (Real installation photos)     (Quality analysis)
                            ↓                               ↓
                            └───────────────┬───────────────┘
                                            ↓
                                    Human Review & Edit
                                            ↓
                                    Send to WhatsApp
                                            ↓
                                    Agent receives feedback
```

---

## Implementation Plan

### Phase 1: Data Integration (Core Foundation)

**Time:** 2-3 hours | **Complexity:** High

#### Task 1.1: Hybrid Data Source
**File:** `/pages/api/foto/photos.ts`

**Current behavior:**
```typescript
// Fetches from BOSS VPS only
const response = await fetch(`${BOSS_API_URL}/api/photos`);
return transform(response);
```

**New behavior:**
```typescript
// 1. Fetch drops from qa_photo_reviews (like WA Monitor)
const drops = await sql`
  SELECT
    drop_number,
    project,
    user_name as submitted_by,
    whatsapp_message_date,
    completed_photos,
    outstanding_photos
  FROM qa_photo_reviews
  WHERE whatsapp_message_date >= NOW() - INTERVAL '7 days'
  ORDER BY whatsapp_message_date DESC
`;

// 2. Fetch BOSS VPS photos index
const bossPhotos = await fetch(`${BOSS_API_URL}/api/photos`);
const photoIndex = buildPhotoIndex(bossPhotos); // DR → Photos map

// 3. Match drops with photos
const dropsWithPhotos = drops.map(drop => ({
  dr_number: drop.drop_number,
  project: drop.project,
  submitted_by: drop.submitted_by,
  date: drop.whatsapp_message_date,
  photos: photoIndex[drop.drop_number] || [], // Link photos by DR number
  has_photos: !!photoIndex[drop.drop_number],
  photo_count: photoIndex[drop.drop_number]?.length || 0,
}));

return dropsWithPhotos;
```

**Success criteria:**
- ✅ Shows real WhatsApp drops from today
- ✅ Links BOSS VPS photos to matching DR numbers
- ✅ Shows placeholder if DR has no photos in BOSS

#### Task 1.2: Photo Matching Logic

**Challenge:** WA Monitor drops may not always have photos in BOSS VPS

**Solution:**
```typescript
function buildPhotoIndex(bossData: any): Map<string, Photo[]> {
  const index = new Map();

  for (const dr of bossData.drs) {
    const photos = dr.photos.map(p => ({
      id: `${dr.dr_number}-${p.filename}`,
      url: `/api/foto/photo-proxy?url=${encodeURI(BOSS_API_URL)}/api/photo/${dr.dr_number}/${p.filename}`,
      filename: p.filename,
      stepLabel: extractStepLabel(p.filename),
      timestamp: p.modified,
    }));

    index.set(dr.dr_number, photos);
  }

  return index;
}
```

**Edge cases:**
- DR exists in `qa_photo_reviews` but not in BOSS → Show "No photos available"
- DR exists in BOSS but not in `qa_photo_reviews` → Don't show (only show WA drops)
- DR number format mismatch → Try normalization (strip spaces, uppercase)

---

### Phase 2: Real-Time Updates

**Time:** 1 hour | **Complexity:** Medium

#### Task 2.1: Auto-Refresh Hook
**File:** `src/modules/foto-review/hooks/usePhotos.ts`

**Add polling:**
```typescript
export function usePhotos(initialFilters?: PhotoFilters) {
  const [photos, setPhotos] = useState<DropRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPhotos = useCallback(async () => {
    const result = await api.fetchPhotos(filters);
    setPhotos(result);
  }, [filters]);

  // Initial fetch
  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  // Auto-refresh every 30 seconds (like WA Monitor)
  useEffect(() => {
    const interval = setInterval(fetchPhotos, 30000);
    return () => clearInterval(interval);
  }, [fetchPhotos]);

  return { photos, isLoading, refresh: fetchPhotos };
}
```

**Success criteria:**
- ✅ Page refreshes automatically every 30s
- ✅ New drops appear without manual refresh
- ✅ Maintains user's selected DR during refresh

#### Task 2.2: Smart Refresh (Don't Lose Selection)

**Problem:** Auto-refresh clears selected DR

**Solution:**
```typescript
// Store selected DR in URL query params (already implemented)
// After refresh, restore selection if DR still exists
useEffect(() => {
  if (selectedDR && photos.length > 0) {
    const stillExists = photos.find(p => p.dr_number === selectedDR.dr_number);
    if (!stillExists) {
      setSelectedDR(null); // DR no longer in list
    }
  }
}, [photos]);
```

---

### Phase 3: Feedback Integration

**Time:** 1 hour | **Complexity:** Low

#### Task 3.1: Link to WA Monitor Feedback API
**File:** `src/modules/foto-review/components/EvaluationPanel.tsx`

**Change:**
```typescript
const handleSendFeedback = async () => {
  if (!feedbackMessage.trim()) return;

  try {
    setSending(true);

    // Use WA Monitor's proven feedback API
    const response = await fetch('/api/wa-monitor-send-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drop_number: drop.dr_number,
        message: feedbackMessage,
        project: drop.project, // Required for group routing
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send feedback');
    }

    alert('✅ Feedback sent to WhatsApp!');

    // Optional: Mark as feedback_sent in database
    await markFeedbackSent(drop.dr_number);

  } catch (err) {
    setError(err.message);
  } finally {
    setSending(false);
  }
};
```

#### Task 3.2: Track Feedback Status

**Add column:** `foto_feedback_sent` to `qa_photo_reviews` table

**Migration SQL:**
```sql
ALTER TABLE qa_photo_reviews
ADD COLUMN IF NOT EXISTS foto_feedback_sent TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_qa_reviews_foto_feedback
ON qa_photo_reviews(foto_feedback_sent);
```

**Update API to mark:**
```typescript
// After successful feedback send
await sql`
  UPDATE qa_photo_reviews
  SET foto_feedback_sent = NOW()
  WHERE drop_number = ${dr_number}
`;
```

**Show in UI:**
```typescript
// In DR list, show badge if feedback already sent
{drop.foto_feedback_sent && (
  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
    Feedback Sent
  </span>
)}
```

---

### Phase 4: UI Enhancements

**Time:** 1 hour | **Complexity:** Low

#### Task 4.1: Filter by Feedback Status

**Add filter option:**
```typescript
<select>
  <option value="all">All Drops</option>
  <option value="no_feedback">No Feedback Sent</option>
  <option value="feedback_sent">Feedback Sent</option>
  <option value="needs_evaluation">Needs Evaluation</option>
</select>
```

#### Task 4.2: Show Submitted By

**Display agent info:**
```typescript
<div className="text-xs text-gray-500">
  Submitted by: {drop.submitted_by || 'Unknown'}
  <br />
  {formatDistanceToNow(new Date(drop.date))} ago
</div>
```

---

### Phase 5: Testing & Validation

**Time:** 1-2 hours | **Complexity:** Medium

#### Task 5.1: Integration Test
**File:** `tests/e2e/foto-review-integration.spec.ts`

```typescript
test('full AI evaluation workflow', async ({ page }) => {
  // 1. Load page
  await page.goto('http://localhost:3005/foto-review');

  // 2. Wait for drops to load
  await page.waitForSelector('[data-testid="dr-list"]');

  // 3. Select first DR
  await page.click('[data-testid="dr-item"]:first-child');

  // 4. Verify photos loaded
  await expect(page.locator('[data-testid="photo-gallery"]')).toBeVisible();

  // 5. Run AI evaluation
  await page.click('button:has-text("Run AI Evaluation")');
  await page.waitForSelector('[data-testid="evaluation-results"]');

  // 6. Edit feedback message
  await page.fill('textarea[data-testid="feedback-message"]', 'Custom feedback');

  // 7. Send feedback
  await page.click('button:has-text("Send Feedback to WhatsApp")');

  // 8. Verify success message
  await expect(page.locator('text=Feedback sent')).toBeVisible();
});
```

#### Task 5.2: ACH Validation

**Let ACH agent verify:**
```bash
cd /home/louisdup/claude-quickstarts/autonomous-coding
python autonomous_agent_demo.py \
  --project-dir /home/louisdup/VF/Apps/FF_React \
  --task "Test foto-review page: verify drops load, photos display, AI evaluation works, and feedback sends successfully" \
  --max-iterations 10
```

---

## Implementation Timeline

| Phase | Tasks | Estimated Time | Complexity |
|-------|-------|----------------|------------|
| Phase 1 | Data Integration | 2-3 hours | High |
| Phase 2 | Real-Time Updates | 1 hour | Medium |
| Phase 3 | Feedback Integration | 1 hour | Low |
| Phase 4 | UI Enhancements | 1 hour | Low |
| Phase 5 | Testing & Validation | 1-2 hours | Medium |
| **Total** | **All Phases** | **6-8 hours** | **High** |

---

## Risks & Mitigation

### Risk 1: DR Number Mismatch
**Problem:** WA Monitor uses `DR1752169`, BOSS uses `DRTEST0808`
**Mitigation:**
- Show all WA drops regardless of photos
- Display "No photos available" if DR not in BOSS
- Add manual photo upload option later

### Risk 2: BOSS VPS Downtime
**Problem:** BOSS API at `100.96.203.105:8001` goes down
**Mitigation:**
- Cache BOSS photo index for 5 minutes
- Show drops even if photos fail to load
- Display error message for photo loading

### Risk 3: Performance
**Problem:** Fetching from both sources on every refresh
**Mitigation:**
- Add Redis cache for BOSS photo index (5 min TTL)
- Paginate drops (show 50 most recent)
- Lazy load photos (only fetch when DR selected)

---

## Success Criteria

✅ **Real-time drops** - Shows new WhatsApp submissions within 30 seconds
✅ **Photo display** - Links BOSS VPS photos to WA Monitor drops
✅ **AI evaluation** - Analyzes photos and generates feedback
✅ **Human review** - Agent can edit AI feedback before sending
✅ **WhatsApp delivery** - Feedback reaches agent in WhatsApp group
✅ **Status tracking** - Shows which drops have feedback sent
✅ **Auto-refresh** - Updates without manual page reload

---

## Files to Modify

### API Layer
- `/pages/api/foto/photos.ts` - Hybrid data source (Phase 1)
- `/pages/api/foto/mark-feedback-sent.ts` - NEW: Track feedback status (Phase 3)

### Frontend Services
- `src/modules/foto-review/hooks/usePhotos.ts` - Auto-refresh (Phase 2)
- `src/modules/foto-review/components/EvaluationPanel.tsx` - WA Monitor feedback (Phase 3)
- `src/modules/foto-review/components/FilterControls.tsx` - Filter by feedback status (Phase 4)

### Database
- Migration: `scripts/migrations/add-foto-feedback-sent.sql` (Phase 3)

### Testing
- `tests/e2e/foto-review-integration.spec.ts` - NEW: Full workflow test (Phase 5)

---

## Next Steps

1. ✅ **Approve this plan** - APPROVED (Dec 7, 2025)
2. ⏳ **Start with Phase 1** - Get data integration working first
3. ⏳ **Deploy to dev** - Test with real WA Monitor data
4. ⏳ **Iterate** - Add remaining phases based on feedback
5. ⏳ **ACH validation** - Let autonomous agent verify all features

---

## Notes

- This plan integrates foto-review with WA Monitor's real-time data flow
- BOSS VPS photos are linked to WhatsApp drops by DR number
- Graceful fallback if DR has no photos in BOSS
- Uses proven WA Monitor feedback API (already working)
- Auto-refresh ensures new drops appear within 30 seconds
- Full human-in-the-loop workflow: AI suggests → Human reviews → Send to WhatsApp

---

**Approved by:** User
**Implementation start:** TBD
**Target completion:** 6-8 hours from start
**Documentation:** This file
