/**
 * QField Ingestion Service for Construction QA
 *
 * Reads from qfield_photo_validations and creates:
 *   - construction_qa_reviews (one per feature)
 *   - construction_qa_photos (one per photo)
 *   - construction_qa_activity log entries
 *
 * Maps work_type to discipline:
 *   pole_installation → civil (feature_type: pole)
 *   cable_stringing   → optical (feature_type: cable_span)
 *   dome_joint         → splicing (feature_type: joint)
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import type { Discipline, FeatureType, PhotoSource } from '../types';

const sql = neon(process.env.DATABASE_URL!);

const MODULE = 'construction-qa-ingest';

/** Map QField work_type to construction QA discipline + feature_type */
const WORK_TYPE_MAP: Record<string, { discipline: Discipline; featureType: FeatureType }> = {
  pole_installation: { discipline: 'civil', featureType: 'pole' },
  cable_stringing: { discipline: 'optical', featureType: 'cable_span' },
  dome_joint: { discipline: 'splicing', featureType: 'joint' },
};

interface IngestOptions {
  projectId: string;
  discipline?: Discipline | 'all';
  sinceDate?: string;
  dryRun?: boolean;
}

interface IngestResult {
  photosFound: number;
  photosIngested: number;
  reviewsCreated: number;
  reviewsUpdated: number;
  errors: string[];
}

/**
 * Ingest QField photos into the Construction QA system.
 *
 * Reads from qfield_photo_validations and creates/updates
 * construction_qa_reviews and construction_qa_photos records.
 */
export async function ingestQFieldPhotos(opts: IngestOptions): Promise<IngestResult> {
  const { projectId, discipline = 'all', sinceDate, dryRun = false } = opts;
  const result: IngestResult = {
    photosFound: 0,
    photosIngested: 0,
    reviewsCreated: 0,
    reviewsUpdated: 0,
    errors: [],
  };

  log.info('Starting QField ingestion', { projectId, discipline, sinceDate, dryRun }, MODULE);

  try {
    // Build work_type filter
    const workTypes: string[] = discipline === 'all'
      ? Object.keys(WORK_TYPE_MAP)
      : [Object.entries(WORK_TYPE_MAP).find(([, v]) => v.discipline === discipline)?.[0]].filter((x): x is string => x !== undefined);

    if (workTypes.length === 0) {
      result.errors.push(`No work types found for discipline: ${discipline}`);
      return result;
    }

    // Fetch unprocessed QField photos
    // Photos that have a feature_id and work_type but no matching construction_qa_photos row
    const workTypePlaceholders = workTypes.map((_, i) => `$${i + 2}`).join(', ');

    let query = `
      SELECT
        qpv.id AS qfield_id,
        qpv.photo_key,
        qpv.feature_id,
        qpv.feature_type,
        qpv.work_type,
        qpv.project_id AS qfield_project_id,
        qpv.vlm_confidence,
        qpv.vlm_feedback,
        qpv.vlm_raw_response,
        qpv.needs_retake,
        qpv.validated_at,
        qpv.created_at
      FROM qfield_photo_validations qpv
      WHERE qpv.feature_id IS NOT NULL
        AND qpv.work_type IN (${workTypePlaceholders})
        AND NOT EXISTS (
          SELECT 1 FROM construction_qa_photos cqp
          WHERE cqp.storage_key = qpv.photo_key
            AND cqp.source = 'qfield'
        )
    `;

    const params: (string | number)[] = [projectId, ...workTypes];

    if (sinceDate) {
      query += ` AND qpv.created_at >= $${params.length + 1}`;
      params.push(sinceDate);
    }

    query += ' ORDER BY qpv.created_at ASC LIMIT 500';

    const photos = await sql.query(query, params);
    result.photosFound = photos.length;

    if (photos.length === 0) {
      log.info('No new photos to ingest', undefined, MODULE);
      return result;
    }

    if (dryRun) {
      log.info('Dry run — skipping writes', { photosFound: photos.length }, MODULE);
      return result;
    }

    // Group photos by feature_id for review creation
    const byFeature = new Map<string, typeof photos>();
    for (const photo of photos) {
      const key = `${photo.work_type}::${photo.feature_id}`;
      if (!byFeature.has(key)) byFeature.set(key, []);
      byFeature.get(key)!.push(photo);
    }

    // Process each feature group
    for (const [featureKey, featurePhotos] of byFeature) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const sample = featurePhotos[0]!;
        const mapping = WORK_TYPE_MAP[sample.work_type as string];
        if (!mapping) continue;

        // Upsert the review record
        const reviewId = await upsertReview(
          projectId,
          mapping.discipline,
          mapping.featureType,
          sample.feature_id as string,
          featurePhotos.length,
          result,
        );

        // Insert photo records
        for (const photo of featurePhotos) {
          await insertPhoto(reviewId, projectId, photo);
          result.photosIngested++;
        }
      } catch (err) {
        const msg = `Failed to process feature ${featureKey}: ${(err as Error).message}`;
        log.error('Ingestion error', { error: msg }, MODULE);
        result.errors.push(msg);
      }
    }

    log.info('QField ingestion complete', result, MODULE);
    return result;
  } catch (err) {
    const msg = `Ingestion failed: ${(err as Error).message}`;
    log.error('Fatal ingestion error', { error: msg }, MODULE);
    result.errors.push(msg);
    return result;
  }
}

