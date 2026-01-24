/**
 * Serial Verification API
 *
 * GET: Fetch 4-way serial comparison status for a DR
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
import { sql } from '@/lib/db';

export interface SerialVerificationResult {
  dropNumber: string;
  ont: {
    oes: string | null;
    offline: string | null;
    onemap: string | null;
    waPhoto: string | null;
    waPhotoConfidence: number | null;
  };
  ups: {
    oes: string | null;
    offline: string | null;
    onemap: string | null;
    waPhoto: string | null;
    waPhotoConfidence: number | null;
  };
  ontVerification: {
    sourcesWithData: number;
    sourcesAgreeing: number;
    allAgree: boolean;
    status: 'verified' | 'partial' | 'mismatch' | 'insufficient';
  };
  upsVerification: {
    sourcesWithData: number;
    sourcesAgreeing: number;
    allAgree: boolean;
    status: 'verified' | 'partial' | 'mismatch' | 'insufficient';
  };
  overallStatus: 'gold' | 'silver' | 'bronze' | 'warning' | 'none';
  badgeLabel: string;
}

function normalizeSerial(serial: string | null): string | null {
  if (!serial) return null;
  return serial.trim().toUpperCase();
}

function calculateVerification(serials: (string | null)[]): {
  sourcesWithData: number;
  sourcesAgreeing: number;
  allAgree: boolean;
  status: 'verified' | 'partial' | 'mismatch' | 'insufficient';
} {
  const normalized = serials.map(normalizeSerial);
  const nonNull = normalized.filter(Boolean) as string[];
  const unique = [...new Set(nonNull)];

  if (nonNull.length === 0) {
    return { sourcesWithData: 0, sourcesAgreeing: 0, allAgree: false, status: 'insufficient' };
  }

  if (nonNull.length === 1) {
    return { sourcesWithData: 1, sourcesAgreeing: 1, allAgree: true, status: 'insufficient' };
  }

  const allAgree = unique.length === 1;
  const mostCommon = nonNull.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const maxAgreeing = Math.max(...Object.values(mostCommon));

  if (allAgree && nonNull.length >= 3) {
    return { sourcesWithData: nonNull.length, sourcesAgreeing: nonNull.length, allAgree: true, status: 'verified' };
  }

  if (allAgree && nonNull.length === 2) {
    return { sourcesWithData: 2, sourcesAgreeing: 2, allAgree: true, status: 'partial' };
  }

  return {
    sourcesWithData: nonNull.length,
    sourcesAgreeing: maxAgreeing,
    allAgree: false,
    status: maxAgreeing >= 3 ? 'partial' : 'mismatch',
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { dropNumber } = req.query;

  if (!dropNumber || typeof dropNumber !== 'string') {
    return apiResponse.badRequest(res, 'dropNumber is required');
  }

  try {
    // Get serials from all 4 sources
    const result = await sql`
      WITH oes_data AS (
        SELECT serial_number as ont, ups_serial as ups
        FROM oes_activations
        WHERE drop_number = ${dropNumber}
        LIMIT 1
      ),
      offline_data AS (
        SELECT serial_number as ont, expected_serial as expected_ont
        FROM offline_devices
        WHERE drop_number = ${dropNumber}
        LIMIT 1
      ),
      onemap_data AS (
        SELECT ont_serial_scanned as ont, ups_serial_scanned as ups
        FROM dr_photo_unified_reviews
        WHERE drop_number = ${dropNumber}
        LIMIT 1
      ),
      wa_photo_data AS (
        SELECT vlm_ont_serial as ont, vlm_ups_serial as ups, vlm_confidence
        FROM wa_photos
        WHERE drop_number = ${dropNumber}
          AND purpose = 'activation'
          AND vlm_processed = true
        ORDER BY vlm_confidence DESC NULLS LAST, message_timestamp DESC
        LIMIT 1
      )
      SELECT
        (SELECT ont FROM oes_data) as oes_ont,
        (SELECT ups FROM oes_data) as oes_ups,
        (SELECT ont FROM offline_data) as offline_ont,
        (SELECT ont FROM onemap_data) as onemap_ont,
        (SELECT ups FROM onemap_data) as onemap_ups,
        (SELECT ont FROM wa_photo_data) as wa_ont,
        (SELECT ups FROM wa_photo_data) as wa_ups,
        (SELECT vlm_confidence FROM wa_photo_data) as wa_confidence
    `;

    const row = result[0] || {};

    const ontSerials = [
      row.oes_ont as string | null,
      row.offline_ont as string | null,
      row.onemap_ont as string | null,
      row.wa_ont as string | null,
    ];

    const upsSerials = [
      row.oes_ups as string | null,
      null, // No offline UPS tracking currently
      row.onemap_ups as string | null,
      row.wa_ups as string | null,
    ];

    const ontVerification = calculateVerification(ontSerials);
    const upsVerification = calculateVerification(upsSerials);

    // Determine overall badge status
    let overallStatus: 'gold' | 'silver' | 'bronze' | 'warning' | 'none' = 'none';
    let badgeLabel = '';

    // Gold: Both ONT and UPS have 3+ sources agreeing
    if (ontVerification.status === 'verified' && upsVerification.status === 'verified') {
      overallStatus = 'gold';
      badgeLabel = '4-Way Verified';
    } else if (ontVerification.status === 'verified' || upsVerification.status === 'verified') {
      // Silver: At least one fully verified
      overallStatus = 'silver';
      badgeLabel = 'Serial Verified';
    } else if (ontVerification.allAgree && ontVerification.sourcesWithData >= 2) {
      // Bronze: ONT matches across 2+ sources
      overallStatus = 'bronze';
      badgeLabel = 'Serial Confirmed';
    } else if (ontVerification.status === 'mismatch' || upsVerification.status === 'mismatch') {
      overallStatus = 'warning';
      badgeLabel = 'Serial Mismatch';
    }

    const verification: SerialVerificationResult = {
      dropNumber,
      ont: {
        oes: row.oes_ont || null,
        offline: row.offline_ont || null,
        onemap: row.onemap_ont || null,
        waPhoto: row.wa_ont || null,
        waPhotoConfidence: row.wa_confidence ? Number(row.wa_confidence) : null,
      },
      ups: {
        oes: row.oes_ups || null,
        offline: null,
        onemap: row.onemap_ups || null,
        waPhoto: row.wa_ups || null,
        waPhotoConfidence: row.wa_confidence ? Number(row.wa_confidence) : null,
      },
      ontVerification,
      upsVerification,
      overallStatus,
      badgeLabel,
    };

    log.info('SerialVerification', `Fetched verification for ${dropNumber}`, {
      ontStatus: ontVerification.status,
      upsStatus: upsVerification.status,
      overallStatus,
    });

    return apiResponse.success(res, verification);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('SerialVerification', `Failed: ${message}`);
    return apiResponse.error(res, message, 500);
  }
}

export default withAuth(withErrorHandler(handler));
