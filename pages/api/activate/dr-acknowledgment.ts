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
 */
function generateAckMessage(
  dropNumber: string,
  found: boolean,
  photoCount: number,
  ontSerial: string | null,
  upsSerial: string | null
): string {
  if (!found) {
    return (
      `📸 *${dropNumber} Received!*\n\n` +
      `⏳ Photos not yet available in 1Map.\n` +
      `Please ensure photos are uploaded to OneMap.\n\n` +
      `Thank you! We'll process your submission shortly.`
    );
  }

  const photoLine =
    photoCount > 0 ? `✅ Photos: ${photoCount}` : `⚠️ Photos: None found - please upload to 1Map`;

  const ontLine = ontSerial
    ? `✅ ONT Serial: ${ontSerial}`
    : `⚠️ ONT Serial: Not scanned - please upload to 1Map`;

  const upsLine = upsSerial
    ? `✅ UPS Serial: ${upsSerial}`
    : `⚠️ UPS Serial: Not scanned - please upload to 1Map`;

  return (
    `📸 *${dropNumber} Received!*\n\n` +
    `${photoLine}\n` +
    `${ontLine}\n` +
    `${upsLine}\n\n` +
    `Thank you! QA review will follow shortly.`
  );
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

    const message = generateAckMessage(dropNumber, found, photoCount, ontSerial, upsSerial);
    const duration = Date.now() - startTime;

    log.info('DrAcknowledgment', `Acknowledgment ready for ${dropNumber} in ${duration}ms`);

    return apiResponse.success(res, {
      dropNumber,
      found,
      photoCount,
      ontSerial,
      upsSerial,
      message,
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
