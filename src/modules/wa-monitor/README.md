# WA Monitor Module

**Version:** 2.0.0 (Isolated & Self-Contained)
**Status:** ✅ Production Ready | 🔒 Fully Isolated
**Last Updated:** 2025-11-24

WhatsApp QA Drop Monitoring System - Real-time tracking and review of QA photo submissions from field agents.

## 🚨 IMPORTANT: This Module is Isolated

This module is **fully isolated** and operates independently from the main FibreFlow application:

- ✅ No dependencies on main app utilities (`@/lib/*`)
- ✅ No dependencies on main app services (`@/services/*`)
- ✅ Frozen API contracts (see `API_CONTRACT.md`)
- ✅ Independent testing (`npm run test:wa-monitor`)
- ✅ Can be extracted to microservice if needed

**Before making changes:** Read `ISOLATION_GUIDE.md` for development workflow and branch strategy.

## 🚨 Quick Troubleshooting

**If feedback sending fails:**
- See **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** for common issues and fixes
- Check VPS sender health: `curl http://72.61.197.178:8081/health`
- Check wa-feedback proxy: `curl http://100.96.203.105:8092/health`
- Restart VPS services: `ssh root@72.61.197.178 "systemctl restart whatsapp-sender whatsapp-bridge"`
- Restart wa-feedback: `ssh velo@100.96.203.105 "echo 'velo2026' | sudo -S systemctl restart wa-feedback"`

## Overview

This module provides a live dashboard for monitoring QA photo review drops submitted via WhatsApp groups. Field agents submit installation photos, which are captured by the VPS monitor, stored in Neon PostgreSQL, and displayed in an interactive dashboard for QA review and feedback.

## Module Structure

```
src/modules/wa-monitor/
├── lib/                              # Internal utilities (ISOLATED)
│   └── apiResponse.ts                # 🔒 Frozen copy - do not modify
├── types/
│   └── wa-monitor.types.ts          # Type definitions
├── services/
│   ├── waMonitorService.ts          # Backend database operations
│   └── waMonitorApiService.ts       # Frontend API client
├── utils/
│   └── waMonitorHelpers.ts          # Helper functions (formatting, export)
├── components/
│   ├── QaReviewCard.tsx             # Main review card with incorrect marking
│   ├── WaMonitorDashboard.tsx       # Main dashboard component
│   ├── WaMonitorFilters.tsx         # Filter controls
│   ├── DropStatusBadge.tsx          # Status badge component
│   └── index.ts                     # Component exports
├── hooks/
│   └── useWaMonitorStats.ts         # Custom React hooks
├── tests/
│   └── integration.test.ts          # Integration tests
├── API_CONTRACT.md                   # 🔒 Frozen API contracts
├── ISOLATION_GUIDE.md                # Development & branch strategy
└── README.md                         # This file
```

## How It Works

### Data Flow
```
WhatsApp Groups → VPS Monitor → Database → Dashboard
                   (Python)      (Neon)     (React)
```

1. **Field agents** submit 12 QA photos to WhatsApp groups (one per installation step)
2. **VPS Monitor** (Python script at `/opt/wa-monitor/prod/`) captures messages via whatsmeow bridge
3. Data saved to **Neon PostgreSQL** table `qa_photo_reviews`
4. **Dashboard** displays drops for QA review, marking incorrect photos, and sending feedback

### 12 QA Steps (Photos Required)
1. Property Photo
2. Cable from Pole
3. Cable Entry Outside
4. Cable Entry Inside
5. Location on Wall
6. Fibre Entry to ONT
7. Overall Work area - final installation
8. ONT Barcode
9. UPS Serial number
10. Powermeter at ONT
11. Green Lights
12. Customer Signature

## Incorrect Photo Marking (Nov 17, 2025)

### UI Design
Each of the 12 QA steps has:
- **Checkbox**: Ticked = photo uploaded, Unticked = missing
- **Text input**: Below each step for explaining why a photo is incorrect

