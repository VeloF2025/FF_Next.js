# SharePoint DR Photo Sync - Setup Guide

## Overview

This document describes how to configure the SharePoint DR Photo Sync system that automatically creates folders and syncs photos from OneMap to SharePoint.

**Target SharePoint Path:**
```
\blitzfibre.com\Velocity_Manco - Documents\Velocity_Quality_Assurance\Regional Home Drops\Projects
```

**Folder Structure:**
```
/Projects/                     (ROOT - needs folder ID)
├── Lawley/                    (Project)
│   ├── Zone_01/               (Zone)
│   │   ├── PON_101/           (PON)
│   │   │   ├── LAW.P.A001/    (Pole)
│   │   │   │   └── DR1234567/ (DR folder with photos)
```

---

## Required Environment Variables

Add these to `.env.production` on the server:

```bash
# SharePoint OAuth (Azure AD App Registration)
SHAREPOINT_TENANT_ID=<azure-ad-tenant-id>
SHAREPOINT_CLIENT_ID=<app-client-id>
SHAREPOINT_CLIENT_SECRET=<app-client-secret>

# SharePoint Site/Drive IDs
SHAREPOINT_SITE_ID=<velocity-manco-site-id>
SHAREPOINT_DRIVE_ID=<documents-drive-id>

# DR Sync Specific
SHAREPOINT_DR_ROOT_FOLDER_ID=<projects-folder-id>
SHAREPOINT_DR_SYNC_ENABLED=true
```

---

## Step 1: Get Azure AD Credentials

If you already have SharePoint credentials for the WA Monitor sync, use the same:
- `SHAREPOINT_TENANT_ID`
- `SHAREPOINT_CLIENT_ID`
- `SHAREPOINT_CLIENT_SECRET`
- `SHAREPOINT_SITE_ID`
- `SHAREPOINT_DRIVE_ID`

If not, create an Azure AD App Registration:

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to: **Azure Active Directory → App registrations → New registration**
3. Name: `FibreFlow SharePoint Sync`
4. Supported account types: Single tenant
5. After creation, note the:
   - **Application (client) ID** → `SHAREPOINT_CLIENT_ID`
   - **Directory (tenant) ID** → `SHAREPOINT_TENANT_ID`
6. Go to **Certificates & secrets → New client secret**
   - Note the secret value → `SHAREPOINT_CLIENT_SECRET`
7. Go to **API permissions → Add permission → Microsoft Graph**
   - Add: `Sites.ReadWrite.All` (Application permission)
   - Add: `Files.ReadWrite.All` (Application permission)
8. Click **Grant admin consent**

---

## Step 2: Get SharePoint Site ID

Run this PowerShell or use Graph Explorer:

```powershell
# Get site ID for Velocity_Manco
GET https://graph.microsoft.com/v1.0/sites/blitzfibre.sharepoint.com:/sites/Velocity_Manco
```

The response includes:
```json
{
  "id": "blitzfibre.sharepoint.com,<site-guid>,<web-guid>"
}
```

Use the full `id` value as `SHAREPOINT_SITE_ID`.

---

## Step 3: Get Drive ID

```
GET https://graph.microsoft.com/v1.0/sites/{site-id}/drives
```

Look for the "Documents" drive and note its `id` → `SHAREPOINT_DRIVE_ID`

---

## Step 4: Get Projects Folder ID

**Option A: From SharePoint UI (Easiest)**

