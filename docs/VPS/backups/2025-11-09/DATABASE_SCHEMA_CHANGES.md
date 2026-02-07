# Database Schema Changes - November 9, 2025

## Resubmission Tracking Feature

### Changes Made

**Table:** `qa_photo_reviews`

**New Column Added:**
```sql
ALTER TABLE qa_photo_reviews
ADD COLUMN resubmitted BOOLEAN DEFAULT FALSE;
```

### Column Details
- **Column Name:** `resubmitted`
- **Data Type:** `BOOLEAN`
- **Default Value:** `FALSE`
- **Purpose:** Track when a drop number has been resubmitted by an agent
- **Nullable:** Yes (defaults to FALSE)

### How It's Used

1. **Initial Drop Creation:** When a new drop is created, `resubmitted = FALSE`
2. **Resubmission Detection:** When the same DR number is posted again to the same WhatsApp group:
   - System detects existing record in `qa_photo_reviews`
   - Sets `resubmitted = TRUE`
   - Sets `incomplete = FALSE` (clears incomplete flag)
   - Sets `feedback_sent = NULL` (clears feedback timestamp)
   - Updates `comment` with resubmission log entry
3. **Dashboard Display:**
   - API sorts by `resubmitted DESC, created_at DESC` (resubmitted drops appear first)
   - UI shows blue 🔄 badge on resubmitted drops
   - Filter allows showing only resubmitted drops

### Migration Path (If Needed)

To replicate this schema on another database:

```sql
-- Add resubmitted column to qa_photo_reviews
ALTER TABLE qa_photo_reviews
ADD COLUMN IF NOT EXISTS resubmitted BOOLEAN DEFAULT FALSE;

-- Optional: Set existing drops to FALSE (already default)
UPDATE qa_photo_reviews
SET resubmitted = FALSE
WHERE resubmitted IS NULL;

-- Verify column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'qa_photo_reviews'
AND column_name = 'resubmitted';
```

### Database Connection

**Production Database (Neon PostgreSQL):**
```
Host: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
Database: neondb
User: neondb_owner
SSL Mode: require
```

**Connection String:**
```
postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

### Related Files Changed

**Backend (VPS):**
- `/opt/velo-test-monitor/services/resubmission_handler.py` - Sets `resubmitted=TRUE` on resubmission
- `/opt/velo-test-monitor/services/realtime_drop_monitor.py` - Detects resubmissions

**Frontend (Next.js):**
- `src/modules/wa-monitor/types/wa-monitor.types.ts` - Added `resubmitted` field to interface
- `src/modules/wa-monitor/services/waMonitorService.ts` - Added column to SELECT query, added sorting
- `src/modules/wa-monitor/components/QaReviewCard.tsx` - Added resubmission badge
- `src/modules/wa-monitor/components/WaMonitorFilters.tsx` - Added resubmission filter
- `src/modules/wa-monitor/components/WaMonitorDashboard.tsx` - Added filter logic

### Deployment Date
**Date:** November 9, 2025
**Time:** 18:17 UTC
**Git Commit:** 5bc82ab
**Git Tag:** v2.1.0-wa-resubmission

### Testing Verification

Test performed with DR0000017 in Velo Test group:
- ✅ Initial creation: `resubmitted = FALSE`
- ✅ After resubmission: `resubmitted = TRUE`
- ✅ Dashboard sorting: Resubmitted drop appears first
- ✅ UI badge: Blue 🔄 badge displays correctly
- ✅ Filter: "Resubmitted Only" filter works

### Rollback Plan (If Needed)

If this feature needs to be removed:

1. **Database:** Column can be safely removed (won't break existing data):
   ```sql
   ALTER TABLE qa_photo_reviews DROP COLUMN IF EXISTS resubmitted;
   ```

2. **Frontend:** Revert to commit before 5bc82ab:
   ```bash
   git revert 5bc82ab
   git push origin master
   ```

3. **VPS:** Restore previous version of resubmission_handler.py:
   ```bash
   # Backup available at: docs/VPS/backups/2025-11-09/
   ```
