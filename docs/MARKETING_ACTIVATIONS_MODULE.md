# Marketing Activations Module

**Created:** November 20, 2025
**Status:** ✅ PRODUCTION
**Purpose:** Monitor and track DR number submissions from marketing WhatsApp groups

## Overview

The Marketing Activations module captures DR (Drop) numbers posted to WhatsApp groups by the marketing team. Unlike the QA review monitoring system, this module only extracts and validates drop numbers without processing photo reviews.

## Architecture

```
WhatsApp Group (Lawley Marketing Activations)
    ↓
WhatsApp Bridge (Go) - Captures messages
    SQLite: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db
    ↓
Python Monitor - Marketing Module
    Service: wa-monitor-prod
    Module: /opt/wa-monitor/prod/modules/marketing_monitor.py
    Config: /opt/wa-monitor/prod/config/projects.yaml
    ↓
Neon PostgreSQL Database
    Table: marketing_activations
    ↓
Next.js API Endpoint
    /api/marketing-activations
    ↓
React Dashboard
    /marketing-activations
```

## Database Schema

### Table: `marketing_activations`

```sql
CREATE TABLE marketing_activations (
  id SERIAL PRIMARY KEY,
  drop_number VARCHAR(20) NOT NULL,
  whatsapp_message_date TIMESTAMPTZ NOT NULL,
  submitted_by VARCHAR(20),              -- Phone number or LID
  user_name VARCHAR(100),                -- Resolved contact name
  is_valid BOOLEAN DEFAULT false,
  validation_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_marketing_activations_date
ON marketing_activations(whatsapp_message_date);

CREATE INDEX idx_marketing_activations_drop
ON marketing_activations(drop_number);
```

### Table: `approved_marketing_drops`

```sql
-- Future validation list (not currently used)
CREATE TABLE approved_marketing_drops (
  drop_number VARCHAR(20) PRIMARY KEY,
  import_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Backend Configuration

### 1. WhatsApp Bridge Setup

**File:** `/opt/velo-test-monitor/services/whatsapp-bridge/main.go`

```go
// Add to PROJECTS map
"Marketing Activations": {
    "group_jid":          "120363422808656601@g.us",
    "project_name":       "Marketing Activations",
    "group_description": "Lawley marketing activstions group",
},
```

**Commands:**
```bash
# Rebuild bridge after adding group
cd /opt/velo-test-monitor/services/whatsapp-bridge
go build -o whatsapp-bridge
systemctl restart whatsapp-bridge

# Verify bridge is monitoring
ps aux | grep whatsapp-bridge
```

### 2. Python Monitor Configuration

**File:** `/opt/wa-monitor/prod/config/projects.yaml`

```yaml
- name: Marketing Activations
  enabled: true
  group_jid: "120363422808656601@g.us"
  description: "Lawley marketing activstions group"
  type: marketing  # Important: Sets monitoring type
```

**Module File:** `/opt/wa-monitor/prod/modules/marketing_monitor.py`

Key features:
- Extracts DR numbers using regex: `\bDR\d+\b`
- Validation currently disabled (`is_valid = True`)
- Resolves LIDs to phone numbers using WhatsApp database
- Stores submissions in `marketing_activations` table

**Restart Monitor:**
```bash
# ALWAYS use safe restart script (clears Python cache)
/opt/wa-monitor/prod/restart-monitor.sh

# Check logs
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep Marketing
```

## Frontend Implementation

### API Endpoint

**File:** `/pages/api/marketing-activations.ts`

**Route:** `GET /api/marketing-activations?date=YYYY-MM-DD`

**Response Format:**
```json
{
  "success": true,
  "data": {
    "date": "2025-11-20",
    "stats": {
      "total": 1,
      "valid": 1,
      "invalid": 0
    },
    "submissions": [
      {
        "dropNumber": "DR1234567",
        "submittedAt": "2025-11-20T14:30:15.000Z",
        "submittedBy": "27640412391",
        "userName": "John Doe",
        "isValid": true,
        "validationMessage": "✅ Marketing drop recorded - DR1234567"
      }
    ]
  }
}
```

**Query Parameters:**
- `date` (optional): Date in YYYY-MM-DD format. Defaults to today.

**Database Queries:**
- Uses tagged-template SQL syntax: `sql\`SELECT * FROM...\``
- Filters by date using Africa/Johannesburg timezone
- Orders submissions by `whatsapp_message_date DESC`

### Dashboard Page

**File:** `/pages/marketing-activations.tsx`

**Route:** `/marketing-activations`

**Features:**
- ✅ Date selector for viewing historical data
- ✅ Daily stats cards (Total, Valid, Invalid)
- ✅ Submissions table with status badges
- ✅ CSV export functionality
- ✅ Auto-refresh every 30 seconds
- ✅ Responsive design with TailwindCSS

**Access:** Available in sidebar under "Field Operations > Marketing Activations"

### Navigation Configuration

**File:** `/src/components/layout/sidebar/config/fieldOperationsSection.ts`

```typescript
{
  to: '/marketing-activations',
  icon: TrendingUp,
  label: 'Marketing Activations',
  shortLabel: 'Marketing',
  permissions: [],
}
```

## Usage Guide

### For Developers

**1. Test Message Capture:**
```bash
# Post test message to group
echo "DR1234567" > WhatsApp group

# Check database
psql "$DATABASE_URL" -c "
  SELECT * FROM marketing_activations
  WHERE drop_number = 'DR1234567';
"

# Check monitor logs
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep Marketing
```

