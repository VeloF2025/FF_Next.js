# Deprecation Notice - DR Photo Review Services

**Date:** January 14, 2026
**Phase:** Phase 6 Week 6.4 - Full Rollout Complete

---

## Summary

The unified DR photo review system is now **fully rolled out** to all projects as of Phase 6 Week 6.4. The old fragmented system consisting of three separate services has been deprecated and will be shut down after a 2-week backup period.

---

## Deprecated Services

### 1. Port 8003 HTML App (OneMap GIS Photo Downloader)
- **Status:** ⚠️ DEPRECATED
- **Location:** http://192.168.1.150:8003/
- **Docker Container:** `dr-photo-api`
- **Shutdown Date:** January 28, 2026 (2 weeks from full rollout)
- **Reason:** Functionality integrated into unified photo service with multi-source fallback

**Replacement:**
- `src/modules/dr-photo-unified/services/unifiedPhotoService.ts`
- `src/modules/dr-photo-unified/services/oneMapIntegrationService.ts`

### 2. WA Monitor QaReviewCard Component
- **Status:** ⚠️ DEPRECATED
- **Location:** `src/modules/wa-monitor/components/QaReviewCard.tsx`
- **Reason:** Replaced by unified review card with combined manual + AI evaluation

**Replacement:**
- `src/modules/dr-photo-unified/components/UnifiedReviewCard.tsx`

### 3. Foto Review VLM Service
- **Status:** ⚠️ DEPRECATED
- **Location:** `src/modules/photo-review/services/fotoVlmService.ts`
- **Reason:** AI evaluation now integrated into unified workflow

**Replacement:**
- `src/modules/dr-photo-unified/services/unifiedVlmService.ts`

---

## Migration Timeline

### Phase 6 Rollout Completed

| Week | Date | Status | Description |
|------|------|--------|-------------|
| **Week 6.1** | Jan 7, 2026 | ✅ COMPLETED | Pilot rollout (Velo Test only) |
| **Week 6.3** | Jan 12, 2026 | ✅ COMPLETED | Partial rollout (4 main projects) |
| **Week 6.4** | Jan 14, 2026 | ✅ COMPLETED | Full rollout (all projects) |

### Transition Period

| Date | Action |
|------|--------|
| **Jan 14, 2026** | Full rollout complete - all projects use unified system |
| **Jan 14 - Jan 28** | 2-week backup period - port 8003 kept running |
| **Jan 28, 2026** | Port 8003 shutdown |
| **Feb 14, 2026** | Old database tables archived (after 1 month) |

---

## Feature Flag Status

**Current Configuration** (`src/lib/featureFlags.ts`):

```typescript
UNIFIED_DR_REVIEW: {
  name: 'Unified DR Photo Review',
  description: 'Consolidated DR photo review system (Phase 6 rollout)',
  enabled: true,
  enabledProjects: [], // Empty array = all projects
  rolloutStage: 'full',
}
```

**All projects now use the unified system by default.**

---

## What's Changed

### Old Workflow (DEPRECATED)
1. WhatsApp message arrives in WA Monitor
2. Users manually log into port 8003, paste DR number, download photos
3. Manual photo review in WA Monitor (QaReviewCard)
4. Separate AI evaluation in Foto Review
5. Feedback sent via WhatsApp monitor

### New Unified Workflow (CURRENT)
1. WhatsApp message arrives → Auto-download photos (multi-source fallback)
2. Single integrated review UI with 4 tabs:
   - **Manual QA:** 12-step checklist
   - **AI Evaluation:** Automated VLM assessment
   - **Photos:** Step-grouped photo gallery
   - **Feedback:** One-click generation and sending
3. Zero context switching - everything in one place

---

## Database Migration

### Old Tables (Read-Only, Archived After 1 Month)
- `qa_photo_reviews` - Manual QA data from WA Monitor
- `foto_ai_reviews` - AI evaluation results from Foto Review

### New Unified Table
- `dr_photo_unified_reviews` - Consolidated manual + AI + feedback data

**Backward Compatibility:**
- View `v_qa_photo_reviews_compat` provides read-only access to unified data
- Old APIs still work during transition period
- Data automatically synced between old and new systems

---

## API Endpoints

### Deprecated APIs (Still Functional During Transition)
- `/api/wa-monitor-drops` - Old WA Monitor drops list
- `/api/wa-monitor-daily-drops` - Old daily drops endpoint
- `/api/foto/photos` - Old Foto Review photos endpoint
- `/api/foto/evaluate` - Old AI evaluation endpoint

### New Unified APIs
- `/api/dr-photo-unified/fetch-photos` - Multi-source photo fetching
- `/api/dr-photo-unified/review/[dropNumber]` - Unified review CRUD
- `/api/dr-photo-unified/evaluate` - Integrated AI evaluation
- `/api/dr-photo-unified/send-feedback` - WhatsApp feedback delivery

---

## Action Items

### For Developers
- ✅ Update any code referencing `QaReviewCard` to use `UnifiedReviewCard`
- ✅ Use new unified APIs for all DR photo operations
- ✅ Test with feature flags to ensure backward compatibility
- ⏳ Remove deprecated components after port 8003 shutdown (Jan 28)

### For DevOps
- ⏳ Schedule port 8003 shutdown: **January 28, 2026**
- ⏳ Archive old database tables: **February 14, 2026**
- ⏳ Monitor unified system metrics during transition period
- ⏳ Set up alerts for any failures in multi-source photo fetching

### For QA/Users
- ✅ All projects now use the unified review system
- ✅ No action required - system automatically switched on Jan 14, 2026
- ℹ️ Report any issues to development team during transition period

---

## Rollback Plan

### Emergency Rollback (If Critical Issues Found)

**Quick Disable** (< 5 minutes):
```typescript
// src/lib/featureFlags.ts
UNIFIED_DR_REVIEW: {
  enabled: false, // Disable unified system
  enabledProjects: [],
  rolloutStage: 'full',
}
```

**Gradual Rollback** (by project):
```typescript
// src/lib/featureFlags.ts
UNIFIED_DR_REVIEW: {
  enabled: true,
  enabledProjects: ['Velo Test', 'Lawley'], // Exclude problematic projects
  rolloutStage: 'partial',
}
```

**Full Revert** (if major issues):
1. Set `enabled: false` in feature flags
2. Restart port 8003 Docker container
3. Revert to commit `ce852372` (before full rollout)

---

## Support

**Questions or Issues?**
- Check documentation: `docs/PRDs/PRD_DR_PHOTO_UNIFIED.md`
- Review implementation plan in plan file
- Contact development team

---

## References

**Documentation:**
- [PRD: DR Photo Unified System](./PRDs/PRD_DR_PHOTO_UNIFIED.md)
- [Implementation Plan](./.claude/plans/dynamic-spinning-floyd.md)
- [Database Tables Reference](./DATABASE_TABLES.md)

**Commits:**
- Week 6.1: `7a436de6` - Phase 6 Week 6.1 pilot rollout
- Week 6.3: `ce852372` - Phase 6 Week 6.3 expansion
- Week 6.4: (pending commit) - Phase 6 Week 6.4 full rollout

**Related Services:**
- Unified Photo Service: `src/modules/dr-photo-unified/services/unifiedPhotoService.ts`
- Unified VLM Service: `src/modules/dr-photo-unified/services/unifiedVlmService.ts`
- Unified Review Card: `src/modules/dr-photo-unified/components/UnifiedReviewCard.tsx`

---

**Last Updated:** January 14, 2026
**Next Review:** January 28, 2026 (Port 8003 shutdown date)
