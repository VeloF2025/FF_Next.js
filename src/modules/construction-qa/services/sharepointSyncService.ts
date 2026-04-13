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
import { getGraphToken } from '@/lib/graph/sharepoint-excel';
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

/** Download a photo from VF Storage. Returns ArrayBuffer + content-type. */
async function downloadPhoto(storageUrl: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await fetch(storageUrl);
  if (!res.ok) {
    throw new Error(`Photo download failed ${res.status}: ${storageUrl}`);
  }
  const data = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
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

    const photos = await sql`
      SELECT id, storage_url, filename, mime_type, checklist_step, step_label
      FROM construction_qa_photos
      WHERE review_id = ${reviewId}::uuid
      ORDER BY checklist_step ASC NULLS LAST, created_at ASC
    `;

    if (photos.length === 0) {
      log.warn('No photos found for review', { module: 'civil-qa:sp-sync', reviewId });
    }

    const token = await getGraphToken();

    // Resolve/create folder hierarchy
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
        photo.filename ? String(photo.filename) : `photo_${String(photo.id)}.jpg`,
      );

      const { data, contentType } = await downloadPhoto(storageUrl);
      await uploadFile(token, driveId, poleFolderId, filename, contentType, data);

      log.info('Uploaded photo to SharePoint', {
        module: 'civil-qa:sp-sync',
        reviewId,
        filename,
      });
    }

    // Fetch the pole folder webUrl for the sp_folder_url field
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
          sp_folder_url  = ${(folderInfo as { webUrl?: string }).webUrl ?? null},
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