**2. Query Today's Submissions:**
```bash
psql "$DATABASE_URL" -c "
  SELECT
    drop_number,
    TO_CHAR(whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI:SS') as time,
    submitted_by,
    is_valid
  FROM marketing_activations
  WHERE DATE(whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE
  ORDER BY whatsapp_message_date DESC;
"
```

**3. CSV Export Script:**

**File:** `/scripts/marketing/import-approved-drops.js`

```bash
# Import approved drop list (for future validation)
node scripts/marketing/import-approved-drops.js path/to/drops.csv
```

### For Marketing Team

**Dashboard Access:**
1. Navigate to https://app.fibreflow.app/marketing-activations
2. View today's submissions by default
3. Select different date to view historical data
4. Click "Export to CSV" to download submissions

**WhatsApp Group:**
- Group Name: Lawley marketing activstions
- Group JID: 120363422808656601@g.us
- Bridge Number: 064 041 2391

**Posting Format:**
- Just post the DR number: `DR1234567`
- Can include in sentence: "Please check DR1234567 status"
- System extracts all DR numbers automatically

## Validation System

**Current Status:** ✅ DISABLED (All submissions marked as valid)

**Reason:** No approved drop list imported yet

**Future Implementation:**
1. Import approved drops to `approved_marketing_drops` table
2. Enable validation in `marketing_monitor.py`:
   ```python
   # Change from:
   is_valid = True
   # To:
   is_valid = self._is_approved(drop_number)
   ```
3. Restart monitor

**CSV Import Script:**
```bash
node scripts/marketing/import-approved-drops.js drops.csv
```

## Deployment History

### November 20, 2025 - Initial Deployment

**Commits:**
- `d6e054e` - feat: Add Marketing Activations monitoring module
- `7b0e098` - fix: Force dynamic rendering for marketing-activations page
- `add8e03` - fix: Convert marketing-activations to Pages Router for stability
- `ed06be4` - fix: Convert marketing-activations API to tagged-template SQL syntax

**Production URL:** https://app.fibreflow.app/marketing-activations

**Test Results:**
- ✅ Backend monitor running
- ✅ DR1234567 captured successfully
- ✅ API endpoint working
- ✅ Dashboard displaying data
- ✅ CSV export functional

## Known Issues & Solutions

### Issue 1: LID Display Instead of Phone Number

**Problem:** Dashboard shows LID (36563643842564) instead of phone number

**Solution:** Marketing monitor needs LID resolution logic (see fix below)

### Issue 2: App Router Build Failures

**Problem:** Initial implementation used App Router causing "NextRouter was not mounted" errors

**Solution:** Converted to Pages Router (`/pages/marketing-activations.tsx`)

### Issue 3: SQL Syntax Error

**Problem:** `sql(query, [params])` syntax not supported in @neondatabase/serverless

**Solution:** Convert to tagged-template syntax: `sql\`SELECT * FROM...\``

## Monitoring & Maintenance

### Health Checks

```bash
# 1. Check monitor service status
systemctl status wa-monitor-prod

# 2. Verify Marketing module loaded
tail -100 /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep -i marketing

# 3. Check recent submissions
psql "$DATABASE_URL" -c "
  SELECT COUNT(*), MAX(whatsapp_message_date) as latest
  FROM marketing_activations
  WHERE DATE(whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE;
"

# 4. Test API endpoint
curl -s https://app.fibreflow.app/api/marketing-activations | jq .
```

### Troubleshooting

**No messages being captured:**
```bash
# 1. Check WhatsApp bridge is monitoring group
sqlite3 /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db \
  "SELECT COUNT(*) FROM messages WHERE group_jid = '120363422808656601@g.us';"

# 2. Check Python monitor is scanning project
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep -E "(Marketing|120363422808656601)"

# 3. Restart monitor (use safe script)
/opt/wa-monitor/prod/restart-monitor.sh
```

**Dashboard not updating:**
```bash
# 1. Check API returns data
curl https://app.fibreflow.app/api/marketing-activations | jq .

# 2. Check browser console for errors
# 3. Hard refresh: Ctrl+Shift+R

# 4. Rebuild frontend
cd /var/www/fibreflow
npm run build
pm2 restart fibreflow-prod
```

## Integration with Other Systems

### Future Enhancements

1. **SharePoint Sync:** Export daily submissions to SharePoint (similar to QA reviews)
2. **Validation:** Enable drop number validation against approved list
3. **Notifications:** WhatsApp notifications for invalid submissions
4. **Analytics:** Weekly/monthly submission reports
5. **Multi-Group:** Add additional marketing WhatsApp groups

### API Integration Example

```javascript
// Fetch today's marketing submissions
const response = await fetch('/api/marketing-activations');
const { data } = await response.json();

console.log(`Total submissions: ${data.stats.total}`);
data.submissions.forEach(sub => {
  console.log(`${sub.dropNumber} by ${sub.userName || sub.submittedBy}`);
});
```

## Related Documentation

- Main WA Monitor: `/docs/wa-monitor/README.md`
- QA Photo Reviews: `/src/modules/wa-monitor/README.md`
- VPS Deployment: `/docs/VPS/DEPLOYMENT.md`
- Python Cache Issue: `/docs/wa-monitor/PYTHON_CACHE_ISSUE.md`
- Add New Project Guide: `/docs/WA_MONITOR_ADD_PROJECT_5MIN.md`

## Support

**VPS Access:** `ssh root@72.60.17.245`
**Database:** `postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb`
**Monitor Logs:** `/opt/wa-monitor/prod/logs/wa-monitor-prod.log`
**WhatsApp Bridge Logs:** `/opt/velo-test-monitor/logs/whatsapp-bridge.log`

---

**Last Updated:** November 20, 2025
**Module Status:** ✅ PRODUCTION READY
