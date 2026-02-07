# WA Monitor Implementation Summary
**Date**: November 6, 2025
**Implementation**: Option 2 - Track WhatsApp Message Date

## ✅ Changes Completed

### 1. Database Migration ✅
- **File**: `scripts/migrations/add_whatsapp_message_date.sql`
- **Changes**:
  - Added `whatsapp_message_date TIMESTAMP WITH TIME ZONE` column to `qa_photo_reviews`
  - Created index for efficient filtering: `idx_qa_photo_reviews_whatsapp_message_date`
  - Backfilled existing rows with `created_at` values (558 rows updated)
- **Status**: ✅ **Applied to production database**

### 2. Dashboard API Updates ✅
- **File**: `src/modules/wa-monitor/services/waMonitorService.ts`
- **Function**: `getDailyDropsPerProject()`
- **Changes**:
  - Updated query to use `COALESCE(whatsapp_message_date, created_at)` instead of `created_at`
  - Filters by actual WhatsApp message date, not database insert date
  - Fallback to `created_at` for backward compatibility
- **Status**: ✅ **Code updated, ready to deploy**

### 3. SharePoint Sync Updates ✅
- **File**: `pages/api/wa-monitor-sync-sharepoint.ts`
- **Changes**: None required - automatically uses updated `getDailyDropsPerProject()`
- **Status**: ✅ **Inherits fix automatically**

### 4. VPS Drop Monitor Script 📋
- **File**: `/opt/velo-test-monitor/services/realtime_drop_monitor.py`
- **Documentation**: `docs/VPS_DROP_MONITOR_PATCH.md`
- **Changes Required**:
  1. Update function signature to accept `message_timestamp` parameter
  2. Update INSERT query to include `whatsapp_message_date` column
  3. Update VALUES clause to include timestamp parameter
  4. Update execute parameters to pass `message_timestamp`
  5. Update function calls to pass WhatsApp message timestamp
- **Status**: 📋 **Patch documented, needs manual application on VPS**

## 🚀 Deployment Steps

### Step 1: Deploy FibreFlow App Changes
```bash
# Build and test locally
npm run build
PORT=3005 npm start

# Deploy to VPS (production)
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow-prod"
```

### Step 2: Apply VPS Drop Monitor Patch

**⚠️ Important**: This must be done carefully as it affects live data capture.

```bash
# 1. SSH to VPS
ssh root@72.60.17.245

# 2. Backup current script
cp /opt/velo-test-monitor/services/realtime_drop_monitor.py \
   /opt/velo-test-monitor/services/realtime_drop_monitor.py.backup_$(date +%Y%m%d)

# 3. Apply the 5 changes documented in docs/VPS_DROP_MONITOR_PATCH.md
nano /opt/velo-test-monitor/services/realtime_drop_monitor.py

# 4. Find the running process
ps aux | grep realtime_drop_monitor

# 5. Gracefully stop it
kill -TERM [PID]

# 6. Restart with logging
cd /opt/velo-test-monitor/services
nohup python3 realtime_drop_monitor.py --interval 15 >> ../logs/drop_monitor.log 2>&1 &

# 7. Verify it's running
ps aux | grep realtime_drop_monitor
tail -f ../logs/drop_monitor.log
```

## 📊 Expected Results

### Before VPS Patch Applied
- Dashboard will continue showing same numbers (41 Lawley, 15 Mohadin)
- Reason: `whatsapp_message_date` was backfilled with `created_at` values
- No change in behavior yet

### After VPS Patch Applied
- **New drops** will have accurate `whatsapp_message_date` from WhatsApp
- Dashboard will show **true daily submission counts**
- Historical batch processing will no longer inflate daily counts
- Example: Tomorrow if 14 drops come via WhatsApp, dashboard will show 14 (not 41)

## 🔍 Verification Commands

### Check Database Column
```sql
-- Verify column exists and is populated
SELECT
  COUNT(*) as total,
  COUNT(whatsapp_message_date) as with_wa_date,
  COUNT(*) - COUNT(whatsapp_message_date) as missing_wa_date
FROM qa_photo_reviews;
```

### Test Dashboard API
```bash
# Locally
curl http://localhost:3005/api/wa-monitor-daily-drops

# Production
curl https://app.fibreflow.app/api/wa-monitor-daily-drops
```

### Check VPS Drop Monitor
```bash
# View recent logs
ssh root@72.60.17.245 "tail -50 /opt/velo-test-monitor/logs/drop_monitor.log"

# Check new drops have whatsapp_message_date
node -e "..." # Query to check recent drops
```

## 📝 Documentation Updates

### Created Files
1. ✅ `docs/WA_MONITOR_DATA_FLOW_REPORT.md` - Complete investigation report
2. ✅ `docs/VPS_DROP_MONITOR_PATCH.md` - VPS patch instructions
3. ✅ `docs/WA_MONITOR_IMPLEMENTATION_SUMMARY.md` - This file
4. ✅ `scripts/migrations/add_whatsapp_message_date.sql` - Database migration
5. ✅ `scripts/migrate-add-wa-message-date.js` - Migration runner

### Updated Files
1. ✅ `src/modules/wa-monitor/services/waMonitorService.ts` - API logic
2. 📋 `/opt/velo-test-monitor/services/realtime_drop_monitor.py` (on VPS) - Pending

## 🎯 Benefits

### Accurate Reporting
- Dashboard shows **actual daily WhatsApp submissions**
- No more confusion from historical batch processing
- True visibility into daily contractor activity

### Data Integrity
- Preserves both timestamps:
  - `whatsapp_message_date`: When contractor sent message
  - `created_at`: When system processed it
- Useful for debugging and auditing

### Backward Compatible
- Uses `COALESCE(whatsapp_message_date, created_at)` fallback
- Existing data continues to work
- No data loss

## ⚠️ Important Notes

1. **VPS Changes are Critical**: The accuracy depends on the VPS script being updated. Without it, new drops will still use fallback behavior.

2. **Timing**: Changes take effect for NEW drops after VPS patch is applied. Historical data remains unchanged.

3. **Testing Window**: First day after VPS patch will show the true difference. Monitor closely.

4. **Rollback**: Keep backups of VPS script. Can rollback by restoring backup and restarting monitor.

## 📞 Support

If issues occur:
1. Check VPS logs: `/opt/velo-test-monitor/logs/drop_monitor.log`
2. Verify database column: `SELECT * FROM qa_photo_reviews ORDER BY created_at DESC LIMIT 5`
3. Test API manually: `curl https://app.fibreflow.app/api/wa-monitor-daily-drops`
4. Rollback VPS script if needed (see backup instructions)

---

**Implementation Status**: ✅ 80% Complete (4/5 components done)
**Remaining**: VPS drop monitor patch application
**Ready for**: Production deployment + VPS update
