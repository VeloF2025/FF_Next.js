/**
 * API Route: /api/activate/process-new-dr
 *
 * Purpose: Webhook endpoint for automatic photo fetch + VLM categorization.
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
 *
 * Business logic lives in:
 *   src/modules/activate/services/dr/drDropsService.ts
 *   src/modules/activate/services/dr/drContactService.ts
 *   src/modules/activate/services/dr/drRecordService.ts
 *   src/modules/activate/services/dr/drCategorizationService.ts
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
// Webhook auth: verified via shared bridge secret (not withAuth - called by Go WhatsApp Bridge)
import { log } from '@/lib/logger';
import { fetchPhotosWithRetry } from '@/modules/activate/services/photoFetchService';

import { fetchContactData } from '@/modules/activate/services/dr/drContactService';
import {
  persistNoPhotos,
  persistPhotoMetadata,
  runCategorizationPipeline,
} from '@/modules/activate/services/dr/drCategorizationService';
import {
  checkDropsTable,
  markSiteSubmitted,
  triggerSharePointFolderCreation,
} from '@/modules/activate/services/dr/drDropsService';
import type { ProcessNewDrRequest, ProcessNewDrResponse } from '@/modules/activate/services/dr/drProcessTypes';
import {
  checkExistingQARecord,
  checkExistingUnifiedRecord,
  resolveSenderPhone,
  resolveUnifiedRecord,
} from '@/modules/activate/services/dr/drRecordService';

const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const {
      dropNumber,
      project,
      submittedDate,
      skipCategorization,
      senderPhone,
      waMessageId,
      waSenderJid,
      waOriginalText,
      waGroupJid,
    } = req.body as ProcessNewDrRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    const submittedDateValue = submittedDate ? new Date(submittedDate) : new Date();
    const submittedDateStr = submittedDateValue.toISOString().split('T')[0]!;

    log.info('ProcessNewDr', `Processing DR: ${dropNumber}`, {
      project,
      submittedDate: submittedDateStr,
      skipCategorization,
      senderPhone,
    });

    // === DROPS TABLE VALIDATION ===
    const dropsRecord = await checkDropsTable(dropNumber);
    let dropsTableMatch = false;
    let projectMismatch = false;
    let expectedProject: string | null = null;

    if (dropsRecord) {
      dropsTableMatch = true;
      expectedProject = dropsRecord.project_name;

      if (project && expectedProject && project.toLowerCase() !== expectedProject.toLowerCase()) {
        projectMismatch = true;
        log.warn('ProcessNewDr', `Project mismatch for ${dropNumber}`, {
          expectedProject,
          submittedTo: project,
          senderPhone,
        });
        return res.status(400).json({
          success: false,
          error: 'PROJECT_MISMATCH',
          message: `${dropNumber} belongs to ${expectedProject}, not ${project}. Please resubmit to the correct group.`,
          dropNumber,
          expectedProject,
          submittedTo: project,
          notifyUser: true,
        });
      }

      await markSiteSubmitted(dropNumber, senderPhone ?? null, project ?? expectedProject);
      log.info('ProcessNewDr', `Marked ${dropNumber} as site submitted`, { expectedProject });
      triggerSharePointFolderCreation(dropNumber, expectedProject);
    } else {
      log.warn('ProcessNewDr', `DR ${dropNumber} not found in drops table - REJECTING`, {
        submittedTo: project,
        senderPhone,
      });
      return res.status(400).json({
        success: false,
        error: 'DR_NOT_FOUND',
        message: `${dropNumber} not found in ${project ?? 'system'}. Please verify the DR number is correct.`,
        dropNumber,
        submittedTo: project,
        notifyUser: true,
      });
    }

    // === EXISTING RECORD CHECKS ===
    const [existingUnified, existingQA] = await Promise.all([
      checkExistingUnifiedRecord(dropNumber),
      checkExistingQARecord(dropNumber, project),
    ]);

    const resolvedSenderPhone = await resolveSenderPhone(
      dropNumber,
      senderPhone,
      existingQA?.sender_phone
    );

    // === CONTACT INFO (fetched once, stored for life of record) ===
    const contact = await fetchContactData(dropNumber);

    // === UNIFIED RECORD RESOLUTION ===
    const wa = { waMessageId, waSenderJid, waOriginalText, waGroupJid };
    const { isResubmission, submissionCount, previousSubmission } = await resolveUnifiedRecord({
      dropNumber,
      submittedDateStr,
      project: project ?? null,
      expectedProject,
      senderPhone: resolvedSenderPhone,
      wa,
      contact,
      existingUnified,
      existingQA,
    });

    // === PHOTO FETCH ===
    log.info('ProcessNewDr', `Fetching photos for ${dropNumber} with retry`);
    const fetchResult = await fetchPhotosWithRetry(dropNumber, {
      maxRetries: 5,
      initialDelayMs: 2000,
      onStatusUpdate: (status) => {
        log.debug('ProcessNewDr', `Photo fetch status: ${status.message}`, {
          dropNumber,
          attempt: status.attempt,
          status: status.status,
        });
      },
    });

    const { photos, ont_barcode, ups_serial, fetchAttempts, downloadTriggered, totalWaitTimeMs } =
      fetchResult;

    log.info('ProcessNewDr', `Photo fetch complete for ${dropNumber}`, {
      photoCount: photos.length,
      fetchAttempts,
      downloadTriggered,
      totalWaitTimeMs,
    });

    if (photos.length === 0) {
      log.warn('ProcessNewDr', `No photos found for ${dropNumber}`);
      await persistNoPhotos(dropNumber, ont_barcode, ups_serial);

      return apiResponse.success(res, {
        dropNumber,
        photosDownloaded: 0,
        categorizationStatus: 'no_photos',
        processingTimeMs: Date.now() - startTime,
        isResubmission,
        submissionCount,
        previousSubmission,
        dropsTableMatch,
        projectMismatch,
        expectedProject,
      } as ProcessNewDrResponse);
    }

    log.info('ProcessNewDr', `Found ${photos.length} photos for ${dropNumber}`);
    await persistPhotoMetadata(dropNumber, photos, ont_barcode, ups_serial);

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
        dropsTableMatch,
        projectMismatch,
        expectedProject,
      } as ProcessNewDrResponse);
    }

    // === VLM CATEGORIZATION ===
    const { categorizationStatus } = await runCategorizationPipeline(dropNumber, photos);

    return apiResponse.success(res, {
      dropNumber,
      photosDownloaded: photos.length,
      categorizationStatus,
      processingTimeMs: Date.now() - startTime,
      isResubmission,
      submissionCount,
      previousSubmission,
      dropsTableMatch,
      projectMismatch,
      expectedProject,
    } as ProcessNewDrResponse);
  } catch (error) {
    log.error('ProcessNewDr', 'Error processing new DR', error);
    return apiResponse.internalError(res, error);
  }
}

/** Main handler — verifies bridge secret before dispatching */
async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (!BRIDGE_SECRET) {
    log.error('ProcessNewDr', 'WA_BRIDGE_SECRET env var not set');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server configuration error');
  }

  const secret = (req.body?.secret as string | undefined) ?? req.headers['x-bridge-secret'];
  if (secret !== BRIDGE_SECRET) {
    return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Invalid bridge secret');
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
}

// Webhook endpoint — authenticated via bridge secret
export default handler;
