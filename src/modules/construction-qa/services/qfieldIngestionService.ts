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
 *   dome_joint        → optical (feature_type: joint)
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { parseQFieldCaptureDate } from '@/lib/exifUtils';
import { copyQFieldPhotoToStorage } from '@/services/qaPhotoStorageService';
import type { Discipline, FeatureType } from '../types';

const sql = neon(process.env.DATABASE_URL!);

const MODULE = 'construction-qa-ingest';

/** Map QField work_type to construction QA discipline + feature_type */
const WORK_TYPE_MAP: Record<string, { discipline: Discipline; featureType: FeatureType }> = {
  pole_installation: { discipline: 'civil', featureType: 'pole' },
  cable_stringing: { discipline: 'optical', featureType: 'cable_span' },
  dome_joint: { discipline: 'optical', featureType: 'joint' },
  activation: { discipline: 'civil', featureType: 'pole' }, // default — overridden per-row below
};

/** Map feature_type string to discipline (used for activation rows with mixed types) */
const FEATURE_TYPE_DISCIPLINE: Record<string, { discipline: Discipline; featureType: FeatureType }> = {
  pole: { discipline: 'civil', featureType: 'pole' },
  cable_span: { discipline: 'optical', featureType: 'cable_span' },
  joint: { discipline: 'optical', featureType: 'joint' },
};

/**
 * QFieldCloud project UUID → FibreFlow project UUID mapping.
 * QFieldCloud uses its own project UUIDs which differ from FibreFlow's.
 */
const QFIELD_TO_FIBREFLOW: Record<string, string> = {
  // Original Pole Audit projects
  '07b7109f-479b-4a7b-b33c-13e2af0c6bd3': '4eb13426-b2a1-472d-9b3c-277082ae9b55', // LAW Pole Audit → Lawley
  '137eb5ec-4c0b-4eab-8a5c-de046eb06349': 'bf9a90db-e758-4c05-b999-694cd63c451f', // MOA Pole Audit → Mohadin
  '04900ce2-1f2e-45bf-b3c8-8c78bc6540db': 'c7255076-1d2f-41ce-97bb-858b8c87ee27', // ETW Pole Audit → Etwatwa
  'c1e14ea2-489c-4376-a59a-1253df404dde': '7003dc06-9af7-4a7c-bc6c-a177d77784f2', // MAM Pole Audit → Mamelodi
  // Site Audit 2026 projects
  '2e988631-462b-448f-ae15-bb693a68cd55': '4eb13426-b2a1-472d-9b3c-277082ae9b55', // LAW Site Audit 2026 → Lawley
  '2ce80264-170c-4f05-ada1-68220d7e5885': '7003dc06-9af7-4a7c-bc6c-a177d77784f2', // MAM1 Site Audit 2026 → Mamelodi
  'bec5f353-2e83-4f6b-989a-fca83ad94e16': 'bf9a90db-e758-4c05-b999-694cd63c451f', // MOA Site Audit 2026 → Mohadin
  '63341eb4-bc81-4607-a3d6-580ea2a7457c': '7d8b94d6-8e5a-4dbb-9ede-69ce3884e004', // THM1 Site Audit 2026 → Thembisa POP 1
  '5f3b962a-7901-43f7-a284-1c1a9ed7f3d1': '1de088dd-fe24-43fb-b8d3-94fca61ef91d', // THM3 Site Audit 2026 → Thembisa POP 3
  '47585401-1b25-4d3b-8d18-4337ea26df88': 'c7255076-1d2f-41ce-97bb-858b8c87ee27', // ETW POP 2 Site Audit 2026 → Etwatwa
  // Additional projects
  '47eb39f5-d6a8-4ce7-9421-9133872c1951': '7003dc06-9af7-4a7c-bc6c-a177d77784f2', // MAM Pole Audit (offline) → Mamelodi
  '380147aa-0c25-4b09-a745-2480addd8cca': 'c7255076-1d2f-41ce-97bb-858b8c87ee27', // ETWpoc1 → Etwatwa
  '7fe59cdc-b1d5-475d-8448-5cf2e9f7175b': 'ce3bf310-d6ba-4ede-ab36-a8c902a5efc6', // Tonga Site Audit 2026 → Tonga
};

/** Reverse map: FibreFlow project UUID → QFieldCloud project UUIDs */
const FIBREFLOW_TO_QFIELD: Record<string, string[]> = {};
for (const [qfId, ffId] of Object.entries(QFIELD_TO_FIBREFLOW)) {
  if (!FIBREFLOW_TO_QFIELD[ffId]) FIBREFLOW_TO_QFIELD[ffId] = [];
  FIBREFLOW_TO_QFIELD[ffId].push(qfId);
}

interface IngestOptions {
  projectId: string;
  discipline?: Discipline | 'all';
  sinceDate?: string;
  dryRun?: boolean;
}

