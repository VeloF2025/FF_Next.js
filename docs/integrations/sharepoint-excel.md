# SharePoint-FibreFlow Excel Integration

**Last Updated:** 2026-03-21  
**Feature Status:** Stable (shipped with Reports Sandbox, commit ca95b24)

## Overview

The SharePoint-FibreFlow Excel integration enables seamless export of analytical reports directly to Microsoft SharePoint Online with Excel workbook formatting. This integration facilitates data distribution, collaboration, and Power BI integration for business intelligence workflows.

### Key Capabilities
- Automated Excel export from Reports Sandbox API
- Direct upload to SharePoint OneDrive (`/sites/FibreFlow/Shared Documents/Reports/`)
- Role-based access control (RBAC) for exported files
- Power BI connectivity for dashboard sourcing
- Daily synchronization and metadata tagging
- Backward compatibility with legacy procurement workflows

## Architecture

### Data Flow

```
FibreFlow Reports Sandbox API
         ↓
    Excel Formatter
         ↓
    Graph API Client
         ↓
SharePoint OneDrive
         ↓
Power BI Data Connectors
```

### Component Stack

| Component | Technology | Purpose |
|---|---|---|
| **Report Generation** | Node.js + SQL | Aggregates analytics data |
| **Excel Workbook Creation** | `xlsx` (SheetJS) | Formats data with styling |
| **SharePoint Authentication** | Microsoft Graph API | OAuth 2.0 token-based access |
| **File Upload** | Graph API `driveItems/upload` | Pushes XLSX to SharePoint |
| **Scheduling** | Node.js cron | Daily 8 PM UTC export runs |
| **Power BI** | Graph Connector | Queries published Excel datasets |

### Authentication Flow

1. **OAuth 2.0 Client Credentials Grant**
   - FibreFlow service account authenticates via Azure AD
   - Token scoped to `Sites.ReadWrite.All` for SharePoint access
   - Token refresh handled by `@azure/identity` SDK

2. **SharePoint Site Scope**
   - Target Site: `https://fibreflow.sharepoint.com/sites/FibreFlow`
   - Root Drive: `/Shared Documents`
   - Report Subfolder: `/Shared Documents/Reports/`

### Configuration

#### Environment Variables

```bash
# Microsoft Graph API
GRAPH_CLIENT_ID="<Azure AD app client ID>"
GRAPH_CLIENT_SECRET="<Azure AD app client secret>"
GRAPH_TENANT_ID="<Azure AD tenant ID>"

# SharePoint Site Configuration
SHAREPOINT_SITE_ID="<SharePoint site ID>"
SHAREPOINT_ROOT_FOLDER_ID="<drive root item ID>"
SHAREPOINT_REPORTS_FOLDER_PATH="/Shared Documents/Reports"

# Sync Schedule
REPORT_EXPORT_SCHEDULE="0 20 * * *"  # 8 PM UTC daily
REPORT_RETENTION_DAYS=90  # Auto-delete files older than 90 days
```

#### Azure AD App Registration Requirements

**Permissions Required:**
- `Sites.ReadWrite.All` — Read/write access to all SharePoint sites
- `Files.ReadWrite.All` — Read/write access to all files and folders
- Optional: `User.ReadWrite.All` for user context in metadata

**Grant Type:** Client Credentials (for unattended service account)

## Setup & Configuration

### 1. Azure AD Application Setup

