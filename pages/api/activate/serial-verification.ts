/**
 * Serial Verification API
 *
 * GET: Fetch 4-way serial comparison status for a DR
 *
 * Serves pre-computed verification from dr_photo_unified_reviews when available.
 * Falls back to live computation (and persists result) when no pre-computed data exists.
 * Use ?recompute=true to force fresh computation.
 *
 * Compares serials from:
 * 1. OES - Original activation record (reference)
 * 2. Offline - Current offline device report
 * 3. OneMap - 1Map database (scanned barcodes)
 * 4. WA Photo - VLM extracted from WhatsApp submission
 *
 * Returns verification status including:
 * - Each source's serial value
 * - Whether all sources agree
 * - Confidence score
 * - Verification badge status (gold/silver/warning)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';
import { sql } from '@/lib/neon';
import {
  computeAndPersistVerification,
  type SerialVerificationResult,
} from '@/modules/activate/services/serialVerificationService';

// Re-export type for backward compatibility
export type { SerialVerificationResult };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { dropNumber, recompute } = req.query;

  if (!dropNumber || typeof dropNumber !== 'string') {
    return apiResponse.badRequest(res, 'dropNumber is required');
  }

  try {
    // Force recomputation if requested
    if (recompute === 'true') {
      log.info('SerialVerification', `Force recomputing verification for ${dropNumber}`);
      const verification = await computeAndPersistVerification(dropNumber);
      return apiResponse.success(res, { ...verification, source: 'recomputed' });
    }

    // Check for pre-computed verification data
    const precomputed = await sql`
      SELECT
        serial_verification_status,
        serial_verification_label,
        serial_verification_details,
        serial_verification_computed_at
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${dropNumber}
        AND serial_verification_computed_at IS NOT NULL
    `;

    if (precomputed.length > 0 && precomputed[0].serial_verification_status) {
      const row = precomputed[0];
      const details = row.serial_verification_details || {};

      log.info('SerialVerification', `Serving pre-computed verification for ${dropNumber}`, {
        status: row.serial_verification_status,
        computedAt: row.serial_verification_computed_at,
      });

      const verification: SerialVerificationResult = {
        dropNumber,
        ont: details.ont || { oes: null, offline: null, onemap: null, waPhoto: null, waPhotoConfidence: null },
        ups: details.ups || { oes: null, offline: null, onemap: null, waPhoto: null, waPhotoConfidence: null },
        ontVerification: details.ontVerification || { sourcesWithData: 0, sourcesAgreeing: 0, allAgree: false, status: 'insufficient' },
        upsVerification: details.upsVerification || { sourcesWithData: 0, sourcesAgreeing: 0, allAgree: false, status: 'insufficient' },
        overallStatus: row.serial_verification_status,
        badgeLabel: row.serial_verification_label || '',
      };

      return apiResponse.success(res, {
        ...verification,
        source: 'precomputed',
        computedAt: row.serial_verification_computed_at,
      });
    }

    // No pre-computed data — compute live and persist for future requests
    log.info('SerialVerification', `No pre-computed data for ${dropNumber}, computing live`);
    const verification = await computeAndPersistVerification(dropNumber);

    return apiResponse.success(res, { ...verification, source: 'computed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('SerialVerification', `Failed: ${message}`);
    return apiResponse.error(res, message, 500);
  }
}

export default withAuth(withErrorHandler(handler));
