/**
 * API Route: /api/dr-photo-unified/process-new-dr
 *
 * Purpose: Webhook endpoint for automatic photo fetch + VLM categorization
 * Method: POST
 *
 * Called by WA Monitor Python service after creating a new DR record.
 * This enables automatic processing so photos are ready when user opens UI.
 *
 * Flow:
 * 1. WA Monitor detects new DR in WhatsApp
 * 2. WA Monitor creates record in dr_photo_unified_reviews
 * 3. WA Monitor calls this webhook
 * 4. This endpoint fetches photos from OneMap + runs VLM categorization
 * 5. User opens UI and sees photos already categorized
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  categorizePhotos,
  PhotoInput,
} from '@/modules/dr-photo-unified/services/categorizationVlmService';
import { photoTypeToStep } from '@/modules/dr-photo-unified/utils/stepMapper';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

// OneMap API host
const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://192.168.1.150:8003';

interface ProcessNewDrRequest {
  dropNumber: string;
  project?: string;
  skipCategorization?: boolean; // Optional: only fetch photos, don't categorize
}

interface PreviousSubmission {
  submission_number: number;
  snapshot_at: string;
  photo_count: number;
  photos_metadata: any[];
  vlm_categorization_status: string | null;
  vlm_categorization_results: any[];
  feedback_sent: boolean;
  feedback_sent_at: string | null;
  step_completion: Record<string, boolean>;
}

interface ProcessNewDrResponse {
  dropNumber: string;
  photosDownloaded: number;
  categorizationStatus: string;
  processingTimeMs: number;
  isResubmission?: boolean;
  submissionCount?: number;
  previousSubmission?: PreviousSubmission | null;
}

/**
 * Fetch photos from OneMap and return as PhotoInput[]
 */