1. Navigate to [Azure Portal](https://portal.azure.com) → **Azure AD** → **App Registrations**
2. Create new app: "FibreFlow Reports Sync"
3. Add API Permissions:
   - Microsoft Graph → Application Permissions
   - Select: `Sites.ReadWrite.All`, `Files.ReadWrite.All`
4. Grant Admin Consent (required for Client Credentials flow)
5. Create Client Secret → copy to environment config

### 2. SharePoint Site Preparation

1. Create SharePoint site: `https://fibreflow.sharepoint.com/sites/FibreFlow`
2. In **Shared Documents** → create subfolder `Reports`
3. Set folder permissions:
   - **Owners**: FibreFlow service account (can edit)
   - **Members**: Finance, Manager, Admin roles (read-only)
   - **Visitors**: Restricted

### 3. FibreFlow Configuration

```bash
# Copy .env.example to .env
cp .env.example .env

# Update with Azure AD and SharePoint credentials
GRAPH_CLIENT_ID=<your_client_id>
GRAPH_CLIENT_SECRET=<your_client_secret>
GRAPH_TENANT_ID=<your_tenant_id>
SHAREPOINT_SITE_ID=<your_site_id>
```

### 4. Start Sync Service

```bash
# Install dependencies (if not already done)
npm install @azure/identity @microsoft/microsoft-graph-client

# Start scheduled export task
npm run sync:reports

# Or run manually once
npm run sync:reports:once
```

## Usage

### Exporting a Report to SharePoint

**Method 1: Automatic (Daily Cron)**
- All Reports Sandbox report types export automatically at 8 PM UTC
- Files saved with pattern: `REPORT-TYPE_YYYY-MM-DD_HHmm.xlsx`
- Metadata tab included with timestamp, applied filters, user who triggered

**Method 2: On-Demand API**

```bash
POST /api/analytics/reports/export

{
  "reportType": "cashflow",
  "filters": {
    "projectId": "uuid-123",
    "dateRange": "2026-03-01_2026-03-31"
  },
  "format": "xlsx",
  "sharepoint": {
    "enabled": true,
    "folder": "/Shared Documents/Reports/Cashflow"
  }
}
```

**Response:**
```json
{
  "success": true,
  "downloadUrl": "https://fibreflow.sharepoint.com/sites/FibreFlow/Shared%20Documents/Reports/Cashflow_2026_03_21_2020.xlsx",
  "sharepointUrl": "https://fibreflow.sharepoint.com/:x:/s/FibreFlow/EYx...",
  "expiresAt": "2026-05-20T20:00:00Z",
  "format": "xlsx"
}
```

**Method 3: React Component**

```tsx
import { useSharePointExport } from '@/hooks/analytics';

export function ExportButton({ reportType, filters }) {
  const { mutate: exportReport, isPending } = useSharePointExport();
  
  const handleExport = () => {
    exportReport({
      reportType,
      filters,
      sharepoint: { enabled: true }
    });
  };
  
  return (
    <button onClick={handleExport} disabled={isPending}>
      {isPending ? 'Exporting...' : 'Export to SharePoint'}
    </button>
  );
}
```

## Excel Workbook Format

All exported workbooks include:

### Sheet 1: Report Data
- Headers with bold formatting and background color
- Column widths auto-fitted to content
- Frozen header row for scrolling
- Number formatting (currency, percentage) applied automatically

### Sheet 2: Metadata (Hidden by Default)
```
Report Type:        Cashflow Overview
Generated At:       2026-03-21 20:00:00 UTC
Generated By:       Reports Sync Service
Filters Applied:    projectId=abc, dateRange=current-month
Data Version:       1.0
RBAC Scope:         Finance, Admin roles
```

### Sheet 3: Data Dictionary (Optional)
- Column descriptions
- Metric definitions
- Unit specifications (currency, %, days, etc.)

## Power BI Integration

### Connecting to SharePoint Excel Data

1. **In Power BI Desktop:**
   - File → Get Data → SharePoint Folder
   - Enter folder path: `https://fibreflow.sharepoint.com/sites/FibreFlow/Shared Documents/Reports/`
   - Provide credentials (OAuth for your account)

2. **Transform Query:**
   - Select report XLSX files
   - Transform → Edit Queries
   - Filter to desired sheets (ignore Metadata, Data Dictionary)

3. **Refresh Schedule:**
   - Publish to Power BI Service
   - Set refresh: Daily 8:30 PM (15 min after FibreFlow sync)
   - Incremental refresh recommended for large datasets

### Example Power Query M Code

```m
let
    SharePointFolder = SharePoint.Files("https://fibreflow.sharepoint.com/sites/FibreFlow/Shared Documents/Reports/"),
    FilteredReports = Table.SelectRows(SharePointFolder, each Text.EndsWith([Name], ".xlsx")),
    LatestCashflow = Table.SelectRows(FilteredReports, each Text.Contains([Name], "Cashflow")),
    ImportedExcel = Excel.Workbook(LatestCashflow{0}[Content]),
    Data = ImportedExcel{[Item="CashflowOverview",Kind="Sheet"]}[Data]
in
    Data
```

## Troubleshooting

### Common Issues

#### Issue 1: "403 Forbidden" on File Upload
**Cause:** Service account lacks write permissions on Reports folder  
**Solution:**
1. Check Azure AD app has `Sites.ReadWrite.All` permission (Admin Consent granted)
2. Verify SharePoint folder permissions include FibreFlow service account
3. Check token scope: `az ad app permission list --id <app-id>` should show approved permissions

#### Issue 2: "File Already Exists" Error on Retry
**Cause:** Sync ran twice, attempting to overwrite same file  
**Solution:**
1. Implement idempotency: check if file exists before upload
2. Use versioning: append millisecond timestamp to filename
3. Enable SharePoint versioning (default: keep 500 versions)

```javascript
async function uploadReportWithVersioning(filename, data) {
  const timestamp = Date.now();
  const versionedName = `${filename.replace('.xlsx', '')}_${timestamp}.xlsx`;
  return uploadToSharePoint(versionedName, data);
}
```

#### Issue 3: Slow API Response (>30s)
**Cause:** Large dataset (>100k rows), poor network latency  
**Solution:**
1. Paginate export: break large reports into monthly chunks
2. Use delta queries: only export changes since last run
3. Compress XLSX before upload: reduces size 60-80%
4. Schedule during off-peak hours (2 AM UTC instead of 8 PM)

#### Issue 4: Power BI "Slow Dataset Refresh"
**Cause:** Querying large Excel files from SharePoint (not optimized)  
**Solution:**
1. Migrate to Azure SQL Database for Power BI source (better performance)
2. Or: Archive old reports (>90 days) to reduce refresh scope
3. Use incremental refresh in Power BI (refresh only last 30 days)

### Diagnostics

**Check Sync Status:**
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/admin/sync/status"
```

**View Sync Logs:**
```bash
# Last 100 lines
tail -100 logs/reports-sync.log

# Errors only
grep ERROR logs/reports-sync.log
```

**Verify SharePoint Connectivity:**
```bash
curl -X GET \
  -H "Authorization: Bearer $GRAPH_TOKEN" \
  "https://graph.microsoft.com/v1.0/sites/fibreflow.sharepoint.com:/sites/FibreFlow:/"
```

## Best Practices

### Do's ✅
- ✅ Schedule exports during off-peak hours (2-4 AM UTC)
- ✅ Archive reports older than 90 days to reduce clutter
- ✅ Use role-based folder permissions for data governance
- ✅ Enable SharePoint versioning for audit trail
- ✅ Test Power BI refresh after each new report type
- ✅ Document filter parameters in Excel metadata sheet

### Don'ts ❌
- ❌ Don't manually edit exported files in SharePoint (changes lost on next sync)
- ❌ Don't use Client Credentials token for user context (audit trail loss)
- ❌ Don't store sensitive credentials in Excel metadata
- ❌ Don't schedule >1 export simultaneously (file lock conflicts)
- ❌ Don't export unfiltered dataset (>1M rows) — paginate instead

## Migration Notes (from Legacy Procurement)

If migrating from legacy PO/Invoice exports:

1. **Endpoint Change:**
   - Old: `POST /api/procurement/export-excel`
   - New: `POST /api/analytics/reports/export` (Expense Pivot for legacy use cases)

2. **File Location:**
   - Old: `/uploads/procurement/`
   - New: `SharePoint /Shared Documents/Reports/`

3. **Permission Mapping:**
   - Old: Direct database role checks
   - New: RBAC via SQL 248 migration (Admin, Manager, Finance, ProjectMgr roles)

4. **Schedule Change:**
   - Old: Manual trigger only
   - New: Automatic daily at 8 PM UTC (configurable)

## Support & References

- **Knowledge Base:** [Reports Sandbox Feature Docs](../features/05-analytics.md#reports-sandbox)
- **API Reference:** `docs/api/analytics-reports.md`
- **Microsoft Graph Docs:** https://docs.microsoft.com/graph/
- **SharePoint API Guide:** https://docs.microsoft.com/sharepoint/dev/
- **Power BI Refresh Limits:** https://learn.microsoft.com/power-bi/admin/service-premium-capacity-manage#capacity-management

## Changelog

| Date | Version | Change |
|---|---|---|
| 2026-03-21 | 1.0.0 | Initial release with Reports Sandbox |
| TBD | 1.1.0 | Planned: Power BI DirectQuery support |
| TBD | 1.2.0 | Planned: OneDrive personal sync option |