/**
 * Upsert a construction_qa_reviews record.
 * Returns the review UUID.
 */
async function upsertReview(
  projectId: string,
  discipline: Discipline,
  featureType: FeatureType,
  featureId: string,
  newPhotoCount: number,
  result: IngestResult,
): Promise<string> {
  // Check if review exists
  const existing = await sql`
    SELECT id, photo_count FROM construction_qa_reviews
    WHERE project_id = ${projectId}::uuid
      AND feature_type = ${featureType}
      AND feature_id = ${featureId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    // Update photo count
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const existingRow = existing[0]!;
    const totalPhotos = Number(existingRow.photo_count) + newPhotoCount;
    await sql`
      UPDATE construction_qa_reviews
      SET photo_count = ${totalPhotos},
          last_photo_at = NOW(),
          updated_at = NOW()
      WHERE id = ${existingRow.id}::uuid
    `;
    result.reviewsUpdated++;
    return existingRow.id as string;
  }

  // Look up zone/PON from the feature table
  let zoneNo: number | null = null;
  let ponNo: number | null = null;

  if (featureType === 'pole') {
    const pole = await sql`
      SELECT zone_no, pon_no FROM poles
      WHERE project_id = ${projectId}::uuid AND pole_number = ${featureId}
      LIMIT 1
    `;
    if (pole.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const p = pole[0]!;
      zoneNo = p.zone_no != null ? Number(p.zone_no) : null;
      ponNo = p.pon_no != null ? Number(p.pon_no) : null;
    }
  } else if (featureType === 'cable_span') {
    const span = await sql`
      SELECT zone_no, pon_no FROM cable_spans
      WHERE project_id = ${projectId}::uuid AND span_label = ${featureId}
      LIMIT 1
    `;
    if (span.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const s = span[0]!;
      zoneNo = s.zone_no != null ? Number(s.zone_no) : null;
      ponNo = s.pon_no != null ? Number(s.pon_no) : null;
    }
  } else if (featureType === 'joint') {
    const joint = await sql`
      SELECT zone_no, pon_no FROM joints
      WHERE project_id = ${projectId}::uuid AND joint_label = ${featureId}
      LIMIT 1
    `;
    if (joint.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const j = joint[0]!;
      zoneNo = j.zone_no != null ? Number(j.zone_no) : null;
      ponNo = j.pon_no != null ? Number(j.pon_no) : null;
    }
  }

  // Create new review
  const newReview = await sql`
    INSERT INTO construction_qa_reviews (
      project_id, discipline, feature_type, feature_id,
      zone_no, pon_no, photo_count, last_photo_at,
      workflow_status, vlm_status, priority
    ) VALUES (
      ${projectId}::uuid, ${discipline}, ${featureType}, ${featureId},
      ${zoneNo}, ${ponNo}, ${newPhotoCount}, NOW(),
      'pending', 'pending', 'normal'
    )
    RETURNING id
  `;

  result.reviewsCreated++;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const newReviewRow = newReview[0]!;

  // Log activity
  await sql`
    INSERT INTO construction_qa_activity (review_id, event_type, actor, payload)
    VALUES (
      ${newReviewRow.id}::uuid,
      'photo_ingested',
      'system',
      ${JSON.stringify({ source: 'qfield', photo_count: newPhotoCount })}::jsonb
    )
  `;

  return newReviewRow.id as string;
}

/**
 * Insert a construction_qa_photos record from a QField photo validation row.
 */
async function insertPhoto(
  reviewId: string,
  projectId: string,
  qfPhoto: Record<string, unknown>,
): Promise<void> {
  const photoKey = qfPhoto.photo_key as string;
  const filename = photoKey.split('/').pop() || photoKey;

  // Determine MIME type from extension
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  await sql`
    INSERT INTO construction_qa_photos (
      review_id, project_id, source, storage_key, filename, mime_type,
      vlm_valid, vlm_confidence, vlm_feedback,
      needs_retake
    ) VALUES (
      ${reviewId}::uuid,
      ${projectId}::uuid,
      'qfield',
      ${photoKey},
      ${filename},
      ${mimeType},
      ${qfPhoto.vlm_confidence != null ? Number(qfPhoto.vlm_confidence) >= 0.6 : null},
      ${qfPhoto.vlm_confidence != null ? Number(qfPhoto.vlm_confidence) : null},
      ${(qfPhoto.vlm_feedback as string) || null},
      ${Boolean(qfPhoto.needs_retake)}
    )
  `;
}