async function fetchPhotosFromOneMap(dropNumber: string): Promise<{
  photos: PhotoInput[];
  ont_barcode: string | null;
  ups_serial: string | null;
}> {
  // Try to get the record from OneMap
  let response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);

  // If 404, trigger download first
  if (response.status === 404 || response.status === 422) {
    log.info('ProcessNewDr', `Record not found for ${dropNumber}, triggering download`);

    const downloadResponse = await fetch(`${ONEMAP_HOST}/api/download/${dropNumber}`, {
      method: 'POST',
    });

    if (downloadResponse.ok) {
      // Retry fetching record
      response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`);
    } else {
      throw new Error(`Download failed: ${downloadResponse.status}`);
    }
  }

  if (!response.ok) {
    throw new Error(`OneMap API error: ${response.status}`);
  }

  const data = await response.json();
  const localPhotos = data.local_photos || [];

  // Map to PhotoInput format (raw, for categorization)
  const photos: PhotoInput[] = localPhotos.map((photo: any) => ({
    filename: photo.filename,
    url: `/api/dr-photo-unified/photo/${dropNumber}/${photo.filename}`,
    original_type: photo.type || null,
    original_step: photo.type ? photoTypeToStep(photo.type) : null,
  }));

  return {
    photos,
    ont_barcode: data.ont_barcode || null,
    ups_serial: data.ups_serial || null,
  };
}

/**
 * Check if DR exists in dr_photo_unified_reviews table
 * Returns full record if exists for history preservation
 */
async function checkExistingUnifiedRecord(dropNumber: string): Promise<any | null> {
  const result = await pool.query(
    `SELECT
       id, drop_number, project, photo_count, photos_metadata,
       vlm_categorization_status, vlm_categorization_results, vlm_categorized_at,
       feedback_sent, feedback_sent_at, submission_count, submission_history,
       step_01_house_photo, step_02_cable_from_pole, step_03_entry_outside,
       step_04_entry_inside, step_05_wall, step_06_ont_back,
       step_07_power_meter, step_08_final_installation, step_09_green_lights,
       step_10_signature, created_at
     FROM dr_photo_unified_reviews
     WHERE drop_number = $1`,
    [dropNumber]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Check if DR exists in qa_photo_reviews table (WA Monitor table)
 * Used for cross-table duplicate detection
 */
async function checkExistingQARecord(dropNumber: string, project?: string): Promise<any | null> {
  // Check across shared projects (Lawley, Mohadin, Mamelodi) or just the specific project
  const sharedProjects = ['Lawley', 'Mohadin', 'Mamelodi'];
  const projectsToCheck = project && sharedProjects.includes(project)
    ? sharedProjects
    : project ? [project] : sharedProjects;

  const placeholders = projectsToCheck.map((_, i) => `$${i + 2}`).join(',');
  const result = await pool.query(
    `SELECT id, drop_number, project, feedback_sent, created_at
     FROM qa_photo_reviews
     WHERE drop_number = $1 AND project IN (${placeholders})`,
    [dropNumber, ...projectsToCheck]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Create a snapshot of the current submission for history
 */
function createSubmissionSnapshot(record: any, submissionNumber: number): PreviousSubmission {
  return {
    submission_number: submissionNumber,
    snapshot_at: new Date().toISOString(),
    photo_count: record.photo_count || 0,
    photos_metadata: record.photos_metadata || [],
    vlm_categorization_status: record.vlm_categorization_status,
    vlm_categorization_results: record.vlm_categorization_results || [],
    feedback_sent: record.feedback_sent || false,
    feedback_sent_at: record.feedback_sent_at || null,
    step_completion: {
      step_01_house_photo: record.step_01_house_photo || false,
      step_02_cable_from_pole: record.step_02_cable_from_pole || false,
      step_03_entry_outside: record.step_03_entry_outside || false,
      step_04_entry_inside: record.step_04_entry_inside || false,
      step_05_wall: record.step_05_wall || false,
      step_06_ont_back: record.step_06_ont_back || false,
      step_07_power_meter: record.step_07_power_meter || false,
      step_08_final_installation: record.step_08_final_installation || false,
      step_09_green_lights: record.step_09_green_lights || false,
      step_10_signature: record.step_10_signature || false,
    },
  };
}

/**
 * POST /api/dr-photo-unified/process-new-dr
 *
 * Webhook for automatic processing of new DRs.
 * Called by WA Monitor after creating a DR record, or via Manual Entry.
 *
 * Duplicate Detection:
 * - Checks dr_photo_unified_reviews (unified table)
 * - Checks qa_photo_reviews (WA Monitor table) for cross-reference
 * - Preserves submission history when resubmitting
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, project, skipCategorization } = req.body as ProcessNewDrRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('ProcessNewDr', `Processing DR: ${dropNumber}`, { project, skipCategorization });

    // Check for existing records in both tables
    const existingUnified = await checkExistingUnifiedRecord(dropNumber);
    const existingQA = await checkExistingQARecord(dropNumber, project);

    let isResubmission = false;
    let submissionCount = 1;
    let previousSubmission: PreviousSubmission | null = null;

    if (existingUnified) {
      // DR exists in unified table - this is a resubmission
      isResubmission = true;
      submissionCount = (existingUnified.submission_count || 1) + 1;

      // Create snapshot of current state before overwriting
      previousSubmission = createSubmissionSnapshot(existingUnified, existingUnified.submission_count || 1);

      // Append to submission history
      const currentHistory = existingUnified.submission_history || [];
      const updatedHistory = [...currentHistory, previousSubmission];

      // Update record with new submission info and preserved history
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           submission_count = $1,
           submission_history = $2,
           last_resubmitted_at = NOW(),
           resubmitted_by = 'manual_entry',
           project = COALESCE($3, project),
           updated_at = NOW()
         WHERE drop_number = $4`,
        [submissionCount, JSON.stringify(updatedHistory), project, dropNumber]
      );

      log.info('ProcessNewDr', `Resubmission detected for ${dropNumber}`, {
        submissionCount,
        previousPhotoCount: previousSubmission.photo_count,
        hadFeedback: previousSubmission.feedback_sent,
      });
    } else if (existingQA) {
      // DR exists in QA table but not unified - create unified record noting the QA reference
      log.info('ProcessNewDr', `Found existing QA record for ${dropNumber} in ${existingQA.project}`);

      await pool.query(
        `INSERT INTO dr_photo_unified_reviews (
           drop_number, project, submission_count, created_at, updated_at,
           submission_history
         ) VALUES ($1, $2, 1, NOW(), NOW(), $3)`,
        [
          dropNumber,
          project || existingQA.project,
          JSON.stringify([{
            submission_number: 0,
            snapshot_at: existingQA.created_at,
            photo_count: 0,
            photos_metadata: [],
            vlm_categorization_status: null,
            vlm_categorization_results: [],
            feedback_sent: existingQA.feedback_sent || false,
            feedback_sent_at: null,
            step_completion: {},
            note: `Originally submitted via WhatsApp to ${existingQA.project}`,
          }])
        ]
      );

      isResubmission = true;
      submissionCount = 1;
    } else {
      // Brand new DR - create fresh record
      await pool.query(
        `INSERT INTO dr_photo_unified_reviews (drop_number, project, submission_count, created_at, updated_at)
         VALUES ($1, $2, 1, NOW(), NOW())`,
        [dropNumber, project || null]
      );
      log.info('ProcessNewDr', `Created new record for ${dropNumber}`);
    }

    // Fetch photos from OneMap
    log.info('ProcessNewDr', `Fetching photos for ${dropNumber}`);
    const { photos, ont_barcode, ups_serial } = await fetchPhotosFromOneMap(dropNumber);

    if (photos.length === 0) {
      log.warn('ProcessNewDr', `No photos found for ${dropNumber}`);

      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET photo_count = 0, photo_source = 'onemap', updated_at = NOW()
         WHERE drop_number = $1`,
        [dropNumber]
      );

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: 0,
        categorizationStatus: 'no_photos',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
      } as ProcessNewDrResponse);
    }

    log.info('ProcessNewDr', `Found ${photos.length} photos for ${dropNumber}`);

    // Store photo metadata
    const photosMetadata = photos.map((p) => ({
      filename: p.filename,
      url: p.url,
      step: null, // Will be set after categorization
      original_type: p.original_type,
    }));

    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         photo_source = 'onemap',
         photo_count = $1,
         photos_metadata = $2,
         ont_serial_scanned = COALESCE($3, ont_serial_scanned),
         ups_serial_scanned = COALESCE($4, ups_serial_scanned),
         updated_at = NOW()
       WHERE drop_number = $5`,
      [photos.length, JSON.stringify(photosMetadata), ont_barcode, ups_serial, dropNumber]
    );

    // Skip categorization if requested (useful for testing)
    if (skipCategorization) {
      log.info('ProcessNewDr', `Skipping categorization for ${dropNumber} (requested)`);

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: photos.length,
        categorizationStatus: 'skipped',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
      } as ProcessNewDrResponse);
    }

    // Run VLM categorization
    log.info('ProcessNewDr', `Running VLM categorization for ${dropNumber}`);

    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET vlm_categorization_status = 'processing', updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );

    try {
      const categorizations = await categorizePhotos(dropNumber, photos);

      // Store categorization results
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           vlm_categorization_status = 'categorized',
           vlm_categorization_results = $1,
           vlm_categorized_at = NOW(),
           updated_at = NOW()
         WHERE drop_number = $2`,
        [JSON.stringify(categorizations), dropNumber]
      );

      log.info('ProcessNewDr', `Categorization complete for ${dropNumber}`, {
        photoCount: categorizations.length,
        processingTimeMs: Date.now() - startTime,
      });

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: photos.length,
        categorizationStatus: 'categorized',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
      } as ProcessNewDrResponse);
    } catch (catError) {
      log.error('ProcessNewDr', `Categorization failed for ${dropNumber}`, catError);

      // Store failure with retry tracking
      const errorMessage = catError instanceof Error ? catError.message : 'Unknown error';
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET
           vlm_categorization_status = 'failed',
           vlm_retry_count = COALESCE(vlm_retry_count, 0) + 1,
           vlm_last_error = $1,
           vlm_next_retry_at = NOW() + INTERVAL '5 minutes',
           updated_at = NOW()
         WHERE drop_number = $2`,
        [errorMessage, dropNumber]
      );

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: photos.length,
        categorizationStatus: 'failed',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
      } as ProcessNewDrResponse);
    }
  } catch (error) {
    log.error('ProcessNewDr', 'Error processing new DR', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}
