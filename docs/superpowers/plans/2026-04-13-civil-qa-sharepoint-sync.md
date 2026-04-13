# Civil QA → SharePoint Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync approved civil QA review photos to SharePoint with Zone/PON/Pole folder structure, triggered automatically on PASS decision, nightly cron, and manual admin button.

**Architecture:** A `sharepointSyncService` downloads photos from VF Storage and uploads them to SharePoint via Microsoft Graph API. A `/api/construction-qa/sp-sync` endpoint processes up to 20 pending reviews per call. Three triggers share the same endpoint: fire-and-forget after PASS decision, nightly cron, and manual admin button in the Civil QA project view.

**Tech Stack:** Microsoft Graph API (client credentials, reuses existing `SHAREPOINT_*` env vars), Next.js API routes, Neon PostgreSQL, existing `getSharePointToken()` from `src/lib/graph/sharepoint-excel.ts`.

**Worktree:** `/home/hein/Workspace/FF_Next.js-civil-qa-sp-sync` — branch `feature/civil-qa-sharepoint-sync`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `migrations/2026-04-13-civil-qa-sharepoint-sync.sql` | 4 new columns + index on `construction_qa_reviews` |
| Modify | `src/modules/construction-qa/types/construction.types.ts` | Add `SpSyncStatus` type |
| Modify | `src/modules/construction-qa/types/dashboard.types.ts` | Add sp_sync fields to `PonFeatureRow` |
| Create | `src/modules/construction-qa/services/sharepointSyncService.ts` | Core Graph API logic: folder creation + file upload |
| Create | `pages/api/construction-qa/sp-sync.ts` | Batch worker endpoint (super_admin, max 20/call) |
| Create | `pages/api/cron/construction-qa-sp-sync.ts` | Nightly cron endpoint (CRON_SECRET auth) |
| Modify | `pages/api/construction-qa/final-decision.ts` | Fire-and-forget sp-sync after PASS |
| Modify | `pages/api/construction-qa/pon-features.ts` | Return sp_sync_status/sp_synced_at/sp_folder_url |
| Modify | `src/modules/construction-qa/components/project/ProjectDetailPage.tsx` | "Sync to SharePoint" button in toolbar |
| Modify | `src/modules/construction-qa/components/project/PonFeaturesPanel.tsx` | sp_sync status badge column |

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/2026-04-13-civil-qa-sharepoint-sync.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/2026-04-13-civil-qa-sharepoint-sync.sql
-- Civil QA SharePoint sync tracking columns

ALTER TABLE construction_qa_reviews
  ADD COLUMN IF NOT EXISTS sp_sync_status  TEXT       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sp_synced_at    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sp_sync_error   TEXT       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sp_folder_url   TEXT       DEFAULT NULL;

-- Fast lookup for the batch worker: find all pending syncs
CREATE INDEX IF NOT EXISTS idx_cqa_sp_sync_status
  ON construction_qa_reviews (sp_sync_status)
  WHERE sp_sync_status IS NOT NULL;

COMMENT ON COLUMN construction_qa_reviews.sp_sync_status IS 'pending | syncing | synced | failed — null means not yet approved';
COMMENT ON COLUMN construction_qa_reviews.sp_synced_at   IS 'Timestamp of last successful SharePoint sync';
COMMENT ON COLUMN construction_qa_reviews.sp_sync_error  IS 'Last error message for failed syncs';
COMMENT ON COLUMN construction_qa_reviews.sp_folder_url  IS 'Direct SharePoint URL to the pole folder after sync';
```

- [ ] **Step 2: Run the migration**

```bash
cd /home/hein/Workspace/FF_Next.js-civil-qa-sp-sync
psql "$DATABASE_URL" -f migrations/2026-04-13-civil-qa-sharepoint-sync.sql
```

Expected output:
```
ALTER TABLE
CREATE INDEX
COMMENT
COMMENT
COMMENT
COMMENT
```

- [ ] **Step 3: Verify columns exist**

```bash
psql "$DATABASE_URL" -c "\d construction_qa_reviews" | grep sp_
```

Expected: 4 rows containing `sp_sync_status`, `sp_synced_at`, `sp_sync_error`, `sp_folder_url`.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-civil-qa-sp-sync
git add migrations/2026-04-13-civil-qa-sharepoint-sync.sql
git commit -m "feat(civil-qa): add SharePoint sync columns to construction_qa_reviews"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/modules/construction-qa/types/construction.types.ts`
- Modify: `src/modules/construction-qa/types/dashboard.types.ts`