```
[✓] 1. Property Photo
    If incorrect, explain why: [Photo unclear, can't see house number___]

[✓] 2. Cable from Pole
    If incorrect, explain why: [Wrong angle - need full view________]

[ ] 3. Cable Entry Outside
    Not uploaded - no comment needed [_____________] (disabled)
```

### Logic - Three States

| Checkbox | Text Input | Result     | Database                               |
|----------|-----------|------------|----------------------------------------|
| ☑️ Ticked | Empty     | ✅ Correct | `step_01_house_photo = true`          |
| ☑️ Ticked | Filled    | ⚠️ Incorrect | `step_01_house_photo = true`<br>`incorrectSteps = ['step_01_house_photo']`<br>`incorrectComments = {"step_01_house_photo": "Photo unclear"}` |
| ☐ Unticked | N/A      | ❌ Missing | `step_01_house_photo = false`         |

### Feedback Generation

When user clicks **"Auto-Generate"**, the system creates a feedback message like:

```
DR1234567

Missing items:
• 3. Cable Entry Outside
• 7. Overall Work area

Incorrect items:
• 1. Property Photo - Photo unclear, can't see house number
• 5. Location on Wall - Wrong angle - need full wall view
```

### Code Implementation

**Component**: `src/modules/wa-monitor/components/QaReviewCard.tsx`

**Key Logic**:
```typescript
// Determine incorrect steps from comments
const getIncorrectSteps = () => {
  return ORDERED_STEP_KEYS.filter(
    key => steps[key] && // Photo uploaded
           incorrectComments[key] && // Comment exists
           incorrectComments[key].trim().length > 0 // Comment not empty
  );
};

// Save to database
await onUpdate(drop.id, {
  ...steps,
  incorrectSteps: getIncorrectSteps(),
  incorrectComments: incorrectComments
});
```

### Database Storage

**Table**: `qa_photo_reviews`

**New Columns** (Added Nov 17, 2025):
```sql
-- Array of step keys marked as incorrect
incorrect_steps TEXT[] DEFAULT '{}',

-- JSONB object mapping step keys to comments
incorrect_comments JSONB DEFAULT '{}'
```

**Example Data**:
```json
{
  "drop_number": "DR1234567",
  "step_01_house_photo": true,
  "step_02_cable_from_pole": true,
  "step_03_cable_entry_outside": false,

  "incorrect_steps": ["step_01_house_photo"],
  "incorrect_comments": {
    "step_01_house_photo": "Photo unclear, can't see house number"
  }
}
```

## Database Schema

**Table:** `qa_photo_reviews`

```sql
CREATE TABLE qa_photo_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number TEXT UNIQUE NOT NULL,
  project TEXT,
  user_name TEXT,
  submitted_by TEXT,

  -- 12 QA steps (boolean - true if photo uploaded)
  step_01_house_photo BOOLEAN DEFAULT false,
  step_02_cable_from_pole BOOLEAN DEFAULT false,
  step_03_cable_entry_outside BOOLEAN DEFAULT false,
  step_04_cable_entry_inside BOOLEAN DEFAULT false,
  step_05_wall_for_installation BOOLEAN DEFAULT false,
  step_06_ont_back_after_install BOOLEAN DEFAULT false,
  step_07_power_meter_reading BOOLEAN DEFAULT false,
  step_08_ont_barcode BOOLEAN DEFAULT false,
  step_09_ups_serial BOOLEAN DEFAULT false,
  step_10_final_installation BOOLEAN DEFAULT false,
  step_11_green_lights BOOLEAN DEFAULT false,
  step_12_customer_signature BOOLEAN DEFAULT false,

  -- Incorrect photo tracking (NEW - Nov 17, 2025)
  incorrect_steps TEXT[] DEFAULT '{}',
  incorrect_comments JSONB DEFAULT '{}',

  -- Metadata
  completed_photos INTEGER DEFAULT 0,
  outstanding_photos INTEGER DEFAULT 12,
  completed BOOLEAN DEFAULT false,
  incomplete BOOLEAN DEFAULT true,
  comment TEXT,
  feedback_sent TIMESTAMP,
  review_date TIMESTAMP DEFAULT NOW(),
  whatsapp_message_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Locking (prevents concurrent edits)
  locked_by TEXT,
  locked_at TIMESTAMP,

  -- Resubmission tracking
  resubmitted BOOLEAN DEFAULT false
);

CREATE INDEX idx_qa_photo_reviews_incorrect_steps ON qa_photo_reviews USING GIN (incorrect_steps);
```

