# Daily Reconciliation Process

**Version:** 1.0
**Last Updated:** January 13, 2026
**Audience:** Warehouse Managers, Project Managers, Supervisors

---

## Overview

The Daily Reconciliation Dashboard provides end-of-day accountability reporting for equipment issued to field technicians. This document explains how to use the dashboard and handle common scenarios.

## Accessing the Dashboard

**URL:** `/procurement/field-stock/reconciliation`

**Direct Link:** https://app.fibreflow.app/procurement/field-stock/reconciliation

---

## Dashboard Components

### 1. Summary Cards

At the top of the page, five summary cards show:

| Card | Description |
|------|-------------|
| **Total Issued** | Equipment issued to all technicians today |
| **Total Installed** | Equipment scanned at installation sites |
| **Total Returned** | Equipment returned to warehouse |
| **Unaccounted** | Issued - Installed - Returned (highlighted if > 0) |
| **Unaccounted Value** | Rand value of unaccounted items |

### 2. Date Selector

- Default: Today's date
- Select past dates to review historical data
- Data refreshes automatically when date changes

### 3. Technician Table

Each row shows one technician's daily activity:

| Column | Description |
|--------|-------------|
| Technician | Name and contractor |
| Issued | Items checked out this morning |
| Installed | Items scanned at drops |
| Returned | Items returned to warehouse |
| Unaccounted | Missing items (red if > 0) |
| Value | Rand value of unaccounted items |
| Status | Good / Warning / Blocked |

### 4. Expandable Details

Click the expand arrow (▶) on any row with unaccounted items to see:
- List of unaccounted serial numbers
- Last known location
- Issue date and time

---

## Daily Workflow

### Morning (07:00 - 08:00)

1. **Issue Equipment** via Daily Checkout Modal
2. Record technician signatures
3. Generate checkout slips

### End of Day (16:00 - 17:00)

1. **Open Reconciliation Dashboard**
2. **Review each technician's status**
3. **Process returns** - Scan returned equipment
4. **Investigate unaccounted items**
5. **Take action** on threshold breaches

---

## Understanding Status Indicators

### Good (Green)
```
✓ Unaccounted: 0-2 items
✓ Value: < R5,000
```
No action required.

### Warning (Yellow)
```
⚠ Unaccounted: 3+ items
  OR
⚠ Value: > R5,000
```
Review with technician. Possible reasons:
- Equipment still in vehicle (forgot to return)
- Serial not scanned at installation
- Legitimate loss/damage

### Blocked (Red)
```
🚫 Contractor flagged for blocking
```
Contractor cannot checkout new equipment until resolved.

---

## Handling Unaccounted Items

### Step 1: Investigate

1. Expand the technician row to see serial numbers
2. Check if items were scanned at drops (may be delayed sync)
3. Call technician to check vehicle inventory

### Step 2: Possible Resolutions

| Scenario | Resolution |
|----------|------------|
| **In vehicle** | Process as return tomorrow |
| **Forgot to scan** | Edit QA review and scan serial |
| **Lost/stolen** | Mark as lost, initiate recovery |
| **Damaged** | Mark as damaged, move to scrap |
| **Wrong technician** | Process stock transfer |

### Step 3: Document

Record the resolution in the system:
1. Click "Actions" dropdown
2. Select resolution type
3. Add notes explaining situation
4. Save

---

## Threshold Configuration

Default thresholds (configurable by admin):

| Threshold | Value | Action |
|-----------|-------|--------|
| Warning Count | 3 items | Yellow highlight |
| Warning Value | R5,000 | Yellow highlight |
| Blocking Count | 5 items | Block contractor |
| Blocking Value | R15,000 | Block contractor |

---

## Exporting Reports

### Export to Excel

1. Click "Export to Excel" button (top right)
2. CSV file downloads with:
   - All technician data
   - Summary row at bottom
   - Filename: `reconciliation_YYYY-MM-DD.csv`

### Report Contents

