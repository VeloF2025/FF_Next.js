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
 *
 * This literal is a THIRD copy of a mapping that already lives in the DB
 * (`qfield_projects` ⋈ `qfield_project_links`), after
 * `scripts/qfield_project_registry.py`. Nothing compared the copies, so a project could
 * be registered for extraction and silently absent here — which is how the five entries
 * above went missing. `__tests__/qfieldProjectMap.test.ts` now cross-checks this map
 * against the Python registry and fails when they diverge. It covers the 14 entries the
 * registry knows about; the other 6 here have no registry counterpart and are checked
 * only for duplicate keys, so the DB audit below is still the wider net.
 *
 * Two reasons the DB cannot simply replace this map today:
 *   - It is not a superset. `380147aa…` (ETWpoc1) is here but has no row in
 *     `qfield_projects` at all — no link, no photos. Dead config; left rather than
 *     removed as a drive-by.
 *   - `Record<string, string>` cannot express what the table holds. `Master_2026` and
 *     `FT_Master_Progress` each link to SIX FibreFlow projects. Both carry zero photos
 *     today, so they are omitted here rather than modelled wrongly.
 *   - Being linked in the DB is not sufficient on its own — a project must be
 *     registered for EXTRACTION first, or its `feature_id`s are raw GPKG row ids rather
 *     than pole labels. Grabouw was the worked example: 121 rows keyed
 *     `poles_20251113101137422`, matching none of its reviews and none of its 3,793
 *     poles. It has since been registered, its stale rows deleted and re-extracted, and
 *     all 121 now resolve to a `GRA.P.*` label — which is what makes the entry below
 *     safe. Grabouw Drill Survey (`0fc570b5…`) is still linked-but-unregistered and is
 *     deliberately absent: its single row carries a `gra-moling_*` id and a NULL
 *     feature_type.
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
  '9af1fc72-f637-4ecb-b371-f7c08a4d4e68': '7bb7e022-dd75-4299-8575-cfc08abdfabb', // FT_Thembelihle → Themb'elihle
  // Registered for extraction but absent here until 2026-08-17, so their photos reached
  // qfield_photo_validations and stopped: 6,242 rows eligible under this service's own
  // predicate and zero construction_qa_reviews between them.
  //
  // What this does NOT do: unblock zone delivery. That gate joins
  // construction_qa_reviews on zone_no AND pon_no, and upsertReview reads those from
  // `poles`, which is EMPTY for all five HT_ projects (Lawley has 4,937, Etwatwa 4,538).
  // Every review created here lands with zone_no NULL, so `q.zone_no = p.zone_no` is
  // never true and Mahikeng's zones 3 and 4 stay shut. Pole data is the missing
  // prerequisite, not this map. (All six zone_delivery_state rows across every project
  // are 'not_started' — no project has passed this gate.)
  'e801cd43-7efe-4f7a-bed5-ee0410f3dfd6': '7794d0ba-95c9-491b-8cb5-7f300c61aa23', // HT_Mahikeng → Mahikeng
  'a7464d75-88e7-4e1a-ba3d-7978844b9ab7': 'd14b5632-8803-4be6-b567-fb091e9e8a7e', // HT_Cradock → Cradock
  'f076fad4-b2a5-40b8-bafe-35c20ce09827': 'de408530-76f0-4d10-bf08-cfcd3202f69e', // HT_Middelburg → Middelburg
  'b32184d6-1776-4b89-8afd-2907dfca86d4': '183fe626-7bf7-4793-bdb9-1a1dc2e21aa6', // HT_Namakgale_P3_A1 → Phalaborwa - Namakgale
  'ef0b7147-e56f-43a1-9074-6807e0bedf50': '67df5c8d-0b3d-4784-9d63-70e3cdd1e2b8', // HT_Phalaborwa_Benfarm_V1 → Phalaborwa - Ben Farm
  // Deliberately NOT added in #2510: at that point Grabouw's 121 rows carried filename
  // stems ("poles_20251113102437166") instead of pole labels, because the project had
  // never been registered for extraction, and ingesting them would have created 121
  // untraceable reviews beside the 122 correct ones. It is registered now, the stale
  // rows have been deleted and re-extracted, and all 121 resolve to a GRA.P.* label
  // matching a row in `poles`. Only then is this line safe.
  'aa6aba62-e57e-4701-8b55-30d2cce996c8': '574a7856-3582-46aa-9094-1c434855d176', // Grabouw QA → Grabouw
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
    // Include ALL work_types for the discipline (e.g. optical = cable_stringing + dome_joint),
    // not just the first match — otherwise a discipline-scoped ingest silently drops work_types.
    const workTypes: string[] = discipline === 'all'
      ? Object.keys(WORK_TYPE_MAP)
      : Object.entries(WORK_TYPE_MAP).filter(([, v]) => v.discipline === discipline).map(([k]) => k);

    if (workTypes.length === 0) {
      result.errors.push(`No work types found for discipline: ${discipline}`);
      return result;
    }

    // Build parameterized query
    // $1..$N = qfProjectIds, then workTypes, then optional sinceDate
    let paramIdx = 1;
    const qfPlaceholders = qfProjectIds.map(() => `$${paramIdx++}`).join(', ');
    const wtPlaceholders = workTypes.map(() => `$${paramIdx++}`).join(', ');
    // Scopes the dedupe below to THIS FibreFlow project. Without it the NOT EXISTS
    // matches on feature_id alone, so a photo under a label that exists in two projects
    // suppresses ingestion of a genuinely different photo in the other. Four labels are
    // duplicated across projects today -- three junk placeholders ("New pole" x6,
    // "New Pole" x3, "Drop Pole" x2) and one real pole label, MAM.P.B120, in two.
    // Pre-existing, but widening the filename match above enlarges its reach, and
    // projectId is already in scope here.
    const dedupeProjectParam = `$${paramIdx++}`;
    const params: (string | number)[] = [...qfProjectIds, ...workTypes, projectId];

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
            AND cqr.project_id = ${dedupeProjectParam}::uuid
            -- Match EITHER filename convention. photo_key gained a trailing MinIO
            -- version segment at some point, so the basename of a modern key is the
            -- version token (v20251110164715-1e5f2261), not the filename -- while rows
            -- ingested before that carry the real filename (poles_....jpeg). Live split:
            -- 59,684 version-token vs 38,449 real-filename. Comparing only the basename
            -- misses every pre-versioning row and re-inserts it; comparing only the
            -- stripped filename misses every post-versioning row. Measured on prod:
            -- basename-only leaves 486 survivors, stripped-only 55,548 (i.e. ~55k
            -- duplicates), both forms 365. The 121-row difference between 486 and 365 is
            -- exactly Grabouw, whose photos were ingested pre-versioning and re-extracted
            -- post-versioning — no other project's behaviour changes.
            AND cqp.filename IN (
              regexp_replace(qpv.photo_key, '^.*/', ''),
              -- Lowercase hex only, matching every version id QFieldCloud emits today
              -- (62,210 versioned keys, 0 exceptions). If that ever changes, form-2 stops
              -- stripping and this falls back to form-1 alone -- which fails in the
              -- DUPLICATE-INSERT direction, i.e. the thing this clause exists to stop.
              regexp_replace(regexp_replace(qpv.photo_key, '/v[0-9]{14}-[0-9a-f]+$', ''), '^.*/', '')
            )
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

    log.info('QField ingestion complete', { data: result }, MODULE);

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

    const existingRow = existing[0]!;
    await sql`
      UPDATE construction_qa_reviews
      SET photo_count = (
            SELECT COUNT(*)::int FROM construction_qa_photos
            WHERE review_id = ${existingRow.id}::uuid
          ),
          last_photo_at = NOW(),
          vlm_status = 'pending',
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