## API Endpoints

### GET /api/wa-monitor-drops
Returns all drops with summary stats

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "dropNumber": "DR1234567",
      "status": "incomplete",
      "step_01_house_photo": true,
      "incorrectSteps": ["step_01_house_photo"],
      "incorrectComments": {"step_01_house_photo": "Photo unclear"}
    }
  ],
  "summary": {
    "total": 100,
    "incomplete": 35,
    "complete": 65
  }
}
```

### PATCH /api/wa-monitor-drops/[id]
Update drop review (including incorrect photo marking)

**Request**:
```json
{
  "step_01_house_photo": true,
  "step_02_cable_from_pole": true,
  "incorrectSteps": ["step_01_house_photo"],
  "incorrectComments": {
    "step_01_house_photo": "Photo unclear"
  }
}
```

### POST /api/wa-monitor-send-feedback
Send feedback to WhatsApp group

**Request**:
```json
{
  "dropId": "uuid",
  "dropNumber": "DR1234567",
  "message": "DR1234567\n\nMissing items:\n• 3. Cable Entry...",
  "project": "Velo Test"
}
```

## User Workflow

### Step-by-Step Usage

1. **View Dashboard**: Navigate to `/wa-monitor`
2. **Find Drop**: Search by drop number or browse list
3. **Click "Edit"**: Locks drop for editing (prevents conflicts)
4. **Review Photos**: Check boxes for completed photos
5. **Mark Incorrect**: Type reason in text box below any incorrect photo
   - Example: "Photo unclear, can't see number"
6. **Auto-Generate Feedback**: Click button to create feedback message
7. **Send to WhatsApp**: Click "Send Feedback" to notify field agent
8. **Save Review**: Saves to database and unlocks drop

### Locking System
- Prevents multiple users editing same drop
- Auto-refresh disabled while editing (prevents data loss)
- Shows warning if locked by another user
- Released on "Save" or "Cancel"

## WA Monitor Agent (Velocity Server)

**Location**: `/opt/wa-monitor/prod/` on Velocity (100.96.203.105)

**WhatsApp Services (VPS - Jan 2026)**: `ssh root@72.61.197.178`
- Sender: `/opt/whatsapp-sender/` (port 8081)
- Bridge: `/opt/whatsapp-bridge/` (port 8083)

### Does NOT Need Updating

The VPS Python agent **does NOT require changes** for the incorrect photo marking feature:

- Agent **only writes** basic QA step data (`step_01_house_photo`, etc.)
- New columns (`incorrect_steps`, `incorrect_comments`) are populated by **dashboard users**
- Agent continues to work as before - **no code changes needed**

### Agent Architecture (v2.0)
```
/opt/wa-monitor/
├── prod/                          # Production monitor
│   ├── modules/
│   │   ├── config.py             # Project config loader
│   │   ├── database.py           # Neon database handler
│   │   └── monitor.py            # Message processing
│   ├── config/
│   │   └── projects.yaml         # Project definitions (YAML)
│   ├── logs/
│   │   └── wa-monitor-prod.log
│   └── restart-monitor.sh        # Safe restart (clears Python cache)
└── dev/                           # Development monitor
    └── (same structure)