```csv
Technician,Contractor,Issued,Installed,Returned,Unaccounted,Value (R),Status
John Smith,ABC Installations,15,13,0,2,2500.00,Warning
Jane Doe,XYZ Fiber,12,12,0,0,0.00,Good
...
SUMMARY,,45,40,2,3,4500.00,
```

---

## Blocking Contractors

### Automatic Blocking

System automatically blocks contractors when:
- Unaccounted count exceeds 5 items in one day
- Unaccounted value exceeds R15,000
- Pattern of repeated warnings (3+ days)

### Manual Blocking

To manually block a contractor:
1. Click "Actions" dropdown on technician row
2. Select "Block Contractor"
3. Enter reason
4. Confirm

### Unblocking

To unblock a contractor:
1. Navigate to Contractor Management
2. Find blocked contractor
3. Click "Unblock"
4. Enter resolution notes
5. Confirm

---

## Automated Alerts

### Email Notifications

System sends automatic emails for:

| Event | Recipients |
|-------|------------|
| Daily summary | Warehouse manager |
| Threshold breach | Project manager + warehouse |
| Contractor blocked | All stakeholders |

### In-App Alerts

Warning banner appears at top of dashboard when:
- Any technician has 3+ unaccounted items
- Total unaccounted value > R10,000

---

## Reconciliation Reports

### Daily Report
- Generated automatically at 18:00
- Sent to configured email addresses
- Includes all technician activity

### Weekly Summary
- Generated every Monday
- Week-over-week comparison
- Identifies patterns and trends

### Monthly Audit
- Full audit trail export
- All transactions with timestamps
- Serial-level detail

---

## Troubleshooting

### No Data Showing

**Cause:** No checkouts recorded for selected date

**Fix:** Verify checkouts were processed via Daily Checkout Modal

### Technician Missing from List

**Cause:** No equipment issued to that technician today

**Fix:** This is normal - only technicians with activity appear

### Wrong Counts

**Cause:** Possible data sync delay

**Fix:**
1. Click refresh button
2. Wait 30 seconds
3. If still wrong, check API logs

### Export Not Working

**Cause:** Browser blocking downloads

**Fix:**
1. Allow downloads from fibreflow.app
2. Check downloads folder
3. Try different browser

---

## Best Practices

### Daily Routine

1. **07:30** - Complete all checkouts before technicians leave
2. **12:00** - Spot check dashboard for early warnings
3. **16:30** - Process returns as technicians arrive
4. **17:00** - Run reconciliation and investigate issues
5. **17:30** - Export report and send summary

### Weekly Review

- Monday: Review previous week's summary
- Identify repeat offenders
- Schedule training if needed
- Update procedures based on patterns

### Monthly Audit

- Export full month's data
- Reconcile against inventory count
- Report discrepancies to management
- Update thresholds if needed

---

## API Endpoints (For Integration)

### GET /api/field-stock/reports/daily-reconciliation

**Query Parameters:**
- `date` (required): YYYY-MM-DD format
- `project` (optional): Filter by project

**Response:**
```json
{
  "success": true,
  "data": {
    "date": "2026-01-13",
    "technicians": [...],
    "summary": {
      "total_issued": 45,
      "total_installed": 40,
      "total_returned": 2,
      "total_unaccounted": 3,
      "unaccounted_value": 4500
    }
  }
}
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Issued** | Equipment checked out to technician |
| **Installed** | Equipment scanned at customer site |
| **Returned** | Equipment returned to warehouse |
| **Unaccounted** | Equipment not installed or returned |
| **GRN** | Goods Receipt Note (warehouse receives) |
| **ISS** | Issue slip (checkout to technician) |
| **Picking** | Stock movement transaction |

---

## Support Contacts

| Issue | Contact |
|-------|---------|
| System problems | support@fibreflow.app |
| Process questions | warehouse@fibreflow.app |
| Contractor disputes | operations@fibreflow.app |

---

**Document Version:** 1.0
**Effective Date:** January 13, 2026
**Review Date:** April 13, 2026
**Owner:** Operations Team
