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
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { detectSwappedSerials, looksLikeOntSerial, looksLikeGizzuSerial } from '@/modules/activate/services/qaAutoFailService';

const ONEMAP_HOST = process.env.ONEMAP_HOST || 'http://192.168.1.150:8003';

interface AckRequest {
  dropNumber: string;
  project?: string;
}

interface OneMapRecordResponse {
  dr_number: string;
  site?: string;
  site_name?: string;
  status?: string;
  photo_count?: number;
  local_photos?: Array<{ filename: string; type?: string }>;
  ont_barcode?: string | null;
  ups_serial?: string | null;
}

/**
 * Extract ONT serial from barcode scan data
 * Barcode format: (S)SERIAL(23S)CODE(20S)CODE(U)user(P)pass(ID)id(KY)key(N)model
 * We want just the serial after (S) and before the next (
 */
function extractOntSerial(barcodeData: string | null): string | null {
  if (!barcodeData) return null;

  // Look for (S) pattern and extract the value after it
  const serialMatch = barcodeData.match(/\(S\)([^(]+)/);
  if (serialMatch && serialMatch[1]) {
    return serialMatch[1].trim();
  }

  // If no (S) pattern, check if it's just a plain serial (no parentheses)
  if (!barcodeData.includes('(')) {
    return barcodeData.trim();
  }

  return null;
}

/**
 * Generate WhatsApp acknowledgment message
 * Returns empty string if DR not found - Go bridge will skip sending
 *
 * IMPORTANT: Detects swapped serials (ONT in UPS field or vice versa) and warns immediately
 */
function generateAckMessage(
  dropNumber: string,
  found: boolean,
  photoCount: number,
  ontSerial: string | null,
  upsSerial: string | null
): { message: string; swapped: boolean; swapDetails: string | null } {
  // If DR not found in 1Map, return empty string
  // Go bridge checks for empty message and won't send anything
  // This prevents confusing "Received!" messages for invalid DRs
  if (!found) {
    return { message: '', swapped: false, swapDetails: null };
  }

  // Check for swapped serials - this is critical!
  const swapCheck = detectSwappedSerials(ontSerial, upsSerial);
  const lines: string[] = [];

  // Header
  lines.push(`📸 *${dropNumber} Received!*`);
  lines.push('');

  // CRITICAL: Swapped serials warning at the top
  if (swapCheck.swapped) {
    lines.push('🔴 *ALERT: SERIALS APPEAR SWAPPED*');
    lines.push('');
    // Show what's in each field
    if (ontSerial && looksLikeGizzuSerial(ontSerial)) {
      lines.push(`❌ ONT field has Gizzu serial: ${ontSerial}`);
    }
    if (upsSerial && looksLikeOntSerial(upsSerial)) {
      lines.push(`❌ UPS field has ONT serial: ${upsSerial}`);
    }
    lines.push('');
    lines.push('*Please correct in 1Map:*');
    lines.push('• ONT should be ALCL/ALCB serial');
    lines.push('• UPS should be GU18W serial (Gizzu)');
    lines.push('');
  }

  // Photo count
  const photoLine =
    photoCount > 0 ? `✅ Photos: ${photoCount}` : `⚠️ Photos: None found - please upload to 1Map`;
  lines.push(photoLine);

  // Serial status (with swap consideration)
  if (swapCheck.swapped) {
    // Already warned above, just show the raw values
    lines.push(`⚠️ ONT field: ${ontSerial || 'Not scanned'}`);
    lines.push(`⚠️ UPS field: ${upsSerial || 'Not scanned'}`);
  } else {
    // Normal display
    const ontLine = ontSerial
      ? `✅ ONT Serial: ${ontSerial}`
      : `⚠️ ONT Serial: Not scanned - please upload to 1Map`;
    lines.push(ontLine);

    const upsLine = upsSerial
      ? `✅ UPS Serial: ${upsSerial}`
      : `⚠️ UPS Serial: Not scanned - please upload to 1Map`;
    lines.push(upsLine);
  }

  lines.push('');

  // Footer
  if (swapCheck.swapped) {
    lines.push('⚠️ Please correct the swapped serials before QA review.');
  } else {
    lines.push('Thank you! QA review will follow shortly.');
  }

  return {
    message: lines.join('\n'),
    swapped: swapCheck.swapped,
    swapDetails: swapCheck.swapped ? swapCheck.details : null,
  };
}

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const startTime = Date.now();

  try {
    const { dropNumber, project } = req.body as AckRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('DrAcknowledgment', `Getting acknowledgment data for ${dropNumber}`, { project });

    let found = false;
    let photoCount = 0;
    let ontSerial: string | null = null;
    let upsSerial: string | null = null;

    try {
      // Read-only query to OneMap - do NOT use /api/download which triggers fetching
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${ONEMAP_HOST}/api/record/${dropNumber}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as OneMapRecordResponse;
        found = true;
        photoCount = data.photo_count || data.local_photos?.length || 0;
        ontSerial = extractOntSerial(data.ont_barcode);
        upsSerial = data.ups_serial || null;

        log.info('DrAcknowledgment', `OneMap data for ${dropNumber}`, {
          photoCount,
          hasOnt: !!ontSerial,
          hasUps: !!upsSerial,
        });
      } else if (response.status === 404 || response.status === 422) {
        log.info('DrAcknowledgment', `DR ${dropNumber} not found in OneMap`);
      } else {
        log.warn('DrAcknowledgment', `OneMap returned ${response.status} for ${dropNumber}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        log.warn('DrAcknowledgment', `OneMap timeout for ${dropNumber}`);
      } else {
        log.warn('DrAcknowledgment', `OneMap query failed for ${dropNumber}`, { error });
      }
      // Continue with found=false - don't fail the request
    }

    const ackResult = generateAckMessage(dropNumber, found, photoCount, ontSerial, upsSerial);
    const duration = Date.now() - startTime;

    if (!found) {
      log.info('DrAcknowledgment', `DR ${dropNumber} not found in 1Map - returning empty message (no ack will be sent)`);
    } else if (ackResult.swapped) {
      log.warn('DrAcknowledgment', `SWAPPED SERIALS detected for ${dropNumber}`, {
        ontSerial,
        upsSerial,
        details: ackResult.swapDetails,
      });
    } else {
      log.info('DrAcknowledgment', `Acknowledgment ready for ${dropNumber} in ${duration}ms`);
    }

    return apiResponse.success(res, {
      dropNumber,
      found,
      photoCount,
      ontSerial,
      upsSerial,
      message: ackResult.message,
      serialsSwapped: ackResult.swapped,
      swapDetails: ackResult.swapDetails,
    });
  } catch (error) {
    log.error('DrAcknowledgment', 'Error generating acknowledgment', { error });
    return apiResponse.internalError(res, error);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
}
