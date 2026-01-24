/**
 * API: /api/activate/wa-photos
 * Query WhatsApp photos for a specific DR
 *
 * GET /api/activate/wa-photos?dropNumber=DR1234567
 * Returns photos submitted via WhatsApp alongside the DR
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

interface WAPhoto {
  id: string;
  wa_message_id: string;
  wa_group_jid: string;
  sender_name: string | null;
  message_timestamp: string;
  original_filename: string | null;
  local_path: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  vlm_ont_serial: string | null;
  vlm_ups_serial: string | null;
  vlm_processed: boolean;
  created_at: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, ['GET']);
  }

  const { dropNumber } = req.query;

  if (!dropNumber || typeof dropNumber !== 'string') {
    return apiResponse.badRequest(res, 'dropNumber query parameter is required');
  }

  try {
    // Query wa_photos table for this DR
    const photos = await sql<WAPhoto[]>`
      SELECT
        id,
        wa_message_id,
        wa_group_jid,
        sender_name,
        message_timestamp,
        original_filename,
        local_path,
        mime_type,
        file_size_bytes,
        vlm_ont_serial,
        vlm_ups_serial,
        vlm_processed,
        created_at
      FROM wa_photos
      WHERE drop_number = ${dropNumber.toUpperCase()}
        AND purpose = 'activation'
      ORDER BY message_timestamp DESC, photo_index ASC
    `;

    // Build URLs for photo proxy
    const photosWithUrls = photos.map((photo) => {
      // Extract DR and filename from local_path
      // NEW local_path format: /var/lib/docker/volumes/boss-vps_dr_photos/_data/{DR}/{filename}
      let url = '';
      if (photo.local_path) {
        const pathParts = photo.local_path.split('/');
        const filename = pathParts[pathParts.length - 1];
        const drFolder = pathParts[pathParts.length - 2];
        // Use the existing photo proxy endpoint
        url = `/api/activate/photo/${drFolder}/${filename}`;
      }

      return {
        id: photo.id,
        wa_message_id: photo.wa_message_id,
        wa_group_jid: photo.wa_group_jid,
        sender_name: photo.sender_name,
        message_timestamp: photo.message_timestamp,
        original_filename: photo.original_filename,
        local_path: photo.local_path,
        mime_type: photo.mime_type,
        file_size_bytes: photo.file_size_bytes,
        vlm_ont_serial: photo.vlm_ont_serial,
        vlm_ups_serial: photo.vlm_ups_serial,
        vlm_processed: photo.vlm_processed,
        created_at: photo.created_at,
        proxy_url: url,
      };
    });

    log.info(`Fetched ${photos.length} WA photos for ${dropNumber}`);

    return apiResponse.success(res, {
      dropNumber: dropNumber.toUpperCase(),
      photoCount: photos.length,
      photos: photosWithUrls,
    });
  } catch (error) {
    log.error('Error fetching WA photos:', error);
    return apiResponse.serverError(res, 'Failed to fetch WhatsApp photos');
  }
}

export default withAuth(handler);