- [ ] **Step 1: Add `SpSyncStatus` to construction.types.ts**

Open `src/modules/construction-qa/types/construction.types.ts`. Find the block where `WorkflowStatus` and `QaDecision` are defined and add directly after:

```typescript
export type SpSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';
```

- [ ] **Step 2: Add sp_sync fields to `PonFeatureRow` in dashboard.types.ts**

Open `src/modules/construction-qa/types/dashboard.types.ts`. Find the `PonFeatureRow` interface (line ~105) and add three fields before the closing brace:

```typescript
  sp_sync_status: SpSyncStatus | null;
  sp_synced_at: string | null;
  sp_folder_url: string | null;
```

Also add the import at the top of `dashboard.types.ts` if `SpSyncStatus` isn't already imported:

```typescript
import type { SpSyncStatus } from './construction.types';
```

- [ ] **Step 3: Type-check**

```bash
cd /home/hein/Workspace/FF_Next.js-civil-qa-sp-sync
npm run type-check 2>&1 | head -30
```

Expected: no new errors related to `SpSyncStatus` or `PonFeatureRow`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/construction-qa/types/construction.types.ts \
        src/modules/construction-qa/types/dashboard.types.ts
git commit -m "feat(civil-qa): add SpSyncStatus type and sp_sync fields to PonFeatureRow"
```

---

## Task 3: SharePoint Sync Service

**Files:**
- Create: `src/modules/construction-qa/services/sharepointSyncService.ts`

This service has one exported function: `syncReview(reviewId)`. It handles all Graph API interaction.

Three env vars must be set (contact Hein for values — derived from the SharePoint sharing link):
- `SHAREPOINT_QA_SITE_ID` — Graph site ID
- `SHAREPOINT_QA_DRIVE_ID` — Document library drive ID  
- `SHAREPOINT_QA_FOLDER_ID` — Item ID of the root "Quality Assurance" folder

- [ ] **Step 1: Create the service**

```typescript
// src/modules/construction-qa/services/sharepointSyncService.ts
/**
 * Civil QA → SharePoint Sync Service
 *
 * Uploads approved review photos to SharePoint under:
 *   {QA root}/Zone {zone_no}/PON {pon_no}/P-{feature_id}/
 *
 * File naming: P-{feature_id}_{step:02d}_{step_label}.{ext}
 * Uses SHAREPOINT_* credentials (same as sharepoint-excel.ts).
 */

import { neon } from '@neondatabase/serverless';
import { getSharePointToken } from '@/lib/graph/sharepoint-excel';
import { createLogger } from '@/lib/logger';

const log = createLogger('civil-qa:sp-sync');
const sql = neon(process.env.DATABASE_URL!);

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ─── Graph API helpers ────────────────────────────────────────────────────────

/** Return the drive item ID for a child folder, creating it if it doesn't exist. */
async function resolveOrCreateFolder(
  token: string,
  driveId: string,
  parentId: string,
  folderName: string,
): Promise<string> {
  // Try to GET the folder by path first (idempotent)
  const encodedName = encodeURIComponent(folderName);
  const getUrl = `${GRAPH_BASE}/drives/${driveId}/items/${parentId}:/${encodedName}`;

  const getRes = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (getRes.ok) {
    const data = await getRes.json() as { id: string };
    return data.id;
  }

  if (getRes.status !== 404) {
    const body = await getRes.text();
    throw new Error(`Graph GET folder failed ${getRes.status}: ${body}`);
  }

  // Folder doesn't exist — create it
  const createUrl = `${GRAPH_BASE}/drives/${driveId}/items/${parentId}/children`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });

  if (!createRes.ok) {
    // Another process may have created it concurrently — retry GET
    if (createRes.status === 409) {
      const retryRes = await fetch(getUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (retryRes.ok) {
        const data = await retryRes.json() as { id: string };
        return data.id;
      }
    }
    const body = await createRes.text();
    throw new Error(`Graph create folder failed ${createRes.status}: ${body}`);
  }

  const created = await createRes.json() as { id: string };
  log.info('Created SharePoint folder', { folderName });
  return created.id;
}