1. Navigate to SharePoint: https://blitzfibre.sharepoint.com/sites/Velocity_Manco
2. Go to: Documents → Velocity_Quality_Assurance → Regional Home Drops → Projects
3. Click on the **Projects** folder (don't open it)
4. Click the **ⓘ** (info/details) button in the toolbar
5. Scroll down in the details panel
6. Look for **Path** or copy the URL
7. The folder ID is in the URL or can be found via "Copy link"

**Option B: From Graph API**

```
GET https://graph.microsoft.com/v1.0/sites/{site-id}/drives/{drive-id}/root:/Velocity_Quality_Assurance/Regional Home Drops/Projects
```

Response:
```json
{
  "id": "<this-is-the-folder-id>",
  "name": "Projects",
  ...
}
```

Use the `id` value as `SHAREPOINT_DR_ROOT_FOLDER_ID`.

---

## Step 5: Configure Server

SSH to the server and add the variables:

```bash
ssh velo@100.96.203.105

# Edit production environment
nano /home/velo/fibreflow/.env.production

# Add these lines:
SHAREPOINT_TENANT_ID=your-tenant-id
SHAREPOINT_CLIENT_ID=your-client-id
SHAREPOINT_CLIENT_SECRET=your-client-secret
SHAREPOINT_SITE_ID=your-site-id
SHAREPOINT_DRIVE_ID=your-drive-id
SHAREPOINT_DR_ROOT_FOLDER_ID=your-projects-folder-id
SHAREPOINT_DR_SYNC_ENABLED=true

# Restart the service
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service
```

---

## Step 6: Verify Setup

Test the sync status endpoint:

```bash
curl -s "https://app.fibreflow.app/api/activate/sharepoint-sync?dropNumber=DR1730560"
```

Expected response (before any sync):
```json
{
  "success": true,
  "data": {
    "dropNumber": "DR1730560",
    "status": "pending_folder",
    "folderCreated": false
  }
}
```

---

## Step 7: Set Up Daily Cron

Add to crontab on the server:

```bash
# Edit crontab
crontab -e

# Add this line (runs at 10 PM daily)
0 22 * * * cd /home/velo/fibreflow && /usr/bin/npx tsx scripts/cron/sharepoint-dr-sync.ts >> /var/log/sharepoint-sync.log 2>&1
```

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/activate/sharepoint-sync?dropNumber=X` | GET | Check sync status |
| `/api/activate/sharepoint-sync` | POST | Sync single DR |
| `/api/activate/sharepoint-sync-batch` | POST | Batch sync |

### Single DR Sync

```bash
curl -X POST https://app.fibreflow.app/api/activate/sharepoint-sync \
  -H "Content-Type: application/json" \
  -d '{"dropNumber": "DR1730560", "action": "full"}'
```

Actions:
- `create_folder` - Create folder hierarchy only
- `sync_photos` - Sync photos (folder must exist)
- `full` - Create folder + sync photos

### Batch Sync

```bash
curl -X POST https://app.fibreflow.app/api/activate/sharepoint-sync-batch \
  -H "Content-Type: application/json" \
  -d '{"action": "verify_folders", "project": "Lawley"}'
```

---

## Trigger Points

| Trigger | What Happens |
|---------|--------------|
| WhatsApp DR submission | Folder created automatically (fire-and-forget) |
| OES Import | Folders verified for imported DRs |
| Daily cron (10 PM) | Photos synced for all DRs with folders |
| Manual API call | On-demand sync |

---

## Troubleshooting

### "SharePoint DR sync is not enabled"
- Ensure `SHAREPOINT_DR_SYNC_ENABLED=true` in .env.production
- Restart the service

### "SharePoint is not configured"
- Check all required env variables are set
- Verify credentials are correct

### Folder creation fails
- Check Azure AD app has `Sites.ReadWrite.All` permission
- Verify the root folder ID is correct
- Check Graph API rate limits (avoid >100 requests/minute)

### Photo sync fails
- Ensure folder was created first
- Check photo URLs are accessible
- Verify file upload permissions

---

## Database Table

The `sharepoint_dr_sync` table tracks sync status:

```sql
SELECT drop_number, folder_created, photos_synced, folder_path
FROM sharepoint_dr_sync
WHERE project = 'Lawley'
LIMIT 10;
```

---

## Files

| File | Purpose |
|------|---------|
| `src/lib/sharepointDrSyncService.ts` | Core service |
| `pages/api/activate/sharepoint-sync.ts` | Single DR API |
| `pages/api/activate/sharepoint-sync-batch.ts` | Batch API |
| `scripts/cron/sharepoint-dr-sync.ts` | Daily cron |
| `scripts/migrations/099_sharepoint_dr_sync.sql` | Database table |
