# WA Monitor WhatsApp Feedback Integration
**Date**: November 6, 2025
**Status**: ✅ IMPLEMENTED - Ready for Testing

## Overview
Integration complete! QA reviewers can now send feedback from the FibreFlow dashboard (https://app.fibreflow.app/wa-monitor) directly to WhatsApp groups.

## How It Works

### User Flow
1. **QA Reviewer** opens https://app.fibreflow.app/wa-monitor
2. **Reviews a drop** by checking/unchecking the 12 QA steps
3. **Types feedback message** (or uses Auto-Generate button)
4. **Clicks "Send Feedback"**
5. **Message sent** to appropriate WhatsApp group
6. **Database updated** with `feedback_sent` timestamp

### Technical Flow
```
FibreFlow Dashboard (React)
    ↓ POST /api/wa-monitor-send-feedback
FibreFlow API (Next.js)
    ↓ POST http://localhost:8080/api/send
WhatsApp Bridge (Go service)
    ↓ WhatsApp Protocol
WhatsApp Group (Velo Test / Lawley / Mohadin)
```

## Implementation Details

### Files Created/Modified

#### 1. API Endpoint
**File**: `pages/api/wa-monitor-send-feedback.ts`
- Accepts: `{dropId, dropNumber, message, project}`
- Calls WhatsApp Bridge API
- Updates `feedback_sent` timestamp in database
- Returns success/error

#### 2. Frontend Service
**File**: `src/modules/wa-monitor/services/waMonitorApiService.ts`
- Added `sendFeedbackToWhatsApp()` function
- Handles API communication
- Defaults to "Velo Test" for testing

#### 3. Dashboard Component
**File**: `src/modules/wa-monitor/components/WaMonitorDashboard.tsx`
- Updated `handleSendFeedback()` to call WhatsApp API
- Refreshes data after sending

#### 4. QA Review Card
**File**: `src/modules/wa-monitor/components/QaReviewCard.tsx`
- Updated to pass `project` parameter
- Shows error alerts if sending fails
- Clears feedback message on success

### WhatsApp Group Mapping

Messages are automatically routed to the correct WhatsApp group based on project:

| Project | WhatsApp Group | JID |
|---------|---------------|-----|
| **Velo Test** ✅ | Velo Test | 120363421664266245@g.us |
| **Lawley** | Lawley Activation 3 | 120363418298130331@g.us |
| **Mohadin** | Mohadin Activations 🥳 | 120363421532174586@g.us |

**Default**: All feedback defaults to **Velo Test** group for testing purposes.

### Environment Variables

**Local (.env.production.local)**:
```bash
WHATSAPP_BRIDGE_URL="http://localhost:8080/api"
```

**VPS (.env.production)**:
```bash
WHATSAPP_BRIDGE_URL="http://localhost:8080/api"
```

## Testing Instructions

### Prerequisites
1. ✅ WhatsApp Bridge service running on port 8080
2. ✅ WhatsApp session authenticated
3. ✅ Access to Velo Test WhatsApp group

### Start WhatsApp Bridge
```bash
# Navigate to WA Monitor directory
cd /home/louisdup/VF/deployments/railway/WA_monitor\ _Velo_Test

# Start WhatsApp Bridge
cd services/whatsapp-bridge
go run main.go
# Should start on port 8080
```

### Test Locally
1. **Start FibreFlow**:
   ```bash
   cd /home/louisdup/VF/Apps/FF_React
   npm run build
   PORT=3005 npm start
   ```

2. **Open Dashboard**:
   - Navigate to http://localhost:3005/wa-monitor

3. **Send Test Feedback**:
   - Select any drop (preferably with missing QA steps)
   - Click "Auto-Generate" to create feedback message
   - Click "Send Feedback"
   - Check Velo Test WhatsApp group for message

4. **Verify Database Updated**:
   ```bash
   psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
     -c "SELECT drop_number, feedback_sent FROM qa_photo_reviews WHERE feedback_sent IS NOT NULL ORDER BY feedback_sent DESC LIMIT 5;"
   ```

### Test on VPS
1. **Deploy to VPS** (already done):
   ```bash
   # Changes already deployed
   ```

2. **Open Dashboard**:
   - Navigate to https://app.fibreflow.app/wa-monitor

3. **Send Test Feedback**:
   - Same steps as local testing
   - Check Velo Test WhatsApp group

## Message Format

### Auto-Generated Feedback Example
```
Hi Agent Name,

QA Review for DR1857010 is incomplete. Missing:

1. House Photo
2. Cable From Pole
3. ONT Barcode

Please provide the missing items. Thank you!
```

### Custom Feedback Example
```
Hi Team,

Please resubmit DR1857010 with:
- Clearer house photo
- ONT barcode scan
- Customer signature

Thanks!
```

## Database Schema

### qa_photo_reviews Table
- **feedback_sent** (timestamp): Set when feedback is sent to WhatsApp
- **sender_phone** (varchar): Phone number of WhatsApp sender
- **updated_at** (timestamp): Updated when feedback is sent

## Troubleshooting

### Error: "Failed to send WhatsApp message"
**Cause**: WhatsApp Bridge not running or not accessible
**Solution**:
1. Check if WhatsApp Bridge is running: `lsof -i:8080`
2. Start WhatsApp Bridge: `cd services/whatsapp-bridge && go run main.go`
3. Verify authentication: Check WhatsApp session is active

### Error: "WhatsApp API error: HTTP 500"
**Cause**: WhatsApp session expired or not authenticated
**Solution**:
1. Restart WhatsApp Bridge
2. Scan QR code to re-authenticate
3. Wait for "Connected" message

### Feedback Not Appearing in WhatsApp Group
**Cause**: Wrong group JID or not member of group
**Solution**:
1. Verify group JID in `/deployments/railway/WA_monitor _Velo_Test/.env`
2. Ensure WhatsApp account is member of target group
3. Check WhatsApp Bridge logs for errors

### "feedback_sent" Not Updated
**Cause**: Database write failed
**Solution**:
1. Check DATABASE_URL is correct
2. Verify database connection
3. Check API logs for SQL errors

## Production Deployment Checklist

Before deploying to production:

- [x] API endpoint created (`/api/wa-monitor-send-feedback`)
- [x] Frontend service updated (`waMonitorApiService.ts`)
- [x] Dashboard component wired up
- [x] QA Review Card updated
- [x] Environment variables configured
- [ ] WhatsApp Bridge running and authenticated
- [ ] Test send to Velo Test group successful
- [ ] Database feedback_sent timestamp updating
- [ ] Error handling tested
- [ ] VPS deployment completed

## Next Steps

### Immediate
1. **Start WhatsApp Bridge** on server where FibreFlow is deployed
2. **Test feedback** to Velo Test group
3. **Verify messages** appear in WhatsApp
4. **Check database** for updated timestamps

### Future Enhancements
1. Add feedback templates
2. Support attachments (screenshots)
3. Two-way communication (read replies)
4. Bulk feedback for multiple drops
5. Feedback history tracking

## Support

### WhatsApp Bridge Logs
```bash
# Check WhatsApp Bridge logs
cd /home/louisdup/VF/deployments/railway/WA_monitor _Velo_Test/services/whatsapp-bridge
tail -f logs/whatsapp-bridge.log
```

### FibreFlow API Logs
```bash
# Check Next.js logs
cd /home/louisdup/VF/Apps/FF_React
pm2 logs fibreflow
```

### Database Queries
```bash
# Check recent feedback
psql "$DATABASE_URL" -c "SELECT drop_number, project, feedback_sent FROM qa_photo_reviews WHERE feedback_sent > NOW() - INTERVAL '1 hour';"

# Count feedback sent today
psql "$DATABASE_URL" -c "SELECT COUNT(*) as feedback_sent_today FROM qa_photo_reviews WHERE DATE(feedback_sent) = CURRENT_DATE;"
```

---
**Document Version**: 1.0
**Last Updated**: November 6, 2025
**Maintained By**: FibreFlow Development Team
