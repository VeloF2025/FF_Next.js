# Civil QA → SharePoint Sync

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** Thembisa 1 first, then any project

---

## Overview

Sync approved civil QA review photos to a SharePoint folder with a nested Zone / PON / Pole folder structure. Three triggers: auto (on PASS decision), nightly cron, and manual admin button.

---

## Architecture

```
PASS decision written
        │
        ├─→ sp_sync_status = 'pending' (inline, fast)
        │
        └─→ background fetch → /api/construction-qa/sp-sync
                    │
                    ▼
            sharepointSyncService.ts
                    │
                    ├── resolve/create Zone {n} folder
                    ├── resolve/create PON {n} folder
                    ├── resolve/create P-{feature_id} folder
                    └── for each photo:
                          download from VF Storage (storage_url)
                          upload to SharePoint
                          name: P-{pole}_NN_{step_label}.jpg
                    │
                    └─→ sp_sync_status = 'synced' | 'failed'

Three triggers → same /api/construction-qa/sp-sync endpoint:
  1. Auto:   called in background after final-decision PASS
  2. Cron:   nightly 02:00 SAST, all pending reviews
  3. Manual: admin button in Civil QA UI (super_admin only)
```

---

## Database Changes

**Migration** — add 4 columns to `construction_qa_reviews`:

| Column | Type | Purpose |
|--------|------|---------|
| `sp_sync_status` | `text` nullable | `pending \| syncing \| synced \| failed` |
| `sp_synced_at` | `timestamptz` nullable | When last successful sync completed |
| `sp_sync_error` | `text` nullable | Last error message for failed syncs |
| `sp_folder_url` | `text` nullable | Direct SharePoint URL to the pole folder |

**Index:** `idx_cqa_sp_sync_status` on `(sp_sync_status)` — used by batch worker to find pending reviews efficiently.

---

## Environment Variables

Three new env vars (set once — resolve the SharePoint sharing link to stable Graph API identifiers):

```
SHAREPOINT_QA_SITE_ID=...
SHAREPOINT_QA_DRIVE_ID=...
SHAREPOINT_QA_FOLDER_ID=...   # item ID of the root QA folder
```

Uses existing `SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET` credentials and `getSharePointToken()` from `src/lib/graph/sharepoint-excel.ts`.

---

## Folder Structure

SharePoint path built dynamically from review fields:

```
{root QA folder}/
  Zone {zone_no}/
    PON {pon_no}/
      P-{feature_id}/
        P-0042_01_before_photo.jpg
        P-0042_02_during_install.jpg
        ...
```

Folder creation is **idempotent** — check if folder exists before creating.

---

## Sync Service

**`src/modules/construction-qa/services/sharepointSyncService.ts`**

Exported: `syncReview(reviewId: string): Promise<void>`

Steps:
1. Fetch review + photos from DB
2. Set `sp_sync_status = 'syncing'`
3. Get SharePoint token via `getSharePointToken()`
4. Resolve/create `Zone {zone_no}` folder under root
5. Resolve/create `PON {pon_no}` folder under zone
6. Resolve/create `P-{feature_id}` folder under PON
7. For each photo in `construction_qa_photos`:
   - Fetch binary from `storage_url`
   - Upload via Graph API `PUT /drives/{driveId}/items/{folderId}:/{filename}:/content`
   - Filename format: `P-{feature_id}_{step_index:02d}_{step_label}.{ext}`
8. On success: update `sp_sync_status = 'synced'`, `sp_synced_at = now()`, `sp_folder_url`
9. On error: update `sp_sync_status = 'failed'`, `sp_sync_error = message`

---

## API Endpoint

**`/api/construction-qa/sp-sync.ts`** — POST, super_admin only

```typescript
// Request body (all optional)
{ projectId?: string, reviewId?: string }
// no body = process ALL pending reviews across all projects

// Response
{ queued: number, synced: number, failed: number }
```

- Processes up to **20 reviews per call** (batch cap — prevents timeout)
- Cron calls repeatedly until response `queued === 0`

**`/api/construction-qa/final-decision.ts`** — existing file

After writing `qa_decision = 'PASS'`, fire-and-forget:
```typescript
void fetch('/api/construction-qa/sp-sync', {
  method: 'POST',
  body: JSON.stringify({ reviewId }),
  headers: { 'Content-Type': 'application/json', cookie: req.headers.cookie ?? '' },
});
```

---

## UI

**Project-level sync button** (super_admin only, in Civil QA project toolbar):
- Label: "Sync to SharePoint"
- On click: `POST /api/construction-qa/sp-sync` with `{ projectId }`
- Result toast: "Synced 14 / 14 reviews" or "14 synced, 2 failed"
- Disabled if no approved reviews exist for the project

**Per-review sync status badge** (in review list):

| Status | Display |
|--------|---------|
| `synced` | Green checkmark + SharePoint icon — links to `sp_folder_url` |
| `pending` | Grey clock icon |
| `syncing` | Spinner |
| `failed` | Red dot — hover/click shows `sp_sync_error` |
| `null` | Nothing (review not yet approved) |

---

## Cron

Add to existing scheduler:
- **Schedule:** nightly, 02:00 SAST
- **Call:** `POST /api/construction-qa/sp-sync` (no body)
- **Repeat:** until `queued === 0` (loop with short delay between calls)

---

## Scope / Phasing

- **Phase 1 (this PR):** Thembisa 1 — validate folder structure + naming with real data
- **Phase 2:** Roll out to all projects (same code, no changes needed — projectId scoping already built in)

---

## What's Explicitly Out of Scope

- Syncing rejected / rework-needed reviews
- Bi-directional sync (SharePoint → FibreFlow)
- Photo deletion from SharePoint if a decision is reversed
- Non-civil disciplines (optical, splicing) — same service can handle them later
