/**
 * API Route: /api/activate/dr-acknowledgment
 *
 * Purpose: Get immediate acknowledgment data for a DR submission
 * Method: POST
 *
 * Returns photo count, ONT serial, UPS serial, and pre-formatted WhatsApp message.
 * This is a lightweight read-only query - does NOT trigger photo downloads.
 *
 * Used by Go WhatsApp Bridge to send immediate reply to DR submissions.
 * Authenticated via shared bridge secret (not withAuth).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';
import {
  generateAckMessage,
  generateNotOnOneMapMessage,
  generateResubmissionAckMessage,
  normalizeForCompare,
} from '@/modules/activate/services/ack/ackMessageBuilder';
import {
  checkDropsTable,
  checkExistingSubmission,
  checkWAPhotos,
  fetchOneMapRecord,
} from '@/modules/activate/services/ack/drLookupService';
import {
  checkDuplicateSerials,
  markForRework,
  saveSwapDetection,
  updateOneMapStatus,
} from '@/modules/activate/services/ack/drStatusService';
import type { AckResult, DuplicateSerialResult, VlmSerialResult, WAPhotoCheck } from '@/modules/activate/services/ack/types';
import { extractWaPhotoSerials, waitForWaPhotos } from '@/modules/activate/services/serialVerificationService';

const logger = createLogger('api/activate/dr-acknowledgment');
const BRIDGE_SECRET = process.env.WA_BRIDGE_SECRET;

// Vercel: Allow up to 30s for delayed VLM serial extraction
export const config = { maxDuration: 30 };

interface AckRequest {
  dropNumber: string;
  project?: string;
  secret?: string;
}

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, project } = req.body as AckRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    logger.info(`Getting acknowledgment data for ${dropNumber}`, { project });

    // Resubmission detection — only treat as resubmission if QA has actually run
    // (qa_decision set or feedback sent). Bare UPSERT records from concurrent calls
    // must NOT trigger resubmission logic.
    // See: .claude/knowledge-base/activate/dr-acknowledgment-race-condition.md
    const existingSubmission = await checkExistingSubmission(dropNumber);
    const isResubmission =
      existingSubmission !== null &&
      (existingSubmission.qa_decision !== null || existingSubmission.feedback_message !== null);

    let submissionNumber = 1;
    let previousPhotoCount = 0;

    if (isResubmission) {
      submissionNumber = (existingSubmission.submission_count || 1) + 1;
      previousPhotoCount = existingSubmission.photo_count || 0;
      logger.info(`RESUBMISSION detected for ${dropNumber}`, {
        previousSubmissions: existingSubmission.submission_count,
        previousPhotoCount,
        qaDecision: existingSubmission.qa_decision,
      });
    } else if (existingSubmission !== null) {
      logger.info(`Record exists for ${dropNumber} but no QA decision yet - treating as first submission`, {
        submissionCount: existingSubmission.submission_count,
        qaDecision: existingSubmission.qa_decision,
        feedbackMessage: existingSubmission.feedback_message ? 'yes' : 'no',
      });
    }

    // Fetch DR from OneMap via BOSS API (read-only, 5s timeout)
    const { found, photoCount, ontSerial, upsSerial } = await fetchOneMapRecord(dropNumber);

    // Start duplicate serial check in parallel with WA photo polling (adds 0ms wall-clock time)
    const duplicateCheckPromise: Promise<DuplicateSerialResult> =
      ontSerial || upsSerial
        ? checkDuplicateSerials(dropNumber, ontSerial, upsSerial)
        : Promise.resolve({ ontDuplicates: [], upsDuplicates: [] });

    // Poll for WhatsApp serial photos and run VLM serial extraction.
    // Race condition: Go Bridge creates wa_photos records asynchronously.
    let waPhotoCheck: WAPhotoCheck = { hasPhoto: false, photoCount: 0 };
    let vlmResult: VlmSerialResult | undefined;

    try {
      const photosReady = await waitForWaPhotos(dropNumber, 10000, 2000);

      if (photosReady) {
        waPhotoCheck = await checkWAPhotos(dropNumber);
        logger.info(`WA photos found for ${dropNumber}, running VLM extraction`, {
          waPhotoCount: waPhotoCheck.photoCount,
        });

        const extraction = await extractWaPhotoSerials(dropNumber, {
          force: false,
          timeoutMs: 8000,
        });

        if (extraction.bestOnt || extraction.bestUps) {
          const ontConf = extraction.bestOnt?.confidence || 0;
          const upsConf = extraction.bestUps?.confidence || 0;
          vlmResult = {
            ontSerial: extraction.bestOnt?.serial || null,
            upsSerial: extraction.bestUps?.serial || null,
            confidence: Math.max(ontConf, upsConf),
            ontConfidence: ontConf,
            upsConfidence: upsConf,
          };
          logger.info(`VLM serial extraction completed for ${dropNumber}`, {
            ontExtracted: vlmResult.ontSerial,
            upsExtracted: vlmResult.upsSerial,
            confidence: vlmResult.confidence,
            photosProcessed: extraction.photosProcessed,
          });
        } else {
          logger.info(`VLM found no serials in ${extraction.photosProcessed} photos for ${dropNumber}`);
        }
      } else {
        waPhotoCheck = await checkWAPhotos(dropNumber);
        logger.info(`No WA photos appeared for ${dropNumber} within timeout`);
      }
    } catch (vlmError) {
      // VLM failure is non-critical — fall back to 1Map serials only
      logger.warn(`VLM extraction failed for ${dropNumber} - using 1Map only`, {
        error: vlmError instanceof Error ? vlmError.message : String(vlmError),
      });
      waPhotoCheck = await checkWAPhotos(dropNumber);
    }

    // Await duplicate check (was running in parallel with WA photo polling)
    const duplicates = await duplicateCheckPromise;
    if (duplicates.ontDuplicates.length > 0 || duplicates.upsDuplicates.length > 0) {
      logger.warn(`Duplicate serials found for ${dropNumber}`, {
        ontDuplicates: duplicates.ontDuplicates.map(d => d.drop_number),
        upsDuplicates: duplicates.upsDuplicates.map(d => d.drop_number),
      });
    }

    // Build acknowledgment message based on scenario
    let ackResult: AckResult;
    let notOnOneMap = false;

    if (isResubmission && found) {
      ackResult = generateResubmissionAckMessage(
        dropNumber,
        photoCount,
        previousPhotoCount,
        submissionNumber,
        ontSerial,
        upsSerial,
        vlmResult,
        duplicates
      );
      await markForRework(dropNumber, photoCount);
      await updateOneMapStatus(dropNumber, 'found', ontSerial, upsSerial);
    } else if (!found) {
      const dropsRecord = await checkDropsTable(dropNumber);

      if (dropsRecord) {
        notOnOneMap = true;
        ackResult = generateNotOnOneMapMessage(dropNumber, dropsRecord, waPhotoCheck);
        logger.warn(`DR ${dropNumber} found in drops but NOT in 1Map`, {
          project: dropsRecord.project_name,
          pole: dropsRecord.pole_number,
        });
        await updateOneMapStatus(dropNumber, 'not_found');
      } else {
        // Truly unknown DR — notify the tech to correct it
        ackResult = {
          message: [
            `❌ *${dropNumber} - Not Found*`,
            '',
            'This DR number was not found in the system.',
            'Please check for typos and resubmit with the correct DR number.',
            '',
            '💡 _Common issues:_',
            '• Missing "R" — e.g. D1234 instead of DR1234',
            '• Extra/missing digits',
            '• Wrong project group',
          ].join('\n'),
          swapped: false,
          swapDetails: null,
        };
        logger.warn(`DR ${dropNumber} not found in 1Map or drops - notifying tech`);
      }
    } else {
      // Normal first submission found in 1Map
      ackResult = generateAckMessage(
        dropNumber,
        found,
        photoCount,
        ontSerial,
        upsSerial,
        waPhotoCheck,
        vlmResult,
        duplicates
      );
      await updateOneMapStatus(dropNumber, 'found', ontSerial, upsSerial);
    }

    const duration = Date.now() - startTime;

    if (!found && !notOnOneMap) {
      logger.info(`DR ${dropNumber} not found anywhere - sending "not found" notification`);
    } else if (notOnOneMap) {
      logger.info(`DR ${dropNumber} NOT ON 1MAP - warning ack sent in ${duration}ms`);
    } else if (isResubmission) {
      logger.info(`Resubmission acknowledgment ready for ${dropNumber}`, {
        submissionNumber,
        photoCount,
        previousPhotoCount,
        duration: `${duration}ms`,
      });
    } else if (ackResult.swapped) {
      logger.warn(`SWAPPED SERIALS detected for ${dropNumber}`, {
        ontSerial,
        upsSerial,
        details: ackResult.swapDetails,
      });
      await saveSwapDetection(dropNumber, ontSerial, upsSerial, ackResult.swapDetails);
    } else {
      logger.info(`Acknowledgment ready for ${dropNumber} in ${duration}ms`);
    }

    const hasDuplicates = duplicates.ontDuplicates.length > 0 || duplicates.upsDuplicates.length > 0;
    const ontMatch = ontSerial && vlmResult?.ontSerial
      ? normalizeForCompare(ontSerial) === normalizeForCompare(vlmResult.ontSerial)
      : null;
    const upsMatch = upsSerial && vlmResult?.upsSerial
      ? normalizeForCompare(upsSerial) === normalizeForCompare(vlmResult.upsSerial)
      : null;

    return apiResponse.success(res, {
      dropNumber,
      found: found || notOnOneMap,
      photoCount,
      ontSerial,
      upsSerial,
      message: ackResult.message,
      serialsSwapped: ackResult.swapped,
      swapDetails: ackResult.swapDetails,
      notOnOneMap,
      isResubmission,
      submissionNumber,
      previousPhotoCount: isResubmission ? previousPhotoCount : null,
      waSerialPhoto: { received: waPhotoCheck.hasPhoto, count: waPhotoCheck.photoCount },
      vlmSerialCheck: vlmResult
        ? { ontSerial: vlmResult.ontSerial, upsSerial: vlmResult.upsSerial, confidence: vlmResult.confidence, ontMatch, upsMatch }
        : null,
      duplicateSerials: hasDuplicates
        ? { ont: duplicates.ontDuplicates.map(d => d.drop_number), ups: duplicates.upsDuplicates.map(d => d.drop_number) }
        : null,
    });
  } catch (error) {
    logger.error('Error generating acknowledgment', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (!BRIDGE_SECRET) {
    logger.error('WA_BRIDGE_SECRET env var not set');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server configuration error');
  }

  const secret = (req.body as AckRequest)?.secret || req.headers['x-bridge-secret'];
  if (secret !== BRIDGE_SECRET) {
    return apiResponse.error(res, ErrorCode.UNAUTHORIZED, 'Invalid bridge secret');
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
}

// Webhook endpoint - authenticated via bridge secret
export default handler;