```

**Important**: Always use safe restart script:
```bash
ssh velo@100.96.203.105
/opt/wa-monitor/prod/restart-monitor.sh  # Clears Python bytecode cache
```

## Projects Monitored

| Project  | WhatsApp Group JID          | Environment |
|----------|----------------------------|-------------|
| Lawley   | 120363418298130331@g.us    | Prod        |
| Mohadin  | 120363421532174586@g.us    | Prod        |
| Mamelodi | 120363408849234743@g.us    | Prod        |
| Velo Test| 120363421664266245@g.us    | Prod & Dev  |

## Development

### Test Drop
Use **`DRTEST001`** for testing (pre-created with 4 completed steps)

### Local Testing
```bash
npm run build
PORT=3005 npm start
# Visit: http://localhost:3005/wa-monitor
```

### Deploy to Staging
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 \
  "echo 'velo2026' | sudo -S bash -c 'cd /home/louis/apps/fibreflow && chown -R louis:louis .git && su louis -c \"git pull origin master && npm run build\"' && sudo systemctl restart fibreflow.service"
# Visit: https://vf.fibreflow.app/wa-monitor
```

### Deploy to Production
```bash
sshpass -p 'velo2026' ssh velo@100.96.203.105 \
  "cd /home/velo/fibreflow-production && git pull origin master && npm run build && echo 'velo2026' | sudo -S systemctl restart fibreflow-production.service"
# Visit: https://app.fibreflow.app/wa-monitor
```

## Troubleshooting

### Changes not showing after deployment?
**Cause**: Browser cache holding old JavaScript files

**Solution**:
1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+F5 or Cmd+Shift+R)
3. In DevTools: Right-click Refresh → "Empty Cache and Hard Reload"

### Text inputs not appearing?
**Cause**: Old JavaScript bundle cached

**Fix**:
```bash
# Force clean rebuild on server
cd /var/www/fibreflow[-dev]
rm -rf .next
npm run build
pm2 restart fibreflow-[prod|dev]
```

### WA Monitor agent not capturing messages?
```bash
# Check VPS bridge logs
ssh root@72.61.197.178 "tail -f /opt/whatsapp-bridge/bridge.log"

# Restart VPS services
ssh root@72.61.197.178 "systemctl restart whatsapp-bridge whatsapp-sender"
```

## Related Documentation

### Module Documentation (Start Here)
- **`API_CONTRACT.md`** - 🔒 Frozen API specifications and contracts
- **`ISOLATION_GUIDE.md`** - Development workflow, branch strategy, testing

### Main App Documentation
- `CLAUDE.md` - Complete WA Monitor system overview
- `/docs/wa-monitor/WA_MONITOR_ARCHITECTURE_V2.md` - Agent architecture
- `/docs/wa-monitor/PYTHON_CACHE_ISSUE.md` - VPS Python cache problems
- `/docs/wa-monitor/WA_MONITOR_ADD_PROJECT_5MIN.md` - Add new WhatsApp groups
- `/docs/wa-monitor/WA_MONITOR_DATA_FLOW_REPORT.md` - Data flow investigation
- `/docs/wa-monitor/WA_MONITOR_LOCKING_SYSTEM.md` - Edit locking system

## Serial Scanning Integration (Jan 2026)

### Overview
Steps 8 (ONT Barcode) and 9 (UPS Serial) now support **barcode scanning** to link installed equipment to drop numbers, enabling end-to-end stock traceability.

### 4-Stage Stock Tracking System
```
Stage 1: Receipt → Stage 2: Checkout → Stage 3: Installation → Stage 4: Reconciliation
(Warehouse)      (Morning)           (WA Monitor QA)         (End of Day)
```

### New Component: SerialScannerModal
**Location**: `src/modules/wa-monitor/components/SerialScannerModal.tsx`