/** Upload a file to a SharePoint folder. Overwrites if exists. */
async function uploadFile(
  token: string,
  driveId: string,
  folderId: string,
  filename: string,
  contentType: string,
  data: ArrayBuffer,
): Promise<void> {
  const encodedName = encodeURIComponent(filename);
  const url = `${GRAPH_BASE}/drives/${driveId}/items/${folderId}:/${encodedName}:/content`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: data,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph upload failed ${res.status}: ${body}`);
  }
}

/** Download a photo from VF Storage (storage_url). Returns ArrayBuffer + content-type. */
async function downloadPhoto(storageUrl: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await fetch(storageUrl);
  if (!res.ok) {
    throw new Error(`Photo download failed ${res.status}: ${storageUrl}`);
  }
  const data = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { data, contentType };
}

// ─── Filename builder ─────────────────────────────────────────────────────────

function buildFilename(
  featureId: string,
  checklistStep: number | null,
  stepLabel: string | null,
  originalFilename: string,
): string {
  const ext = originalFilename.includes('.')
    ? originalFilename.split('.').pop()!.toLowerCase()
    : 'jpg';

  if (checklistStep !== null && stepLabel) {
    const step = String(checklistStep).padStart(2, '0');
    const label = stepLabel.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `P-${featureId}_${step}_${label}.${ext}`;
  }

  // Fallback: use original filename prefixed with pole number
  return `P-${featureId}_${originalFilename}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Sync a single approved review's photos to SharePoint. Updates sp_sync_status on the review. */
export async function syncReview(reviewId: string): Promise<void> {
  const driveId = process.env.SHAREPOINT_QA_DRIVE_ID;
  const rootFolderId = process.env.SHAREPOINT_QA_FOLDER_ID;

  if (!driveId || !rootFolderId) {
    throw new Error('SHAREPOINT_QA_DRIVE_ID and SHAREPOINT_QA_FOLDER_ID must be set');
  }

  // Mark as syncing
  await sql`
    UPDATE construction_qa_reviews
    SET sp_sync_status = 'syncing', updated_at = NOW()
    WHERE id = ${reviewId}::uuid
  `;

  try {
    // Fetch review metadata
    const reviews = await sql`
      SELECT feature_id, zone_no, pon_no
      FROM construction_qa_reviews
      WHERE id = ${reviewId}::uuid
    `;

    if (reviews.length === 0) {
      throw new Error(`Review ${reviewId} not found`);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const review = reviews[0]!;
    const featureId = String(review.feature_id);
    const zoneNo = review.zone_no != null ? Number(review.zone_no) : null;
    const ponNo = review.pon_no != null ? Number(review.pon_no) : null;

    if (zoneNo === null || ponNo === null) {
      throw new Error(`Review ${reviewId} is missing zone_no or pon_no — cannot build folder path`);
    }

    // Fetch photos
    const photos = await sql`
      SELECT id, storage_url, filename, mime_type, checklist_step, step_label
      FROM construction_qa_photos
      WHERE review_id = ${reviewId}::uuid
      ORDER BY checklist_step ASC NULLS LAST, created_at ASC
    `;

    if (photos.length === 0) {
      log.warn('No photos found for review', { module: 'civil-qa:sp-sync', reviewId });
    }

    // Acquire token
    const token = await getSharePointToken();

    // Resolve folder structure: Zone → PON → Pole
    const zoneFolderId = await resolveOrCreateFolder(token, driveId, rootFolderId, `Zone ${zoneNo}`);
    const ponFolderId = await resolveOrCreateFolder(token, driveId, zoneFolderId, `PON ${ponNo}`);
    const poleFolderId = await resolveOrCreateFolder(token, driveId, ponFolderId, `P-${featureId}`);

    // Upload each photo
    for (const photo of photos) {
      const storageUrl = String(photo.storage_url);
      if (!storageUrl) {
        log.warn('Photo has no storage_url, skipping', { module: 'civil-qa:sp-sync', photoId: photo.id });
        continue;
      }

      const filename = buildFilename(
        featureId,
        photo.checklist_step != null ? Number(photo.checklist_step) : null,
        photo.step_label ? String(photo.step_label) : null,
        photo.filename ? String(photo.filename) : `photo_${photo.id}.jpg`,
      );

      const { data, contentType } = await downloadPhoto(storageUrl);
      await uploadFile(token, driveId, poleFolderId, filename, contentType, data);

      log.info('Uploaded photo to SharePoint', {
        module: 'civil-qa:sp-sync',
        reviewId,
        filename,
      });
    }

    // Build the SharePoint web URL for the pole folder
    // Graph returns a webUrl on the folder item — fetch it
    const folderInfoUrl = `${GRAPH_BASE}/drives/${driveId}/items/${poleFolderId}?$select=webUrl`;
    const folderInfoRes = await fetch(folderInfoUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const folderInfo = folderInfoRes.ok
      ? (await folderInfoRes.json() as { webUrl?: string })
      : {};

    await sql`
      UPDATE construction_qa_reviews
      SET sp_sync_status = 'synced',
          sp_synced_at   = NOW(),
          sp_sync_error  = NULL,
          sp_folder_url  = ${folderInfo.webUrl ?? null},
          updated_at     = NOW()
      WHERE id = ${reviewId}::uuid
    `;

    log.info('Review synced to SharePoint', {
      module: 'civil-qa:sp-sync',
      reviewId,
      featureId,
      photos: photos.length,
    });
  } catch (error) {
    const message = (error as Error).message;
    log.error('SharePoint sync failed', { module: 'civil-qa:sp-sync', reviewId, error: message });

    await sql`
      UPDATE construction_qa_reviews
      SET sp_sync_status = 'failed',
          sp_sync_error  = ${message},
          updated_at     = NOW()
      WHERE id = ${reviewId}::uuid
    `;

    throw error;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/hein/Workspace/FF_Next.js-civil-qa-sp-sync
npm run type-check 2>&1 | grep -i "sharepoint\|sp-sync\|error" | head -20
```

Expected: no errors in `sharepointSyncService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/construction-qa/services/sharepointSyncService.ts
git commit -m "feat(civil-qa): add sharepointSyncService — Graph API folder creation + photo upload"
```

---

## Task 4: Batch Worker API Endpoint

**Files:**
- Create: `pages/api/construction-qa/sp-sync.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
// pages/api/construction-qa/sp-sync.ts
/**
 * POST /api/construction-qa/sp-sync
 *
 * Batch worker — syncs approved civil QA reviews to SharePoint.
 * Processes up to 20 pending reviews per call (prevents timeout).
 *
 * Body (all optional):
 *   { projectId?: string, reviewId?: string }
 *   No body → process ALL pending reviews
 *
 * Auth: super_admin only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { syncReview } from '@/modules/construction-qa/services/sharepointSyncService';

const sql = neon(process.env.DATABASE_URL!);
const BATCH_SIZE = 20;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  const { projectId, reviewId } = (req.body ?? {}) as {
    projectId?: string;
    reviewId?: string;
  };

  try {
    // Find pending reviews
    let pending: { id: string }[];

    if (reviewId) {
      // Single review (fire-and-forget from final-decision)
      pending = await sql`
        SELECT id FROM construction_qa_reviews
        WHERE id = ${reviewId}::uuid
          AND sp_sync_status = 'pending'
        LIMIT 1
      `;
    } else if (projectId) {
      // All pending for a specific project (manual admin button)
      pending = await sql`
        SELECT id FROM construction_qa_reviews
        WHERE project_id = ${projectId}::uuid
          AND sp_sync_status = 'pending'
        ORDER BY updated_at ASC
        LIMIT ${BATCH_SIZE}
      `;
    } else {
      // All pending across all projects (cron)
      pending = await sql`
        SELECT id FROM construction_qa_reviews
        WHERE sp_sync_status = 'pending'
        ORDER BY updated_at ASC
        LIMIT ${BATCH_SIZE}
      `;
    }

    const queued = pending.length;
    let synced = 0;
    let failed = 0;

    for (const row of pending) {
      try {
        await syncReview(row.id);
        synced++;
      } catch {
        failed++;
      }
    }

    log.info('sp-sync batch complete', {
      module: 'construction-qa',
      projectId: projectId ?? 'all',
      queued,
      synced,
      failed,
    });

    return apiResponse.success(res, { queued, synced, failed });
  } catch (error) {
    log.error('sp-sync fatal', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('super_admin')(handler));
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check 2>&1 | grep "sp-sync\|error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/api/construction-qa/sp-sync.ts
git commit -m "feat(civil-qa): add /api/construction-qa/sp-sync batch worker endpoint"
```

---

## Task 5: Cron Endpoint

**Files:**
- Create: `pages/api/cron/construction-qa-sp-sync.ts`

- [ ] **Step 1: Create the cron endpoint**

```typescript
// pages/api/cron/construction-qa-sp-sync.ts
/**
 * Cron: Civil QA SharePoint Sync
 *
 * POST /api/cron/construction-qa-sp-sync
 *
 * Nightly 02:00 SAST — loops until all pending reviews are synced.
 * Auth: CRON_SECRET Bearer token.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }

  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided =
      req.headers.authorization?.replace('Bearer ', '') ||
      (req.query.secret as string | undefined);
    if (provided !== cronSecret) {
      return apiResponse.unauthorized(res);
    }
  }

  log.info('CronSpSync', { action: 'start' });

  let totalSynced = 0;
  let totalFailed = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 20; // Safety cap: 20 × 20 = up to 400 reviews per cron run

  try {
    // Forward the cron secret so sp-sync endpoint authenticates as super_admin
    // The sp-sync endpoint uses withPermission('super_admin') but the cron runs
    // without a user session — so we call it with the internal cookie workaround.
    // Instead, we call the service directly via the internal URL with cron auth header.
    //
    // NOTE: sp-sync requires super_admin session. For the cron, we bypass auth by
    // calling syncReview directly from the service to avoid session complexity.
    const { syncReview } = await import(
      '@/modules/construction-qa/services/sharepointSyncService'
    );
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL!);

    while (iterations < MAX_ITERATIONS) {
      const pending = await sql`
        SELECT id FROM construction_qa_reviews
        WHERE sp_sync_status = 'pending'
        ORDER BY updated_at ASC
        LIMIT 20
      `;

      if (pending.length === 0) break;

      for (const row of pending) {
        try {
          await syncReview(row.id);
          totalSynced++;
        } catch {
          totalFailed++;
        }
      }

      iterations++;
    }

    log.info('CronSpSync', { action: 'complete', totalSynced, totalFailed, iterations });

    return res.status(200).json({
      success: true,
      totalSynced,
      totalFailed,
      iterations,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = (error as Error).message;
    log.error('CronSpSync', { action: 'fatal', error: message });
    return res.status(500).json({ error: message });
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check 2>&1 | grep "construction-qa-sp-sync\|error" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/api/cron/construction-qa-sp-sync.ts
git commit -m "feat(civil-qa): add nightly SharePoint sync cron endpoint"
```

---

## Task 6: Wire Final-Decision (Fire-and-Forget on PASS)

**Files:**
- Modify: `pages/api/construction-qa/final-decision.ts`

- [ ] **Step 1: Add sp_sync_status = 'pending' to the UPDATE and fire-and-forget call**

In `final-decision.ts`, find the UPDATE block (lines 79–91). Replace it with:

```typescript
    // Update the review — mark sp_sync_status pending for PASS decisions
    await sql`
      UPDATE construction_qa_reviews
      SET workflow_status = ${newStatus},
          qa_decision = ${decision},
          qa_decision_at = NOW(),
          qa_decision_by = ${decidedBy},
          qa_reason_code = ${reasonCodes.length > 0 ? reasonCodes[0] : null},
          qa_notes = ${notes || null},
          rework_count = CASE WHEN ${decision} = 'REWORK_NEEDED' THEN rework_count + 1 ELSE rework_count END,
          resubmission_snapshots = COALESCE(resubmission_snapshots, '[]'::jsonb) || ${JSON.stringify(snapshot)}::jsonb,
          sp_sync_status = CASE WHEN ${decision} = 'PASS' THEN 'pending' ELSE sp_sync_status END,
          updated_at = NOW()
      WHERE id = ${reviewId}::uuid
    `;
```

Then, after the activity log insert (after line 102), add the fire-and-forget call:

```typescript
    // Trigger SharePoint sync in the background for PASS decisions
    if (decision === 'PASS') {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';
      void fetch(`${baseUrl}/api/construction-qa/sp-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Forward session cookie so withAuth passes
          cookie: req.headers.cookie ?? '',
        },
        body: JSON.stringify({ reviewId }),
      }).catch((err: Error) => {
        log.warn('sp-sync fire-and-forget failed', { module: 'construction-qa', error: err.message });
      });
    }
```

- [ ] **Step 2: Lint check**

```bash
npm run lint -- --max-warnings=0 pages/api/construction-qa/final-decision.ts 2>&1 | tail -10
```

Expected: no new lint errors.

- [ ] **Step 3: Type-check**

```bash
npm run type-check 2>&1 | grep "final-decision\|error" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add pages/api/construction-qa/final-decision.ts
git commit -m "feat(civil-qa): set sp_sync_status=pending on PASS, fire-and-forget sp-sync"
```

---

## Task 7: Return sp_sync Fields from pon-features API

**Files:**
- Modify: `pages/api/construction-qa/pon-features.ts`

- [ ] **Step 1: Add three columns to the SELECT**

Find the SELECT block (lines ~94–113). Add three columns after `r.updated_at`:

```sql
        r.sp_sync_status,
        r.sp_synced_at,
        r.sp_folder_url
```

The full SELECT becomes:
```sql
      SELECT
        r.id,
        r.feature_id,
        r.feature_type,
        r.discipline,
        r.zone_no,
        r.pon_no,
        r.photo_count,
        r.vlm_confidence,
        r.vlm_status,
        r.workflow_status,
        r.qa_decision,
        r.qa_decision_by,
        r.priority,
        r.assigned_to,
        r.updated_at,
        r.sp_sync_status,
        r.sp_synced_at,
        r.sp_folder_url
      FROM construction_qa_reviews r
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check 2>&1 | grep "pon-features\|error" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/api/construction-qa/pon-features.ts
git commit -m "feat(civil-qa): return sp_sync_status/sp_synced_at/sp_folder_url from pon-features"
```

---

## Task 8: UI — Sync Button in ProjectDetailPage

**Files:**
- Modify: `src/modules/construction-qa/components/project/ProjectDetailPage.tsx`

- [ ] **Step 1: Add state and handler**

At the top of `ProjectDetailPage.tsx`, add the `Cloud` icon import to the existing lucide import line:

```typescript
import { ArrowLeft, RefreshCw, Download, CheckCircle, XCircle, Cloud } from 'lucide-react';
```

Inside the `ProjectDetailPage` component, after the existing state declarations, add:

```typescript
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
```

Add the sync handler function inside the component (after `fetchZones` or wherever the other handlers are):

```typescript
  const handleSpSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/construction-qa/sp-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json() as { data?: { queued: number; synced: number; failed: number } };
      const r = data.data;
      if (r) {
        setSyncResult(
          r.failed > 0
            ? `${r.synced} synced, ${r.failed} failed`
            : `Synced ${r.synced} / ${r.synced + r.failed} reviews`,
        );
      }
    } catch (err) {
      setSyncResult('Sync failed — see logs');
      log.error('sp-sync UI error', { error: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  }, [projectId]);
```

- [ ] **Step 2: Add the button to the toolbar**

Find the toolbar/header area where the `Download` button and `RefreshCw` button already exist. Add the sync button alongside them (after the export button):

```tsx
        <button
          onClick={() => void handleSpSync()}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          title="Sync approved reviews to SharePoint"
        >
          <Cloud className="h-3.5 w-3.5" />
          {syncing ? 'Syncing…' : 'Sync to SharePoint'}
        </button>
        {syncResult && (
          <span className="text-xs text-gray-400">{syncResult}</span>
        )}
```

- [ ] **Step 3: Type-check**

```bash
npm run type-check 2>&1 | grep "ProjectDetailPage\|error" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/construction-qa/components/project/ProjectDetailPage.tsx
git commit -m "feat(civil-qa): add 'Sync to SharePoint' button to project toolbar"
```

---

## Task 9: UI — sp_sync Badge in PonFeaturesPanel

**Files:**
- Modify: `src/modules/construction-qa/components/project/PonFeaturesPanel.tsx`

- [ ] **Step 1: Add the Cloud icon import**

Find the existing lucide import in `PonFeaturesPanel.tsx`:

```typescript
import { ChevronLeft, ChevronRight, Bot, User } from 'lucide-react';
```

Replace with:

```typescript
import { ChevronLeft, ChevronRight, Bot, User, Cloud, CloudOff, Loader2, CheckCircle2 } from 'lucide-react';
```

- [ ] **Step 2: Add the SpSyncBadge helper component**

Add this small helper above the `PonFeaturesPanel` component definition:

```tsx
function SpSyncBadge({
  status,
  folderUrl,
  error,
}: {
  status: string | null;
  folderUrl: string | null;
  error?: string | null;
}) {
  if (!status) return null;

  if (status === 'synced' && folderUrl) {
    return (
      <a
        href={folderUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-green-400 hover:text-green-300"
        title="View in SharePoint"
        onClick={e => e.stopPropagation()}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </a>
    );
  }

  if (status === 'synced') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" title="Synced to SharePoint" />;
  }

  if (status === 'pending') {
    return <Cloud className="h-3.5 w-3.5 text-gray-400" title="SharePoint sync pending" />;
  }

  if (status === 'syncing') {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" title="Syncing to SharePoint…" />;
  }

  if (status === 'failed') {
    return (
      <span title={error ?? 'SharePoint sync failed'}>
        <CloudOff className="h-3.5 w-3.5 text-red-400" />
      </span>
    );
  }

  return null;
}
```

- [ ] **Step 3: Add a column header and badge in each row**

Find where the table headers are rendered (look for the `<th>` elements for Status, VLM, Assigned, etc.). Add a SharePoint column header:

```tsx
<th className="px-3 py-2 text-right text-xs font-medium text-gray-400">SP</th>
```

In the table row render (find where `STATUS_COLORS` badge is shown), add a final cell with the badge. The `feature` object now has `sp_sync_status`, `sp_synced_at`, `sp_folder_url` from the updated `PonFeatureRow` type:

```tsx
<td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
  <SpSyncBadge
    status={feature.sp_sync_status}
    folderUrl={feature.sp_folder_url}
  />
</td>
```

- [ ] **Step 4: Type-check**

```bash
npm run type-check 2>&1 | grep "PonFeaturesPanel\|error" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/construction-qa/components/project/PonFeaturesPanel.tsx
git commit -m "feat(civil-qa): add SharePoint sync status badge to PON features table"
```

---

## Task 10: CI Check + PR

- [ ] **Step 1: Full CI check**

```bash
cd /home/hein/Workspace/FF_Next.js-civil-qa-sp-sync
npm run ci:quick 2>&1 | tail -30
```

Expected: lint + type-check pass. Fix any errors before proceeding.

- [ ] **Step 2: Create PR**

```bash
git push -u origin feature/civil-qa-sharepoint-sync
gh pr create \
  --title "feat(civil-qa): sync approved review photos to SharePoint (Zone/PON/Pole)" \
  --body "$(cat <<'EOF'
## Summary
- Adds SharePoint sync for approved civil QA review photos
- Folder structure: Zone {n} / PON {n} / P-{pole_number}/
- File naming: P-{pole}_NN_{step_label}.jpg
- Three triggers: auto on PASS, nightly cron (02:00 SAST), manual admin button
- Tracks sync status per review (pending/syncing/synced/failed) with badge in UI

## Environment Variables Required (set on Velocity before deploying)
```
SHAREPOINT_QA_SITE_ID=...
SHAREPOINT_QA_DRIVE_ID=...
SHAREPOINT_QA_FOLDER_ID=...
```

## Migration
`migrations/2026-04-13-civil-qa-sharepoint-sync.sql` — run before deploy

## Test Plan
- [ ] Run migration against production DB
- [ ] Set SHAREPOINT_QA_* env vars on dev server
- [ ] Approve a Thembisa 1 civil QA review → verify folder created + photos uploaded
- [ ] Check badge shows green checkmark + link in PON features panel
- [ ] Trigger manual sync from project toolbar
- [ ] Check failed sync shows red badge with error tooltip

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for Implementer

**Getting the SHAREPOINT_QA_* env var values:**
1. Open the SharePoint folder URL Hein provided
2. In Graph Explorer, call: `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{siteName}`
3. Note the `id` → that's `SHAREPOINT_QA_SITE_ID`
4. Then: `GET /sites/{siteId}/drives` → find the document library → `SHAREPOINT_QA_DRIVE_ID`
5. Then navigate to the QA folder item: `GET /drives/{driveId}/root:/{path to QA folder}` → `SHAREPOINT_QA_FOLDER_ID`

Or ask Hein to provide the three IDs from the SharePoint admin panel.

**sp-sync auth note:** The cron endpoint bypasses the `withAuth` middleware by calling `syncReview` directly from the service. The `/api/construction-qa/sp-sync` endpoint requires `super_admin` session — the fire-and-forget from `final-decision.ts` forwards the request cookie so the session is inherited.
