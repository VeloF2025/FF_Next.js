/**
 * API Route: /api/activate/validate-prerequisites
 *
 * Purpose: Phase 1 of QA Wizard - Check prerequisites before detailed review
 * Method: GET
 *
 * Checks:
 * - Photos available (fetched from OneMap)
 * - ONT serial synced (from dr_photo_unified_reviews - synced via 1Map app)
 * - UPS serial synced (from dr_photo_unified_reviews - synced via 1Map app)
 * - Serial format validation
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { checkPhotosExist } from '@/modules/activate/services/photoFetchService';
import {
  checkPrerequisites,
  validateOntSerial,
  validateUpsSerial,
  type DrValidationData,
  type PrerequisitesResult,
} from '@/modules/activate/services/qaAutoFailService';

interface PrerequisitesResponse {
  drNumber: string;
  project: string | null;
  prerequisites: PrerequisitesResult;
  photosCheck: {
    exists: boolean;
    count: number;
    needsDownload: boolean;
  };
  serialsFromOneMap: {
    ontSerial: string | null;
    upsSerial: string | null;
    ontValid: { valid: boolean; reason: string };
    upsValid: { valid: boolean; reason: string };
  };
  canProceed: boolean;
  message: string;
}

/**
 * GET /api/activate/validate-prerequisites?dropNumber=XXX
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    log.info('ValidatePrerequisites', `Checking prerequisites for ${dropNumber}`);

    // 1. Check if photos exist
    const photosCheck = await checkPhotosExist(dropNumber);

    // 2. Get serials and project from dr_photo_unified_reviews (OneMap synced data via 1Map app)
    const drResult = await pool.query(
      `SELECT ont_serial_scanned, ups_serial_scanned, project
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1
       LIMIT 1`,
      [dropNumber]
    );

    const drData = drResult.rows[0] || { ont_serial_scanned: null, ups_serial_scanned: null, project: null };
    const ontSerial = drData.ont_serial_scanned;
    const upsSerial = drData.ups_serial_scanned;
    const project = drData.project;

    // 3. Validate serial formats
    const ontValid = validateOntSerial(ontSerial);
    const upsValid = validateUpsSerial(upsSerial);

    // 4. Run full prerequisites check
    const validationData: DrValidationData = {
      drNumber: dropNumber,
      photoCount: photosCheck.count,
      photos: [], // We don't need photos for prerequisites check
      ontSerial,
      upsSerial,
      powerMeterDbm: null,
      vlmOntSerialStep6: null,
      vlmOntSerialStep9: null,
      vlmDrNumberStep9: null,
    };

    const prerequisites = checkPrerequisites(validationData);

    // Determine if we can proceed
    const canProceed = prerequisites.passed && photosCheck.exists;

    let message: string;
    if (canProceed) {
      message = 'All prerequisites met. Ready for photo review.';
    } else if (!photosCheck.exists) {
      message = photosCheck.needsDownload
        ? 'Photos not synced yet. Will download when categorization starts.'
        : 'No photos found for this DR.';
    } else {
      message = `Prerequisites failed: ${prerequisites.failures.join(', ')}`;
    }

    const response: PrerequisitesResponse = {
      drNumber: dropNumber,
      project,
      prerequisites,
      photosCheck,
      serialsFromOneMap: {
        ontSerial,
        upsSerial,
        ontValid,
        upsValid,
      },
      canProceed,
      message,
    };

    // Update unified table with prerequisites check result (after migration 127)
    const newPhase = prerequisites.passed && photosCheck.exists ? 'photo_review' : 'prerequisites';
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         prerequisites_passed = $1,
         prerequisites_checked_at = NOW(),
         onemap_ont_serial = $2,
         onemap_ups_serial = $3,
         qa_phase = $4,
         updated_at = NOW()
       WHERE drop_number = $5`,
      [prerequisites.passed, ontSerial, upsSerial, newPhase, dropNumber]
    );

    log.info('ValidatePrerequisites', `Prerequisites ${canProceed ? 'PASSED' : 'FAILED'} for ${dropNumber}`, {
      photosExist: photosCheck.exists,
      photoCount: photosCheck.count,
      ontSerial: !!ontSerial,
      upsSerial: !!upsSerial,
    });

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('ValidatePrerequisites', 'Error checking prerequisites', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(handler);