Opens camera/barcode scanner for Steps 8 & 9:
- Validates serial exists in `stock_serials` table
- Confirms serial is issued to the technician
- Prevents duplicate installations
- Records GPS coordinates at scan time

### Enhanced QaReviewCard
Steps 8 & 9 now show:
```
[✓] 8. ONT Barcode
    Serial: ONT-ABC123 ✓ [Scan] [Clear]

[✓] 9. UPS Serial
    Serial: UPS-XYZ789 ✓ [Scan] [Clear]
```

### API Endpoint: POST /api/wa-monitor-scan-serial
Records serial scan and creates consumption record:

**Request**:
```json
{
  "qaReviewId": "uuid",
  "dropNumber": "DR1234567",
  "stepNumber": 8,
  "serialNumber": "ONT-ABC123",
  "technicianId": "user-id",
  "technicianName": "John Smith",
  "gpsLat": -25.7461,
  "gpsLng": 28.1881,
  "scanTimestamp": "2026-01-13T10:30:00Z"
}
```

**Response** (Success):
```json
{
  "success": true,
  "data": {
    "consumptionId": "uuid",
    "serialStatus": "installed",
    "dropUpdated": true,
    "qaReviewUpdated": true
  }
}
```

**Error Codes**:
- `SERIAL_NOT_FOUND` - Serial number not in system
- `SERIAL_NOT_ISSUED` - Serial not issued to this technician
- `ALREADY_INSTALLED` - Serial already installed at another drop

### New Database Columns

Added to `qa_photo_reviews` table:
```sql
-- Scanned serial numbers
ont_serial_scanned VARCHAR(100),
ups_serial_scanned VARCHAR(100),
router_serial_scanned VARCHAR(100),

-- Links to stock_consumptions
ont_consumption_id UUID REFERENCES stock_consumptions(id),
ups_consumption_id UUID REFERENCES stock_consumptions(id),
router_consumption_id UUID REFERENCES stock_consumptions(id),

-- Scan metadata
scan_gps_lat DECIMAL(10, 7),
scan_gps_lng DECIMAL(10, 7),
scan_timestamp TIMESTAMP WITH TIME ZONE,

-- Verification
serials_verified BOOLEAN DEFAULT false,
verification_notes TEXT
```

### User Workflow

1. Complete Steps 1-7 (property photos, cable routing)
2. **Step 8**: Tap "Scan" → Camera opens → Scan ONT barcode
   - System validates: serial exists, issued to you, not already installed
   - On success: Serial displayed with green checkmark
   - On error: Toast message with specific error
3. **Step 9**: Tap "Scan" → Scan UPS serial
4. Complete Steps 10-12 (final photos, signature)
5. Submit review → All serials linked to drop_number

### Manual Entry Fallback
If camera/barcode scan fails:
1. Tap "Manual Entry" button
2. Type serial number (e.g., "ONT-ABC123")
3. System validates same as scan
4. Useful for: damaged stickers, poor lighting, camera issues

### Stock Status Lifecycle
```
available → issued → installed
   ↓           ↓         ↓
(Warehouse) (Technician) (At Drop)
```

### Related Documentation
- **Field Stock Module**: `src/modules/field-stock/README.md`
- **Stock Tracking Guide**: `docs/STOCK_TRACKING_GUIDE.md`
- **Reconciliation Process**: `docs/RECONCILIATION_PROCESS.md`
- **Daily Reconciliation Dashboard**: `/procurement/field-stock/reconciliation`

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| Jan 6, 2025 | 1.0 | Initial WA Monitor dashboard |
| Nov 17, 2025 | 2.0 | **Incorrect photo marking** - Text input approach |
| Jan 13, 2026 | 3.0 | **Serial scanning integration** - 4-stage stock tracking |

---

**Last Updated**: January 13, 2026
**Current Version**: 3.0 (Serial Scanning Integration)
**Status**: ✅ Production Ready
**Architecture**: Modular "Lego Block" Pattern
