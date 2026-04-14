/**
 * API Route: /api/activate/refresh
 *
 * Purpose: Manual refresh of DR data from BOSS API (1Map cache)
 * Method: POST
 * Query: dropNumber (required)
 *
 * UNIFIED ARCHITECTURE (Jan 2026):
 * - This endpoint is for MANUAL refresh only (user clicks "Refresh" button)
 * - NOT called automatically during page views
 * - Fetches fresh data from BOSS API and updates unified table
 * - Used when user suspects stale data or photos were recently uploaded
 *
 * Following FibreFlow standards:
 * - Uses apiResponse helper for consistent responses
 * - Neon PostgreSQL with ep-dry-night-a9qyh4sj endpoint
 * - Proper error handling and logging
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';

// BOSS API caches 1Map photo data
const BOSS_API_HOST = 'http://100.96.203.105:8003';

/**
 * Map photo type to unified step number (10 steps)
 */
function mapPhotoTypeToStep(photoType: string): number {
  const mapping: Record<string, number> = {
    'ph_prop': 1, 'ph_sign1': 1, 'ph_drop': 1, 'ph_outs': 1,
    'ph_pole': 2, 'ph_cbl_r': 2,
    'ph_entry_out': 3, 'ph_hm_ln': 3,
    'ph_entry_in': 4, 'ph_hm_en': 4,
    'ph_wall': 5,
    'ph_ont': 6, 'ph_ont_back': 6,
    'ph_powm': 7, 'ph_powm1': 7, 'ph_powm2': 7,
    'ph_after': 8, 'ph_final': 8,
    'ph_lights': 9, 'ph_led': 9,
    'ph_sign2': 10, 'ph_signature': 10,
  };
  return mapping[photoType] || 0;
}

interface BossApiRecord {
  local_photos: Array<{ filename: string; type: string; size?: number }>;
  photo_count: number;
  ont_barcode: string | null;
  ups_serial: string | null;
  // Contact fields (1Map data)
  contact_person_name?: string;
  contact_name?: string;
  contact_person_surname?: string;
  contact_surname?: string;
  contact_number?: string;
  contact_phone?: string;
  email_address?: string;
  contact_email?: string;
  language?: string;
  signup_agent?: string;
  installer_name?: string;
}

/**
 * Fetch fresh data from BOSS API and update unified table
 */
async function refreshFromBossApi(dropNumber: string): Promise<{
  success: boolean;
  photosUpdated: number;
  serialsUpdated: boolean;
  contactUpdated: boolean;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // Trigger download first to ensure latest photos
    const downloadResponse = await fetch(`${BOSS_API_HOST}/api/download/${dropNumber}`, {
      method: 'POST',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!downloadResponse.ok && downloadResponse.status !== 404) {
      log.warn(`Download trigger failed for ${dropNumber}: ${downloadResponse.status}`);
    }

    // Fetch the record
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 10000);

    const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      signal: controller2.signal,
    });

    clearTimeout(timeout2);

    if (!response.ok) {
      return {
        success: false,
        photosUpdated: 0,
        serialsUpdated: false,
        contactUpdated: false,
        error: `BOSS API returned ${response.status}`,
      };
    }

    const data: BossApiRecord = await response.json();

    // Build photos metadata
    const photosMetadata = (data.local_photos || []).map((photo) => ({
      filename: photo.filename,
      step: mapPhotoTypeToStep(photo.type),
      type: photo.type,
      size: photo.size,
    }));

    // Build contact info
    const firstName = data.contact_person_name || data.contact_name || '';
    const lastName = data.contact_person_surname || data.contact_surname || '';
    const subscriberName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
    const subscriberPhone = data.contact_number || data.contact_phone || null;
    const subscriberEmail = data.email_address || data.contact_email || null;

    // Update unified table
    const result = await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         photo_count = $2,
         photos_metadata = $3,
         ont_serial_scanned = COALESCE($4, ont_serial_scanned),
         ups_serial_scanned = COALESCE($5, ups_serial_scanned),
         subscriber_name = COALESCE($6, subscriber_name),
         subscriber_phone = COALESCE($7, subscriber_phone),
         subscriber_email = COALESCE($8, subscriber_email),
         subscriber_language = COALESCE($9, subscriber_language),
         signup_agent = COALESCE($10, signup_agent),
         installer_name = COALESCE($11, installer_name),
         updated_at = NOW()
       WHERE drop_number = $1
       RETURNING id`,
      [
        dropNumber,
        photosMetadata.length,
        JSON.stringify(photosMetadata),
        data.ont_barcode,
        data.ups_serial,
        subscriberName,
        subscriberPhone,
        subscriberEmail,
        data.language || null,
        data.signup_agent || null,
        data.installer_name || null,
      ]
    );

    if (result.rowCount === 0) {
      return {
        success: false,
        photosUpdated: 0,
        serialsUpdated: false,
        contactUpdated: false,
        error: 'DR not found in unified table',
      };
    }

    return {
      success: true,
      photosUpdated: photosMetadata.length,
      serialsUpdated: !!(data.ont_barcode || data.ups_serial),
      contactUpdated: !!(subscriberName || subscriberPhone),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Refresh failed for ${dropNumber}`, { error: errorMessage });
    return {
      success: false,
      photosUpdated: 0,
      serialsUpdated: false,
      contactUpdated: false,
      error: errorMessage,
    };
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const dropNumber = (req.query.dropNumber || req.body?.dropNumber) as string;

  if (!dropNumber) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
  }

  try {
    log.info(`Manual refresh requested for ${dropNumber}`);

    const result = await refreshFromBossApi(dropNumber);

    if (!result.success) {
      log.warn(`Refresh failed for ${dropNumber}`, { error: result.error });
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, result.error || 'Refresh failed');
    }

    log.info(`Refresh completed for ${dropNumber}`, {
      photosUpdated: result.photosUpdated,
      serialsUpdated: result.serialsUpdated,
      contactUpdated: result.contactUpdated,
    });

    return apiResponse.success(res, {
      dropNumber,
      refreshed: true,
      photosUpdated: result.photosUpdated,
      serialsUpdated: result.serialsUpdated,
      contactUpdated: result.contactUpdated,
    });
  } catch (error) {
    log.error(`Refresh error for ${dropNumber}`, { error: error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