interface IngestResult {
  projectId: string;
  projectName?: string;
  photosFound: number;
  photosIngested: number;
  reviewsCreated: number;
  reviewsUpdated: number;
  errors: string[];
}

interface IngestAllResult {
  projects: IngestResult[];
  totalPhotosIngested: number;
  totalReviewsCreated: number;
  totalReviewsUpdated: number;
  totalErrors: number;
}

/**
 * Ingest QField photos for ALL mapped projects.
 */
export async function ingestAllQFieldPhotos(opts: { dryRun?: boolean; discipline?: Discipline | 'all' }): Promise<IngestAllResult> {
  const ffProjectIds = Object.values(QFIELD_TO_FIBREFLOW);
  const unique = [...new Set(ffProjectIds)];

  const results: IngestResult[] = [];
  for (const projectId of unique) {
    const r = await ingestQFieldPhotos({ projectId, discipline: opts.discipline, dryRun: opts.dryRun });
    results.push(r);
  }

  return {
    projects: results,
    totalPhotosIngested: results.reduce((s, r) => s + r.photosIngested, 0),
    totalReviewsCreated: results.reduce((s, r) => s + r.reviewsCreated, 0),
    totalReviewsUpdated: results.reduce((s, r) => s + r.reviewsUpdated, 0),
    totalErrors: results.reduce((s, r) => s + r.errors.length, 0),
  };
}

/**
 * Ingest QField photos into the Construction QA system for a single project.
 *
 * Reads from qfield_photo_validations and creates/updates
 * construction_qa_reviews and construction_qa_photos records.
 */
export async function ingestQFieldPhotos(opts: IngestOptions): Promise<IngestResult> {
  const { projectId, discipline = 'all', sinceDate, dryRun = false } = opts;
  const result: IngestResult = {
    projectId,
    photosFound: 0,
    photosIngested: 0,
    reviewsCreated: 0,
    reviewsUpdated: 0,
    errors: [],
  };

  // Look up QField project IDs for this FibreFlow project
  const qfProjectIds = FIBREFLOW_TO_QFIELD[projectId];
  if (!qfProjectIds || qfProjectIds.length === 0) {
    result.errors.push(`No QField project mapping for FibreFlow project ${projectId}`);
    return result;
  }

  log.info('Starting QField ingestion', { projectId, qfProjectIds, discipline, sinceDate, dryRun }, MODULE);

  try {
    // Build work_type filter
    const workTypes: string[] = discipline === 'all'
      ? Object.keys(WORK_TYPE_MAP)
      : [Object.entries(WORK_TYPE_MAP).find(([, v]) => v.discipline === discipline)?.[0]].filter((x): x is string => x !== undefined);

    if (workTypes.length === 0) {
      result.errors.push(`No work types found for discipline: ${discipline}`);
      return result;
    }

    // Build parameterized query
    // $1..$N = qfProjectIds, then workTypes, then optional sinceDate
    let paramIdx = 1;
    const qfPlaceholders = qfProjectIds.map(() => `$${paramIdx++}`).join(', ');
    const wtPlaceholders = workTypes.map(() => `$${paramIdx++}`).join(', ');
    const params: (string | number)[] = [...qfProjectIds, ...workTypes];

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
        qpv.created_at,
        qpv.checklist_step,
        qpv.step_label
      FROM qfield_photo_validations qpv
      WHERE qpv.feature_id IS NOT NULL
        AND qpv.project_id IN (${qfPlaceholders})
        AND qpv.work_type IN (${wtPlaceholders})
        AND NOT EXISTS (
          SELECT 1 FROM construction_qa_photos cqp
          JOIN construction_qa_reviews cqr ON cqr.id = cqp.review_id
          WHERE cqr.feature_id = qpv.feature_id
            AND cqp.filename = regexp_replace(qpv.photo_key, '^.*/', '')
        )
    `;

    if (sinceDate) {
      query += ` AND qpv.created_at >= $${paramIdx++}`;
      params.push(sinceDate);
    }

    query += ' ORDER BY qpv.created_at ASC';

    const photos = await sql.query(query, params);
    result.photosFound = photos.length;

    if (photos.length === 0) {
      log.info('No new photos to ingest', { projectId }, MODULE);
      return result;
    }

    if (dryRun) {
      log.info('Dry run — skipping writes', { projectId, photosFound: photos.length }, MODULE);
      return result;
    }

    // Deduplicate by photo_key (multiple qfield_photo_validations can reference same photo)
    const seenKeys = new Set<string>();
    const uniquePhotos = photos.filter(p => {
      const pk = p.photo_key as string;
      if (seenKeys.has(pk)) return false;
      seenKeys.add(pk);
      return true;
    });
    result.photosFound = uniquePhotos.length;

    // Group photos by feature_type + feature_id for review creation
    const byFeature = new Map<string, typeof photos>();
    for (const photo of uniquePhotos) {
      const ft = photo.feature_type as string || 'pole';
      const key = `${ft}::${photo.feature_id}`;
      if (!byFeature.has(key)) byFeature.set(key, []);
      byFeature.get(key)!.push(photo);
    }

    // Process each feature group
    for (const [featureKey, featurePhotos] of byFeature) {
      try {
        const sample = featurePhotos[0];
        if (!sample) continue;

        // For activation work_type, derive discipline from actual feature_type
        const rowFeatureType = sample.feature_type as string;
        const mapping = (sample.work_type === 'activation' && rowFeatureType && FEATURE_TYPE_DISCIPLINE[rowFeatureType])
          ? FEATURE_TYPE_DISCIPLINE[rowFeatureType]
          : WORK_TYPE_MAP[sample.work_type as string];
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

        // Insert photo records and track earliest capture date
        let earliestCapture: Date | null = null;
        const featureId = sample.feature_id as string;
        for (const photo of featurePhotos) {
          const capturedAt = await insertPhoto(reviewId, projectId, photo, featureId);
          if (capturedAt && (!earliestCapture || capturedAt < earliestCapture)) {
            earliestCapture = capturedAt;
          }
          result.photosIngested++;
        }

        // Update review's last_photo_at to earliest capture date
        if (earliestCapture) {
          await sql`
            UPDATE construction_qa_reviews
            SET last_photo_at = LEAST(last_photo_at, ${earliestCapture.toISOString()}::timestamptz)
            WHERE id = ${reviewId}::uuid
          `;
        }

        // Update civil step booleans from assigned checklist_step values
        if (mapping.discipline === 'civil') {
          await sql`
            WITH photo_steps AS (
              SELECT
                bool_or(checklist_step = 1) AS s1, bool_or(checklist_step = 2) AS s2,
                bool_or(checklist_step = 3) AS s3, bool_or(checklist_step = 4) AS s4,
                bool_or(checklist_step = 5) AS s5, bool_or(checklist_step = 6) AS s6,
                bool_or(checklist_step = 7) AS s7, bool_or(checklist_step = 8) AS s8
              FROM construction_qa_photos
              WHERE review_id = ${reviewId}::uuid
            )
            UPDATE construction_qa_reviews SET
              civil_step_01_before_photo = COALESCE(ps.s1, false),
              civil_step_02_during_photo = COALESCE(ps.s2, false),
              civil_step_03_depth_photo = COALESCE(ps.s3, false),
              civil_step_04_end_plates = COALESCE(ps.s4, false),
              civil_step_05_compaction = COALESCE(ps.s5, false),
              civil_step_06_level_check = COALESCE(ps.s6, false),
              civil_step_07_after_photo = COALESCE(ps.s7, false),
              civil_step_08_signature = COALESCE(ps.s8, false),
              updated_at = NOW()
            FROM photo_steps ps
            WHERE id = ${reviewId}::uuid
          `;
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
    // Update photo count from actual photo records (not additive — prevents drift)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const existingRow = existing[0]!;
    await sql`
      UPDATE construction_qa_reviews
      SET photo_count = (
            SELECT COUNT(*)::int FROM construction_qa_photos
            WHERE review_id = ${existingRow.id}::uuid
          ),
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
  featureId: string,
): Promise<Date | null> {
  const photoKey = qfPhoto.photo_key as string;
  const filename = photoKey.split('/').pop() || photoKey;

  // Determine MIME type from extension
  const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  // Extract capture date from QField filename
  const capturedAt = parseQFieldCaptureDate(photoKey);

  // Copy photo from MinIO to local storage for fast serving
  const localPath = await copyQFieldPhotoToStorage(photoKey, projectId, featureId, filename);
  const source = localPath ? 'local' : 'qfield';
  const storageKey = localPath || photoKey;

  const checklistStep = qfPhoto.checklist_step != null ? Number(qfPhoto.checklist_step) : null;
  const stepLabel = (qfPhoto.step_label as string) || null;

  await sql`
    INSERT INTO construction_qa_photos (
      review_id, project_id, source, storage_key, filename, mime_type,
      vlm_valid, vlm_confidence, vlm_feedback,
      needs_retake, captured_at,
      checklist_step, step_label
    ) VALUES (
      ${reviewId}::uuid,
      ${projectId}::uuid,
      ${source},
      ${storageKey},
      ${filename},
      ${mimeType},
      ${qfPhoto.vlm_confidence != null ? Number(qfPhoto.vlm_confidence) >= 0.6 : null},
      ${qfPhoto.vlm_confidence != null ? Number(qfPhoto.vlm_confidence) : null},
      ${(qfPhoto.vlm_feedback as string) || null},
      ${Boolean(qfPhoto.needs_retake)},
      ${capturedAt ? capturedAt.toISOString() : null},
      ${checklistStep},
      ${stepLabel}
    )
    ON CONFLICT (review_id, filename) DO NOTHING
  `;

  return capturedAt;
}
